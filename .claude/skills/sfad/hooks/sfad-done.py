#!/usr/bin/env python3
"""SFAD completion verdict: is this feature actually done?

「完成は自己申告ではなく機械の判定」— その判定を出すのがこのスクリプト。
これまで完成の宣言は cycle.md Phase 8 が印字する散文だけで、Claude 自身の
自己申告だった。ここで exit code に落とすことで CI でも同じ判定が出せる。

判定する4つ:

1. **Test List 消化** — functional.md の Test List が全て [x]。
2. **仕様ゲート** — docs/specs 配下の全仕様を sfad-guard.py に通し、deny が出ない。
   検査は guard 本体を subprocess で呼んで行う（写しを持たない = hook と絶対にズレない）。
3. **drift クリーン** — sfad-drift.py が exit 0。
4. **テスト Green** — プロジェクトのテストコマンドが exit 0。

**検証できなかった項目は「合格」にしない。** テストコマンドを特定できない、
guard が見つからない、といった場合は UNKNOWN として不合格にする。完成の判定が
「確かめられなかったので通す」で緑になったら、自己申告に戻ってしまう。

テストコマンドの決め方（上から順に最初に当たったもの）:
  1. 環境変数 SFAD_TEST_CMD
  2. .claude/sfad.json の test_command
  3. プロジェクトファイルからの推定（pyproject / package.json / composer.json）

Usage:
  python sfad-done.py [feature ...]   # 省略時は全 feature
  exit 0 = 完成, 1 = 未完成, 2 = 実行エラー
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GUARD = os.path.join(HERE, "sfad-guard.py")
DRIFT = os.path.join(HERE, "sfad-drift.py")
SPECS_ROOT = os.path.join("docs", "specs")
TEST_LIST_HEADER_RE = re.compile(r"^##\s*Test List", re.MULTILINE)
# ID の有無で数え分けない。`- [ ] 何か` も未消化として数える。ID を要求すると
# ID 無しの未チェック項目が黙って消え、「全項目 [x]」で緑になってしまう。
TEST_LIST_ITEM_RE = re.compile(r"^[-*]\s*\[([ xX])\]\s*(.+)$")
# フェンスは行頭のものだけを対とする。行中の裸のバッククォート3連を対と解釈すると、
# その間の未消化項目が消えて「全項目 [x]」で緑になる。
CODE_FENCE_RE = re.compile(r"^```[\s\S]*?^```", re.MULTILINE)
CONFIG_PATH = os.path.join(".claude", "sfad.json")
DENY_MARK = '"deny"'

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str) -> None:
    results.append((name, ok, detail))


def read(path: str) -> str:
    with open(path, encoding="utf-8-sig") as f:
        return f.read().replace("\r\n", "\n")


def run_argv(argv: list[str]) -> tuple[int, str]:
    try:
        r = subprocess.run(
            argv, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=900,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return 2, str(exc)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


SHELL_META_RE = re.compile(r"[|&;<>$`(){}\[\]*?~]")


def run_shell(command: str) -> tuple[int, str]:
    """テストコマンドを実行する。

    シェルの機能（パイプ・連結・変数展開）を使っていないコマンドは argv として
    直接起動する。Windows の cmd.exe は `.venv/Scripts/python.exe` のような
    スラッシュ区切りの実行ファイルを解決できず、実運用の試験では
    「内部コマンドまたは外部コマンドとして認識されていません」で落ちた。
    副作用としてシェル経由の実行面も減る。
    """
    try:
        if SHELL_META_RE.search(command):
            r = subprocess.run(
                command, shell=True, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=900,
            )
        else:
            argv = shlex.split(command, posix=(os.name != "nt"))
            if argv and ("/" in argv[0] or "\\" in argv[0]):
                # Windows の CreateProcess は相対パスのスラッシュ区切りを解決できない。
                # `.venv/Scripts/python.exe` は実在しても WinError 2 になる。
                argv[0] = os.path.normpath(argv[0])
            r = subprocess.run(
                argv, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=900,
            )
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        return 2, str(exc)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def features(wanted: set[str]) -> list[str]:
    if not os.path.isdir(SPECS_ROOT):
        return []
    found = []
    for name in sorted(os.listdir(SPECS_ROOT)):
        if wanted and name not in wanted:
            continue
        if os.path.isfile(os.path.join(SPECS_ROOT, name, "functional.md")):
            found.append(name)
    return found


def check_test_list(names: list[str]) -> None:
    unchecked: list[str] = []
    empty: list[str] = []
    for feature in names:
        functional = read(os.path.join(SPECS_ROOT, feature, "functional.md"))
        # テンプレートの例示を実項目と数えないよう、フェンスを先に落とす
        body = CODE_FENCE_RE.sub("", functional)
        header = TEST_LIST_HEADER_RE.search(body)
        if not header:
            empty.append(feature)
            continue
        section = body[header.end():].split("\n## ", 1)[0]
        items = [m for m in (TEST_LIST_ITEM_RE.match(l.strip()) for l in section.splitlines()) if m]
        if not items:
            empty.append(feature)
            continue
        unchecked += [f"{feature}:{m.group(2)[:40]}" for m in items if m.group(1) not in ("x", "X")]
    if empty:
        record("Test List", False,
               "Test List が空、または項目が1つもありません: " + ", ".join(empty)
               + "（空の Test List は『検証すべきことが無い』ではなく『まだ書いていない』）")
        return
    if unchecked:
        record("Test List", False,
               f"未消化 {len(unchecked)} 件: " + ", ".join(unchecked[:8])
               + (" ほか" if len(unchecked) > 8 else ""))
        return
    record("Test List", True, "全項目 [x]")


def check_spec_gates(names: list[str]) -> None:
    """全仕様を guard 本体に通す。検査の写しをここに持たないための subprocess。"""
    if not os.path.isfile(GUARD):
        record("仕様ゲート", False, "UNKNOWN: sfad-guard.py が見つかりません")
        return
    denied: list[str] = []
    missing_files: list[str] = []
    for feature in names:
        spec_dir = os.path.join(SPECS_ROOT, feature)
        tier = re.search(r"^tier:\s*(\S+)", read(os.path.join(spec_dir, "functional.md")), re.MULTILINE)
        # YAML として正当な `tier: "2"` でも Tier 2 と判定する。剥がさないと
        # 必須ファイル検査が丸ごと外れる。
        if tier and tier.group(1).strip().strip("\"'") == "2":
            missing_files += [
                f"{feature}/{required}"
                for required in ("threat.md", "resilience.md")
                if not os.path.isfile(os.path.join(spec_dir, required))
            ]
        for name in sorted(os.listdir(spec_dir)):
            if not name.endswith(".md"):
                continue
            path = os.path.join(spec_dir, name).replace("\\", "/")
            payload = json.dumps({
                "tool_name": "Write",
                "tool_input": {"file_path": path, "content": read(path)},
            })
            try:
                r = subprocess.run(
                    [sys.executable, GUARD], input=payload,
                    capture_output=True, text=True, encoding="utf-8",
                    errors="replace", timeout=60,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                record("仕様ゲート", False, f"UNKNOWN: guard を実行できません: {exc}")
                return
            if r.returncode != 0:
                record("仕様ゲート", False,
                       f"UNKNOWN: guard が異常終了しました (rc={r.returncode}, {path})。"
                       "確かめられなかったものを合格にはしません")
                return
            if DENY_MARK in (r.stdout or ""):
                denied.append(path)
    if missing_files:
        record("仕様ゲート", False,
               "Tier 2 に必須の仕様がありません: " + ", ".join(missing_files[:5]))
        return
    if denied:
        record("仕様ゲート", False, "deny: " + ", ".join(denied[:5])
               + (" ほか" if len(denied) > 5 else ""))
        return
    record("仕様ゲート", True, f"{len(names)} 仕様が guard を通過")


def check_drift(names: list[str]) -> None:
    if not os.path.isfile(DRIFT):
        record("drift", False, "UNKNOWN: sfad-drift.py が見つかりません")
        return
    rc, out = run_argv([sys.executable, DRIFT, *names])
    if rc == 0:
        record("drift", True, "クリーン")
    elif rc == 1:
        lines = [l.strip() for l in out.splitlines() if "DRIFT" in l]
        record("drift", False, "; ".join(lines[:4]) or "drift あり")
    else:
        record("drift", False, f"UNKNOWN: drift の実行に失敗 (rc={rc})")


def detect_test_command() -> tuple[str, str]:
    env = os.environ.get("SFAD_TEST_CMD")
    if env:
        return env, "SFAD_TEST_CMD"
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8-sig") as f:
                cfg = json.load(f)
            if cfg.get("test_command"):
                return str(cfg["test_command"]), CONFIG_PATH
        except (OSError, ValueError):
            pass
    if os.path.isfile("pyproject.toml"):
        return "pytest -q", "pyproject.toml から推定"
    if os.path.isfile("package.json"):
        try:
            with open("package.json", encoding="utf-8-sig") as f:
                pkg = json.load(f)
            if "test" in pkg.get("scripts", {}):
                return "npm test --silent", "package.json の scripts.test"
        except (OSError, ValueError):
            pass
    if os.path.isfile("composer.json"):
        return "./vendor/bin/pest", "composer.json から推定"
    return "", ""


def check_tests() -> None:
    command, source = detect_test_command()
    if not command:
        record("テスト", False,
               "UNKNOWN: テストコマンドを特定できません。SFAD_TEST_CMD か "
               f"{CONFIG_PATH} の test_command で明示してください"
               "（確かめられないものを合格にはしません）")
        return
    rc, out = run_shell(command)
    if rc == 0:
        record("テスト", True, f"{command}（{source}）")
        return
    tail = "\n".join(out.strip().splitlines()[-5:])
    record("テスト", False, f"{command} が exit {rc}\n      " + tail.replace("\n", "\n      "))


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    wanted = set(sys.argv[1:])
    names = features(wanted)
    unknown = sorted(wanted - set(names))
    if unknown:
        # 存在しない feature 名を黙って捨てると、対象ゼロで「完成」になる
        print("SFAD done: 指定された仕様が見つかりません: " + ", ".join(unknown))
        return 2
    if not names:
        print("SFAD done: 対象の仕様がありません（docs/specs/{feature}/functional.md）")
        return 2

    try:
        check_test_list(names)
        check_spec_gates(names)
    except OSError as exc:
        print(f"SFAD done: 仕様を読めません: {exc}")
        return 2
    check_drift(names)
    check_tests()

    print(f"SFAD done: {', '.join(names)}")
    for name, ok, detail in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {detail}")

    if not results:
        print("判定: UNKNOWN — 検査が1つも実行されていません")
        return 2
    if all(ok for _, ok, _ in results):
        print("判定: 完成 — 4項目すべて機械で確認済み")
        return 0
    print("判定: 未完成 — 上の FAIL を消すまで完成ではありません（自己申告で上書きしないこと）")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
