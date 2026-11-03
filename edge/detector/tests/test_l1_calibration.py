"""CAL-1: calibration.json の読み込みと温度の当て方（edge-l1 R4）。"""

import json
import math

import pytest

from detector.l1.calibration import Calibration, load_calibration

from .conftest import named
from .l1_fakes import MODEL, answer

IDS = ("alert_level", "on_roadway", "static_shoulder", "false_positive")


def write(tmp_path, data) -> object:
    p = tmp_path / "calibration.json"
    p.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
    return p


def good(**temps) -> dict:
    t = dict.fromkeys(IDS, 1.0)
    t.update(temps)
    return {"version": 1, "model": MODEL, "temperatures": t}


# CAL-1a
def test_cal1a_正しいcalibration_jsonを読める(tmp_path, logbuf):
    cal = load_calibration(write(tmp_path, good(false_positive=2)))
    assert cal == Calibration(MODEL, {**dict.fromkeys(IDS, 1.0), "false_positive": 2.0})
    assert named(logbuf, "l1.calibration_loaded")[0]["model"] == MODEL


# CAL-1b
@pytest.mark.parametrize(
    ("data", "reason"),
    [
        (None, "missing"),
        ("{not json", "invalid"),
        ({**good(), "version": 2}, "invalid"),
        ({**good(), "temperatures": {"alert_level": 1.0}}, "invalid"),
        (good(on_roadway=0.0), "invalid"),
        (good(on_roadway=21), "invalid"),
        (good(on_roadway=True), "invalid"),
        (good(on_roadway="1"), "invalid"),
        ('{"version": 1, "model": "m", "temperatures": {"alert_level": NaN}}', "invalid"),
        ([1, 2], "invalid"),
        ({**good(), "model": ""}, "invalid"),
        (
            json.dumps(good()).replace('"alert_level": 1.0', '"alert_level": 1' + "0" * 400),
            "invalid",
        ),
        ("[" * 100_000 + "]" * 100_000, "invalid"),
    ],
)
def test_cal1b_無い壊れている範囲外は校正なし(tmp_path, logbuf, data, reason):
    path = tmp_path / "calibration.json" if data is None else write(tmp_path, data)
    assert load_calibration(path) is None
    assert named(logbuf, "l1.calibration_unavailable")[0]["reason"] == reason


def test_cal1b_読めないファイルはunreadable(tmp_path, logbuf):
    assert load_calibration(tmp_path) is None  # ディレクトリ
    assert named(logbuf, "l1.calibration_unavailable")[0]["reason"] == "unreadable"


# CAL-1c
def test_cal1c_温度1では変わらず温度2では0_5に寄る():
    one = Calibration(MODEL, dict.fromkeys(IDS, 1.0))
    two = Calibration(MODEL, dict.fromkeys(IDS, 2.0))
    a = answer(levels={"none": 0.1, "zone": 0.2, "danger": 0.7}, false_positive=0.95)
    same = one.apply(a)
    assert same.false_positive == pytest.approx(0.95)
    assert same.alert_level["danger"] == pytest.approx(0.7)
    soft = two.apply(a)
    assert 0.5 < soft.false_positive < 0.95
    assert soft.alert_level["danger"] < 0.7
    assert sum(soft.alert_level.values()) == pytest.approx(1.0)
    edge = one.apply(answer(levels={"none": 0.0, "zone": 0.0, "danger": 1.0}, false_positive=1.0))
    assert all(math.isfinite(v) and 0.0 <= v <= 1.0 for v in edge.alert_level.values())
    assert edge.false_positive < 1.0 and one.noul("on_roadway", 0.0) > 0.0


# CAL-1d・CAL-1e
def test_cal1d_答えたモデルが違う別名空なら校正なし():
    cal = Calibration(MODEL, dict.fromkeys(IDS, 1.0))
    assert cal.matches(MODEL)
    assert not cal.matches("nli-deberta-large")
    assert not cal.matches("jev-latest")
    assert not cal.matches("")


def test_cal1e_calibration_jsonのmodelが別名なら形が違う(tmp_path, logbuf):
    assert load_calibration(write(tmp_path, {**good(), "model": "jev-latest"})) is None
    assert named(logbuf, "l1.calibration_unavailable")[0]["reason"] == "invalid"
