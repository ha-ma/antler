"""UC-5・AUTH・FAIL・CONC: 本物の WebSocket サーバー（ローカル、ポート自動）。"""

import asyncio
import json
import socket
from datetime import timedelta
from types import SimpleNamespace

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from detector.config import JudgeConfig, ServerConfig
from detector.hub import AlertHub
from detector.server import AlertServer, ServerError

from .conftest import T0, Clock, deer, named, result


def build(max_clients: int = 16, clock=None, **kw):
    clk = clock or Clock()
    hub = AlertHub(JudgeConfig(), clock=clk, wall=lambda: T0 + timedelta(seconds=clk.t))
    server = AlertServer(hub, ServerConfig(port=0, max_clients=max_clients), **kw)
    return hub, clk, server


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 20))


def go_on(hub, clk):
    hub.on_result(result(0, deer()))
    clk.advance(0.1)
    hub.on_result(result(100, deer()))


async def recv_json(ws, timeout=3):
    return json.loads(await asyncio.wait_for(ws.recv(), timeout))


# UC-5a・AUTH-1
def test_uc5a_alertsにつながり他のパスは404():
    async def main():
        _, _, server = build()
        port = await server.start()
        try:
            async with connect(f"ws://127.0.0.1:{port}/alerts"):
                pass
            for path in ("/other", "/", "/alerts/x"):
                with pytest.raises(InvalidStatus) as err:
                    async with connect(f"ws://127.0.0.1:{port}{path}"):
                        pass
                assert err.value.response.status_code == 404
        finally:
            await server.stop()

    run(main())


# UC-5b・AUTH-3
def test_uc5b_上限を超えたら503で既存の接続は無事():
    async def main():
        hub, clk, server = build(max_clients=2)
        port = await server.start()
        url = f"ws://127.0.0.1:{port}/alerts"
        try:
            async with connect(url) as a, connect(url) as b:
                with pytest.raises(InvalidStatus) as err:
                    async with connect(url):
                        pass
                assert err.value.response.status_code == 503
                go_on(hub, clk)
                assert (await recv_json(a))["type"] == "flag"
                assert (await recv_json(b))["type"] == "flag"
        finally:
            await server.stop()

    run(main())


# UC-5c・AUTH-4
def test_uc5c_64KB超の接続だけ切られ_他は受け続ける():
    async def main():
        hub, clk, server = build()
        port = await server.start()
        url = f"ws://127.0.0.1:{port}/alerts"
        try:
            async with connect(url, max_size=None) as big, connect(url) as ok:
                await big.send("x" * (64 * 1024 + 1))
                with pytest.raises(ConnectionClosed):
                    await asyncio.wait_for(big.recv(), 3)
                go_on(hub, clk)
                assert (await recv_json(ok))["type"] == "flag"
        finally:
            await server.stop()

    run(main())


# UC-5d・AUTH-2・AUTH-6・AUTH-7・MASS-1
def test_uc5d_変な入力は無視しサーバーは落ちず何も返さない(logbuf):
    async def main():
        hub, clk, server = build()
        port = await server.start()
        url = f"ws://127.0.0.1:{port}/alerts"
        try:
            async with connect(url) as ws:
                for raw in (
                    "not json",
                    json.dumps(
                        {"type": "flag", "deer": True, "conf": 1, "distanceM": 1, "side": "L"}
                    ),
                    json.dumps({"type": "config", "threshold": 0.0}),
                    json.dumps({"type": "get_logs"}),
                    json.dumps({"type": "label", "value": "present", "extra": [1, 2]}),
                    json.dumps({"type": "ack", "t_shown": "2027-02-15T16:31:08.100+09:00", "z": 1}),
                ):
                    await ws.send(raw)
                    await asyncio.sleep(0.25)  # 1 秒 5 通の上限に触れない
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(ws.recv(), 0.3)  # 何も返ってこない
                assert not hub.deer_on and hub._judge.state is None
                go_on(hub, clk)
                assert (await recv_json(ws))["type"] == "flag"
            assert server._cfg.port == 0
            assert hub._cfg.threshold == 0.4
        finally:
            await server.stop()

    run(main())
    assert len(named(logbuf, "client.ignored")) == 4
    assert len(named(logbuf, "ack")) == 1


# UC-5e・CONC-2
def test_uc5e_全員に同じフラグ_接続切断を繰り返しても落ちない():
    async def main():
        hub, clk, server = build()
        port = await server.start()
        url = f"ws://127.0.0.1:{port}/alerts"
        try:
            async with connect(url) as a, connect(url) as b, connect(url) as lazy:
                go_on(hub, clk)
                got = [await recv_json(a), await recv_json(b)]
                assert got[0] == got[1]
                # lazy は読まない。a,b は先へ進める
                for _ in range(5):
                    clk.advance(1.1)
                    hub.tick()
                    hub.on_result(result(1000, deer()))
                    await recv_json(a)
                assert lazy is not None

            async def churn():
                for _ in range(8):
                    async with connect(url):
                        hub.tick()

            await asyncio.gather(
                churn(), churn(), *(asyncio.to_thread(lambda: None) for _ in range(2))
            )
        finally:
            await server.stop()

    run(main())


# UC-5f・IDEM-2
def test_uc5f_切れたらdisconnected_stopは2回呼べて全接続が閉じる(logbuf):
    async def main():
        _, _, server = build()
        port = await server.start()
        ws = await connect(f"ws://127.0.0.1:{port}/alerts")
        await asyncio.sleep(0.1)
        assert server.client_count == 1
        await server.stop()
        await server.stop()
        with pytest.raises(ConnectionClosed):
            await asyncio.wait_for(ws.recv(), 3)
        assert server.client_count == 0

    run(main())
    assert named(logbuf, "client.disconnected")


# UC-5g
def test_uc5g_死んだ接続はpingで外れる():
    async def main():
        _, _, server = build(ping_interval=0.1, ping_timeout=0.2, close_timeout=0.2)
        port = await server.start()
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(
            b"GET /alerts HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            b"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        await writer.drain()
        await reader.readuntil(b"\r\n\r\n")
        assert server.client_count == 1
        # 応答しない（pong を返さない）クライアント: 読まずに待つ
        for _ in range(30):
            await asyncio.sleep(0.1)
            if server.client_count == 0:
                break
        assert server.client_count == 0
        writer.close()
        await server.stop()

    run(main())


# UC-5h
def test_uc5h_既定のhostとping設定():
    assert ServerConfig().host == "127.0.0.1"
    _, _, server = build()
    assert (server._ping, server._open_timeout, server._close_timeout) == (
        (1.5, 2.5),
        3.0,
        1.0,
    )  # 1.5 + 2.5 + 1.0 = 5 秒以内に外れる


# UC-5i
def test_uc5i_1秒5通を超えたら読み捨て_警告は1回(logbuf):
    async def main():
        _, _, server = build(clock=Clock())
        port = await server.start()
        try:
            async with connect(f"ws://127.0.0.1:{port}/alerts") as ws:
                ack = json.dumps({"type": "ack", "t_shown": "2027-02-15T16:31:08.100+09:00"})
                for _ in range(20):
                    await ws.send(ack)
                await asyncio.sleep(0.3)
        finally:
            await server.stop()

    run(main())
    assert len(named(logbuf, "ack")) == 5
    assert len(named(logbuf, "client.throttled")) == 1


class Slow:
    def __init__(self, transport) -> None:
        self.transport = transport


# FAIL-1
def test_fail1_書き込みが溜まった遅い接続は切って配信を続ける(logbuf):
    closed = []
    transport = SimpleNamespace(get_write_buffer_size=lambda: 10**7, abort=lambda: closed.append(1))
    _, _, server = build()
    slow = Slow(transport)
    server._clients.add(slow)
    assert server.broadcast("{}") == 0
    assert closed == [1] and server.client_count == 0
    assert named(logbuf, "client.slow")


# FAIL-2
def test_fail2_送信中に切れてもサーバーは落ちない():
    async def main():
        hub, clk, server = build()
        port = await server.start()
        ws = await connect(f"ws://127.0.0.1:{port}/alerts")
        await asyncio.sleep(0.1)
        ws.transport.abort()
        go_on(hub, clk)
        await asyncio.sleep(0.1)
        async with connect(f"ws://127.0.0.1:{port}/alerts") as ok:
            assert (await recv_json(ok))["type"] == "flag"  # snapshot
        await server.stop()

    run(main())


# FAIL-4
def test_fail4_ポート使用中ならServerError(logbuf):
    async def main():
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            s.listen()
            hub = AlertHub(JudgeConfig())
            server = AlertServer(hub, ServerConfig(port=s.getsockname()[1]))
            with pytest.raises(ServerError):
                await server.start()
            await server.stop()  # 半端に残っていない

    run(main())
    assert named(logbuf, "server.start_failed")


# AUTH-5
def test_auth5_配信するフラグに画像や位置が無い():
    async def main():
        hub, clk, server = build()
        port = await server.start()
        try:
            async with connect(f"ws://127.0.0.1:{port}/alerts") as ws:
                go_on(hub, clk)
                seen = [await recv_json(ws), await recv_json(ws)]
        finally:
            await server.stop()
        return seen

    for flag in run(main()):
        assert flag.get("frameJpegB64") is None
        assert not {"lat", "lng", "deviceId", "email", "image"} & set(flag)


# AUTH-6 の補足: 設定はファイルからだけ
def test_auth6_設定オブジェクトは凍結されている():
    with pytest.raises(AttributeError):
        JudgeConfig().threshold = 0.0  # type: ignore[misc]


# CONC-1
def test_conc1_更新とハートビートが交互でもJSONは壊れずON_OFFの順が逆転しない():
    hub, clk, _ = build()[:3]
    out = []
    hub.sender = lambda t: out.append(json.loads(t)) or 1
    for i in range(30):
        clk.advance(0.1)
        hub.on_result(result(i * 100, deer()) if i < 15 else result(i * 100))
        hub.tick()
    states = [f["deer"] for f in out]
    assert states[0] is False and True in states
    on_at = states.index(True)
    assert states[-1] is False and states[on_at:].index(False) > 0  # ON のあとに OFF が来る
