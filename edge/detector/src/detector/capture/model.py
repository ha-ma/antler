"""Capture の組み立て（ch7、packages/schema の capture。docs/specs/edge-capture E1）。

キーは CaptureSchema の欄だけ。個人情報（氏名・メール・電話・端末識別子）と緯度経度の欄を持たない。
位置は roadSegment（道路区間 ID）に丸めた文字列だけを受け取る（座標を受け取る口を作らない）。
"""

from __future__ import annotations

import math
import re
import secrets
from typing import TYPE_CHECKING

from detector.capture.light import light_period
from detector.frame import JST, format_t_frame
from detector.judge import estimate_distance_m, side_of

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence
    from datetime import datetime

    from detector.ports import Detection

__all__ = [
    "BOX_LIMIT",
    "UNKNOWN_SEGMENT",
    "build_capture",
    "new_capture_id",
    "sanitize_segment",
    "valid_l1_probs",
]

BOX_LIMIT = 8
UNKNOWN_SEGMENT = "unknown"
ID_PREFIX = "cap_"
ID_BYTES = 6  # 16 進 12 桁（48 ビット）
_SEGMENT_RE = re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*")
_SEGMENT_MAX = 64
_ALERT_LEVELS = ("none", "zone", "danger")
_NOUL_KEYS = ("on_roadway", "static_shoulder", "false_positive")
_SEASON_BY_MONTH = {
    12: "winter",
    1: "winter",
    2: "winter",
    3: "spring",
    4: "spring",
    5: "spring",
    6: "summer",
    7: "summer",
    8: "summer",
    9: "autumn",
    10: "autumn",
    11: "autumn",
}


def new_capture_id(token_bytes: Callable[[int], bytes] = secrets.token_bytes) -> str:
    """`cap_` + 乱数 12 桁（16 進）。推測されにくい（CaptureSchema の id の形に合う）。"""
    return ID_PREFIX + token_bytes(ID_BYTES).hex()


def sanitize_segment(value: object) -> str:
    """roadSegment の形（英数字とハイフン、64 字まで）に合わなければ unknown。座標を通さない。"""
    if (
        isinstance(value, str)
        and len(value) <= _SEGMENT_MAX
        and _SEGMENT_RE.fullmatch(value) is not None
    ):
        return value
    return UNKNOWN_SEGMENT


def _unit(value: object) -> bool:
    return (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0.0 <= value <= 1.0
    )


def valid_l1_probs(probs: object) -> dict[str, object] | None:
    """L1ProbsSchema の形（alert_level 3 値と noul 3 問、すべて有限の 0〜1）。外れたら None。"""
    if not isinstance(probs, dict) or set(probs) != {"alert_level", *_NOUL_KEYS}:
        return None
    levels = probs["alert_level"]
    if not isinstance(levels, dict) or set(levels) != set(_ALERT_LEVELS):
        return None
    if not all(_unit(levels[k]) for k in _ALERT_LEVELS) or not all(
        _unit(probs[k]) for k in _NOUL_KEYS
    ):
        return None
    return {
        "alert_level": {k: levels[k] for k in _ALERT_LEVELS},
        **{k: probs[k] for k in _NOUL_KEYS},
    }


def _box(d: Detection) -> list[float] | None:
    """中心基準 (cx, cy, w, h) を画像の中に切った左上基準 (x, y, w, h) に。壊れていれば None。"""
    cx, cy, w, h = d.xywh
    if not all(math.isfinite(v) for v in (cx, cy, w, h)) or w <= 0.0 or h <= 0.0:
        return None
    x0, y0 = max(0.0, cx - w / 2.0), max(0.0, cy - h / 2.0)
    x1, y1 = min(1.0, cx + w / 2.0), min(1.0, cy + h / 2.0)
    if x1 <= x0 or y1 <= y0:
        return None
    return [round(x0, 4), round(y0, 4), round(x1 - x0, 4), round(y1 - y0, 4)]


def build_capture(
    *,
    capture_id: str,
    detections: Sequence[Detection],
    t_frame: datetime,
    image_size: tuple[int, int],
    distance_table: tuple[tuple[float, float], ...],
    min_box_conf: float,
    segment: object = UNKNOWN_SEGMENT,
    l1_probs: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """検出つきのフレームから Capture（consent は false。同意は走行後に PWA が決める）を作る。"""
    boxes: list[dict[str, object]] = []
    best_height, best_center_x = -1.0, 0.5
    for d in detections:
        if d.label != "deer" or not math.isfinite(d.conf) or d.conf < min_box_conf:
            continue
        xywh = _box(d)
        if xywh is None or len(boxes) >= BOX_LIMIT:
            continue
        boxes.append({"label": "deer", "xywh": xywh, "by": "model"})
        if d.xywh[3] > best_height:
            best_height, best_center_x = d.xywh[3], d.xywh[0]
    local = t_frame.astimezone(JST)
    capture: dict[str, object] = {
        "id": capture_id,
        "source": "vehicle",
        "image": f"captures/{capture_id}.jpg",
        "imageSize": [image_size[0], image_size[1]],
        "boxes": boxes,
        "conditions": {
            "season": _SEASON_BY_MONTH[local.month],
            "month": local.month,
            "weather": "unknown",
            "surface": "unknown",
            "light": light_period(local),
            "fog": "none",
            "traffic": "unknown",
            "vehicle": "unknown",
        },
        "distanceM": estimate_distance_m(best_height, distance_table) if boxes else None,
        "side": side_of(best_center_x) if boxes else None,
        "pose": "unknown",
        "reactionMs": None,
        "outcome": "avoided",
        "roadSegment": sanitize_segment(segment),
        "consent": False,
        "createdAt": format_t_frame(t_frame),
    }
    probs = valid_l1_probs(l1_probs)
    if probs is not None:
        capture["l1Probs"] = probs
    return capture
