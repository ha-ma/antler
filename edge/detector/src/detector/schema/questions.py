"""L1 に送る固定の 4 問（手書き。生成物 judge_request.py とは別のファイル）。

文言は要件定義書 原本 第 7 章の JudgeRequest の例と同一で、
packages/schema/src/judge-request.ts の JUDGE_QUESTIONS と同じ内容。
質問文を変えると L1 の校正が無効になるので、edge-l1 の l1/questions.py は
ここから import し、書き直さない。変えるときは仕様（docs/specs/schema-judge）・見本・
生成物・校正データをまとめて直す。一致は tests/test_judge_request_model.py（UC-6d）が確かめる。
"""

from __future__ import annotations

from typing import Final

JUDGE_QUESTIONS: Final[tuple[dict[str, object], ...]] = (
    {
        "id": "alert_level",
        "type": "choice",
        "text": "Which alert should the driver get now?",
        "options": ["none", "zone", "danger"],
    },
    {
        "id": "on_roadway",
        "type": "noul",
        "text": "The animal is moving into the driving lane.",
    },
    {
        "id": "static_shoulder",
        "type": "noul",
        "text": "The animal is standing still on the road shoulder.",
    },
    {
        "id": "false_positive",
        "type": "noul",
        "text": "The detection is not a real deer (sign, snow, post).",
    },
)
