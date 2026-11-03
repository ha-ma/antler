"""AC-a〜c: edge-l1 の受け入れ（変更指示 §4 Step 3）。本物の SDK・WebSocket・pump で確かめる。

(a) L1 停止時も赤が鳴る (b) calibration.json 無しでは上書きしない
(c) 校正後 conf ≥ 0.9 の false_positive で赤 → 赤でない（PWA では琥珀）に降格し、
    l1.overrode=true が送られる
"""

import asyncio
import json

from websockets.asyncio.client import connect

from detector.config import load_config
from detector.frame import format_t_frame
from detector.hub import AlertHub
from detector.inference import DeerDetector, Detection, ScriptedDetector
from detector.l1 import start_l1
from detector.pipeline import process_frames
from detector.runner import pump
from detector.server import AlertServer

from .conftest import frames_at_fps, named
from .l1_fakes import MODEL, JevServer, closed_port, jev_body
from .test_runner import VALIDATOR, ListSource


def approaching(i: int) -> list[Detection]:
    """左寄りの鹿が近づく（LAC-1 と同じ）。"""
    return [Detection("deer", 0.92, (0.3, 0.5, 0.1, 0.10 + 0.01 * i))]


def write_config(tmp_path, base_url: str, calibration: bool) -> object:
    if calibration:
        temps = dict.fromkeys(
            ("alert_level", "on_roadway", "static_shoulder", "false_positive"), 1.0
        )
        (tmp_path / "calibration.json").write_text(
            json.dumps({"version": 1, "model": MODEL, "temperatures": temps}), encoding="utf-8"
        )
    path = tmp_path / "detector.toml"
    path.write_text(f'[l1]\nbase_url = "{base_url}"\n', encoding="utf-8")
    return load_config(path)


def drive(config, transport=None, environ=None) -> tuple[list[dict], list]:
    """鹿 6 フレームを流し、WebSocket で受けたフラグを OFF まで集める。"""
    script = [[]] * 2 + [approaching(i) for i in range(6)] + [[]] * 2
    detector = DeerDetector(ScriptedDetector(script))
    frames = frames_at_fps(10, 10)

    async def main():
        hub = AlertHub(config.judge, tracker=config.tracker, l1=config.l1)
        l1_task = start_l1(config, hub, environ=environ or {}, transport=transport)
        assert l1_task is not None
        server = AlertServer(hub, config.server.__class__(port=0))  # 8765 を使わない
        port = await server.start()
        seen = []
        try:
            async with connect(f"ws://127.0.0.1:{port}/alerts") as ws:
                results = process_frames(ListSource(frames), config, detector)
                task = asyncio.create_task(pump(results, hub, background=[l1_task]))
                while True:
                    flag = json.loads(await asyncio.wait_for(ws.recv(), 5))
                    seen.append(flag)
                    if not flag["deer"] and any(f["deer"] for f in seen) and "l1" not in flag:
                        break
                await task
        finally:
            await server.stop()
        return seen

    return asyncio.run(asyncio.wait_for(main(), 30)), frames


# AC-a・S-1
def test_aca_L1が止まっていても赤が従来どおり鳴る(tmp_path, logbuf):
    config = write_config(tmp_path, f"http://127.0.0.1:{closed_port()}", calibration=True)
    seen, frames = drive(config)
    on = [f for f in seen if f["deer"]]
    assert on[0]["t_frame"] == format_t_frame(frames[3].t_frame)  # LAC-1 と同じ
    assert on[0]["side"] == "L" and on[0]["distanceM"] == 15
    assert seen[-1]["deer"] is False
    assert all(VALIDATOR.is_valid(f) for f in seen)
    assert all("l1" not in f for f in seen)
    down = named(logbuf, "l1_unavailable")
    assert down and down[0]["reason"] == "connect"


# AC-b・S-2
def test_acb_calibration_json無しでは降格しない(tmp_path, logbuf):
    jev = JevServer(body=jev_body(false_positive=0.99))
    config = write_config(tmp_path, "http://127.0.0.1:8766", calibration=False)
    seen, _ = drive(config, transport=jev.transport)
    assert jev.requests, "L1 に聞いている"
    first_on = next(i for i, f in enumerate(seen) if f["deer"])
    offs = [f for f in seen[first_on:] if not f["deer"]]
    assert len(offs) == 1  # 解除の 1 回だけ（降格の deer: false は無い）
    assert all("l1" not in f for f in seen)
    results = named(logbuf, "l1.result")
    assert results and {r["route"] for r in results} <= {"uncalibrated", "no_episode"}
    assert any(r["route"] == "uncalibrated" for r in results)
    assert named(logbuf, "l1.calibration_unavailable")[0]["reason"] == "missing"


# AC-c
def test_acc_校正後0_95のfalse_positiveで赤から降格しoverrodeが送られる(tmp_path, logbuf):
    jev = JevServer(body=jev_body(false_positive=0.95))
    config = write_config(tmp_path, "http://127.0.0.1:8766", calibration=True)
    seen, _ = drive(config, transport=jev.transport)
    first_on = next(i for i, f in enumerate(seen) if f["deer"])
    demoted = [f for f in seen[first_on:] if not f["deer"] and "l1" in f]
    assert demoted, "赤のあとに降格のフラグが届く"
    l1 = demoted[0]["l1"]
    assert l1["alert_level"] == "zone" and l1["overrode"] is True
    assert abs(l1["conf"] - 0.95) < 1e-6 and l1["latencyMs"] >= 0
    assert "conf" not in demoted[0] and "distanceM" not in demoted[0]  # deer: false の形
    assert all(VALIDATOR.is_valid(f) for f in seen)
    sent = [e for e in named(logbuf, "flag.sent") if e.get("l1", {}).get("overrode")]
    assert sent and sent[0]["reason"] == "l1"
    body = jev.payloads()[0]
    assert set(body["questions"]) == {
        "alert_level",
        "on_roadway",
        "static_shoulder",
        "false_positive",
    }
