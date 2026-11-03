"""UC-7・AC-1・AC-2・FAIL-3・S-4・S-5: pump とエンドツーエンド。"""

import asyncio
import json
import threading
import time

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from websockets.asyncio.client import connect

from detector.config import Config, JudgeConfig, ServerConfig
from detector.hub import AlertHub
from detector.inference import DeerDetector, Detection, ScriptedDetector
from detector.pipeline import process_frames
from detector.runner import pump
from detector.server import AlertServer

from .conftest import deer, frames_at_fps, named, result
from .test_flag import SCHEMA

VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 30))


class ListSource:
    def __init__(self, frames):
        self.frames = list(frames)

    def read(self):
        return self.frames.pop(0) if self.frames else None


def fast_hub(**kw):
    cfg = JudgeConfig(off_after_s=0.5, **kw)
    return AlertHub(cfg)


# AC-1
def test_ac1_ONのフラグが届き消えて1_5秒でOFF_ackでログが残る(logbuf):
    ON = [[Detection("deer", 0.92, (0.3, 0.5, 0.1, 0.1))]] * 6
    script = [[]] * 2 + ON + [[]] * 2
    detector = DeerDetector(ScriptedDetector(script))

    async def main():
        hub = fast_hub()
        server = AlertServer(hub, ServerConfig(port=0))
        port = await server.start()
        seen = []
        try:
            async with connect(f"ws://127.0.0.1:{port}/alerts") as ws:
                frames = frames_at_fps(10, 10)
                results = process_frames(ListSource(frames), Config(), detector)
                task = asyncio.create_task(pump(results, hub))
                while True:
                    flag = json.loads(await asyncio.wait_for(ws.recv(), 5))
                    seen.append(flag)
                    if flag["deer"]:
                        await ws.send(
                            json.dumps({"type": "ack", "t_shown": "2027-02-15T16:31:08.700+09:00"})
                        )
                    if len(seen) >= 3 and not flag["deer"] and any(f["deer"] for f in seen):
                        break
                await task
        finally:
            await server.stop()
        return seen

    seen = run(main())
    on = [f for f in seen if f["deer"]]
    assert on and on[0]["side"] == "L" and on[0]["distanceM"] == 16
    assert all(VALIDATOR.is_valid(f) for f in seen)
    assert seen[-1]["deer"] is False
    assert named(logbuf, "ack") and named(logbuf, "flag.sent")
    assert all("t_frame" in e for e in named(logbuf, "flag.sent"))
    assert all("t_frame" in e for e in named(logbuf, "frame.processed"))


# AC-2・UC-7b・S-4・S-5
def test_ac2_入力が止まってもexpireでOFF_ハートビートの無い静けさ(logbuf):
    sent = []
    hub = AlertHub(JudgeConfig(off_after_s=0.5))
    hub.sender = lambda t: sent.append(json.loads(t)) or 0  # 接続 0 でも判定は続く（S-5）

    async def main():
        results = iter([result(0, deer()), result(100, deer())])
        await pump(results, hub, tick_s=0.05)

    run(main())
    assert [f["deer"] for f in sent][-1] is False and True in [f["deer"] for f in sent]
    assert named(logbuf, "flag.sent")[-1]["reason"] == "change"


# UC-7a
def test_uc7a_遅い推論でもハートビートが出る():
    sent = []
    hub = AlertHub(JudgeConfig(stall_after_s=30))
    hub.sender = lambda t: sent.append(t) or 0

    def slow():
        yield result(0)
        time.sleep(1.4)  # 推論が重い
        yield result(100)

    async def main():
        await pump(slow(), hub, tick_s=0.05)

    run(main())
    assert len(sent) >= 2  # 最初の判定 + 1 秒のハートビート（スレッドが止めていない）


# UC-7c
def test_uc7c_tickerの例外で死なず_生成器を閉じる(logbuf):
    hub = fast_hub()
    calls = []
    orig = hub.tick

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom SECRET")
        orig()

    hub.tick = flaky
    closed = []

    def gen():
        try:
            yield result(0)
            time.sleep(0.3)
            yield result(100)
        finally:
            closed.append(1)

    run(pump(gen(), hub, tick_s=0.05))
    assert len(calls) > 2 and closed == [1]
    assert named(logbuf, "tick.failed") and "SECRET" not in logbuf.getvalue()


# UC-7b・FAIL-3
def test_uc7b_入力の例外は上へ出てタスクが片付く(logbuf):
    hub = fast_hub()

    def broken():
        yield result(0)
        raise RuntimeError("camera exploded SECRET")

    async def main():
        with pytest.raises(RuntimeError):
            await pump(broken(), hub, tick_s=0.05)
        await asyncio.sleep(0.1)
        return [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]

    assert run(main()) == []
    assert named(logbuf, "pump.aborted")[0]["error_type"] == "RuntimeError"
    assert "SECRET" not in logbuf.getvalue()


# CONC-1（スレッドから結果を受けながら、ループ側だけが Judge を触る）
def test_conc1_Judgeに触るのはループのスレッドだけ():
    hub = fast_hub()
    threads = set()
    orig = hub.on_result

    def spy(r):
        threads.add(threading.get_ident())
        orig(r)

    hub.on_result = spy

    async def main():
        loop_thread = threading.get_ident()
        await pump(iter([result(0, deer()), result(100, deer())]), hub, tick_s=0.05)
        return loop_thread

    assert threads == {run(main())}
