"""PWA が走行後に Capture を取りに来る HTTP（B2-5。docs/specs/edge-capture E5）。

WebSocket のサーバー（server.py）とは別のポート。信頼の境界は車内の Wi-Fi AP（WPA2）で、ここでは
- Host を IP リテラル・localhost・ezoroad.local に限る（DNS rebinding）
- Origin があるリクエストは、許可リスト、または Host と同じホスト名のときだけ許す
  （別サイトのページから書かせない）
- 書き込みは JSON だけ（フォームの単純リクエストでは書けない）。
  本文 8 KB・同時 8 接続・5 秒の打ち切り
を守る。応答にパス・例外文を出さない。一覧はメモリの索引から返す（ディスクを走査しない）。
"""

from __future__ import annotations

import ipaddress
import json
import logging
import re
import ssl
import threading
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from time import perf_counter
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlsplit

from detector.capture.store import valid_id

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from detector.capture.store import CaptureStore
    from detector.config import CaptureServerConfig

__all__ = ["CaptureApi", "CaptureServer", "CaptureServerError", "Response"]

logger = logging.getLogger("detector.capture.http")

MAX_BODY_BYTES = 8 * 1024
MAX_IDS = 200
DEFAULT_LIMIT = 200
MAX_LIMIT = 500
ALLOWED_HOST_NAMES = frozenset({"localhost", "ezoroad.local"})
_IMAGE_PATH = re.compile(r"/captures/([^/]+)/image")
_ROUTES: dict[str, tuple[str, str]] = {
    "/captures": ("list", "GET, OPTIONS"),
    "/captures/consent": ("consent", "POST, OPTIONS"),
    "/captures/uploaded": ("uploaded", "POST, OPTIONS"),
}


class CaptureServerError(Exception):
    """待ち受けを始められない（ポート使用中など）。"""


@dataclass
class Response:
    status: int
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict)


def _to_int(text: str) -> int | None:
    """ASCII の数字だけの文字列を整数に（`"²"` など isdigit() が True の文字で落とさない）。"""
    if not text or not text.isascii() or not text.isdigit():
        return None
    return int(text)


def _json(status: int, payload: object) -> Response:
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
    return Response(status, body, {"Content-Type": "application/json; charset=utf-8"})


def _error(status: int, code: str, message: str) -> Response:
    return _json(status, {"error": {"code": code, "message": message}})


def _host_name(host: str | None) -> str | None:
    """Host ヘッダのホスト名（小文字、ポートと [] を除く）。不正なら None。"""
    if not host or len(host) > 255:
        return None
    text = host.strip().lower()
    if text.startswith("["):
        end = text.find("]")
        return text[1:end] if end > 0 else None
    return text.rsplit(":", 1)[0] if text.count(":") == 1 else text


def _host_allowed(host: str | None) -> bool:
    name = _host_name(host)
    if not name:
        return False
    if name in ALLOWED_HOST_NAMES:
        return True
    try:
        ipaddress.ip_address(name)
    except ValueError:
        return False
    return True


def _origin_host(origin: str) -> str | None:
    try:
        parts = urlsplit(origin)
        if parts.scheme not in ("http", "https") or parts.path or parts.query or parts.fragment:
            return None
        return parts.hostname.lower() if parts.hostname else None
    except ValueError:
        return None


class CaptureApi:
    """HTTP を知らない純粋な処理。handle(method, target, headers, body) → Response。"""

    def __init__(
        self,
        store: CaptureStore,
        idle_seconds: Callable[[], float | None],
        allowed_origins: tuple[str, ...] = (),
    ) -> None:
        self._store = store
        self._idle = idle_seconds
        self._allowed = frozenset(allowed_origins)

    def handle(self, method: str, target: str, headers: Mapping[str, str], body: bytes) -> Response:
        started = perf_counter()
        route = "other"
        try:
            response, route = self._dispatch(method, target, headers, body)
        except Exception as exc:  # noqa: BLE001  内部のエラー文を返さない
            logger.error("capture.http_failed", extra={"error_type": type(exc).__name__})
            response = _error(500, "INTERNAL_ERROR", "内部エラーが発生しました")
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        logger.info(
            "capture.http",
            extra={
                "method": method,
                "route": route,
                "status": response.status,
                "ms": round((perf_counter() - started) * 1000.0, 2),
            },
        )
        return response

    # --- 内部 ---

    def _dispatch(
        self, method: str, target: str, headers: Mapping[str, str], body: bytes
    ) -> tuple[Response, str]:
        h = {k.lower(): v for k, v in headers.items()}
        if not _host_allowed(h.get("host")):
            return _error(421, "MISDIRECTED", "この宛先は使えません"), "other"
        origin = h.get("origin")
        cors = self._cors_headers(origin, h.get("host")) if origin is not None else None
        path = urlsplit(target).path
        name, allow = _ROUTES.get(path, ("", ""))
        if not name:
            if _IMAGE_PATH.fullmatch(path):
                name, allow = "image", "GET, OPTIONS"
            else:
                return _error(404, "NOT_FOUND", "見つかりません"), "other"
        if method == "OPTIONS":
            return self._preflight(origin, cors), name
        if method not in allow.split(", "):
            return Response(405, b"", {"Allow": allow}), name
        # Origin があるのに許されない: 書き込みは 403。読み取りは CORS ヘッダ無しで返す
        # （ブラウザはその応答を読めない）
        if method == "POST" and origin is not None and cors is None:
            return _error(403, "FORBIDDEN", "許可されていないオリジンです"), name
        if method == "POST":
            response = self._post(name, h, body)
        elif name == "list":
            response = self._list(target)
        else:
            match = _IMAGE_PATH.fullmatch(path)
            response = self._image(match.group(1) if match else "")
        if cors is not None:
            response.headers.update(cors)
        return response, name

    def _cors_headers(self, origin: str, host: str | None) -> dict[str, str] | None:
        """許すオリジンだけ ACAO を返す。許可リスト、または Host と同じホスト名のオリジン。"""
        allowed = origin in self._allowed
        if not allowed:
            origin_host = _origin_host(origin)
            allowed = origin_host is not None and origin_host == _host_name(host)
        if not allowed:
            return None
        return {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}

    def _preflight(self, origin: str | None, cors: dict[str, str] | None) -> Response:
        if origin is None:
            return Response(204)
        if cors is None:
            return _error(403, "FORBIDDEN", "許可されていないオリジンです")
        return Response(
            204,
            b"",
            {
                **cors,
                "Access-Control-Allow-Methods": "GET, POST",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Max-Age": "600",
                "Access-Control-Allow-Private-Network": "true",
            },
        )

    def _list(self, target: str) -> Response:
        query = parse_qs(urlsplit(target).query, keep_blank_values=True)
        pending = False
        if "pending" in query:
            if query["pending"] not in (["1"], ["true"]):
                return _error(400, "INVALID_INPUT", "pending は 1 か true")
            pending = True
        limit = DEFAULT_LIMIT
        if "limit" in query:
            raw = query["limit"][-1]
            limit_value = _to_int(raw)
            if limit_value is None or not 1 <= limit_value <= MAX_LIMIT:
                return _error(400, "INVALID_INPUT", f"limit は 1〜{MAX_LIMIT}")
            limit = limit_value
        items, total = self._store.list(limit, pending=pending)
        return _json(200, {"items": items, "total": total, "idleSeconds": self._idle()})

    def _image(self, capture_id: str) -> Response:
        data = self._store.read_image(capture_id) if valid_id(capture_id) else None
        if data is None:
            return _error(404, "NOT_FOUND", "見つかりません")
        return Response(200, data, {"Content-Type": "image/jpeg"})

    def _post(self, name: str, h: Mapping[str, str], body: bytes) -> Response:
        content_type = h.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return _error(415, "UNSUPPORTED_MEDIA_TYPE", "application/json で送ってください")
        declared = _to_int(h.get("content-length", ""))
        if declared is None:
            return _error(411, "LENGTH_REQUIRED", "Content-Length が要ります")
        if declared > MAX_BODY_BYTES or len(body) > MAX_BODY_BYTES:
            return _error(413, "PAYLOAD_TOO_LARGE", "本文が大きすぎます")
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError):  # 深い入れ子も 400
            return _error(400, "INVALID_INPUT", "JSON を読めません")
        ids, consent = _parse_ids(payload, with_consent=name == "consent")
        if ids is None:
            return _error(400, "INVALID_INPUT", "ids は cap_ + 16進12桁の 1〜200 件")
        if name == "consent":
            if consent is None:
                return _error(400, "INVALID_INPUT", "consent は true か false")
            return _json(200, {"updated": self._store.set_consent(ids, consent)})
        return _json(200, {"updated": self._store.mark_uploaded(ids)})


def _parse_ids(payload: object, *, with_consent: bool) -> tuple[list[str] | None, bool | None]:
    """{"ids": [...]} か {"consent": bool, "ids": [...]}（ほかのキーは拒否）。"""
    expected = {"consent", "ids"} if with_consent else {"ids"}
    if not isinstance(payload, dict) or set(payload) != expected:
        return None, None
    ids = payload["ids"]
    if (
        not isinstance(ids, list)
        or not 1 <= len(ids) <= MAX_IDS
        or not all(valid_id(i) for i in ids)
    ):
        return None, None
    consent = payload.get("consent") if with_consent else None
    if with_consent and not isinstance(consent, bool):
        return ids, None
    return ids, consent


class CaptureServer:
    """CaptureApi をソケットで待ち受ける。専用のスレッド。接続は保たない。"""

    def __init__(
        self,
        api: CaptureApi,
        config: CaptureServerConfig,
        *,
        max_connections: int = 8,
        timeout: float = 5.0,
        ssl_context: ssl.SSLContext | None = None,
    ) -> None:
        self._api = api
        self._cfg = config
        self._slots = threading.BoundedSemaphore(max_connections)
        self._timeout = timeout
        self._ssl = ssl_context
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> int:
        """待ち受けを始めて、実際のポートを返す。使用中なら CaptureServerError。"""
        handler = _make_handler(self._api, self._slots, self._timeout, self._ssl)
        try:
            httpd = ThreadingHTTPServer((self._cfg.host, self._cfg.port), handler)
        except OSError as exc:
            logger.critical("capture.server_failed", extra={"error_type": type(exc).__name__})
            msg = f"待ち受けを始められない: {self._cfg.host}:{self._cfg.port}"
            raise CaptureServerError(msg) from exc
        httpd.daemon_threads = True
        self._httpd = httpd
        self._thread = threading.Thread(
            target=httpd.serve_forever,
            name="capture-http",
            daemon=True,
            kwargs={"poll_interval": 0.1},
        )
        self._thread.start()
        port = int(httpd.server_address[1])
        logger.info(
            "capture.listening",
            extra={"host": self._cfg.host, "port": port, "tls": self._ssl is not None},
        )
        return port

    def stop(self) -> None:
        httpd, self._httpd = self._httpd, None
        if httpd is None:
            return  # 2 回目は何もしない
        httpd.shutdown()
        httpd.server_close()
        if self._thread is not None:
            self._thread.join(2.0)


def _make_handler(
    api: CaptureApi,
    slots: threading.BoundedSemaphore,
    timeout: float,
    ssl_context: ssl.SSLContext | None = None,
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"  # 接続は保たない
        server_version = "antler"
        sys_version = ""

        def setup(self) -> None:
            self.timeout = timeout
            if ssl_context is not None:
                # 握手はこのスレッドで、枠を取ってから（待ち受けのスレッドでしない。pwa-https R3）
                self.request = ssl_context.wrap_socket(
                    self.request, server_side=True, do_handshake_on_connect=False
                )
            super().setup()

        def handle(self) -> None:
            if not slots.acquire(blocking=False):
                if ssl_context is None:
                    self._raw_error(503, "同時の接続が多すぎます")
                # TLS では握手の前に 503 を書けない。握手せずに閉じる
                return
            try:
                if ssl_context is not None and not self._handshake():
                    return
                super().handle()
            finally:
                slots.release()

        def _handshake(self) -> bool:
            try:
                self.connection.do_handshake()  # 受信ごとに timeout 秒で打ち切り
            except (ssl.SSLError, OSError) as exc:
                logger.debug("capture.tls_failed", extra={"error_type": type(exc).__name__})
                return False
            return True

        def finish(self) -> None:
            try:
                super().finish()
            except OSError:
                pass  # 握手していない TLS の接続を閉じるときの書き出しの失敗
            finally:
                if ssl_context is not None:
                    self.connection.close()

        def _raw_error(self, status: int, message: str) -> None:
            body = json.dumps({"error": {"code": "BUSY", "message": message}}).encode()
            head = (
                f"HTTP/1.0 {status} {HTTPStatus(status).phrase}\r\n"
                "Content-Type: application/json\r\n"
                f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n"
            )
            try:
                self.wfile.write(head.encode("ascii") + body)
                self.wfile.flush()
            except OSError:
                return

        def _serve(self) -> None:
            length = _to_int(self.headers.get("Content-Length", ""))
            body = b""
            if self.command == "POST" and length is not None and 0 < length <= MAX_BODY_BYTES:
                body = self.rfile.read(length)
            response = api.handle(self.command, self.path, dict(self.headers.items()), body)
            self.send_response(response.status)
            for key, value in response.headers.items():
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(response.body)))
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response.body)

        do_GET = do_POST = do_OPTIONS = do_DELETE = do_PUT = do_PATCH = _serve

        def log_message(self, format: str, *args: object) -> None:
            return  # 走行ログは capture.http に自分で残す

        def version_string(self) -> str:
            return "antler"

    return Handler
