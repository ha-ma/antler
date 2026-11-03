"""UC-3: 間引き。"""

import pytest

from detector.config import ConfigError
from detector.throttle import FrameThrottle

from .conftest import frame_at, frames_at_fps, named


def passed(fps_in: float, target: float, count: int) -> list[int]:
    t = FrameThrottle(target)
    return [f.seq for f in frames_at_fps(fps_in, count) if t.accept(f)]


def test_uc3a_60fpsの60枚は10fpsで10枚_先頭は通る():
    got = passed(60, 10, 60)
    assert len(got) == 10 and got[0] == 0
    assert got == [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]


def test_uc3b_30to10は3枚に1枚_遅い入力は全部通る():
    assert passed(30, 10, 12) == [0, 3, 6, 9]
    assert passed(5, 10, 6) == [0, 1, 2, 3, 4, 5]


def test_uc3c_揺れ5ms以内は通し_90msは捨てる():
    t = FrameThrottle(10)
    assert t.accept(frame_at(0, 0))
    assert t.accept(frame_at(99.99, 1))
    assert not t.accept(frame_at(99.99 + 90, 2))


def test_uc3d_戻りは捨てて警告_その後は通常(logbuf):
    t = FrameThrottle(10)
    assert t.accept(frame_at(1000, 0))
    assert not t.accept(frame_at(900, 1))
    assert not t.accept(frame_at(1000, 2))
    assert t.accept(frame_at(1100, 3))
    events = named(logbuf, "frame.out_of_order")
    assert len(events) == 2 and events[0]["seq"] == 1 and "t_frame" in events[0]


def test_uc3f_1秒超の戻りは数え直す(logbuf):
    t = FrameThrottle(10)
    assert t.accept(frame_at(10_000, 0))
    assert t.accept(frame_at(10_100, 1))
    assert t.accept(frame_at(5_000, 2))  # 5 秒戻った
    assert named(logbuf, "clock.jump")
    assert not t.accept(frame_at(5_050, 3))
    assert t.accept(frame_at(5_100, 4))
    t2 = FrameThrottle(10)
    t2.accept(frame_at(2000, 0))
    assert not t2.accept(frame_at(1500, 1))  # 0.5 秒の戻りは捨てるだけ
    assert not named(logbuf, "clock.jump")[1:]


@pytest.mark.parametrize("bad", [4, 11, 0, -5, float("nan")])
def test_uc3e_範囲外はConfigError(bad):
    with pytest.raises(ConfigError, match="target_fps"):
        FrameThrottle(bad)


@pytest.mark.parametrize("ok", [5, 10])
def test_uc3e_端は通る(ok):
    FrameThrottle(ok)
