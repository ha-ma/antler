"""Frame（画像と撮影時刻）と 640×480 への変換（B2-1）。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

JST = timezone(timedelta(hours=9))
TARGET_WIDTH = 640
TARGET_HEIGHT = 480


@dataclass(frozen=True)
class Frame:
    """image は (高さ, 幅, 3) の uint8（BGR）。t_frame は tz 付きで、JST に正規化する。"""

    image: np.ndarray
    t_frame: datetime
    seq: int

    def __post_init__(self) -> None:
        img = self.image
        if img.ndim != 3 or img.shape[2] != 3 or img.dtype != np.uint8 or 0 in img.shape:
            msg = f"image は (高さ, 幅, 3) の uint8 で空でない: {img.shape} {img.dtype}"
            raise ValueError(msg)
        if self.t_frame.tzinfo is None:
            msg = "t_frame はタイムゾーン付きにする"
            raise ValueError(msg)
        object.__setattr__(self, "t_frame", self.t_frame.astimezone(JST))


def format_t_frame(t_frame: datetime) -> str:
    """ログ用: 2027-02-15T16:31:08.120+09:00（ミリ秒まで、JST）。"""
    return t_frame.astimezone(JST).isoformat(timespec="milliseconds")


def resize_frame(frame: Frame, width: int = TARGET_WIDTH, height: int = TARGET_HEIGHT) -> Frame:
    """最近傍で引き伸ばす（余白は足さない）。元の Frame は変えない。"""
    h, w = frame.image.shape[:2]
    rows = np.arange(height) * h // height
    cols = np.arange(width) * w // width
    return Frame(frame.image[rows[:, None], cols[None, :]], frame.t_frame, frame.seq)
