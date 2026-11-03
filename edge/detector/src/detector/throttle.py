"""間引き（B2-1: 5〜10 fps）。撮影時刻 t_frame の間隔で通す。"""

from __future__ import annotations

import logging
import math
from datetime import timedelta
from typing import TYPE_CHECKING

from detector.config import MAX_TARGET_FPS, MIN_TARGET_FPS
from detector.frame import format_t_frame
from detector.ports import ConfigError

if TYPE_CHECKING:
    from datetime import datetime

    from detector.frame import Frame

logger = logging.getLogger("detector.throttle")

JITTER = timedelta(milliseconds=5)
JUMP = timedelta(seconds=1)


class FrameThrottle:
    def __init__(self, target_fps: float) -> None:
        if not (MIN_TARGET_FPS <= target_fps <= MAX_TARGET_FPS) or math.isnan(target_fps):
            msg = f"target_fps は {MIN_TARGET_FPS}〜{MAX_TARGET_FPS}: {target_fps}"
            raise ConfigError(msg)
        self._interval = timedelta(seconds=1.0 / target_fps)
        self._last: datetime | None = None

    def accept(self, frame: Frame) -> bool:
        if self._last is not None:
            elapsed = frame.t_frame - self._last
            if elapsed <= timedelta(0):
                if -elapsed > JUMP:
                    logger.warning(
                        "clock.jump",
                        extra={"seq": frame.seq, "t_frame": format_t_frame(frame.t_frame)},
                    )
                    self._last = frame.t_frame
                    return True
                logger.warning(
                    "frame.out_of_order",
                    extra={"seq": frame.seq, "t_frame": format_t_frame(frame.t_frame)},
                )
                return False
            if elapsed < self._interval - JITTER:
                return False
        self._last = frame.t_frame
        return True
