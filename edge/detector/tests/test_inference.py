"""UC-4: 鹿の一次推論。"""

import math

from detector.inference import DeerDetector, Detection, ScriptedDetector

from .conftest import image, named


def d(label="deer", conf=0.9, xywh=(0.5, 0.5, 0.1, 0.2)) -> Detection:
    return Detection(label, conf, xywh)


def test_uc4a_deer以外は捨て_確信度順():
    inner = ScriptedDetector([[d("cow", 0.99), d(conf=0.6), d("person"), d(conf=0.95)]])
    out = DeerDetector(inner).detect(image())
    assert [x.conf for x in out] == [0.95, 0.6]


def test_uc4b_不正な検出だけ捨てて警告(logbuf):
    bad = [
        d(conf=1.2),
        d(conf=-0.1),
        d(conf=math.nan),
        d(xywh=(1.5, 0.5, 0.1, 0.1)),
        d(xywh=(0.5, 0.5, -0.1, 0.1)),
    ]
    out = DeerDetector(ScriptedDetector([[*bad, d(conf=0.7)]])).detect(image())
    assert [x.conf for x in out] == [0.7]
    assert len(named(logbuf, "detection.invalid")) == 5


def test_uc4c_鹿なしは空():
    assert DeerDetector(ScriptedDetector([[d("cow")]])).detect(image()) == []


def test_uc4d_Scriptedは順に返し尽きたら空_形を記録する():
    s = ScriptedDetector([[d()], [d(conf=0.5)]])
    assert s.detect(image(10, 20))[0].conf == 0.9
    assert s.detect(image())[0].conf == 0.5
    assert s.detect(image()) == []
    assert s.seen_shapes[0] == (20, 10, 3)
    assert len(s.seen_shapes) == 3
