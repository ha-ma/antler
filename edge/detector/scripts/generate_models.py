"""JSON Schema から pydantic のモデルを作る（docs/specs/schema-judge UC-6）。

    python edge/detector/scripts/generate_models.py          # 書き出す
    python edge/detector/scripts/generate_models.py --check  # 最新か確かめる（違えば exit 1）

入力は packages/schema/json/ の JSON Schema（Zod から作った生成物）。出力は
src/detector/schema/ の judge_request.py（JudgeRequest）と client_message.py（ClientMessage。
pwa-uplink で足した）。生成物を手で直さない。
生成ツールのバージョンは pyproject.toml の dev 依存で固定してある。
同じ入力から毎回同じバイト列になる（タイムスタンプを入れない）。
"""

from __future__ import annotations

import argparse
import difflib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

DETECTOR = Path(__file__).resolve().parents[1]
ROOT = DETECTOR.parents[1]
SCHEMA_DIR = ROOT / "packages" / "schema" / "json"
TARGET_DIR = DETECTOR / "src" / "detector" / "schema"
# (JSON Schema の名前, 出力のファイル名)。先頭が既定（render() の引数なし）
TARGETS: tuple[tuple[str, str], ...] = (
    ("judge-request", "judge_request.py"),
    ("client-message", "client_message.py"),
)
SCHEMA = SCHEMA_DIR / "judge-request.schema.json"
TARGET = TARGET_DIR / "judge_request.py"

# ruff の整形・lint は対象外にする（lint-staged が除外設定を使わずにファイル名を渡すため、
# pyproject.toml の extend-exclude だけでは足りない）。
HEADER = (
    "# 生成物。手で直さない。再生成: python edge/detector/scripts/generate_models.py\n"
    "# ruff: noqa\n"
    "# fmt: off"
)

# Zod・jsonschema と判定を揃える設定（理由は docs/specs/schema-judge/functional.md R5）:
#   --base-class         NaN・Infinity を拒否する基底クラス（src/detector/schema/_base.py）
#   --strict-types       "54" や true を数として受けない
#   --enum-field-as-literal  列挙は Literal（lax の列挙の変換を避ける）
#   --formatters builtin 外部の整形ツールのバージョンに出力を左右されない
#   --use-title-as-name  Zod の .meta({ title }) をクラス名にする
ARGS = [
    "--input-file-type",
    "jsonschema",
    "--output-model-type",
    "pydantic_v2.BaseModel",
    "--target-python-version",
    "3.11",
    "--base-class",
    "detector.schema._base.StrictModel",
    "--strict-types",
    "int",
    "float",
    "--use-annotated",
    "--use-standard-collections",
    "--use-union-operator",
    "--enum-field-as-literal",
    "all",
    "--collapse-root-models",
    "--use-title-as-name",
    "--formatters",
    "builtin",
    "--disable-timestamp",
    "--custom-file-header",
    HEADER,
]


def render(name: str = "judge-request") -> bytes:
    filename = dict(TARGETS)[name]
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / filename
        command = [
            sys.executable,
            "-m",
            "datamodel_code_generator",
            "--input",
            str(SCHEMA_DIR / f"{name}.schema.json"),
            "--output",
            str(out),
            *ARGS,
        ]
        result = subprocess.run(command, check=False, capture_output=True, text=True)  # noqa: S603
        if result.returncode != 0:
            sys.stderr.write(result.stdout + result.stderr)
            raise SystemExit(f"生成ツールが失敗した（exit {result.returncode}）")
        return harden(out.read_text(encoding="utf-8")).encode("utf-8")


def harden(source: str) -> str:
    """`ttcSec`（0 以上の数か null）のような制約つきの数は RootModel で生成され、基底クラス
    StrictModel の設定が届かない。NaN・Infinity を拒否する設定を RootModel にも足す。"""
    patched, count = re.subn(
        r"^(class \w+\(RootModel\[[^\n]*\]\):\n)",
        r"\1    model_config = ConfigDict(allow_inf_nan=False)\n",
        source,
        flags=re.MULTILINE,
    )
    # 生成ツールの出力の形が変わって当たらなくなったら、黙って素通りさせずに止める
    if count != source.count("(RootModel["):
        raise SystemExit("RootModel の書き方が想定と違う（harden の正規表現を見直す）")
    if "ConfigDict" not in patched.split("class ", 1)[0]:
        raise SystemExit("ConfigDict の import が無い")
    return patched


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="書き出さず、最新かだけ確かめる")
    args = parser.parse_args()
    stale = False
    for name, filename in TARGETS:
        target = TARGET_DIR / filename
        generated = render(name)
        current = target.read_bytes() if target.exists() else b""
        if args.check:
            if generated == current:
                continue
            stale = True
            diff = difflib.unified_diff(
                current.decode("utf-8").splitlines(),
                generated.decode("utf-8").splitlines(),
                "committed",
                "regenerated",
                lineterm="",
            )
            sys.stderr.write("\n".join(list(diff)[:60]) + "\n")
            sys.stderr.write(
                f"{target.relative_to(ROOT)} が古い。"
                "python edge/detector/scripts/generate_models.py\n"
            )
            continue
        target.write_bytes(generated)
        sys.stdout.write(f"wrote {target.relative_to(ROOT)}\n")
    return 1 if stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
