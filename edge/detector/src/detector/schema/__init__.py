"""@antler/schema の JSON Schema から作った pydantic のモデル。

edge は AlertFlag・Capture を JSON Schema（jsonschema）で検証する既存の方式のまま、
L1 に送る JudgeRequest だけは型つきで組み立てる（docs/specs/schema-judge）。
"""

from detector.schema.judge_request import JudgeRequest
from detector.schema.questions import JUDGE_QUESTIONS

__all__ = ["JUDGE_QUESTIONS", "JudgeRequest"]
