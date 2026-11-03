"""UC-1: 入力（配列・動画・カメラ）。"""

from datetime import timedelta

import pytest

from detector.sources import (
    ArrayFrameSource,
    CameraSource,
    SourceError,
    VideoFileSource,
    open_camera,
    open_video_file,
)

from .conftest import T0, FakeCapture, image, named


def test_uc1a_配列ソースはseq順に返し4回目はNone():
    src = ArrayFrameSource([image(), image(), image()], start=T0, fps=10)
    got = [src.read() for _ in range(4)]
    assert [f.seq for f in got[:3]] == [0, 1, 2]
    assert got[3] is None
    assert got[1].t_frame - got[0].t_frame == timedelta(milliseconds=100)


def test_uc1d_動画は開始時刻から33ms刻み_尽きたらNone():
    src = VideoFileSource(FakeCapture(5, 30.0), fps=30.0, start=T0)
    got = [src.read() for _ in range(6)]
    assert got[5] is None
    ms = [round((f.t_frame - T0).total_seconds() * 1000) for f in got[:5]]
    assert ms == [0, 33, 67, 100, 133]


def test_uc1h_fpsが不正ならSourceError_同じ開始時刻なら再現する():
    for bad in (0, -1, float("nan")):
        with pytest.raises(SourceError, match="fps"):
            VideoFileSource(FakeCapture(), fps=bad, start=T0)
    a = VideoFileSource(FakeCapture(3), fps=30.0, start=T0)
    b = VideoFileSource(FakeCapture(3), fps=30.0, start=T0)
    assert [a.read().t_frame for _ in range(3)] == [b.read().t_frame for _ in range(3)]


def test_uc1e_カメラのt_frameは注入した時計_失敗はSourceError(logbuf):
    ticks = iter([T0, T0 + timedelta(milliseconds=17), T0 + timedelta(milliseconds=34)])
    src = CameraSource(FakeCapture(2), clock=lambda: next(ticks))
    assert src.read().t_frame == T0
    assert src.read().seq == 1
    with pytest.raises(SourceError, match="camera"):
        src.read()
    assert named(logbuf, "camera.lost")


def test_uc1f_開けない(fake_cv2, logbuf, monkeypatch):
    fake_cv2.opened = False
    with pytest.raises(SourceError):
        open_video_file("/Users/someone/private/drive.mp4")
    event = named(logbuf, "camera.open_failed")[0]
    assert "someone" not in str(event) and "drive.mp4" in str(event)  # UC-6e
    with pytest.raises(SourceError):
        open_camera(0, 1280, 720, 60)
    monkeypatch.setitem(__import__("sys").modules, "cv2", None)
    with pytest.raises(SourceError, match="opencv"):
        open_video_file("x.mp4")


def test_uc1g_open_系は偽cv2を解像度とfps付きで使う(fake_cv2):
    cam = open_camera(2, 1280, 720, 60)
    assert fake_cv2.opened_with == [2]
    assert fake_cv2.captures[0].props == {3: 1280, 4: 720, 5: 60}
    assert cam.read().seq == 0
    video = open_video_file("a.mp4", start=T0)
    assert fake_cv2.opened_with[1] == "a.mp4"
    assert video.read().t_frame == T0
