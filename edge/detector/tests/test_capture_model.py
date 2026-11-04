"""capture.model（docs/specs/edge-capture UC-1・UC-4 の値の検査）: Capture の組み立て。"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from detector.capture.model import (
    BOX_LIMIT,
    build_capture,
    new_capture_id,
    sanitize_segment,
    valid_l1_probs,
)
from detector.config import JudgeConfig
from detector.ports import Detection

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads(
    (ROOT / "packages" / "schema" / "json" / "capture.schema.json").read_text(encoding="utf-8")
)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
JST = timezone(timedelta(hours=9))
TABLE = JudgeConfig().distance_table
SCHEMA_KEYS = set(SCHEMA["properties"])

L1_PROBS = {
    "alert_level": {"none": 0.1, "zone": 0.2, "danger": 0.7},
    "on_roadway": 0.6,
    "static_shoulder": 0.1,
    "false_positive": 0.05,
}


def _build(
    detections: list[Detection] | None = None,
    when: str = "2027-02-15T16:31:08.120+09:00",
    **kw: object,
) -> dict:
    dets = detections if detections is not None else [Detection("deer", 0.9, (0.3, 0.5, 0.1, 0.2))]
    args: dict = {
        "capture_id": "cap_0123456789ab",
        "detections": dets,
        "t_frame": datetime.fromisoformat(when).astimezone(JST),
        "image_size": (320, 240),
        "distance_table": TABLE,
        "min_box_conf": 0.4,
    }
    args.update(kw)
    return build_capture(**args)


def test_CAP_1a_JSON_Schemaに通る() -> None:
    capture = _build()
    assert list(VALIDATOR.iter_errors(capture)) == []
    with_probs = _build(l1_probs=L1_PROBS)
    assert list(VALIDATOR.iter_errors(with_probs)) == []
    assert with_probs["l1Probs"] == L1_PROBS
    assert "l1Probs" not in capture


def test_CAP_1b_xywhは中心基準から左上基準になり0から1に収まる() -> None:
    box = _build([Detection("deer", 0.9, (0.3, 0.5, 0.1, 0.2))])["boxes"][0]
    assert box["xywh"] == pytest.approx([0.25, 0.4, 0.1, 0.2])
    assert box["label"] == "deer"
    assert box["by"] == "model"
    # 端にはみ出す検出は画像の中に切る
    edge = _build([Detection("deer", 0.9, (0.98, 0.02, 0.2, 0.2))])["boxes"][0]["xywh"]
    assert all(0.0 <= v <= 1.0 for v in edge)
    assert edge[0] + edge[2] == pytest.approx(1.0)
    assert edge[1] == pytest.approx(0.0)
    assert edge[3] == pytest.approx(0.12)


def test_CAP_1c_距離と方向は最も大きい検出から_boxesは8件まで() -> None:
    small = Detection("deer", 0.95, (0.8, 0.5, 0.04, 0.05))
    big = Detection("deer", 0.6, (0.2, 0.5, 0.1, 0.2))
    capture = _build([small, big])
    assert capture["side"] == "L"
    assert capture["distanceM"] == 8
    many = [Detection("deer", 0.9, (0.5, 0.5, 0.02 + i / 1000, 0.05)) for i in range(12)]
    assert len(_build(many)["boxes"]) == BOX_LIMIT == 8
    # 閾値未満・壊れた検出は boxes に入れない
    low = Detection("deer", 0.39, (0.5, 0.5, 0.1, 0.1))
    nan = Detection("deer", 0.9, (0.5, 0.5, float("nan"), 0.1))
    zero = Detection("deer", 0.9, (0.5, 0.5, 0.0, 0.1))
    only_good = _build([low, nan, zero, big])
    assert len(only_good["boxes"]) == 1


def test_CAP_1d_知れない欄の既定値() -> None:
    capture = _build()
    conditions = capture["conditions"]
    for key in ("weather", "surface", "traffic", "vehicle"):
        assert conditions[key] == "unknown"
    assert conditions["fog"] == "none"
    assert capture["pose"] == "unknown"
    assert capture["outcome"] == "avoided"
    assert capture["reactionMs"] is None
    assert capture["consent"] is False
    assert capture["source"] == "vehicle"
    assert capture["imageSize"] == [320, 240]
    assert capture["image"] == "captures/cap_0123456789ab.jpg"


@pytest.mark.parametrize(
    "segment",
    ["43.1,144.3", "", "R241 akan", "../x", "a" * 65, "-x", "x-", "x--y", None, 12],
)
def test_CAP_1e_roadSegmentが形違いならunknown(segment: object) -> None:
    assert _build(segment=segment)["roadSegment"] == "unknown"
    assert sanitize_segment(segment) == "unknown"


def test_CAP_1e_roadSegmentは提供元の値() -> None:
    assert _build(segment="R241-akan-32")["roadSegment"] == "R241-akan-32"
    assert sanitize_segment("deer-zone-07") == "deer-zone-07"


def test_CAP_1f_キーはCaptureSchemaの欄だけで個人情報を持たない() -> None:
    capture = _build(l1_probs=L1_PROBS)
    assert set(capture) <= SCHEMA_KEYS
    banned = re.compile(r"mail|name|phone|device|udid|imei|^lat|^lon|latitude|longitude", re.I)
    assert [k for k in capture if banned.search(k)] == []
    assert set(capture["conditions"]) == set(SCHEMA["properties"]["conditions"]["properties"])


def test_CAP_1g_idはcap_と16進12桁で乱数の差し込みで決定的() -> None:
    assert new_capture_id(lambda n: bytes(range(n))) == "cap_000102030405"
    assert re.fullmatch(r"cap_[0-9a-f]{12}", new_capture_id())
    assert new_capture_id() != new_capture_id()


@pytest.mark.parametrize(
    ("iso", "month", "season"),
    [
        ("2027-12-01T10:00:00+09:00", 12, "winter"),
        ("2027-02-15T10:00:00+09:00", 2, "winter"),
        ("2027-03-01T10:00:00+09:00", 3, "spring"),
        ("2027-06-30T10:00:00+09:00", 6, "summer"),
        ("2027-09-01T10:00:00+09:00", 9, "autumn"),
        # UTC では前日でも JST の月で決める
        ("2027-02-28T16:00:00+00:00", 3, "spring"),
    ],
)
def test_CAP_1h_createdAtはJSTのt_frameで月と季節はそこから(
    iso: str, month: int, season: str
) -> None:
    capture = _build(when=iso)
    assert capture["conditions"]["month"] == month
    assert capture["conditions"]["season"] == season
    assert capture["createdAt"].endswith("+09:00")
    assert capture["createdAt"] == datetime.fromisoformat(iso).astimezone(JST).isoformat(
        timespec="milliseconds"
    )


def test_CAP_1h_lightは太陽の高さ() -> None:
    assert _build(when="2027-02-15T16:30:00+09:00")["conditions"]["light"] == "dusk"
    assert _build(when="2027-02-15T12:00:00+09:00")["conditions"]["light"] == "day"


def test_L1P_1c_外れた確率は付けない() -> None:
    assert valid_l1_probs(L1_PROBS) == L1_PROBS
    bad_cases = [
        {**L1_PROBS, "on_roadway": float("nan")},
        {**L1_PROBS, "on_roadway": 1.2},
        {**L1_PROBS, "false_positive": -0.1},
        {**L1_PROBS, "static_shoulder": float("inf")},
        {**L1_PROBS, "alert_level": {"none": 0.1, "zone": 0.2}},
        {**L1_PROBS, "alert_level": {"none": 0.1, "zone": 0.2, "danger": "0.7"}},
        {"alert_level": L1_PROBS["alert_level"], "on_roadway": 0.1},
        {**L1_PROBS, "extra": 0.1},
        {**L1_PROBS, "on_roadway": True},
        None,
        "x",
    ]
    for bad in bad_cases:
        assert valid_l1_probs(bad) is None, bad
    # 外れた確率を渡しても Capture には欄ごと付かない
    assert "l1Probs" not in _build(l1_probs={**L1_PROBS, "on_roadway": 2.0})


def test_L1P_1d_付ける値は渡された生の確率そのもの() -> None:
    probs = {**L1_PROBS, "on_roadway": 0.123456789}
    assert _build(l1_probs=probs)["l1Probs"]["on_roadway"] == 0.123456789
