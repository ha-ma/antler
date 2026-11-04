"""パイプライン: 読む → 間引く → 640×480 → 推論 → 走行ログ（t_frame を必ず残す）。

具体的な入力・推論クラスは知らない。Protocol（ports）だけに依存する（B1-3）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from time import perf_counter
from typing import TYPE_CHECKING

from detector.frame import format_t_frame, resize_frame
from detector.throttle import FrameThrottle

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from datetime import datetime

    import numpy as np

    from detector.config import Config
    from detector.ports import Detection, Detector, FrameSource

logger = logging.getLogger("detector.pipeline")

DEGRADED_AFTER = 30


@dataclass(frozen=True)
class FrameResult:
    seq: int
    t_frame: datetime
    detections: list[Detection] = field(default_factory=list)
    infer_ms: float = 0.0
    failed: bool = False  # 推論が壊れたフレーム。「鹿なし」と区別する
    invalid_count: int = 0  # 不正で捨てた検出の数。鹿 0 件でこれが多いと「壊れた鹿なし」
    # 640×480 に縮めた画像（検知フレームの保存 edge-capture が使う）。比較・repr には入れない
    image: np.ndarray | None = field(default=None, compare=False, repr=False)


def process_frames(
    source: FrameSource,
    config: Config,
    detector: Detector,
    clock: Callable[[], float] = perf_counter,
) -> Iterator[FrameResult]:
    """通ったフレームごとに FrameResult を返す。終わり方によらず pipeline.summary を 1 回残す。"""
    throttle = FrameThrottle(config.pipeline.target_fps)
    budget_ms = config.infer.budget_ms
    counts = {"read": 0, "passed": 0, "failed": 0}
    consecutive = 0
    degraded = False
    ended = "closed"
    try:
        while True:
            try:
                frame = source.read()
            except Exception as exc:
                ended = "error"
                logger.critical("pipeline.aborted", extra={"error_type": type(exc).__name__})
                raise
            if frame is None:
                ended = "eof"
                return
            counts["read"] += 1
            if not throttle.accept(frame):
                continue
            counts["passed"] += 1
            resized = resize_frame(frame)
            t_frame = format_t_frame(frame.t_frame)
            started = clock()
            try:
                detections = detector.detect(resized.image)
            except Exception as exc:  # noqa: BLE001  推論の失敗で走行を止めない
                infer_ms = (clock() - started) * 1000.0
                counts["failed"] += 1
                consecutive += 1
                logger.error(
                    "infer.failed",
                    extra={
                        "seq": frame.seq,
                        "t_frame": t_frame,
                        "consecutive": consecutive,
                        "error_type": type(exc).__name__,
                    },
                )
                if consecutive == DEGRADED_AFTER:
                    degraded = True
                    logger.critical("infer.degraded", extra={"seq": frame.seq, "t_frame": t_frame})
                yield FrameResult(frame.seq, frame.t_frame, [], infer_ms, failed=True)
                continue
            infer_ms = (clock() - started) * 1000.0
            invalid = getattr(detector, "last_invalid", 0)
            if invalid and not detections:
                # 全部不正で捨てた: 本物の「鹿なし」と区別し、続くなら degraded に数える
                consecutive += 1
                if consecutive == DEGRADED_AFTER:
                    degraded = True
                    logger.critical("infer.degraded", extra={"seq": frame.seq, "t_frame": t_frame})
            else:
                consecutive = 0
            if degraded and consecutive == 0:
                logger.info("infer.recovered", extra={"seq": frame.seq, "t_frame": t_frame})
                degraded = False
            if infer_ms > budget_ms:
                logger.warning(
                    "infer.over_budget",
                    extra={"seq": frame.seq, "t_frame": t_frame, "infer_ms": round(infer_ms, 1)},
                )
            logger.info(
                "frame.processed",
                extra={
                    "seq": frame.seq,
                    "t_frame": t_frame,
                    "infer_ms": round(infer_ms, 1),
                    "deer_count": len(detections),
                    "max_conf": max((d.conf for d in detections), default=None),
                    "invalid_count": invalid,
                },
            )
            yield FrameResult(
                frame.seq,
                frame.t_frame,
                detections,
                infer_ms,
                invalid_count=invalid,
                image=resized.image,
            )
    finally:
        logger.info(
            "pipeline.summary",
            extra={
                "read": counts["read"],
                "passed": counts["passed"],
                "dropped": counts["read"] - counts["passed"],
                "failed": counts["failed"],
                "ended": ended,
            },
        )
