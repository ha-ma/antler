"""AUTH-1〜4: vehicle の認可マトリクスの ❌ セル（docs/specs/pwa-uplink/threat.md）。"""

from __future__ import annotations

import asyncio
import json

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from detector.config import JudgeConfig, L1Config, ServerConfig
from detector.fusion import L1Verdict
from detector.hub import AlertHub
from detector.server import AlertServer

from .conftest import Clock, deer, named, result


def make_hub():
    sent: list[dict] = []
    clock = Clock()
    hub = AlertHub(JudgeConfig(), clock=clock, l1=L1Config())
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    return hub, sent, clock


def vehicle(**kw) -> str:
    return json.dumps({"type": "vehicle", **kw})


# AUTH-1
def test_auth1_vehicleだけでは赤にならず赤も解けず降格も起きない():
    hub, sent, clock = make_hub()
    for _ in range(30):
        hub.on_client_message(vehicle(speedKmh=0, zone="outside", light="day"))
    assert sent == []  # 何も送られない（赤にならない）
    for i in range(2):
        clock.advance(0.1)
        hub.on_result(result(100 * i, deer(0.9)))
    reds = len(sent)
    assert sent[-1]["deer"] is True
    for _ in range(30):
        hub.on_client_message(vehicle(speedKmh=0, zone="outside", light="day"))
    assert len(sent) == reds and hub.fusion is not None and hub.fusion.active is False
    # 降格の条件（今のエピソード・校正あり…）は変わらない: 前のエピソードの答えでは降格しない
    target, _ = hub.l1_target()
    stale = L1Verdict(
        episode=(hub.fusion.episode or 0) - 1,
        track_id=target.track_id,
        started=clock(),
        latency_ms=10.0,
        model="llm-qwen2.5-1.5b",
        calibrated=True,
        alert_level="zone",
        conf=0.99,
        conf_raw=0.99,
        reason="false_positive",
    )
    hub.on_l1(stale)
    assert sent[-1]["deer"] is True and len(sent) == reds


# AUTH-2
@pytest.mark.parametrize(
    "extra",
    [
        {"lat": 43.1751, "lon": 144.3},
        {"latitude": 43.1751},
        {"accuracyM": 8},
        {"timestamp": 1_800_000_000_000},
        {"deviceId": "IDFA-1"},
        {"remainingKm": 3.2},
    ],
)
def test_auth2_位置や識別子つきのvehicleは拒否して保持も記録もしない(logbuf, extra):
    hub, _, _ = make_hub()
    hub.on_client_message(vehicle(speedKmh=42, zone="inside", **extra))
    assert hub.vehicle_report(10.0) is None
    assert named(logbuf, "vehicle.invalid")
    assert not named(logbuf, "vehicle.updated")
    dumped = logbuf.getvalue()
    for secret in ("43.1751", "144.3", "IDFA-1", "1800000000000"):
        assert secret not in dumped


# AUTH-3
def test_auth3_vehicleで設定や閾値は変わらない():
    hub, sent, _ = make_hub()
    before = (hub._cfg, hub.fusion._cfg)
    hub.on_client_message(
        vehicle(threshold=0.0, override_conf=0.1, base_url="http://evil", zone="inside")
    )
    hub.on_client_message(vehicle(speedKmh=42))
    assert (hub._cfg, hub.fusion._cfg) == before
    assert hub._cfg.threshold == JudgeConfig().threshold
    assert hub.fusion._cfg.override_conf == 0.9
    assert sent == []


# AUTH-4
def test_auth4_大きなvehicleは接続を切り洪水は上限で捨て赤の送信は止まらない():
    async def main() -> tuple[int, list[dict]]:
        hub = AlertHub(JudgeConfig(), l1=L1Config())
        received: list[dict] = []
        calls = {"n": 0}
        original = hub.on_client_message

        def counting(raw: object) -> None:
            calls["n"] += 1
            original(raw)

        hub.on_client_message = counting  # type: ignore[method-assign]
        server = AlertServer(hub, ServerConfig(port=0))
        port = await server.start()
        try:
            async with connect(f"ws://127.0.0.1:{port}/alerts") as ws:
                for _ in range(40):  # 1 秒 5 通を超える洪水
                    await ws.send(vehicle(speedKmh=42, zone="inside"))
                await asyncio.sleep(0.3)
                for i in range(2):
                    hub.on_result(result(100 * i, deer(0.9)))
                async with asyncio.timeout(3):
                    while not (received and received[-1]["deer"]):
                        received.append(json.loads(await ws.recv()))
            async with connect(f"ws://127.0.0.1:{port}/alerts") as big:
                await big.send(vehicle(speedKmh=42, note="x" * (70 * 1024)))
                with pytest.raises(ConnectionClosed):
                    async with asyncio.timeout(3):
                        while True:
                            await big.recv()
        finally:
            await server.stop()
        return calls["n"], received

    handled, flags = asyncio.run(main())
    assert handled <= 5  # 洪水の分は捨てられた（ほかの接続の分は数えていない）
    assert flags and flags[-1]["deer"] is True  # 赤の送信は止まらない


# AUTH-6
def test_auth6_古いvehicleを使い続けさせられない_10秒で固定値に戻る(logbuf):
    hub, _, clock = make_hub()
    hub.on_client_message(vehicle(speedKmh=0, zone="outside", light="day"))
    clock.advance(10.01)  # 端末の時計は見ない。edge が受け取った時刻から測る
    assert hub.vehicle_report(10.0) is None
    hub.on_client_message(
        vehicle(speedKmh=0, zone="outside", light="day", t_shown="2099-01-01T00:00:00+09:00")
    )
    assert hub.vehicle_report(10.0) is None  # 時刻つきの偽の「新しさ」は通らない
    assert len(named(logbuf, "vehicle.stale")) == 1


# AUTH-7
def test_auth7_vehicleの値は配信するフラグにもsnapshotにも載らない():
    hub, sent, clock = make_hub()
    hub.on_client_message(vehicle(speedKmh=77, zone="outside", light="dusk"))
    for i in range(2):
        clock.advance(0.1)
        hub.on_result(result(100 * i, deer(0.9)))
    clock.advance(1.0)
    hub.tick()
    snapshot = hub.snapshot()
    assert snapshot is not None
    texts = [json.dumps(f) for f in sent] + [snapshot]
    assert texts
    for text in texts:
        keys = set(json.loads(text))
        assert not keys & {"speedKmh", "speed", "light", "headlight"}
