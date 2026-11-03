"""RUN-1: L1 のタスク（edge-l1 R7）。何が起きても死なず、1 つずつ聞き、失敗で間隔を延ばす。"""

import asyncio
import builtins
import contextlib
import json

import pytest

from detector.config import Config, JudgeConfig, L1Config
from detector.hub import AlertHub
from detector.l1 import start_l1
from detector.l1.calibration import Calibration
from detector.l1.runner import MAX_BACKOFF_S, backoff_s, make_verdict, run_l1
from detector.runner import pump

from .conftest import Clock, deer, named, result
from .l1_fakes import MODEL, FakeClient, answer, unavailable

IDS = ("alert_level", "on_roadway", "static_shoulder", "false_positive")
CAL = Calibration(MODEL, dict.fromkeys(IDS, 1.0))


def red_hub(clock=None, **l1):
    clock = clock or Clock()
    hub = AlertHub(JudgeConfig(), clock=clock, l1=L1Config(**l1))
    sent = []
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    for i in range(2):
        clock.advance(0.1)
        hub.on_result(result(100 * i, deer(0.9, x=0.4)))
    assert hub.deer_on
    return hub, sent, clock


def spin(hub, client, n: int, cal=CAL, clock=None, **l1) -> list[float]:
    """run_l1 を回し、sleep が n 回呼ばれたら止める。sleep に渡った秒を返す。"""
    sleeps: list[float] = []

    async def fake_sleep(s):
        sleeps.append(s)
        await asyncio.sleep(0)

    async def main():
        task = asyncio.create_task(
            run_l1(hub, client, L1Config(**l1), cal, clock=clock or Clock(), sleep=fake_sleep)
        )
        while len(sleeps) < n:
            await asyncio.sleep(0)
            assert not task.done(), "タスクが死んだ"
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(asyncio.wait_for(main(), 10))
    return sleeps


# RUN-1a
def test_run1a_答えがhubに渡りl1_resultが残る(logbuf):
    hub, sent, _ = red_hub()
    client = FakeClient([answer(false_positive=0.95)])
    spin(hub, client, 1)
    assert client.requests and client.requests[0].state.recentAlerts30s == 1
    assert sent[-1]["deer"] is False and sent[-1]["l1"]["overrode"] is True
    res = named(logbuf, "l1.result")[0]
    assert res["route"] == "override" and res["calibrated"] is True and res["model"] == MODEL
    assert hub.l1_healthy is True


# RUN-1b・S-3
def test_run1b_失敗や例外が続いても死なずログは1秒に1回で回復を残す(logbuf):
    hub, _, _ = red_hub()
    script = [TimeoutError(), unavailable("http"), RuntimeError("x"), answer()]
    client = FakeClient(script)
    spin(hub, client, 5)
    down = named(logbuf, "l1_unavailable")
    assert len(down) == 1 and down[0]["reason"] == "timeout"
    assert named(logbuf, "l1.recovered")[0]["after_failures"] == 3
    assert len(client.requests) >= 4


def test_run1b_遅い答えはtimeout_msで打ち切る(logbuf):
    hub, _, _ = red_hub()
    client = FakeClient([answer()], delay=1.0)

    async def main():
        task = asyncio.create_task(run_l1(hub, client, L1Config(timeout_ms=50), CAL))
        await asyncio.sleep(0.2)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(main())
    assert named(logbuf, "l1_unavailable")[0]["reason"] == "timeout"
    assert hub.l1_healthy is False


# RUN-1c
def test_run1c_同時に1つまで開始から1_rate_hz秒ごと():
    hub, _, _ = red_hub()
    client = FakeClient([answer()], delay=0.01)
    sleeps = spin(hub, client, 3, rate_hz=2.5)
    assert client.max_in_flight == 1
    assert sleeps == [pytest.approx(0.4)] * 3  # 注入した時計は進まないので間隔そのもの


def test_run1c_かかった時間は間隔から引く():
    clock = Clock()
    hub, _, _ = red_hub()

    class Slow(FakeClient):
        async def judge(self, request):
            clock.advance(0.3)
            return await super().judge(request)

    sleeps = spin(hub, Slow([answer()]), 1, clock=clock, rate_hz=2.5)
    assert sleeps[0] == pytest.approx(0.1)


# RUN-1d
def test_run1d_聞く対象が無いティックは送らない():
    hub = AlertHub(JudgeConfig(), clock=Clock(), l1=L1Config())
    client = FakeClient([answer()])
    spin(hub, client, 3)
    assert client.requests == []


# RUN-1e
def test_run1e_wakeで次のティックを待たずに聞く():
    hub, _, _ = red_hub()
    client = FakeClient([answer()])

    async def main():
        task = asyncio.create_task(run_l1(hub, client, L1Config(rate_hz=0.1), CAL))
        while not client.requests:
            await asyncio.sleep(0.01)
        hub.l1_wake.set()
        for _ in range(100):
            if len(client.requests) >= 2:
                break
            await asyncio.sleep(0.01)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(asyncio.wait_for(main(), 5))
    assert len(client.requests) >= 2  # 10 秒の間隔を待たずに 2 回目


# RUN-1f・RUN-1i
def test_run1f_無効やSDK無しや車外の接続先ではNone(logbuf, monkeypatch, tmp_path):
    hub = AlertHub(JudgeConfig(), l1=L1Config())
    off = Config(l1=L1Config(enabled=False))
    assert start_l1(off, AlertHub(JudgeConfig(), l1=off.l1), environ={}) is None
    assert named(logbuf, "l1.disabled")

    remote = start_l1(Config(), hub, environ={"TYPESAFE_BASE_URL": "https://api.typesafe.ai"})
    assert remote is None
    assert named(logbuf, "l1_unavailable")[-1]["reason"] == "remote_not_allowed"
    endpoint = named(logbuf, "l1.endpoint")[-1]
    assert endpoint == {**endpoint, "scheme": "https", "host": "api.typesafe.ai", "port": None}

    ok = start_l1(Config(), hub, environ={})
    assert ok is not None
    ok.close()

    real = builtins.__import__

    def fake(name, *args, **kw):
        if name == "typesafe_sdk":
            raise ImportError(name)
        return real(name, *args, **kw)

    monkeypatch.setattr(builtins, "__import__", fake)
    assert start_l1(Config(), hub, environ={}) is None
    assert named(logbuf, "l1_unavailable")[-1]["reason"] == "sdk_missing"


# RUN-1g
def test_run1g_pumpは入力が尽きたらbackgroundを片付ける():
    state = {"started": False, "cancelled": False}

    async def forever():
        state["started"] = True
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    hub = AlertHub(JudgeConfig())

    async def main():
        await pump(iter([result(0)]), hub, settle_ticks=1, background=[forever()])

    asyncio.run(asyncio.wait_for(main(), 5))
    assert state == {"started": True, "cancelled": True}


# RUN-1h
def test_run1h_失敗が続くと間隔が2倍ずつ延び成功で戻る():
    hub, _, _ = red_hub()
    fails = [unavailable() for _ in range(4)]
    sleeps = spin(hub, FakeClient([*fails, answer()]), 6, rate_hz=2.5)
    assert sleeps[:4] == [pytest.approx(0.8), pytest.approx(1.6), MAX_BACKOFF_S, MAX_BACKOFF_S]
    assert sleeps[4] == pytest.approx(0.4)


# RUN-1j（[ADDED review]）
def test_run1j_失敗が何千回続いても間隔は2秒で頭打ち():
    assert backoff_s(0.4, 0) == pytest.approx(0.4)
    assert backoff_s(0.4, 1) == pytest.approx(0.8)
    assert backoff_s(0.4, 10_000) == MAX_BACKOFF_S  # OverflowError にならない


# RUN-1j
def test_run1j_後始末のon_l1_failedが例外でもタスクは死なない(logbuf):
    hub, _, _ = red_hub()

    def boom():
        raise RuntimeError("boom")

    hub.on_l1_failed = boom
    client = FakeClient([unavailable()])
    spin(hub, client, 3)
    assert len(client.requests) >= 3
    assert named(logbuf, "l1.release_failed")


# RUN-1j
def test_run1j_backgroundが死んだらログに残し検知は続ける(logbuf):
    async def dies():
        raise RuntimeError("boom")

    hub = AlertHub(JudgeConfig())

    async def main():
        await pump(iter([result(0), result(100)]), hub, settle_ticks=1, background=[dies()])

    asyncio.run(asyncio.wait_for(main(), 5))
    assert named(logbuf, "background.died")[0]["error_type"] == "RuntimeError"


def test_失敗で降格が解けて赤に戻る():
    hub, sent, _ = red_hub()
    spin(hub, FakeClient([answer(false_positive=0.95), unavailable()]), 2)
    assert sent[-1]["deer"] is True


def test_モデル違いは校正なしでmismatchは1秒に1回(logbuf):
    hub, sent, _ = red_hub()
    spin(hub, FakeClient([answer(false_positive=0.99, model="nli-deberta-large")]), 3)
    assert sent[-1]["deer"] is True
    assert len(named(logbuf, "l1.calibration_mismatch")) == 1
    assert {r["route"] for r in named(logbuf, "l1.result")} == {"uncalibrated"}


def test_make_verdictは校正なしでは理由を持たない():
    from detector.fusion import L1Target

    target = L1Target(1, 3, [], None)
    v = make_verdict(answer(false_positive=0.99), target, 1.0, 20.0, None, 0.9)
    assert v.calibrated is False and v.reason is None and v.conf_raw == 0.99
    w = make_verdict(answer(false_positive=0.99), target, 1.0, 20.0, CAL, 0.9)
    assert w.calibrated and w.reason == "false_positive" and w.track_id == 3


def test_聞いているあいだにエピソードが変わったらすぐ聞き直す():
    clock = Clock()
    hub = AlertHub(JudgeConfig(), clock=clock, l1=L1Config())
    hub.on_result(result(0, deer(0.6, x=0.4)))  # 赤でない（0.6）

    class TurnsRed(FakeClient):
        async def judge(self, request):
            if len(self.requests) == 0:
                for i in range(2):
                    clock.advance(0.1)
                    hub.on_result(result(100 + 100 * i, deer(0.9, x=0.4)))
            return await super().judge(request)

    sleeps = spin(hub, TurnsRed([answer()]), 2, clock=clock)
    assert sleeps[0] == 0.0
