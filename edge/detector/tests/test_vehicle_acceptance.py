"""AC-a・AC-b・AC-d・AUTH-5: pwa-uplink の受け入れ（docs/specs/pwa-uplink）。

本物の WebSocket クライアントが `vehicle` を送り、本物の SDK（偽の local-jev）への問い合わせの
state と、WebSocket で配られるフラグを確かめる。赤の経路に `vehicle` が触れないこと、
固定値で学習した校正のもとでは実値で降格が増えないことを回帰として持つ。
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from time import monotonic

import pytest
from websockets.asyncio.client import connect

from detector.config import ServerConfig, load_config
from detector.hub import AlertHub
from detector.l1 import start_l1
from detector.server import AlertServer

from .conftest import deer, named, result
from .l1_fakes import MODEL, JevServer, jev_body

IDS = ("alert_level", "on_roadway", "static_shoulder", "false_positive")
LIVE = {"speedKmh": 45, "zone": "outside", "light": "day"}
LIVE_STATE = {"speedKmh": 45.0, "zone": "outside", "light": "day", "headlight": "off"}
FIXED_STATE = {"speedKmh": 60.0, "zone": "inside", "light": "night", "headlight": "low"}
OUTSIDE_STOPPED = {"speedKmh": 0, "zone": "outside", "light": "day"}


@dataclass
class SkewClock:
    """単調時計に差を足せる時計。10 秒たったことにする。"""

    skew: float = 0.0

    def __call__(self) -> float:
        return monotonic() + self.skew


@dataclass
class Outcome:
    flags: list[dict] = field(default_factory=list)
    jev: JevServer = field(default_factory=JevServer)

    def states(self) -> list[dict]:
        """問い合わせの state のうち、車の状態の 4 項目（track などは除く）。"""
        keys = ("speedKmh", "zone", "light", "headlight")
        return [{k: p["state"][k] for k in keys} for p in self.jev.payloads()]

    def strip(self) -> list[dict]:
        return [{k: v for k, v in f.items() if k != "t_sent"} for f in self.flags]


def write_config(tmp_path, context: str | None, *, calibration: bool = True):
    """context: None = 校正に context なし（固定値で学習）、"fixed" / "real"。"""
    if calibration:
        data = {"version": 1, "model": MODEL, "temperatures": dict.fromkeys(IDS, 1.0)}
        if context is not None:
            data["context"] = context
        (tmp_path / "calibration.json").write_text(json.dumps(data), encoding="utf-8")
    path = tmp_path / "detector.toml"
    path.write_text('[l1]\nbase_url = "http://127.0.0.1:8766"\n', encoding="utf-8")
    return load_config(path)


async def wait_for(predicate, timeout: float = 5.0) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


async def run_case(
    config,
    *,
    vehicle: dict | None,
    false_positive: float = 0.05,
    jump_after_first_ask: bool = False,
    frames: int = 12,
) -> tuple[Outcome, AlertHub]:
    """鹿を 0.15 秒おきに流し、L1 に聞かせる。vehicle があれば最初に WebSocket で送る。"""
    out = Outcome(jev=JevServer(body=jev_body(false_positive=false_positive)))
    clock = SkewClock()
    hub = AlertHub(config.judge, clock=clock, tracker=config.tracker, l1=config.l1)
    l1 = start_l1(config, hub, environ={}, transport=out.jev.transport)
    assert l1 is not None
    server = AlertServer(hub, ServerConfig(port=0))  # 8765 を使わない
    port = await server.start()
    l1_task = asyncio.create_task(l1)
    try:
        async with connect(f"ws://127.0.0.1:{port}/alerts") as ws:

            async def collect() -> None:
                async for raw in ws:
                    out.flags.append(json.loads(raw))

            reader = asyncio.create_task(collect())
            if vehicle is not None:
                await ws.send(json.dumps({"type": "vehicle", **vehicle}))
                await wait_for(lambda: hub.vehicle_report(10.0) is not None)
            for i in range(frames):
                if jump_after_first_ask and out.jev.requests and not clock.skew:
                    clock.skew = 11.0
                hub.on_result(result(150 * i, deer(0.9, x=0.4)))
                await asyncio.sleep(0.15)
            if jump_after_first_ask:
                await wait_for(lambda: len(out.jev.requests) >= 2, timeout=3.0)
            reader.cancel()
    finally:
        l1_task.cancel()
        await server.stop()
        await asyncio.gather(l1_task, return_exceptions=True)
    return out, hub


# AC-a
def test_aca_校正なしでは実値で聞き10秒たつと固定値に戻る(tmp_path, logbuf):
    config = write_config(tmp_path, None, calibration=False)
    out, _ = asyncio.run(run_case(config, vehicle=LIVE, jump_after_first_ask=True, frames=10))
    states = out.states()
    assert states[0] == LIVE_STATE
    assert states[-1] == FIXED_STATE  # 注入した時計を進めたあとの問い合わせ
    assert len(named(logbuf, "vehicle.stale")) == 1
    assert {r["state_source"] for r in named(logbuf, "l1.result")} == {"pwa", "fixed"}


# AC-b
def test_acb_vehicleを送っても赤の経路は変わらず校正なしでは赤は下がらない(tmp_path, logbuf):
    config = write_config(tmp_path, None, calibration=False)
    with_vehicle, _ = asyncio.run(run_case(config, vehicle=OUTSIDE_STOPPED, false_positive=0.99))
    without, _ = asyncio.run(run_case(config, vehicle=None, false_positive=0.99))

    def reds(o: Outcome) -> list[dict]:
        return [f for f in o.strip() if f["deer"]]

    assert reds(with_vehicle), "赤が鳴る"
    assert reds(with_vehicle)[0]["distanceM"] == reds(without)[0]["distanceM"]
    assert reds(with_vehicle)[0]["side"] == reds(without)[0]["side"]
    for o in (with_vehicle, without):
        assert all("l1" not in f for f in o.flags)  # 校正なしは l1 を付けない
        first = next(i for i, f in enumerate(o.flags) if f["deer"])
        assert all(f["deer"] for f in o.flags[first:])  # 降格が一度も起きない（鹿は見え続けている）


# AC-d
@pytest.mark.parametrize(
    ("context", "expected"), [(None, FIXED_STATE), ("fixed", FIXED_STATE), ("real", LIVE_STATE)]
)
def test_acd_校正のcontextで実値を使うかが決まる(tmp_path, logbuf, context, expected):
    config = write_config(tmp_path, context)
    out, _ = asyncio.run(run_case(config, vehicle=LIVE, frames=6))
    assert out.states(), "L1 に聞いている"
    assert all(s == expected for s in out.states())
    if expected is FIXED_STATE:
        assert len(named(logbuf, "l1.vehicle_ignored")) == 1
        assert {r["state_source"] for r in named(logbuf, "l1.result")} == {"fixed"}
    else:
        assert not named(logbuf, "l1.vehicle_ignored")
        assert {r["state_source"] for r in named(logbuf, "l1.result")} == {"pwa"}


# AUTH-5
def test_auth5_固定値で学習した校正のもとでは実値を送り続けても降格が増えない(tmp_path, logbuf):
    config = write_config(tmp_path, None)  # context なし = 固定値で学習
    spam, _ = asyncio.run(run_case(config, vehicle=OUTSIDE_STOPPED, false_positive=0.95))
    plain, _ = asyncio.run(run_case(config, vehicle=None, false_positive=0.95))

    def demotions(o: Outcome) -> int:
        return sum(1 for f in o.flags if not f["deer"] and f.get("l1", {}).get("overrode"))

    assert demotions(plain) >= 1, "降格する答えなので降格する（比較の前提）"
    assert (demotions(spam) >= 1) == (demotions(plain) >= 1)
    assert all(s == FIXED_STATE for s in spam.states())  # 聞く内容が同じ = 実値が降格を動かせない
    assert all(s == FIXED_STATE for s in plain.states())
