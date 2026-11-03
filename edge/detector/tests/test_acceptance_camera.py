"""AC-1: 60 fps・1 秒の動画（偽 cv2）を 10 fps で回し、鹿の区間を拾い、t_frame を残す。"""

import re
from datetime import timedelta

from detector.config import Config
from detector.inference import DeerDetector, Detection, ScriptedDetector
from detector.pipeline import process_frames
from detector.sources import open_video_file

from .conftest import T0, named


def test_ac1_動画から10個の結果とt_frameつきログ(fake_cv2, logbuf):
    fake_cv2.count, fake_cv2.fps = 60, 60.0
    deer = Detection("deer", 0.92, (0.4, 0.5, 0.1, 0.2))
    # 通ったフレーム 10 枚のうち 4〜7 枚目に鹿が写る
    script = [[]] * 3 + [[deer]] * 4 + [[]] * 3
    source = open_video_file("drive.mp4", start=T0)
    results = list(process_frames(source, Config(), DeerDetector(ScriptedDetector(script))))

    assert len(results) == 10
    stamps = [r.t_frame for r in results]
    assert stamps == sorted(stamps)
    assert stamps[1] - stamps[0] == timedelta(milliseconds=100)
    assert [len(r.detections) for r in results] == [0, 0, 0, 1, 1, 1, 1, 0, 0, 0]

    logs = named(logbuf, "frame.processed")
    assert len(logs) == 10
    assert all(
        re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+09:00", e["t_frame"]) for e in logs
    )
