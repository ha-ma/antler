"""LAC-1・S-1: L1 が無い構成でも、L0 だけで赤が従来どおり鳴る（edge-l0 の受け入れ）。"""

import asyncio
import importlib
import json
import sys

import pytest
from websockets.asyncio.client import connect

from detector.config import load_config
from detector.frame import format_t_frame
from detector.hub import AlertHub
from detector.inference import DeerDetector, Detection, ScriptedDetector
from detector.pipeline import process_frames
from detector.runner import pump
from detector.server import AlertServer

from .conftest import frames_at_fps, named
from .test_runner import VALIDATOR, ListSource


def approaching(i: int) -> list[Detection]:
    """左寄りの鹿が近づく（ボックスが毎フレーム高くなる）。"""
    return [Detection("deer", 0.92, (0.3, 0.5, 0.1, 0.10 + 0.01 * i))]


# LAC-1・S-1
def test_lac1_L1が無くても赤が従来どおり鳴りOFFになる(tmp_path, logbuf, monkeypatch):
    monkeypatch.setitem(sys.modules, "detector.l1", None)  # L1 は存在しない
    with pytest.raises(ImportError):
        importlib.import_module("detector.l1")
    cfg_path = tmp_path / "detector.toml"
    cfg_path.write_text('[coreml]\ncompute_units = "cpu_and_ne"\n', encoding="utf-8")
    config = load_config(cfg_path)
    assert config.coreml.compute_units == "cpu_and_ne"

    script = [[]] * 2 + [approaching(i) for i in range(6)] + [[]] * 2
    detector = DeerDetector(ScriptedDetector(script))
    frames = frames_at_fps(10, 10)

    async def main():
        hub = AlertHub(config.judge, tracker=config.tracker)
        server = AlertServer(hub, config.server.__class__(port=0))  # 8765 を使わない
        port = await server.start()
        seen = []
        try:
            async with connect(f"ws://127.0.0.1:{port}/alerts") as ws:
                results = process_frames(ListSource(frames), config, detector)
                task = asyncio.create_task(pump(results, hub))
                while True:
                    flag = json.loads(await asyncio.wait_for(ws.recv(), 5))
                    seen.append(flag)
                    if not flag["deer"] and any(f["deer"] for f in seen):
                        break
                await task
        finally:
            await server.stop()
        return seen

    seen = asyncio.run(asyncio.wait_for(main(), 30))
    on = [f for f in seen if f["deer"]]
    # 従来どおり: 2 枚目の鹿（4 枚目のフレーム）で ON、距離と L/R つき、JSON Schema に通る
    assert on[0]["t_frame"] == format_t_frame(frames[3].t_frame)
    assert on[0]["side"] == "L" and on[0]["distanceM"] == 15
    assert all(VALIDATOR.is_valid(f) for f in seen)
    assert seen[-1]["deer"] is False
    sent_on = [e for e in named(logbuf, "flag.sent") if e["deer"]]
    assert sent_on and all({"track_id", "ttc_s", "lateral_mps"} <= e.keys() for e in sent_on)
