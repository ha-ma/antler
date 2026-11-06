"""pwa-https R3: AlertServer（wss）と CaptureServer（https）。

証明書は make_tls.py で一時ディレクトリに作る。
"""

from __future__ import annotations

import asyncio
import http.client
import json
import shutil
import socket
import ssl
import threading
import time
from datetime import timedelta
from pathlib import Path

import pytest
from websockets.asyncio.client import connect

from detector.capture.http import CaptureApi, CaptureServer
from detector.capture.service import CaptureService
from detector.capture.store import CaptureStore
from detector.config import CaptureServerConfig, JudgeConfig, ServerConfig, load_config
from detector.hub import AlertHub
from detector.server import AlertServer

from .conftest import T0, Clock, deer, named, result, ssl_client, ssl_server


def alert_server(context: ssl.SSLContext | None, **kw):
    clk = Clock()
    hub = AlertHub(JudgeConfig(), clock=clk, wall=lambda: T0 + timedelta(seconds=clk.t))
    server = AlertServer(hub, ServerConfig(port=0), ssl_context=context, **kw)
    return hub, clk, server


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 20))


async def first_flag(ws) -> dict:
    return json.loads(await asyncio.wait_for(ws.recv(), 3))


def test_uc_3a_wss_delivers_alert_flags_to_a_client_that_trusts_the_ca(
    tls_dir: Path, logbuf
) -> None:
    async def main() -> None:
        hub, clk, server = alert_server(ssl_server(tls_dir))
        port = await server.start()
        try:
            async with connect(f"wss://127.0.0.1:{port}/alerts", ssl=ssl_client(tls_dir)) as ws:
                hub.on_result(result(0, deer()))
                clk.advance(0.1)
                hub.on_result(result(100, deer()))
                flags = [await first_flag(ws) for _ in range(2)]
                assert any(f["deer"] is True for f in flags)
            # ezoroad.local の名前でも検証が通る（SAN）
            async with connect(
                f"wss://127.0.0.1:{port}/alerts",
                ssl=ssl_client(tls_dir),
                server_hostname="ezoroad.local",
            ):
                pass
        finally:
            await server.stop()

    run(main())
    assert named(logbuf, "server.listening")[0]["tls"] is True


def test_uc_3b_fail_4_untrusting_client_fails_and_server_keeps_serving(
    tls_dir: Path, other_tls_dir: Path
) -> None:
    async def main() -> None:
        _, _, server = alert_server(ssl_server(tls_dir))
        port = await server.start()
        try:
            with pytest.raises(ssl.SSLCertVerificationError):
                async with connect(f"wss://127.0.0.1:{port}/alerts", ssl=ssl_client(other_tls_dir)):
                    pass
            # 平文で話しかけても落ちない
            with pytest.raises(Exception):  # noqa: B017  ws の層の例外は版で違う
                async with connect(f"ws://127.0.0.1:{port}/alerts", open_timeout=2):
                    pass
            async with connect(f"wss://127.0.0.1:{port}/alerts", ssl=ssl_client(tls_dir)):
                assert server.client_count == 1
        finally:
            await server.stop()

    run(main())


def test_auth_11_impersonating_server_with_another_ca_is_rejected(
    tls_dir: Path, other_tls_dir: Path
) -> None:
    """AP の中の偽のサーバー（別の CA で ezoroad.local を名乗る）に、PWA はつながらない。"""

    async def main() -> None:
        _, _, fake = alert_server(ssl_server(other_tls_dir))
        port = await fake.start()
        try:
            with pytest.raises(ssl.SSLCertVerificationError):
                async with connect(
                    f"wss://127.0.0.1:{port}/alerts",
                    ssl=ssl_client(tls_dir),
                    server_hostname="ezoroad.local",
                ):
                    pass
        finally:
            await fake.stop()

    run(main())


def test_uc_3c_without_context_it_is_plain_ws(logbuf) -> None:
    async def main() -> None:
        _, _, server = alert_server(None)
        port = await server.start()
        try:
            async with connect(f"ws://127.0.0.1:{port}/alerts"):
                pass
        finally:
            await server.stop()

    run(main())
    assert named(logbuf, "server.listening")[0]["tls"] is False


def test_uc_3g_fail_6_handshake_timeout_is_open_timeout(tls_dir: Path) -> None:
    async def main() -> None:
        hub, clk, server = alert_server(ssl_server(tls_dir), open_timeout=0.5)
        port = await server.start()
        try:
            silent = socket.create_connection(("127.0.0.1", port), timeout=3)  # 握手をしない
            async with connect(f"wss://127.0.0.1:{port}/alerts", ssl=ssl_client(tls_dir)) as ws:
                hub.on_result(result(0, deer()))
                clk.advance(0.1)
                hub.on_result(result(100, deer()))
                assert (await first_flag(ws))["type"] == "flag"
            started = time.monotonic()
            silent.settimeout(4)
            assert await asyncio.to_thread(silent.recv, 1) == b""  # サーバーが閉じる
            assert time.monotonic() - started < 3.0
            silent.close()
        finally:
            await server.stop()

    run(main())


# --- CaptureServer ---


@pytest.fixture
def store(tmp_path: Path) -> CaptureStore:
    return CaptureStore(tmp_path / "captures", max_items=10)


def capture_server(store: CaptureStore, context: ssl.SSLContext | None, **kw) -> CaptureServer:
    api = CaptureApi(store, lambda: 120.0, ())
    return CaptureServer(
        api, CaptureServerConfig(host="127.0.0.1", port=0), ssl_context=context, **kw
    )


def https_get(port: int, tls: Path, path: str = "/captures") -> tuple[int, bytes]:
    conn = http.client.HTTPSConnection("127.0.0.1", port, timeout=3, context=ssl_client(tls))
    try:
        conn.request("GET", path)
        response = conn.getresponse()
        return response.status, response.read()
    finally:
        conn.close()


def test_uc_3d_capture_list_over_https_and_plaintext_is_closed(
    store: CaptureStore, tls_dir: Path, logbuf
) -> None:
    server = capture_server(store, ssl_server(tls_dir), timeout=1.0)
    port = server.start()
    try:
        status, body = https_get(port, tls_dir)
        assert status == 200
        assert json.loads(body)["items"] == []
        plain = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        with pytest.raises((http.client.HTTPException, OSError)):
            plain.request("GET", "/captures")
            plain.getresponse()
        plain.close()
        assert https_get(port, tls_dir)[0] == 200  # 待ち受けは続く
    finally:
        server.stop()
    assert named(logbuf, "capture.listening")[0]["tls"] is True
    assert named(logbuf, "capture.tls_failed")


def test_uc_3e_fail_5_silent_tls_connections_time_out_without_blocking(
    store: CaptureStore, tls_dir: Path
) -> None:
    server = capture_server(store, ssl_server(tls_dir), timeout=1.0)
    port = server.start()
    try:
        silent = [socket.create_connection(("127.0.0.1", port), timeout=3) for _ in range(3)]
        assert https_get(port, tls_dir)[0] == 200  # 黙る接続があっても返る
        for sock in silent:
            sock.settimeout(4)
            started = time.monotonic()
            assert sock.recv(1) == b""
            assert time.monotonic() - started < 3.0
            sock.close()
    finally:
        server.stop()


def test_uc_3h_full_slots_close_tls_connections_without_handshake(
    store: CaptureStore, tls_dir: Path
) -> None:
    server = capture_server(store, ssl_server(tls_dir), timeout=2.0, max_connections=2)
    port = server.start()
    try:
        held = [socket.create_connection(("127.0.0.1", port), timeout=3) for _ in range(2)]
        time.sleep(0.3)  # 2 つの枠が握手待ちで埋まる
        with pytest.raises((ssl.SSLError, OSError)):
            https_get(port, tls_dir)
        for sock in held:
            sock.close()
        for _ in range(40):
            try:
                if https_get(port, tls_dir)[0] == 200:
                    break
            except (ssl.SSLError, OSError):
                threading.Event().wait(0.1)
        else:
            pytest.fail("枠が空いても受けられない")
    finally:
        server.stop()


def test_uc_3f_capture_service_passes_tls_context(tmp_path: Path, tls_dir: Path) -> None:
    shutil.copytree(tls_dir, tmp_path / "tls")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        free = probe.getsockname()[1]
    path = tmp_path / "detector.toml"
    path.write_text(
        f'[capture]\ndir = "captures"\n[capture_server]\nport = {free}\n'
        '[tls]\ncert = "tls/server.crt"\nkey = "tls/server.key"\n',
        encoding="utf-8",
    )
    service = CaptureService.from_config(load_config(path))
    assert service is not None
    port = service.server.start()
    try:
        assert https_get(port, tmp_path / "tls")[0] == 200
    finally:
        service.server.stop()


# --- edge-run（detector.app.serve）の配線 ---


def test_uc_3i_app_serves_wss_and_https_when_tls_is_configured(
    tmp_path: Path, tls_dir: Path
) -> None:
    """UC-3i: edge-run は [tls] があれば AlertServer に TLS を渡し、wss で赤が届く。

    Capture は https。
    """
    from detector import app

    from .app_fakes import CONFIG_TEXT, FakeCamera, always_deer, make_config

    text = CONFIG_TEXT + (
        f'\n[tls]\ncert = "{tls_dir / "server.crt"}"\nkey = "{tls_dir / "server.key"}"\n'
    )
    config = make_config(tmp_path, text)
    camera = FakeCamera()
    deps = app.Deps(load_detector=always_deer, open_source=lambda _c: camera)

    async def main() -> tuple[app.RunInfo, app.RunResult]:
        loop = asyncio.get_running_loop()
        ready: asyncio.Future[app.RunInfo] = loop.create_future()
        control = app.StopControl()
        task = asyncio.create_task(app.serve(config, deps, control, ready=ready.set_result))
        info = await asyncio.wait_for(ready, 5)
        try:
            async with connect(
                f"wss://127.0.0.1:{info.ws_port}/alerts", ssl=ssl_client(tls_dir)
            ) as ws:
                while not json.loads(await asyncio.wait_for(ws.recv(), 5))["deer"]:
                    pass
            assert info.capture_port is not None
            status, _ = await asyncio.to_thread(https_get, info.capture_port, tls_dir)
            assert status == 200
        finally:
            control.request()
        return info, await asyncio.wait_for(task, 15)

    _, outcome = run(main())
    assert outcome == app.RunResult(0, "signal")
    assert camera.closed == 1


def test_uc_3i_app_refuses_to_start_with_broken_tls(tmp_path: Path, tls_dir: Path) -> None:
    """UC-3i / FAIL-2: [tls] が壊れていたら edge-run は StartupError（平文で待ち受けない）。"""
    from detector import app

    from .app_fakes import CONFIG_TEXT, FakeCamera, always_deer, make_config

    text = CONFIG_TEXT + (
        f'\n[tls]\ncert = "{tmp_path / "missing.crt"}"\nkey = "{tls_dir / "server.key"}"\n'
    )
    config = make_config(tmp_path, text)
    camera = FakeCamera()
    deps = app.Deps(load_detector=always_deer, open_source=lambda _c: camera)
    with pytest.raises(app.StartupError):
        run(app.serve(config, deps, app.StopControl()))
    assert camera.closed == 1
