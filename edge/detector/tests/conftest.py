"""edge-camera のテスト共通部品。実機・動画・CoreML は使わず、偽物で差し替える。"""

from __future__ import annotations

import io
import json
import sys
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import numpy as np
import pytest

from detector.frame import Frame
from detector.log import configure_logging

T0 = datetime(2027, 2, 15, 7, 31, 8, 0, tzinfo=UTC)


def image(width: int = 64, height: int = 48, value: int = 0) -> np.ndarray:
    return np.full((height, width, 3), value, dtype=np.uint8)


def frame_at(ms: float, seq: int = 0, **kw: int) -> Frame:
    return Frame(image(**kw), T0 + timedelta(milliseconds=ms), seq)


def frames_at_fps(fps: float, count: int, **kw: int) -> list[Frame]:
    return [frame_at(i * 1000.0 / fps, i, **kw) for i in range(count)]


@pytest.fixture
def logbuf() -> io.StringIO:
    buf = io.StringIO()
    configure_logging("DEBUG", stream=buf)
    return buf


def events(buf: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in buf.getvalue().splitlines()]


def named(buf: io.StringIO, event: str) -> list[dict]:
    return [e for e in events(buf) if e["event"] == event]


class FakeCapture:
    """cv2.VideoCapture の代わり。read は (ok, image)、尽きたら (False, None)。"""

    def __init__(self, count: int = 3, fps: float = 30.0, opened: bool = True) -> None:
        self.remaining = count
        self.fps = fps
        self.opened = opened
        self.props: dict[int, float] = {}
        self.released = False

    def isOpened(self) -> bool:
        return self.opened

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self.remaining <= 0:
            return False, None
        self.remaining -= 1
        return True, image(32, 24, value=self.remaining)

    def get(self, prop: int) -> float:
        return self.fps if prop == 5 else 0.0

    def set(self, prop: int, value: float) -> bool:
        self.props[prop] = value
        return True

    def release(self) -> None:
        self.released = True


@pytest.fixture
def fake_cv2(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    made: list[FakeCapture] = []
    state = SimpleNamespace(count=3, fps=30.0, opened=True, opened_with=[], captures=made)

    def video_capture(target: object) -> FakeCapture:
        state.opened_with.append(target)
        cap = FakeCapture(state.count, state.fps, state.opened)
        made.append(cap)
        return cap

    module = SimpleNamespace(
        VideoCapture=video_capture,
        CAP_PROP_FPS=5,
        CAP_PROP_FRAME_WIDTH=3,
        CAP_PROP_FRAME_HEIGHT=4,
    )
    monkeypatch.setitem(sys.modules, "cv2", module)
    state.module = module
    return state
