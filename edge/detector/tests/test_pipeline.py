"""UC-5・UC-6・UC-8・S-1〜S-4: パイプラインと走行ログ。"""

import contextlib
import json
import math
import re
from dataclasses import replace
from pathlib import Path

import pytest

from detector.config import Config
from detector.frame import Frame
from detector.inference import DeerDetector, Detection, ScriptedDetector
from detector.pipeline import process_frames
from detector.ports import SourceError
from detector.sources import ArrayFrameSource

from .conftest import T0, FakeCapture, events, frames_at_fps, image, named

DEER = Detection("deer", 0.9, (0.5, 0.5, 0.1, 0.2))


class ListSource:
    """最小の自作 FrameSource。最後に error があれば投げる。"""

    def __init__(self, frames: list[Frame], error: Exception | None = None) -> None:
        self.frames = list(frames)
        self.error = error

    def read(self) -> Frame | None:
        if self.frames:
            return self.frames.pop(0)
        if self.error:
            raise self.error
        return None


class StepClock:
    """推論の前後で呼ばれる単調時計。1 回の推論ごとに durations の値だけ進む。"""

    def __init__(self, durations: list[float]) -> None:
        self.durations = list(durations)
        self.now = 0.0
        self.toggle = False

    def __call__(self) -> float:
        if not self.toggle:
            self.toggle = True
            return self.now
        self.toggle = False
        self.now += self.durations.pop(0) if self.durations else 0.0
        return self.now


class Boom(Exception):
    pass


class FlakyDetector:
    def __init__(self, fail_on: set[int]) -> None:
        self.calls = 0
        self.fail_on = fail_on

    def detect(self, _image: object) -> list[Detection]:
        self.calls += 1
        if self.calls in self.fail_on:
            raise Boom(f"pixels {image(2, 2)!r}")
        return []


def run(frames, detector, clock=None, config=None):
    kwargs = {} if clock is None else {"clock": clock}
    return list(process_frames(ListSource(frames), config or Config(), detector, **kwargs))


# UC-5a
def test_uc5a_推論に渡るのは間引き後の640x480だけ():
    det = ScriptedDetector([])
    out = run(frames_at_fps(60, 60, width=100, height=80), det)
    assert len(out) == 10 and len(det.seen_shapes) == 10
    assert set(det.seen_shapes) == {(480, 640, 3)}


# UC-5b
def test_uc5b_infer_msは単調時計の差_100ms超で警告(logbuf):
    clock = StepClock([0.030, 0.060, 0.120])
    out = run(frames_at_fps(10, 3), ScriptedDetector([]), clock)
    assert [round(r.infer_ms) for r in out] == [30, 60, 120]
    warns = named(logbuf, "infer.over_budget")
    assert len(warns) == 1 and warns[0]["seq"] == 2 and "t_frame" in warns[0]
    assert len(out) == 3


# UC-5h
def test_uc5h_budgetは設定の値(logbuf):
    base = Config()
    cfg = replace(base, infer=replace(base.infer, budget_ms=50))
    run(frames_at_fps(10, 2), ScriptedDetector([]), StepClock([0.040, 0.060]), cfg)
    assert len(named(logbuf, "infer.over_budget")) == 1


# UC-5c
def test_uc5c_推論が壊れたらfailed_次は処理_連続数が戻る(logbuf):
    det = FlakyDetector({1, 2})
    out = run(frames_at_fps(10, 4), det)
    assert [r.failed for r in out] == [True, True, False, False]
    assert all(r.detections == [] for r in out)
    fails = named(logbuf, "infer.failed")
    assert [f["consecutive"] for f in fails] == [1, 2]
    assert "t_frame" in fails[0] and fails[0]["error_type"] == "Boom"
    assert "pixels" not in json.dumps(events(logbuf))  # UC-6e: 例外の本文を出さない
    assert named(logbuf, "pipeline.summary")[0]["failed"] == 2


# UC-5g
def test_uc5g_連続30回でdegradedは1回_成功でrecovered(logbuf):
    det = FlakyDetector(set(range(1, 36)))
    run(frames_at_fps(10, 37), det)
    assert len(named(logbuf, "infer.degraded")) == 1
    assert named(logbuf, "infer.degraded")[0]["level"] == "critical"
    assert len(named(logbuf, "infer.recovered")) == 1


# UC-5d
def test_uc5d_尽きたらsummary(logbuf):
    run(frames_at_fps(60, 60), ScriptedDetector([]))
    s = named(logbuf, "pipeline.summary")
    assert len(s) == 1
    assert (s[0]["read"], s[0]["passed"], s[0]["dropped"], s[0]["failed"]) == (60, 10, 50, 0)
    assert s[0]["ended"] == "eof"


# UC-5e
def test_uc5e_SourceErrorはaborted_summary_例外は上へ(logbuf):
    src = ListSource(frames_at_fps(10, 2), SourceError("camera lost"))
    gen = process_frames(src, Config(), ScriptedDetector([]))
    got = [next(gen), next(gen)]
    with pytest.raises(SourceError):
        next(gen)
    assert len(got) == 2
    assert named(logbuf, "pipeline.aborted")[0]["level"] == "critical"
    assert named(logbuf, "pipeline.summary")[0]["ended"] == "error"


# UC-5f
def test_uc5f_途中でcloseしてもsummaryが1回(logbuf):
    gen = process_frames(ListSource(frames_at_fps(10, 5)), Config(), ScriptedDetector([]))
    next(gen)
    gen.close()
    s = named(logbuf, "pipeline.summary")
    assert len(s) == 1 and s[0]["ended"] == "closed"


# UC-5h
def test_uc5h_単調時計なので壁時計が戻っても負にならない(logbuf):
    # 壁時計（t_frame）が戻っても infer_ms は単調時計の差
    f = frames_at_fps(10, 2)
    f[1] = Frame(f[1].image, T0.replace(year=2020), 1)
    out = run(f, ScriptedDetector([]), StepClock([0.01, 0.01]))
    assert all(r.infer_ms >= 0 for r in out)


# UC-6a
def test_uc6a_frame_processedの項目(logbuf):
    run(
        frames_at_fps(10, 1),
        ScriptedDetector([[DEER, Detection("deer", 0.6, (0.1, 0.1, 0.1, 0.1))]]),
        StepClock([0.042]),
    )
    e = named(logbuf, "frame.processed")[0]
    assert e["seq"] == 0
    assert re.fullmatch(r"2027-02-15T16:31:08\.000\+09:00", e["t_frame"])
    assert e["infer_ms"] == pytest.approx(42, abs=0.5)
    assert (e["deer_count"], e["max_conf"]) == (2, 0.9)


# UC-6b
def test_uc6b_鹿なしはcount0_conf_null(logbuf):
    run(frames_at_fps(10, 1), ScriptedDetector([[]]))  # S-4
    e = named(logbuf, "frame.processed")[0]
    assert e["deer_count"] == 0 and e["max_conf"] is None


# UC-6c
def test_uc6c_捨てたフレームの個別ログは無い(logbuf):
    run(frames_at_fps(60, 60), ScriptedDetector([]))
    assert len(named(logbuf, "frame.processed")) == 10
    assert not [e for e in events(logbuf) if e["event"].startswith("frame.drop")]


# UC-6d
def test_uc6d_ログに画像や位置の項目が無い(logbuf):
    run(frames_at_fps(60, 30), FlakyDetector({2}))
    banned = {"image", "pixels", "lat", "lng", "deviceId", "email"}
    for e in events(logbuf):
        assert not banned & set(e)
    text = logbuf.getvalue()
    assert "array(" not in text and "lat" not in text.replace("latency", "")


# UC-8a
def test_uc8a_パイプラインは具体クラスをimportしない():
    src = (Path(__file__).parents[1] / "src/detector/pipeline.py").read_text(encoding="utf-8")
    assert "detector.sources" not in src and "detector.inference" not in src
    assert not re.search(r"from \.(sources|inference)", src)


# UC-8b
def test_uc8b_自作クラスでも回る():
    out = run(frames_at_fps(10, 2), FlakyDetector(set()))
    assert len(out) == 2


# S-1
def test_s1_入力が尽きたら終わる():
    assert run([], ScriptedDetector([])) == []


# AC-2
def test_ac2_3種の入力が同じパイプラインで回る(fake_cv2):
    from detector.sources import CameraSource, open_video_file

    cfg = Config()
    arrays = ArrayFrameSource([image(64, 48)] * 3, start=T0, fps=10)
    video = open_video_file("a.mp4", start=T0)
    cam = CameraSource(FakeCapture(3), clock=lambda: T0)
    for source in (arrays, video, cam):
        out = []
        with contextlib.suppress(SourceError):  # カメラは尽きず、外れたとき SourceError
            for r in process_frames(source, cfg, DeerDetector(ScriptedDetector([[DEER]] * 3))):
                out.append(r)
        assert len(out) >= 1 and all(r.t_frame.utcoffset().total_seconds() == 32400 for r in out)


# UC-5i
def test_uc5i_SourceError以外の例外でもabortedとsummary(logbuf):
    src = ListSource(frames_at_fps(10, 1), ValueError("bad frame"))
    gen = process_frames(src, Config(), ScriptedDetector([]))
    next(gen)
    with pytest.raises(ValueError, match="bad frame"):
        next(gen)
    assert named(logbuf, "pipeline.aborted")[0]["error_type"] == "ValueError"
    assert named(logbuf, "pipeline.summary")[0]["ended"] == "error"


# UC-5j
def test_uc5j_全部不正で捨てた鹿なしは区別され_続くとdegraded(logbuf):
    bad = Detection("deer", math.nan, (0.5, 0.5, 0.1, 0.1))
    det = DeerDetector(ScriptedDetector([[bad]] * 30 + [[]]))
    out = run(frames_at_fps(10, 31), det)
    assert out[0].invalid_count == 1 and out[0].detections == []
    assert out[30].invalid_count == 0
    assert named(logbuf, "frame.processed")[0]["invalid_count"] == 1
    assert len(named(logbuf, "infer.degraded")) == 1
    assert len(named(logbuf, "infer.recovered")) == 1
