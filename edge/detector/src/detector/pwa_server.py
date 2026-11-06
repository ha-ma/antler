"""PWA の静的配信（https）と CA の配布（http）。docs/specs/pwa-https R4。

    python -m detector.pwa_server --config edge/detector/config.toml

- https の口（既定 8443）: 起動時にメモリへ読んだ `apps/pwa/dist` を GET・HEAD で返す。パスは一覧との
  完全一致で引く（ディスクを辿らない）。拡張子の無い知らないパスは index.html（SPA）
- http の口（既定 8080）: 設定ページ（4 言語）と CA の証明書（`/ezoroad-ca.crt`）だけ。CA の鍵は読まない
- 両方の口で Host を IPv4・`localhost`・`ezoroad.local` に限る（DNS rebinding）。ページに Host を入れない
- 同時 16 接続。枠はスレッドを作る前に数え、溢れたら握手もせずに閉じる。受信ごとに 5 秒で打ち切る
- 信頼の境界は車内の Wi-Fi AP（WPA2）。アクセスのログ（パス・アドレス）は残さない
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import ipaddress
import logging
import os
import signal
import ssl
import sys
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from detector.config import ConfigError, load_config, resolve_path
from detector.log import configure_logging
from detector.tls import TlsError, enabled, server_context

if TYPE_CHECKING:
    import socket
    from collections.abc import Callable, Mapping, Sequence

    from detector.config import Config, PwaServerConfig

__all__ = [
    "Asset",
    "PwaServer",
    "PwaServerError",
    "build",
    "host_allowed",
    "load_dist",
    "main",
    "route_http",
    "route_https",
    "self_check",
    "setup_page",
]

logger = logging.getLogger("detector.pwa_server")

MAX_DIST_BYTES = 64 * 1024 * 1024
MAX_CONNECTIONS = 16
TIMEOUT_S = 5.0
CA_PATH = "/ezoroad-ca.crt"
HEALTH_PATH = "/healthz"
EXPIRING_S = 30 * 86400
WS_PORT = 8765
ALLOWED_HOST_NAMES = frozenset({"localhost", "ezoroad.local"})
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".geojson": "application/geo+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".webmanifest": "application/manifest+json",
    ".txt": "text/plain; charset=utf-8",
}
COMMON_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    # 同意の操作を別のページの枠に入れさせない（index.html の meta の CSP では frame-ancestors が効かない）
    "X-Frame-Options": "DENY",
}
SECRET_SUFFIXES = frozenset({".key", ".pem", ".p12", ".pfx"})
# PWA の応答のヘッダの CSP（meta の CSP と両方が効く。ここは枠への埋め込みだけを止める）
FRAME_CSP = "frame-ancestors 'none'"


class PwaServerError(Exception):
    """配信を始められない（TLS・dist・ポート・証明書の自己検査）。"""


@dataclass(frozen=True)
class Asset:
    body: bytes
    content_type: str
    cache: str


@dataclass
class Response:
    status: int
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict)


def _cache_for(path: str) -> str:
    if path.startswith("/assets/"):
        return "public, max-age=31536000, immutable"  # ハッシュ付きの名前
    return "no-cache"


def load_dist(root: Path, limit: int = MAX_DIST_BYTES) -> dict[str, Asset]:
    """dist をメモリへ。シンボリックリンクとドットで始まる名前は載せない。index.html が無ければ失敗。"""
    if not root.is_dir() or root.is_symlink():
        msg = "PWA の dist が無い（npm run build -w apps/pwa）"
        raise PwaServerError(msg)
    assets: dict[str, Asset] = {}
    total = 0
    for current, dirs, files in os.walk(root, followlinks=False):
        here = Path(current)
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (here / d).is_symlink())
        for name in sorted(files):
            path = here / name
            if name.startswith(".") or path.is_symlink() or not path.is_file():
                continue
            if path.suffix.lower() in SECRET_SUFFIXES:
                continue  # 鍵らしい名前は dist に紛れても配らない
            try:
                total += path.stat().st_size  # 読む前に上限を見る
                if total > limit:
                    msg = f"PWA の dist が {limit // (1024 * 1024)} MB を超える"
                    raise PwaServerError(msg)
                body = path.read_bytes()
            except OSError as exc:
                msg = f"PWA の dist を読めない（{type(exc).__name__}）"
                raise PwaServerError(msg) from exc
            url = "/" + path.relative_to(root).as_posix()
            assets[url] = Asset(body, MIME.get(path.suffix.lower(), "application/octet-stream"), "")
    if "/index.html" not in assets:
        msg = "PWA の dist に index.html が無い（npm run build -w apps/pwa）"
        raise PwaServerError(msg)
    return {url: Asset(a.body, a.content_type, _cache_for(url)) for url, a in assets.items()}


def host_allowed(host: str | None) -> bool:
    """Host が IPv4 リテラル・localhost・ezoroad.local か（ポートは問わない。IPv6 は受けない）。"""
    if not host or len(host) > 255:
        return False
    text = host.strip().lower()
    if text.startswith("[") or text.count(":") > 1:
        return False
    name = text.rsplit(":", 1)[0] if ":" in text else text
    if name in ALLOWED_HOST_NAMES:
        return True
    try:
        ipaddress.IPv4Address(name)
    except ValueError:
        return False
    return True


def _empty(status: int, **headers: str) -> Response:
    return Response(status, b"", {**COMMON_HEADERS, **headers})


def _path_of(target: str) -> str | None:
    try:
        path = urlsplit(target).path
    except ValueError:
        return None
    return path if path.startswith("/") else None


def route_https(
    method: str, target: str, headers: Mapping[str, str], assets: Mapping[str, Asset]
) -> Response:
    """https の口。dist の一覧との完全一致・SPA・/healthz。"""
    if not host_allowed(headers.get("Host")):
        return _empty(421)
    if method not in ("GET", "HEAD"):
        return _empty(405, Allow="GET, HEAD")
    path = _path_of(target)
    if path is None:
        return _empty(404)
    if path == HEALTH_PATH:
        return _empty(204, **{"Cache-Control": "no-store"})
    key = "/index.html" if path == "/" else path
    asset = assets.get(key)
    if asset is None and "." not in path.rsplit("/", 1)[-1]:
        asset = assets["/index.html"]  # SPA（拡張子の無いパス）
    if asset is None:
        return _empty(404)
    return Response(
        200,
        asset.body,
        {
            **COMMON_HEADERS,
            "Content-Security-Policy": FRAME_CSP,
            "Content-Type": asset.content_type,
            "Cache-Control": asset.cache,
        },
    )


# --- 設定ページ（http の口。4 言語。Host をページに入れない。https の URL はページの JS が組む） ---

_TEXTS: dict[str, dict[str, str]] = {
    "ja": {
        "title": "EZO ROAD — 最初に 1 回だけ",
        "intro": "鹿アラートを安全な接続（https）で開くために、この車の証明書をスマホに入れます。1 台につき 1 回だけです。",
        "ios": "iPhone: 1)「証明書をダウンロード」→「許可」 2) 設定 → 一般 → VPN とデバイス管理 → EZO ROAD → インストール 3) 設定 → 一般 → 情報 → 証明書信頼設定 → EZO ROAD をオン",
        "android": "Android: 1)「証明書をダウンロード」 2) 設定 → セキュリティ → 暗号化と認証情報 → 証明書をインストール → CA 証明書 → ダウンロードしたファイル",
        "warn": "ブラウザの警告は押し切らずに、証明書を入れてください。",
        "remove": "返却したら証明書を消してください。iPhone: 設定 → 一般 → VPN とデバイス管理 → EZO ROAD → プロファイルを削除。Android: 設定 → セキュリティ → 信頼できる認証情報 → ユーザー → EZO ROAD を削除。",
        "fingerprint": "証明書の指紋（SHA-256）",
        "download": "証明書をダウンロード",
        "open": "EZO ROAD を開く",
        "checking": "証明書を確かめています…",
    },
    "en": {
        "title": "EZO ROAD — one-time setup",
        "intro": "To open the deer alert over a secure connection (https), install this car's certificate on your phone. Once per phone.",
        "ios": "iPhone: 1) Tap “Download certificate” → Allow 2) Settings → General → VPN & Device Management → EZO ROAD → Install 3) Settings → General → About → Certificate Trust Settings → turn on EZO ROAD",
        "android": "Android: 1) Tap “Download certificate” 2) Settings → Security → Encryption & credentials → Install a certificate → CA certificate → the downloaded file",
        "warn": "Do not click through the browser warning. Install the certificate instead.",
        "remove": "After returning the car, remove the certificate. iPhone: Settings → General → VPN & Device Management → EZO ROAD → Remove Profile. Android: Settings → Security → Trusted credentials → User → EZO ROAD → Remove.",
        "fingerprint": "Certificate fingerprint (SHA-256)",
        "download": "Download certificate",
        "open": "Open EZO ROAD",
        "checking": "Checking the certificate…",
    },
    "zh": {
        "title": "EZO ROAD — 只需設定一次",
        "intro": "為了以安全連線（https）開啟鹿警示，請在手機安裝這輛車的憑證。每支手機只需一次。",
        "ios": "iPhone：1) 點「下載憑證」→「允許」 2) 設定 → 一般 → VPN 與裝置管理 → EZO ROAD → 安裝 3) 設定 → 一般 → 關於本機 → 憑證信任設定 → 開啟 EZO ROAD",
        "android": "Android：1) 點「下載憑證」 2) 設定 → 安全性 → 加密與憑證 → 安裝憑證 → CA 憑證 → 選擇下載的檔案",
        "warn": "請不要略過瀏覽器的警告，請安裝憑證。",
        "remove": "還車後請刪除憑證。iPhone：設定 → 一般 → VPN 與裝置管理 → EZO ROAD → 移除描述檔。Android：設定 → 安全性 → 信任的憑證 → 使用者 → EZO ROAD → 移除。",
        "fingerprint": "憑證指紋（SHA-256）",
        "download": "下載憑證",
        "open": "開啟 EZO ROAD",
        "checking": "正在確認憑證…",
    },
    "ko": {
        "title": "EZO ROAD — 처음 한 번만",
        "intro": "사슴 경보를 안전한 연결(https)로 열기 위해 이 차량의 인증서를 휴대폰에 설치합니다. 휴대폰마다 한 번만 하면 됩니다.",
        "ios": "iPhone: 1) ‘인증서 다운로드’ → 허용 2) 설정 → 일반 → VPN 및 기기 관리 → EZO ROAD → 설치 3) 설정 → 일반 → 정보 → 인증서 신뢰 설정 → EZO ROAD 켜기",
        "android": "Android: 1) ‘인증서 다운로드’ 2) 설정 → 보안 → 암호화 및 사용자 인증 정보 → 인증서 설치 → CA 인증서 → 다운로드한 파일",
        "warn": "브라우저 경고를 무시하고 진행하지 말고 인증서를 설치하세요.",
        "remove": "반납 후에는 인증서를 삭제하세요. iPhone: 설정 → 일반 → VPN 및 기기 관리 → EZO ROAD → 프로파일 제거. Android: 설정 → 보안 → 신뢰할 수 있는 자격 증명 → 사용자 → EZO ROAD → 삭제.",
        "fingerprint": "인증서 지문(SHA-256)",
        "download": "인증서 다운로드",
        "open": "EZO ROAD 열기",
        "checking": "인증서를 확인하는 중…",
    },
}
LANGS = ("ja", "en", "zh", "ko")


def _script(https_port: int) -> str:
    # 別オリジン（スキームもポートも違う）なので no-cors。不透明な応答が返る＝握手が通った＝CA を信頼している。
    # 前の確認が終わってから 3 秒後に次を始める（重ならない）
    return (
        "(function(){"
        f"var t='https://'+location.hostname+':{https_port}/';"
        "var a=document.querySelectorAll('a.open');"
        "for(var i=0;i<a.length;i++){a[i].href=t;}"
        "function check(){fetch(t+'healthz',{mode:'no-cors',cache:'no-store'})"
        ".then(function(){location.replace(t);},function(){setTimeout(check,3000);});}"
        "check();})();"
    )


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


def setup_page(fingerprint: str, https_port: int) -> tuple[bytes, str]:
    """設定ページの HTML と、そのページの CSP（スクリプトはハッシュで許す）。"""
    script = _script(https_port)
    digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
    sections = []
    for lang in LANGS:
        t = {k: _escape(v) for k, v in _TEXTS[lang].items()}
        sections.append(
            f'<section lang="{lang}"><h2>{t["title"]}</h2><p>{t["intro"]}</p>'
            f'<p><a class="button" href="{CA_PATH}" download>{t["download"]}</a> '
            f'<a class="button open" href="#">{t["open"]}</a></p>'
            f'<p>{t["ios"]}</p><p>{t["android"]}</p><p class="warn">{t["warn"]}</p>'
            f'<p>{t["remove"]}</p><p class="status">{t["checking"]}</p>'
            f'<p class="fp">{t["fingerprint"]}: <code>{_escape(fingerprint)}</code></p></section>'
        )
    style = (
        "body{font-family:system-ui,sans-serif;margin:16px;line-height:1.6;color:#1B2A24;"
        "background:#FBF8F1}section{border-bottom:1px solid #E6DFD0;padding:8px 0}"
        ".button{display:inline-block;min-height:44px;padding:10px 16px;margin:4px 4px 4px 0;"
        "border-radius:10px;background:#1E6F5C;color:#FFFFFF;text-decoration:none}"
        ".warn{font-weight:700}code{word-break:break-all;font-size:12px}"
    )
    html = (
        '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>EZO ROAD setup</title><style>{style}</style></head><body>"
        + "".join(sections)
        + f"<script>{script}</script></body></html>"
    )
    style_digest = base64.b64encode(hashlib.sha256(style.encode("utf-8")).digest()).decode("ascii")
    csp = (
        "default-src 'none'; "
        f"script-src 'sha256-{digest}'; style-src 'sha256-{style_digest}'; "
        "connect-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    )
    return html.encode("utf-8"), csp


def route_http(
    method: str, target: str, headers: Mapping[str, str], page: tuple[bytes, str], ca_pem: bytes
) -> Response:
    """http の口。設定ページと CA の証明書だけ。"""
    if not host_allowed(headers.get("Host")):
        return _empty(421)
    if method not in ("GET", "HEAD"):
        return _empty(405, Allow="GET, HEAD")
    path = _path_of(target)
    if path == "/":
        body, csp = page
        return Response(
            200,
            body,
            {
                **COMMON_HEADERS,
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "Content-Security-Policy": csp,
            },
        )
    if path == CA_PATH:
        return Response(
            200,
            ca_pem,
            {
                **COMMON_HEADERS,
                "Content-Type": "application/x-x509-ca-cert",
                "Content-Disposition": 'attachment; filename="ezoroad-ca.crt"',
                "Cache-Control": "no-cache",
            },
        )
    return _empty(404)


# --- 自己検査（スマホ側では「CA 未信頼」と見分けがつかない食い違いを、起動のときに見つける） ---


def _decode_cert(path: Path) -> dict[str, object] | None:
    decode = getattr(getattr(ssl, "_ssl", None), "_test_decode_cert", None)
    if decode is None:
        return None
    try:
        return decode(str(path))
    except (ssl.SSLError, OSError, ValueError):
        return None


def self_check(cert: Path, host: str, index_html: bytes, now: float | None = None) -> None:
    """期限切れ・host が SAN に無い → PwaServerError。30 日未満・CSP に無い IP → warn。"""
    info = _decode_cert(cert)
    if info is None:
        logger.info("pwa_server.self_check_skipped")
        return
    now = time.time() if now is None else now
    not_after = ssl.cert_time_to_seconds(str(info["notAfter"]))
    if not_after <= now:
        msg = "サーバー証明書の期限が切れている（make_tls.py で発行し直す）"
        raise PwaServerError(msg)
    if not_after - now < EXPIRING_S:
        logger.warning("pwa_server.cert_expiring", extra={"days": int((not_after - now) // 86400)})
    san = info.get("subjectAltName", ())
    ips = [str(v) for k, v in san if k == "IP Address"]  # type: ignore[misc]
    try:
        literal = ipaddress.IPv4Address(host)
    except ValueError:
        literal = None
    if literal is not None and not literal.is_unspecified and str(literal) not in ips:
        msg = "pwa_server.host の IP がサーバー証明書に無い（make_tls.py --new-ca --ip <IP>）"
        raise PwaServerError(msg)
    html = index_html.decode("utf-8", "replace")
    for ip in ips:
        if f"wss://{ip}:{WS_PORT}" not in html:
            # PWA を VITE_EDGE_HOSTS=ezoroad.local,<IP> でビルドし直す
            logger.warning("pwa_server.csp_missing_host", extra={"host": ip})


# --- ソケット ---


class _BoundedServer(ThreadingHTTPServer):
    """枠（同時接続）をスレッドを作る前に数える。溢れた接続は握手もせずに閉じる。"""

    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        slots: threading.BoundedSemaphore,
    ) -> None:
        self.slots = slots
        super().__init__(address, handler)

    def process_request(self, request: socket.socket, client_address: object) -> None:  # type: ignore[override]
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)  # type: ignore[arg-type]
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request: socket.socket, client_address: object) -> None:  # type: ignore[override]
        try:
            super().process_request_thread(request, client_address)  # type: ignore[arg-type]
        finally:
            self.slots.release()

    def handle_error(self, request: object, client_address: object) -> None:  # type: ignore[override]
        # 標準は接続元のアドレスとトレースバックを stderr に出す（アクセスのログは残さない。R4）
        logger.debug(
            "pwa_server.request_failed", extra={"error_type": type(sys.exc_info()[1]).__name__}
        )


def _make_handler(
    route: Callable[[str, str, Mapping[str, str]], Response],
    timeout: float,
    ssl_context: ssl.SSLContext | None,
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"  # 接続は保たない
        server_version = "antler"
        sys_version = ""

        def setup(self) -> None:
            self.timeout = timeout
            if ssl_context is not None:
                self.request = ssl_context.wrap_socket(
                    self.request, server_side=True, do_handshake_on_connect=False
                )
            super().setup()

        def handle(self) -> None:
            if ssl_context is not None:
                try:
                    self.connection.do_handshake()  # 枠の中のスレッドで。受信ごとに timeout 秒
                except (ssl.SSLError, OSError) as exc:
                    logger.debug("pwa_server.tls_failed", extra={"error_type": type(exc).__name__})
                    return
            super().handle()

        def finish(self) -> None:
            try:
                super().finish()
            except OSError:
                pass
            finally:
                if ssl_context is not None:
                    self.connection.close()

        def _serve(self) -> None:
            # 見出しの名前は大文字小文字を問わない（`host:` で送るクライアントも Host として読む）
            headers = {k.title(): v for k, v in self.headers.items()}
            response = route(self.command, self.path, headers)
            self.send_response(response.status)
            for key, value in response.headers.items():
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(response.body)))
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response.body)

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _serve
        do_TRACE = do_CONNECT = _serve

        def send_error(
            self, code: int, message: str | None = None, explain: str | None = None
        ) -> None:
            if code == 501:  # 知らないメソッドも route を通して 405（Host の検査と共通の見出し）
                self._serve()
                return
            super().send_error(code, message, explain)

        def log_message(self, format: str, *args: object) -> None:
            return  # アクセスのログ（パス・アドレス）は残さない

        def version_string(self) -> str:
            return "antler"

    return Handler


class PwaServer:
    """https の口と http の口を、それぞれ専用のスレッドで待ち受ける。"""

    def __init__(
        self,
        config: PwaServerConfig,
        assets: Mapping[str, Asset],
        ca_pem: bytes,
        fingerprint: str,
        ssl_context: ssl.SSLContext,
        *,
        timeout: float = TIMEOUT_S,
        max_connections: int = MAX_CONNECTIONS,
    ) -> None:
        self._cfg = config
        self._assets = dict(assets)
        self._ca_pem = ca_pem
        self._fingerprint = fingerprint
        self._ssl = ssl_context
        self._timeout = timeout
        self._max = max_connections
        self._servers: list[ThreadingHTTPServer] = []
        self._threads: list[threading.Thread] = []

    def _open(
        self, port: int, route: Callable[[str, str, Mapping[str, str]], Response], tls: bool
    ) -> ThreadingHTTPServer:
        slots = threading.BoundedSemaphore(self._max)
        handler = _make_handler(route, self._timeout, self._ssl if tls else None)
        return _BoundedServer((self._cfg.host, port), handler, slots)

    def start(self) -> tuple[int, int]:
        """両方の口を開き、（https のポート, http のポート）を返す。片方でも開けなければ両方閉じる。"""
        try:
            secure = self._open(
                self._cfg.https_port,
                lambda m, t, h: route_https(m, t, h, self._assets),
                tls=True,
            )
            self._servers.append(secure)
            https_port = int(secure.server_address[1])
            page = setup_page(self._fingerprint, https_port)
            plain = self._open(
                self._cfg.http_port,
                lambda m, t, h: route_http(m, t, h, page, self._ca_pem),
                tls=False,
            )
            self._servers.append(plain)
        except OSError as exc:
            self.stop()
            logger.critical("pwa_server.start_failed", extra={"error_type": type(exc).__name__})
            msg = f"待ち受けを始められない: {self._cfg.host}（ポート使用中など）"
            raise PwaServerError(msg) from exc
        for name, server in zip(("pwa-https", "pwa-http"), self._servers, strict=True):
            thread = threading.Thread(
                target=server.serve_forever, name=name, daemon=True, kwargs={"poll_interval": 0.1}
            )
            thread.start()
            self._threads.append(thread)
        ports = (https_port, int(plain.server_address[1]))
        logger.info(
            "pwa_server.listening",
            extra={"host": self._cfg.host, "https_port": ports[0], "http_port": ports[1]},
        )
        return ports

    def stop(self) -> None:
        servers, self._servers = self._servers, []
        threads, self._threads = self._threads, []
        for server in servers:
            if threads:  # serve_forever が回っているときだけ（回っていない shutdown は返らない）
                server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(2.0)


def _fingerprint(pem: str) -> str:
    der = ssl.PEM_cert_to_DER_cert(pem)
    digest = hashlib.sha256(der).hexdigest().upper()
    return ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))


def build(config: Config, now: float | None = None) -> PwaServer:
    """設定から PwaServer を作る（まだ待ち受けない）。足りない・壊れているなら PwaServerError / TlsError。"""
    if not enabled(config) or not config.tls.ca_cert.strip():
        msg = "[tls] の cert・key・ca_cert をそろえる（scripts/make_tls.py で作る）"
        raise PwaServerError(msg)
    context = server_context(config)
    if context is None:  # enabled を確かめたので来ない
        msg = "TLS の設定が無い"
        raise PwaServerError(msg)
    try:
        ca_text = resolve_path(config, config.tls.ca_cert).read_text(encoding="ascii")
        fingerprint = _fingerprint(ca_text)
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        msg = "tls.ca_cert が CA の証明書（PEM）として読めない"
        raise PwaServerError(msg) from exc
    if "PRIVATE KEY" in ca_text:
        msg = "tls.ca_cert に鍵が入っている（配るのは ca.crt だけ）"
        raise PwaServerError(msg)
    assets = load_dist(resolve_path(config, config.pwa_server.dist))
    self_check(
        resolve_path(config, config.tls.cert),
        config.pwa_server.host,
        assets["/index.html"].body,
        now,
    )
    return PwaServer(config.pwa_server, assets, ca_text.encode("ascii"), fingerprint, context)


def main(argv: Sequence[str] | None = None, stop: threading.Event | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="PWA を https で配り、CA を http で配る（pwa-https）"
    )
    parser.add_argument("--config", type=Path, required=True, help="edge/detector の設定ファイル")
    args = parser.parse_args(argv)
    configure_logging()
    try:
        server = build(load_config(args.config))
        ports = server.start()
    except (ConfigError, TlsError, PwaServerError) as exc:
        sys.stderr.write(f"pwa_server: {exc}\n")
        return 2
    sys.stderr.write(f"pwa_server: https {ports[0]} / http {ports[1]}（Ctrl+C で止める）\n")
    done = stop or threading.Event()
    if stop is None:
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: done.set())
    done.wait()
    server.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
