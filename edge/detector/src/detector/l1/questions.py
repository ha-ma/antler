"""L1 の 4 問（B2-4）。文言は schema-judge で凍結した `detector.schema.JUDGE_QUESTIONS` だけが正。

ここでは文字列を書かず、jev の送る形に写すだけ（名前をキーにした辞書。`instructions`、
choice は `criteria`）。
選択肢の説明文は足さない（足すと校正が無効になる。Step 4 で校正と同時に決める）。
"""

from __future__ import annotations

from typing import Final

from detector.schema import JUDGE_QUESTIONS

__all__ = ["ALERT_LEVELS", "NOUL_IDS", "QUESTION_IDS", "wire_questions"]

QUESTION_IDS: Final[tuple[str, ...]] = tuple(str(q["id"]) for q in JUDGE_QUESTIONS)
ALERT_LEVELS: Final[tuple[str, ...]] = tuple(
    str(o)
    for q in JUDGE_QUESTIONS
    if q["type"] == "choice"
    for o in q["options"]  # type: ignore[union-attr]
)
NOUL_IDS: Final[tuple[str, ...]] = tuple(
    str(q["id"]) for q in JUDGE_QUESTIONS if q["type"] == "noul"
)


def wire_questions() -> dict[str, dict[str, object]]:
    """`system_one` の questions（順序は JUDGE_QUESTIONS のまま）。"""
    wire: dict[str, dict[str, object]] = {}
    for q in JUDGE_QUESTIONS:
        item: dict[str, object] = {"type": q["type"], "instructions": q["text"]}
        if q["type"] == "choice":
            item["criteria"] = dict.fromkeys(q["options"])  # type: ignore[call-overload]
        wire[str(q["id"])] = item
    return wire
