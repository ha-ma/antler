"""入力と推論の差し込み口（B1-3: カメラ・推論・通信をアダプタで分離）。

パイプラインはここの Protocol と例外だけを知る。具体クラス（sources / inference）は知らない。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import numpy as np

    from detector.frame import Frame


class SourceError(Exception):
    """入力（カメラ・動画）が開けない、または読めなくなった。"""


class ConfigError(ValueError):
    """設定の値が不正。メッセージにキー名を入れる。"""


@dataclass(frozen=True)
class Detection:
    """1 つの検出。xywh は 0〜1 に正規化した（中心 x, 中心 y, 幅, 高さ）。YOLO の標準。"""

    label: str
    conf: float
    xywh: tuple[float, float, float, float]


class FrameSource(Protocol):
    def read(self) -> Frame | None:
        """次のフレーム。終わりなら None。読めなくなったら SourceError。"""
        ...


class Detector(Protocol):
    def detect(self, image: np.ndarray) -> list[Detection]: ...
