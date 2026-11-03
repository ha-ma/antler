"""@antler/schema との契約テスト（docs/specs/alert-ui UC-1j、docs/specs/schema-judge UC-5b）。

edge は AlertFlag・Capture・ClientMessage の型を自前で持たず、packages/schema/json/ に書き出された
JSON Schema で検証する。JudgeRequest も同じ見本で JSON Schema を確かめる（pydantic は
test_judge_request_model.py）。TS のテストと同じ見本（packages/schema/fixtures/）を使い、
同じ結果になることを確かめる。AlertFlag.l1・Capture.l1Probs の見本もここで通る。
TripPlan は edge が扱わないので対象外。
"""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[3]
SCHEMA_DIR = ROOT / "packages" / "schema" / "json"
FIXTURE_DIR = ROOT / "packages" / "schema" / "fixtures"
KINDS = ["alert-flag", "capture", "client-message", "judge-request"]


def _validator(kind: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / f"{kind}.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _fixtures(kind: str, validity: str) -> list[tuple[str, object]]:
    files = sorted((FIXTURE_DIR / kind / validity).glob("*.json"))
    return [(f.stem, json.loads(f.read_text(encoding="utf-8"))) for f in files]


@pytest.mark.parametrize("kind", KINDS)
def test_UC_1j_validの見本はJSON_Schemaで通る(kind: str) -> None:
    validator = _validator(kind)
    cases = _fixtures(kind, "valid")
    assert cases, f"{kind} の valid の見本がありません"
    failing = [name for name, value in cases if not validator.is_valid(value)]
    assert failing == []


@pytest.mark.parametrize("kind", KINDS)
def test_UC_1j_invalidの見本はJSON_Schemaで落ちる(kind: str) -> None:
    validator = _validator(kind)
    cases = _fixtures(kind, "invalid")
    assert cases, f"{kind} の invalid の見本がありません"
    passing = [name for name, value in cases if validator.is_valid(value)]
    assert passing == []


def test_UC_1j_受信側の例はch7のAlertFlag() -> None:
    flag = json.loads((FIXTURE_DIR / "alert-flag" / "valid" / "ch7-example.json").read_text())
    assert _validator("alert-flag").is_valid(flag)
    assert flag["deer"] is True
    assert flag["side"] == "L"
