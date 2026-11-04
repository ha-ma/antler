"""L1P-1e・FAIL-6: run_l1 の観察者（docs/specs/edge-capture E3）。降格・ログの動作を変えない。

Test List: L1P-1e L1P-1f、障害: FAIL-6
"""

from __future__ import annotations

import asyncio
import contextlib

from detector.config import JudgeConfig, L1Config
from detector.hub import AlertHub
from detector.l1.client import L1Answer
from detector.l1.runner import run_l1

from .conftest import Clock, deer, named, result
from .l1_fakes import FakeClient, answer
from .test_l1_runner import CAL, red_hub


def spin(hub, client, n, clock=None, observer=None):  # type: ignore[no-untyped-def]
    """run_l1 を観察者つきで回し、sleep が n 回呼ばれたら止める。"""
    sleeps: list[float] = []

    async def fake_sleep(s):  # type: ignore[no-untyped-def]
        sleeps.append(s)
        await asyncio.sleep(0)

    async def main() -> None:
        task = asyncio.create_task(
            run_l1(
                hub,
                client,
                L1Config(),
                CAL,
                clock=clock or Clock(),
                sleep=fake_sleep,
                observer=observer,
            )
        )
        while len(sleeps) < n:
            await asyncio.sleep(0)
            assert not task.done(), "タスクが死んだ"
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(asyncio.wait_for(main(), 10))


def test_L1P_1e_観察者は答えごとに答えと時刻とfreshで呼ばれる(logbuf) -> None:
    hub, sent, _ = red_hub()
    calls: list[tuple[L1Answer, float, bool]] = []
    client = FakeClient([answer(false_positive=0.95)])
    spin(hub, client, 2, observer=lambda a, at, fresh: calls.append((a, at, fresh)))
    assert len(calls) >= 1
    got, at, fresh = calls[0]
    assert got.false_positive == 0.95
    assert isinstance(at, float)
    assert fresh is True
    # 観察者がいても降格とログは今までどおり
    assert sent[-1]["deer"] is False
    assert named(logbuf, "l1.result")[0]["route"] == "override"


def test_L1P_1e_観察者なしの動作は今までと同じ(logbuf) -> None:
    hub, sent, _ = red_hub()
    spin(hub, FakeClient([answer(false_positive=0.95)]), 1)
    assert sent[-1]["deer"] is False
    assert named(logbuf, "l1.result")[0]["route"] == "override"


def test_FAIL_6_観察者が例外を出しても降格とログと回復は変わらない(logbuf) -> None:
    hub, sent, _ = red_hub()

    def broken(*_: object) -> None:
        msg = "observer bug"
        raise RuntimeError(msg)

    client = FakeClient([answer(false_positive=0.95)])
    spin(hub, client, 2, observer=broken)
    assert sent[-1]["deer"] is False and sent[-1]["l1"]["overrode"] is True
    assert named(logbuf, "l1.result")
    assert hub.l1_healthy is True
    # 観察者の失敗は l1 の失敗（l1_unavailable）として数えない
    assert not named(logbuf, "l1_unavailable")
    observed = named(logbuf, "l1.observer_failed")
    assert observed
    assert observed[0]["error_type"] == "RuntimeError"
    assert "observer bug" not in str(observed[0])


def test_L1P_1f_エピソードが変わった答えはfreshでない() -> None:
    clock = Clock()
    hub = AlertHub(JudgeConfig(), clock=clock, l1=L1Config())
    hub.on_result(result(0, deer(0.6, x=0.4)))  # 赤でない

    class TurnsRed(FakeClient):
        async def judge(self, request):  # type: ignore[no-untyped-def]
            if len(self.requests) == 0:
                for i in range(2):
                    clock.advance(0.1)
                    hub.on_result(result(100 + 100 * i, deer(0.9, x=0.4)))
            return await super().judge(request)

    calls: list[bool] = []
    spin(
        hub,
        TurnsRed([answer()]),
        2,
        clock=clock,
        observer=lambda _a, _at, fresh: calls.append(fresh),
    )
    assert calls[0] is False  # 聞いているあいだに赤のエピソードが始まった
