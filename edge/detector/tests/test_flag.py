"""UC-3: フラグの組み立てと JSON Schema。"""

import json
import re
from datetime import timedelta
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from detector.flag import build_flag
from detector.judge import JudgeState

from .conftest import T0

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "packages/schema/json/alert-flag.schema.json").read_text("utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
ON = JudgeState(True, T0, 0.94, 58, "L")
OFF = JudgeState(False, T0)
SENT = T0 + timedelta(milliseconds=190)


# UC-3a
def test_uc3a_ONのフラグ():
    f = build_flag(ON, SENT)
    assert f["type"] == "flag" and f["v"] == 1 and f["deer"] is True
    assert (f["conf"], f["distanceM"], f["side"]) == (0.94, 58, "L")
    assert f["frameJpegB64"] is None and f["zone"] == "outside"
    assert "zoneDistanceKm" not in f and "zoneRemainingKm" not in f


# UC-3b
def test_uc3b_OFFのフラグに鹿の項目が無い():
    f = build_flag(OFF, SENT)
    assert f["deer"] is False
    assert not {"conf", "distanceM", "side"} & set(f)


# UC-3c
@pytest.mark.parametrize("state", [ON, OFF, JudgeState(True, T0, 1.0, 4, "R")])
def test_uc3c_JSON_Schemaを通る(state):
    assert VALIDATOR.is_valid(json.loads(json.dumps(build_flag(state, SENT))))


# UC-3d
def test_uc3d_時刻はJSTのミリ秒():
    f = build_flag(ON, SENT)
    pat = r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+09:00"
    assert re.fullmatch(pat, f["t_frame"]) and re.fullmatch(pat, f["t_sent"])
    assert f["t_frame"] == "2027-02-15T16:31:08.000+09:00"
