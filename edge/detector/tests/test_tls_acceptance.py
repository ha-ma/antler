"""pwa-https AC-1: 車内の 4 つの口を、make_tls.py の証明書で同時に立てて通す。

設定ページ（http）→ CA の配布 → /healthz（https）→ PWA の index（https）→ AlertFlag（wss）→
Capture の一覧（https）。クライアントは CA を信頼したもの（スマホにプロファイルを入れた状態）。
"""

from __future__ import annotations

import asyncio
import http.client
import json
import socket
from datetime import timedelta
from pathlib import Path

from websockets.asyncio.client import connect

from detector import tls
from detector.capture.service import CaptureService
from detector.config import load_config
from detector.hub import AlertHub
from detector.pwa_server import CA_PATH, HEALTH_PATH, build
from detector.server import AlertServer

from .conftest import T0, Clock, deer, result, ssl_client


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def request(
    conn: http.client.HTTPConnection, path: str, host: str
) -> tuple[int, dict[str, str], bytes]:
    try:
        conn.request("GET", path, headers={"Host": host})
        response = conn.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        conn.close()


def test_ac_1_setup_page_to_pwa_to_wss_flag_to_capture_list(tmp_path: Path, tls_dir: Path) -> None:
    ws_port, capture_port, https_port, http_port = (free_port() for _ in range(4))
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    index = (
        '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="'
        f"connect-src 'self' wss://ezoroad.local:{ws_port} wss://127.0.0.1:{ws_port} "
        f'https://127.0.0.1:{capture_port}"></head><body><div id="root"></div></body></html>'
    ).encode()
    (dist / "index.html").write_bytes(index)
    (dist / "assets" / "index-abc.js").write_bytes(b"console.log(1)")
    config_path = tmp_path / "detector.toml"
    config_path.write_text(
        f"[server]\nport = {ws_port}\n"
        f'[capture]\ndir = "captures"\n[capture_server]\nport = {capture_port}\n'
        f'[tls]\ncert = "{tls_dir / "server.crt"}"\nkey = "{tls_dir / "server.key"}"\n'
        f'ca_cert = "{tls_dir / "ca.crt"}"\n'
        f'[pwa_server]\ndist = "{dist}"\nhttps_port = {https_port}\nhttp_port = {http_port}\n',
        encoding="utf-8",
    )
    config = load_config(config_path)

    pwa = build(config)
    capture = CaptureService.from_config(config)
    assert capture is not None
    clk = Clock()
    hub = AlertHub(config.judge, clock=clk, wall=lambda: T0 + timedelta(seconds=clk.t))
    alerts = AlertServer(hub, config.server, ssl_context=tls.server_context(config))

    pwa.start()
    capture.server.start()
    client = ssl_client(tls_dir)
    try:
        # 1. 設定ページ（http、カードの QR）。CA を配る前なので平文
        status, headers, body = request(
            http.client.HTTPConnection("127.0.0.1", http_port, timeout=3),
            "/",
            f"127.0.0.1:{http_port}",
        )
        assert status == 200
        assert "Content-Security-Policy" in headers
        assert b"ezoroad-ca.crt" in body

        # 2. CA の証明書（鍵は配らない）
        status, headers, body = request(
            http.client.HTTPConnection("127.0.0.1", http_port, timeout=3),
            CA_PATH,
            f"127.0.0.1:{http_port}",
        )
        assert status == 200
        assert body == (tls_dir / "ca.crt").read_bytes()
        assert b"PRIVATE KEY" not in body

        # 3. CA を入れた端末から https の /healthz（設定ページはこれで「信頼できた」を出す）
        status, _, _ = request(
            http.client.HTTPSConnection("127.0.0.1", https_port, timeout=3, context=client),
            HEALTH_PATH,
            f"127.0.0.1:{https_port}",
        )
        assert status == 204

        # 4. PWA の index（https、CSP に wss の 127.0.0.1 がある）
        status, _, body = request(
            http.client.HTTPSConnection("127.0.0.1", https_port, timeout=3, context=client),
            "/drive",
            f"127.0.0.1:{https_port}",
        )
        assert status == 200
        assert body == index

        # 5. wss で AlertFlag
        async def flags() -> list[dict]:
            port = await alerts.start()
            try:
                async with connect(f"wss://127.0.0.1:{port}/alerts", ssl=client) as ws:
                    hub.on_result(result(0, deer()))
                    clk.advance(0.1)
                    hub.on_result(result(100, deer()))
                    return [json.loads(await asyncio.wait_for(ws.recv(), 3)) for _ in range(2)]
            finally:
                await alerts.stop()

        received = asyncio.run(asyncio.wait_for(flags(), 20))
        assert all(f["type"] == "flag" for f in received)
        assert any(f["deer"] is True for f in received)

        # 6. Capture の一覧（https）
        status, _, body = request(
            http.client.HTTPSConnection("127.0.0.1", capture_port, timeout=3, context=client),
            "/captures",
            f"127.0.0.1:{capture_port}",
        )
        assert status == 200
        assert json.loads(body)["items"] == []
    finally:
        capture.server.stop()
        pwa.stop()
