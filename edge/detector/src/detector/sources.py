"""フレームの入力（B1-2・B1-3）: 画像配列・動画・カメラ。OpenCV は使うときだけ import。"""

from __future__ import annotations

import importlib
import logging
import math
from datetime import UTC, datetime, timedelta
from pathlib import PurePath
from typing import TYPE_CHECKING, Protocol

from detector.frame import Frame
from detector.ports import FrameSource, SourceError

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    import numpy as np

logger = logging.getLogger("detector.source")

__all__ = [
    "ArrayFrameSource",
    "CameraSource",
    "FrameSource",
    "SourceError",
    "VideoFileSource",
    "open_camera",
    "open_video_file",
]


def _now() -> datetime:
    return datetime.now(UTC)


class Capture(Protocol):
    """cv2.VideoCapture が満たす部分。"""

    def read(self) -> tuple[bool, np.ndarray | None]: ...
    def release(self) -> None: ...


class ArrayFrameSource:
    """画像配列から作る入力。テスト用の画像や、書き出した静止画の列に使う。"""

    def __init__(
        self, images: Sequence[np.ndarray], start: datetime | None = None, fps: float = 60.0
    ) -> None:
        self._images = list(images)
        self._start = start or _now()
        self._fps = fps
        self._index = 0

    def read(self) -> Frame | None:
        if self._index >= len(self._images):
            return None
        seq = self._index
        self._index += 1
        t_frame = self._start + timedelta(seconds=seq / self._fps)
        return Frame(self._images[seq], t_frame, seq)


class VideoFileSource:
    """動画ファイル。t_frame = 開始時刻 + 通し番号 / fps（実時間に依らず、再生しても同じ値）。"""

    def __init__(self, capture: Capture, fps: float, start: datetime | None = None) -> None:
        if not math.isfinite(fps) or fps <= 0:
            capture.release()
            msg = f"動画の fps が不正: {fps}"
            raise SourceError(msg)
        self._capture = capture
        self._fps = fps
        self._start = start or _now()
        self._seq = 0

    def read(self) -> Frame | None:
        ok, img = self._capture.read()
        if not ok or img is None:
            self._capture.release()
            return None
        seq = self._seq
        self._seq += 1
        return Frame(img, self._start + timedelta(seconds=seq / self._fps), seq)


class CameraSource:
    """カメラ。t_frame は read() から戻った瞬間の壁時計（ドライバの撮影時刻は Deferred）。"""

    def __init__(self, capture: Capture, clock: Callable[[], datetime] = _now) -> None:
        self._capture = capture
        self._clock = clock
        self._seq = 0

    def read(self) -> Frame:
        ok, img = self._capture.read()
        t_frame = self._clock()
        if not ok or img is None:
            logger.error("camera.lost", extra={"seq": self._seq})
            self._capture.release()
            msg = "camera: フレームを読めない"
            raise SourceError(msg)
        seq = self._seq
        self._seq += 1
        return Frame(img, t_frame, seq)


def _load_cv2() -> object:
    try:
        return importlib.import_module("cv2")
    except ImportError as exc:
        logger.error("camera.open_failed", extra={"reason": "opencv"})
        msg = "opencv が入っていない（pip install opencv-python）"
        raise SourceError(msg) from exc


def _open(cv2: object, target: str | int, label: str) -> Capture:
    capture = cv2.VideoCapture(target)  # type: ignore[attr-defined]
    if not capture.isOpened():
        logger.error("camera.open_failed", extra={"target": label})
        msg = f"開けない: {label}"
        raise SourceError(msg)
    return capture


def open_video_file(path: str, start: datetime | None = None) -> VideoFileSource:
    cv2 = _load_cv2()
    capture = _open(cv2, path, PurePath(path).name)  # パスの親ディレクトリはログに出さない
    fps = float(capture.get(cv2.CAP_PROP_FPS))  # type: ignore[attr-defined]
    return VideoFileSource(capture, fps, start)


def open_camera(
    device: int,
    width: int,
    height: int,
    fps: int,
    clock: Callable[[], datetime] = _now,
) -> CameraSource:
    cv2 = _load_cv2()
    capture = _open(cv2, device, f"device:{device}")
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)  # type: ignore[attr-defined]
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)  # type: ignore[attr-defined]
    capture.set(cv2.CAP_PROP_FPS, fps)  # type: ignore[attr-defined]
    return CameraSource(capture, clock)
