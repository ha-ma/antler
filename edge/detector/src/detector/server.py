"""WebSocket サーバー（B3-2）: ws://<host>:8765/alerts。サーバー → クライアントは AlertFlag だけ。

信頼の境界は Wi-Fi AP の WPA2（別 feature）。ここでは、パス・接続数・メッセージの大きさと頻度、
遅いクライアント、死んだ接続に上限を置く。クライアントの本文・アドレスはログに残さない。
"""

from __future__ import annotations

import logging
from http import HTTPStatus
from time import monotonic
from typing import TYPE_CHECKING

from websockets.asyncio.server import broadcast, serve

if TYPE_CHECKING:
    from collections.abc import Callable

    from websockets.asyncio.server import Server, ServerConnection
    from websockets.http11 import Request, Response

    from detector.config import ServerConfig
    from detector.hub import AlertHub

logger = logging.getLogger("detector.server")

PATH = "/alerts"
MAX_MESSAGE_BYTES = 64 * 1024
MAX_WRITE_BUFFER = 16 * 1024  # フラグ約 60 通ぶん。それ以上溜まった接続は古い危険を運ぶので切る
MAX_MESSAGES_PER_S = 5


class ServerError(Exception):
    """待ち受けを始められない（ポート使用中など）。"""


class AlertServer:
    def __init__(
        self,
        hub: AlertHub,
        config: ServerConfig,
        ping_interval: float = 1.5,
        ping_timeout: float = 2.5,
        open_timeout: float = 3.0,
        close_timeout: float = 1.0,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._hub = hub
        self._cfg = config
        self._ping = (ping_interval, ping_timeout)
        self._open_timeout = open_timeout
        self._close_timeout = close_timeout
        self._clock = clock
        self._clients: set[ServerConnection] = set()
        self._server: Server | None = None
        hub.sender = self.broadcast

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def start(self) -> int:
        try:
            self._server = await serve(
                self._handle,
                self._cfg.host,
                self._cfg.port,
                process_request=self._process_request,
                max_size=MAX_MESSAGE_BYTES,
                ping_interval=self._ping[0],
                ping_timeout=self._ping[1],
                open_timeout=self._open_timeout,
                close_timeout=self._close_timeout,
                logger=logging.getLogger("detector.websockets"),
            )
        except OSError as exc:
            logger.critical("server.start_failed", extra={"error_type": type(exc).__name__})
            msg = f"待ち受けを始められない: {self._cfg.host}:{self._cfg.port}"
            raise ServerError(msg) from exc
        port = self._server.sockets[0].getsockname()[1]
        logger.info("server.listening", extra={"host": self._cfg.host, "port": port})
        return port

    async def stop(self) -> None:
        server, self._server = self._server, None
        if server is None:
            return  # 2 回目は何もしない
        server.close()
        await server.wait_closed()  # 残りの接続も閉じる

    def broadcast(self, text: str) -> int:
        """待たずに全クライアントへ。書き込みが溜まった遅い接続は切る。"""
        live = []
        for conn in list(self._clients):
            transport = getattr(conn, "transport", None)
            if transport is not None and transport.get_write_buffer_size() > MAX_WRITE_BUFFER:
                logger.warning("client.slow")
                self._clients.discard(conn)
                conn.transport.abort()
                continue
            live.append(conn)
        if live:
            broadcast(live, text, raise_exceptions=False)
        return len(live)

    def _process_request(self, connection: ServerConnection, request: Request) -> Response | None:
        if request.path.split("?", 1)[0] != PATH:
            return connection.respond(HTTPStatus.NOT_FOUND, "")
        if len(self._clients) >= self._cfg.max_clients:
            logger.warning("client.rejected")
            return connection.respond(HTTPStatus.SERVICE_UNAVAILABLE, "")
        return None

    async def _handle(self, connection: ServerConnection) -> None:
        self._clients.add(connection)
        logger.info("client.connected", extra={"clients": len(self._clients)})
        window_start, in_window, warned = self._clock(), 0, False
        try:
            snapshot = self._hub.snapshot()
            if snapshot is not None:
                await connection.send(snapshot)
            async for raw in connection:
                now = self._clock()
                if now - window_start >= 1.0:
                    window_start, in_window, warned = now, 0, False
                in_window += 1
                if in_window > MAX_MESSAGES_PER_S:
                    if not warned:
                        warned = True
                        logger.warning("client.throttled")
                    continue
                self._hub.on_client_message(raw)
        except Exception as exc:  # noqa: BLE001  1 つの接続の異常でサーバーを止めない
            if type(exc).__name__ not in ("ConnectionClosedError", "ConnectionClosedOK"):
                logger.warning("client.error", extra={"error_type": type(exc).__name__})
        finally:
            self._clients.discard(connection)
            logger.info("client.disconnected", extra={"clients": len(self._clients)})
