"""Q-1・REQ-1: 4 問の写しと、L1 に送る JudgeRequest（edge-l1 R1・R2）。"""

from pathlib import Path

import pytest

from detector.config import JudgeConfig, L1Config, TrackerConfig
from detector.fusion import Fusion, L1Target
from detector.l0.stage import L0Stage
from detector.l1.client import L1Unavailable
from detector.l1.questions import ALERT_LEVELS, QUESTION_IDS, wire_questions
from detector.l1.request import VehicleContext, build_request
from detector.schema import JUDGE_QUESTIONS, JudgeRequest

from .conftest import deer, result

L1_DIR = Path(__file__).resolve().parents[1] / "src" / "detector" / "l1"


# Q-1a
def test_q1a_JUDGE_QUESTIONSの順で写しinstructionsは質問文と同じ():
    wire = wire_questions()
    assert (
        tuple(wire)
        == QUESTION_IDS
        == (
            "alert_level",
            "on_roadway",
            "static_shoulder",
            "false_positive",
        )
    )
    for q in JUDGE_QUESTIONS:
        item = wire[q["id"]]
        assert item["type"] == q["type"] and item["instructions"] == q["text"]
    assert wire["alert_level"]["criteria"] == {"none": None, "zone": None, "danger": None}
    assert all("criteria" not in wire[q] for q in QUESTION_IDS[1:])
    assert ALERT_LEVELS == ("none", "zone", "danger")


# Q-1b
def test_q1b_l1のソースに質問文を書かない():
    texts = [str(q["text"]) for q in JUDGE_QUESTIONS]
    for path in L1_DIR.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        for text in texts:
            assert text not in source, f"{path.name} に質問文がある"


def rig():
    l0 = L0Stage(JudgeConfig(), TrackerConfig())
    fu = Fusion(L1Config(), l0, 0.8)
    return l0, fu


def feed(l0, fu, *frames):
    now = 100.0
    for i, dets in enumerate(frames):
        now += 0.1
        l0.update(result(100.0 * i, *dets), now)
        fu.after_l0(now)


# REQ-1a
def test_req1a_主トラックからJudgeRequestに通る問い合わせを作る():
    l0, fu = rig()
    feed(l0, fu, *[[deer(0.6, h=0.1 + 0.02 * i)] for i in range(4)])
    target = fu.target()
    req = build_request(target, 2, "jev-latest")
    assert isinstance(req, JudgeRequest)
    s = req.state
    assert (s.speedKmh, s.zone, s.light, s.headlight) == (60.0, "inside", "night", "low")
    assert s.recentAlerts30s == 2 and len(s.track) == 4 and s.track[-1].t == 0.0
    assert s.ttcSec is not None and s.ttcSec.root > 0
    assert req.model == "jev-latest"
    assert [q.id for q in req.questions] == list(QUESTION_IDS)


# REQ-1b
def test_req1b_主トラックが無ければ作らない():
    l0, fu = rig()
    assert fu.target() is None
    feed(l0, fu, [])
    assert fu.target() is None


# REQ-1c
def test_req1c_TTCが無ければttcSecはnull():
    l0, fu = rig()
    feed(l0, fu, [deer(0.6)])
    req = build_request(fu.target(), 0, "jev-latest")
    assert req.state.ttcSec is None
    assert '"ttcSec":null' in req.model_dump_json()


# REQ-1d
def test_req1d_JudgeRequestに通らなければinvalid_request():
    target = L1Target(None, 1, [{"t": 0.0, "conf": 0.9}], None)
    with pytest.raises(L1Unavailable) as err:
        build_request(target, 0, "jev-latest")
    assert err.value.reason == "invalid_request"
    good = L1Target(
        None,
        1,
        [{"t": 0.0, "conf": 0.9, "distanceM": 10.0, "lateralMps": 0.0, "side": "L", "pos": "lane"}],
        None,
    )
    with pytest.raises(L1Unavailable):
        build_request(good, 0, "jev latest")
    assert build_request(good, 0, "x", VehicleContext(speed_kmh=80.0)).state.speedKmh == 80.0


# REQ-1e
def test_req1e_赤のあいだは高い看板でなく赤の候補の鹿について聞く():
    l0, fu = rig()
    sign = deer(0.45, x=0.7, h=0.3)
    real = deer(0.85, x=0.4, h=0.1)
    feed(l0, fu, [sign, real], [sign, real])
    assert l0.state.deer
    target = fu.target()
    req = build_request(target, 1, "jev-latest")
    assert req.state.track[-1].conf == 0.85
    assert target.episode == fu.episode == 1
