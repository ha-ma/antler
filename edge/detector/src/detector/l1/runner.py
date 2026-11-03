"""L1 のタスク（B2-4・R7）: 2〜3 Hz で 1 つずつ聞き、答えを hub に渡す。何が起きても死なない。

- 問い合わせは同時に 1 つまで（await してから次）。間隔は開始から 1 / rate_hz 秒
- 失敗が n 回続いたら、次まで min(2 秒, 間隔 × 2^n)
  （local-jev は打ち切っても計算を続けるので詰めない）
- 失敗は l1_unavailable（理由・型名）を 1 秒に 1 回まで。回復したら l1.recovered
- イベントループの上で動く。hub と L0 の状態を触るのはここ（ループの上）だけ
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from time import monotonic
from typing import TYPE_CHECKING

from detector.config import resolve_path
from detector.fusion import L1Verdict, conclude
from detector.l1.calibration import load_calibration
from detector.l1.client import (
    L1Unavailable,
    endpoint_fields,
    make_client,
    resolve_base_url,
)
from detector.l1.request import build_request

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Coroutine, Mapping

    from detector.config import Config, L1Config
    from detector.fusion import L1Target
    from detector.hub import AlertHub
    from detector.l1.calibration import Calibration
    from detector.l1.client import JudgeClient, L1Answer

__all__ = ["MAX_BACKOFF_S", "make_verdict", "run_l1", "start_l1"]

logger = logging.getLogger("detector.l1")

MAX_BACKOFF_S = 2.0
FAIL_LOG_INTERVAL_S = 1.0
MISMATCH_LOG_INTERVAL_S = 1.0


def make_verdict(
    answer: L1Answer,
    target: L1Target,
    started: float,
    latency_ms: float,
    calibration: Calibration | None,
    override_conf: float,
) -> L1Verdict:
    """答えに校正を当て、結論を出す。校正なし・モデル違いは calibrated=False（降格しない）。"""
    raw_level, raw_conf, _ = conclude(answer.alert_level, answer.false_positive, override_conf)
    calibrated = calibration is not None and calibration.matches(answer.model)
    used = calibration.apply(answer) if calibrated and calibration else answer
    level, conf, reason = conclude(used.alert_level, used.false_positive, override_conf)
    return L1Verdict(
        episode=target.episode,
        track_id=target.track_id,
        started=started,
        latency_ms=latency_ms,
        model=answer.model,
        calibrated=calibrated,
        alert_level=level if calibrated else raw_level,
        conf=conf if calibrated else raw_conf,
        conf_raw=raw_conf,
        reason=reason if calibrated else None,
    )


async def _wait(hub: AlertHub, seconds: float, sleep: Callable[[float], Awaitable[None]]) -> None:
    """seconds 待つ。赤の保留（B2-8）で起こされたら早く戻る。"""
    if hub.l1_wake.is_set():
        hub.l1_wake.clear()
        return
    waker = asyncio.ensure_future(hub.l1_wake.wait())
    timer = asyncio.ensure_future(sleep(max(0.0, seconds)))
    try:
        await asyncio.wait({waker, timer}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in (waker, timer):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        hub.l1_wake.clear()


async def run_l1(
    hub: AlertHub,
    client: JudgeClient,
    config: L1Config,
    calibration: Calibration | None,
    clock: Callable[[], float] = monotonic,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """キャンセルされるまで回る。例外を外へ出さない（検知を止めない）。"""
    interval = 1.0 / config.rate_hz
    failures = 0
    last_fail_log: float | None = None
    last_mismatch_log: float | None = None
    timeout_s = config.timeout_ms / 1000.0
    while True:
        started = clock()
        stale = False
        try:
            picked = hub.l1_target()
            if picked is not None:
                target, recent = picked
                request = build_request(target, recent, config.model)
                async with asyncio.timeout(timeout_s):  # どのクライアントでも 800 ms で打ち切る
                    answer = await client.judge(request)
                latency_ms = (clock() - started) * 1000.0
                # 聞いているあいだに赤のエピソードが変わった: 降格に使えないので、すぐ聞き直す
                stale = hub.fusion is not None and target.episode != hub.fusion.episode
                verdict = make_verdict(
                    answer, target, started, latency_ms, calibration, config.override_conf
                )
                if calibration is not None and not verdict.calibrated:
                    now = clock()
                    if (
                        last_mismatch_log is None
                        or now - last_mismatch_log >= MISMATCH_LOG_INTERVAL_S
                    ):
                        last_mismatch_log = now
                        logger.warning("l1.calibration_mismatch", extra={"model": answer.model})
                hub.on_l1(verdict)
                if failures:
                    logger.info("l1.recovered", extra={"after_failures": failures})
                failures = 0
                hub.l1_healthy = True
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001  失敗しても検知は止めない（L0 だけで動く）
            if isinstance(exc, L1Unavailable):
                reason, error_type = exc.reason, exc.error_type
            else:
                reason = "timeout" if isinstance(exc, TimeoutError) else "error"
                error_type = type(exc).__name__
            failures += 1
            hub.l1_healthy = False
            hub.on_l1_failed()
            now = clock()
            if last_fail_log is None or now - last_fail_log >= FAIL_LOG_INTERVAL_S:
                last_fail_log = now
                logger.warning(
                    "l1_unavailable",
                    extra={"reason": reason, "error_type": error_type, "failures": failures},
                )
        delay = min(MAX_BACKOFF_S, interval * 2**failures) if failures else interval
        await _wait(hub, 0.0 if stale else delay - (clock() - started), sleep)


def start_l1(
    config: Config,
    hub: AlertHub,
    environ: Mapping[str, str] | None = None,
    transport: object | None = None,
) -> Coroutine[object, object, None] | None:
    """L1 のタスク（コルーチン）を作る。動かせなければ理由を残して None（L0 だけで動く）。

    `pump(results, hub, background=[coro])` に渡す。
    """
    cfg = config.l1
    if not cfg.enabled or hub.fusion is None:
        logger.info("l1.disabled")
        return None
    env = os.environ if environ is None else environ
    base_url = resolve_base_url(cfg.base_url, env)
    try:
        logger.info("l1.endpoint", extra=endpoint_fields(base_url))
    except ValueError:
        logger.info("l1.endpoint", extra={"scheme": None, "host": None, "port": None})
    try:
        client = make_client(base_url, cfg.timeout_ms, env, transport)
    except L1Unavailable as exc:
        logger.warning("l1_unavailable", extra={"reason": exc.reason, "error_type": exc.error_type})
        return None
    calibration = load_calibration(resolve_path(config, cfg.calibration_path))

    async def task() -> None:
        try:
            await run_l1(hub, client, cfg, calibration)
        finally:
            await client.aclose()

    return task()
