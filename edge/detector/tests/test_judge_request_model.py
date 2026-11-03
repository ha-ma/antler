"""JudgeRequest の 3 つの形（Zod・JSON Schema・pydantic）の一致。

仕様は docs/specs/schema-judge の UC-5・UC-6。TS のテスト
（packages/schema/src/judge-request.test.ts）と同じ見本
（packages/schema/fixtures/judge-request/）を使う。pydantic のモデルは JSON Schema から
生成したもの（scripts/generate_models.py）で、手で直さない。
"""

from __future__ import annotations

import copy
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError

from detector.schema import JUDGE_QUESTIONS, JudgeRequest

ROOT = Path(__file__).resolve().parents[3]
DETECTOR = ROOT / "edge" / "detector"
SCHEMA = ROOT / "packages" / "schema" / "json" / "judge-request.schema.json"
FIXTURES = ROOT / "packages" / "schema" / "fixtures" / "judge-request"


def _load(validity: str) -> list[tuple[str, dict]]:
    files = sorted((FIXTURES / validity).glob("*.json"))
    return [(f.stem, json.loads(f.read_text(encoding="utf-8"))) for f in files]


def _ch7() -> dict:
    return json.loads((FIXTURES / "valid" / "ch7-example.json").read_text(encoding="utf-8"))


def _validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _pydantic_ok(value: object) -> bool:
    try:
        JudgeRequest.model_validate(value)
    except ValidationError:
        return False
    return True


def test_AC_1_ch7の例は3つで通り質問文を1語変えると3つとも落ちる() -> None:
    example = _ch7()
    assert _validator().is_valid(example)
    assert _pydantic_ok(example)
    reworded = copy.deepcopy(example)
    reworded["questions"][0]["text"] = "Which alert should the driver get?"
    assert not _validator().is_valid(reworded)
    assert not _pydantic_ok(reworded)


def test_UC_6a_生成物がJSON_Schemaから作り直したものと一致する() -> None:
    result = subprocess.run(  # noqa: S603 - 固定の引数で自分の生成スクリプトを呼ぶ
        [sys.executable, str(DETECTOR / "scripts" / "generate_models.py"), "--check"],
        capture_output=True,
        text=True,
        check=False,
        cwd=DETECTOR,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("validity", ["valid", "invalid"])
def test_UC_6b_pydanticは全見本でjsonschemaと同じ結果を返す(validity: str) -> None:
    validator = _validator()
    cases = _load(validity)
    assert cases, f"judge-request の {validity} の見本がありません"
    expected = validity == "valid"
    disagreeing = [
        name
        for name, value in cases
        if not (validator.is_valid(value) == _pydantic_ok(value) == expected)
    ]
    assert disagreeing == []


def test_UC_6c_ch7の例はvalidateしてdumpすると元のJSONに戻る() -> None:
    for name, value in _load("valid"):
        model = JudgeRequest.model_validate(value)
        assert json.loads(model.model_dump_json()) == value, name
        assert model.model_dump(mode="json") == value, name
    null_ttc = JudgeRequest.model_validate(dict(_load("valid"))["ttc-null"])
    assert '"ttcSec":null' in null_ttc.model_dump_json()


def test_UC_6d_PythonのJUDGE_QUESTIONSはch7の例のquestionsと一致しJudgeRequestに通る() -> None:
    example = _ch7()
    assert json.loads(json.dumps(JUDGE_QUESTIONS)) == example["questions"]
    request = {**example, "questions": list(JUDGE_QUESTIONS)}
    assert _pydantic_ok(request)
    assert _validator().is_valid(json.loads(json.dumps(request)))


def test_UC_6e_pydanticは余分なキーと数でない値を拒否する() -> None:
    example = _ch7()
    extra = copy.deepcopy(example)
    extra["state"]["frameJpegB64"] = "AAAA"
    assert not _pydantic_ok(extra)
    top = {**example, "image": "x"}
    assert not _pydantic_ok(top)
    for bad in ("54", True, None):
        wrong = copy.deepcopy(example)
        wrong["state"]["speedKmh"] = bad
        assert not _pydantic_ok(wrong), repr(bad)


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("field", ["speedKmh", "ttcSec", "lateralMps"])
def test_UC_1i_FAIL_3_NaNとInfinityはPythonでも拒否される(field: str, bad: float) -> None:
    request = copy.deepcopy(_ch7())
    if field == "lateralMps":
        request["state"]["track"][1]["lateralMps"] = bad
    else:
        request["state"][field] = bad
    assert not _pydantic_ok(request)


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ('"speedKmh": 54', '"speedKmh": 1e400'),
        ('"ttcSec": 3.9', '"ttcSec": 1e400'),
        ('"lateralMps": 0.4', '"lateralMps": 1e400'),
        ('"lateralMps": 0.4', '"lateralMps": -1e400'),
    ],
)
def test_UC_1i_1e400はpydanticが拒否する(old: str, new: str) -> None:
    text = json.dumps(_ch7()).replace(old, new)
    assert new in text
    with pytest.raises(ValidationError):
        JudgeRequest.model_validate_json(text)
    with pytest.raises(ValidationError):
        JudgeRequest.model_validate(json.loads(text))


def test_UC_6f_既知の差が固定されている() -> None:
    validator = _validator()
    two_point_zero = copy.deepcopy(_ch7())
    two_point_zero["state"]["recentAlerts30s"] = 2.0
    assert validator.is_valid(two_point_zero)
    assert not _pydantic_ok(two_point_zero)
    infinite = json.loads(
        json.dumps(_ch7()).replace('"speedKmh": 54', '"speedKmh": 1e400'),
    )
    assert math.isinf(infinite["state"]["speedKmh"])
    assert validator.is_valid(infinite)
    assert not _pydantic_ok(infinite)


def test_FAIL_2_posの末尾の改行は3つとも拒否される() -> None:
    request = copy.deepcopy(_ch7())
    request["state"]["track"][1]["pos"] = "shoulder\n"
    assert not _validator().is_valid(request)
    assert not _pydantic_ok(request)


def test_IDEM_2_生成を2回繰り返しても同じバイト列() -> None:
    spec = importlib.util.spec_from_file_location(
        "generate_models", DETECTOR / "scripts" / "generate_models.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    first = module.render()
    assert first == module.render()
    assert first == (DETECTOR / "src" / "detector" / "schema" / "judge_request.py").read_bytes()
