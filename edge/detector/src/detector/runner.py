"""実行: edge-camera のパイプライン（同期の生成器）を別スレッドで進め、判定と配信につなぐ。"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Coroutine, Iterator, Sequence

    from detector.hub import AlertHub
    from detector.pipeline import FrameResult

logger = logging.getLogger("detector.runner")

TICK_S = 0.1


async def pump(
    results: Iterator[FrameResult],
    hub: AlertHub,
    tick_s: float = TICK_S,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    settle_ticks: int = 100,
    background: Sequence[Coroutine[object, object, None]] = (),
) -> None:
    """結果を 1 件ずつスレッドで取り、ループの上で判定する。重い推論が配信と ping を止めない。

    入力が尽きたら、ON の鹿が expire で OFF になるまで（最大 settle_ticks 回）刻み続ける。
    入力の例外は上へ出す（ticker は片付ける）。background（L1 のタスクなど）は並べて動かし、
    終わりに片付ける。
    """
    others = [asyncio.create_task(coro) for coro in background]

    async def ticker() -> None:
        while True:
            try:
                hub.tick()
            except Exception as exc:  # noqa: BLE001  ticker が黙って死ぬと ON が固定される
                logger.error("tick.failed", extra={"error_type": type(exc).__name__})
            await sleep(tick_s)

    task = asyncio.create_task(ticker())
    try:
        while True:
            result = await asyncio.to_thread(next, results, None)
            if result is None:
                break
            hub.on_result(result)
        for _ in range(settle_ticks):
            if not hub.deer_on:
                break
            await sleep(tick_s)
    except Exception as exc:
        logger.critical("pump.aborted", extra={"error_type": type(exc).__name__})
        raise
    finally:
        close = getattr(results, "close", None)
        if close is not None:
            with contextlib.suppress(ValueError, RuntimeError):
                close()  # 生成器（カメラ）を解放する
        for t in (task, *others):
            t.cancel()
        for t in (task, *others):
            with contextlib.suppress(asyncio.CancelledError):
                await t
