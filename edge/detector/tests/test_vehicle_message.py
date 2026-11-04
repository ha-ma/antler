"""vehicle メッセージ（PWA → edge の車の状態）の形（docs/specs/pwa-uplink UC-1、R1）。

packages/schema/json/client-message.schema.json から生成した pydantic のモデルと、
TS と共有の見本（packages/schema/fixtures/client-message/）で同じ結果になることを確かめる。
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from detector.vehicle import VehicleReport, parse_vehicle

DETECTOR = Path(__file__).resolve().parents[1]
ROOT = DETECTOR.parents[1]
SCHEMA = ROOT / "packages" / "schema" / "json" / "client-message.schema.json"
FIXTURES = ROOT / "packages" / "schema" / "fixtures" / "client-message"


def _validator() -> Draft202012Validator:
    return Draft202012Validator(
        json.loads(SCHEMA.read_text(encoding="utf-8")), format_checker=FormatChecker()
    )


def _vehicle_fixtures(validity: str) -> list[tuple[str, object]]:
    files = sorted((FIXTURES / validity).glob("vehicle-*.json"))
    return [(f.stem, json.loads(f.read_text(encoding="utf-8"))) for f in files]


def _ok(value: object) -> bool:
    try:
        parse_vehicle(value)
    except ValueError:
        return False
    return True


# VM-1f
@pytest.mark.parametrize("validity", ["valid", "invalid"])
def test_vm1f_全見本でjsonschemaとpydanticが同じ結果(validity: str) -> None:
    validator = _validator()
    cases = _vehicle_fixtures(validity)
    assert len(cases) >= 4
    for name, value in cases:
        assert validator.is_valid(value) == (validity == "valid"), name
        assert _ok(value) == (validity == "valid"), name


def test_vm1f_JSONの整数の速度とゼロを通す() -> None:
    report = parse_vehicle(json.loads('{"type":"vehicle","speedKmh":60,"zone":"inside"}'))
    assert report == VehicleReport(speed_kmh=60.0, zone="inside", light=None)
    zero = parse_vehicle(json.loads('{"type":"vehicle","speedKmh":0}'))
    assert zero.speed_kmh == 0.0  # 0 は「速度なし」ではない
    assert isinstance(zero.speed_kmh, float)


def test_vm1f_空は3項目とも分からない() -> None:
    assert parse_vehicle({"type": "vehicle"}) == VehicleReport(None, None, None)


@pytest.mark.parametrize(
    "text",
    [
        '{"type":"vehicle","speedKmh":NaN}',
        '{"type":"vehicle","speedKmh":Infinity}',
        '{"type":"vehicle","speedKmh":-Infinity}',
        '{"type":"vehicle","speedKmh":-0.1}',
        '{"type":"vehicle","speedKmh":300.1}',
        '{"type":"vehicle","speedKmh":true}',
        '{"type":"vehicle","speedKmh":"42"}',
        '{"type":"vehicle","speedKmh":null}',
        '{"type":"vehicle","zone":null}',
        '{"type":"vehicle","light":null}',
        '{"type":"vehicle","zone":"unknown"}',
        '{"type":"vehicle","lat":43.1}',
        '{"type":"vehicle","speedKmh":42,"timestamp":1}',
    ],
)
def test_vm1f_壊れた値は拒否する(text: str) -> None:
    assert not _ok(json.loads(text))  # Python の json は NaN / Infinity も読める。pydantic が止める


def test_vm1f_辞書でないものは拒否する() -> None:
    for value in (None, [], "vehicle", 1, {"type": "ack"}, {}):
        assert not _ok(value)


# VM-1e
def test_vm1e_生成物が最新() -> None:
    result = subprocess.run(  # noqa: S603 - 固定の引数で自分の生成スクリプトを呼ぶ
        [sys.executable, str(DETECTOR / "scripts" / "generate_models.py"), "--check"],
        capture_output=True,
        text=True,
        check=False,
        cwd=DETECTOR,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_vm1e_生成は2回で同じバイト列でjudge_requestは変わらない() -> None:
    spec = importlib.util.spec_from_file_location(
        "generate_models", DETECTOR / "scripts" / "generate_models.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    schema_dir = DETECTOR / "src" / "detector" / "schema"
    for name, filename in module.TARGETS:
        first = module.render(name)
        assert first == module.render(name)
        assert first == (schema_dir / filename).read_bytes()
