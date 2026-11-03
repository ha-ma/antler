#!/usr/bin/env python3
"""The SFAD ↔ stack seam is a contract; this test holds both layers to it.

このハーネスは2層（SFAD が「何を作るか」、スタックが「どう書くか」）だが、
層と層の接続を検査するものが無かった。SKILL.md と test.md が指していた
rules/{stack}/architecture/05_tests.md は3ヶ月間存在せず、テスト規約への
唯一の入口が切れていたのに誰も気づかなかった。

CONTRACT.md の委譲表が継ぎ目の唯一の宣言で、ここはその表を実物と突き合わせる。
リンク切れ検査に留めないのが要点: 次に壊れるのはパスの消滅ではなく、見出しの
改名と、委譲先が存在するのに撃てなくなることだから。

Run: python skills/sfad/hooks/tests/test_stack_contract.py
Exit code 0 = all pass. No external dependencies.
"""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
CONTRACT = os.path.join(REPO, "skills", "sfad", "CONTRACT.md")
SFAD_DIR = os.path.join(REPO, "skills", "sfad")
STACKS_DIR = os.path.join(REPO, "stacks")
FIXED_COLUMNS = 4  # #, 委譲する事柄, アンカー, 必須見出し
NA_RE = re.compile(r"^N/A\s*[:：]\s*\S")
SFAD_REF_RE = re.compile(r"`(stacks/[^`\s]*)`")
REQUIRED_MATCHERS = ("Bash", "PowerShell", "Write|Edit|MultiEdit")

FAILURES = 0


def check(desc: str, ok: bool, detail: str = "") -> None:
    global FAILURES
    if not ok:
        FAILURES += 1
    print(("OK  " if ok else "FAIL"), desc + (f" :: {detail}" if detail and not ok else ""))


def read(path: str) -> str:
    with open(path, encoding="utf-8-sig") as f:
        return f.read().replace("\r\n", "\n")


def parse_contract() -> tuple[list[str], list[dict]]:
    """委譲表を (スタック名の並び, 行) に読む。"""
    text = read(CONTRACT)
    rows: list[list[str]] = []
    for line in text.split("## 委譲の表", 1)[1].split("\n## ", 1)[0].splitlines():
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        if re.match(r"^\|[\s:|-]+\|$", stripped):
            continue
        rows.append([c.strip() for c in stripped.strip("|").split("|")])
    header, body = rows[0], rows[1:]
    stacks = header[FIXED_COLUMNS:]
    parsed = [
        {"what": r[1], "anchor": r[2], "heading": r[3],
         "cells": dict(zip(stacks, r[FIXED_COLUMNS:]))}
        for r in body
    ]
    return stacks, parsed


def discovered_stacks() -> list[str]:
    if not os.path.isdir(STACKS_DIR):
        return []
    return sorted(
        name for name in os.listdir(STACKS_DIR)
        if os.path.isfile(os.path.join(STACKS_DIR, name, "CLAUDE.md"))
    )


def check_columns(declared: list[str], found: list[str]) -> None:
    # 並び順は問わない（表の読みやすさを優先してよい）。過不足だけを見る。
    missing = sorted(set(found) - set(declared))
    extra = sorted(set(declared) - set(found))
    check("表の列と実在するスタックが一致する", not missing and not extra,
          f"表に無いスタック={missing} 実在しない列={extra}")


def check_anchors(rows: list[dict], stacks: list[str]) -> None:
    for row in rows:
        for stack in stacks:
            cell = row["cells"].get(stack, "")
            label = f"[{row['what']}] {stack}"
            if NA_RE.match(cell):
                continue
            if cell != "✅":
                check(label, False,
                      f"セルが ✅ でも 'N/A: 理由' でもありません: {cell!r}"
                      "（空欄や理由なしの - は認めません）")
                continue
            pattern = os.path.join(REPO, row["anchor"].strip("`").replace("{stack}", stack))
            matches = glob.glob(pattern)
            if not matches:
                check(label, False, f"アンカーが実在しません: {row['anchor']}")
                continue
            heading = row["heading"]
            if NA_RE.match(heading):
                check(label, True)
                continue
            anchored = re.compile(r"^#+\s*" + re.escape(heading) + r"\s*$", re.MULTILINE)
            hit = any(anchored.search(read(m)) for m in matches)
            check(label, hit, f"見出し「{heading}」が {matches[0]} にありません")


def check_unregistered_refs(rows: list[dict]) -> None:
    """SFAD の散文が表に無い継ぎ目を黙って生やしていないか。"""
    anchors = [r["anchor"].strip("`") for r in rows]
    offenders: list[str] = []
    for path in glob.glob(os.path.join(SFAD_DIR, "**", "*.md"), recursive=True):
        if os.path.abspath(path) == os.path.abspath(CONTRACT):
            continue
        for ref in SFAD_REF_RE.findall(read(path)):
            ref = ref.rstrip("/`")
            if any(a.startswith(ref) or ref.startswith(a) for a in anchors):
                continue
            offenders.append(f"{os.path.relpath(path, REPO)}: {ref}")
    check("SFAD の参照が全て契約表に載っている", not offenders, "; ".join(sorted(set(offenders))[:5]))


def check_delegate_capability(stacks: list[str]) -> None:
    """委譲先が「ある」だけでなく「撃てる」ことまで見る。"""
    for stack in stacks:
        settings_path = os.path.join(STACKS_DIR, stack, ".claude", "settings.json")
        if not os.path.isfile(settings_path):
            check(f"[hook 配線] {stack}", False, "settings.json がありません")
            continue
        try:
            pre = json.loads(read(settings_path)).get("hooks", {}).get("PreToolUse", [])
        except ValueError as exc:
            check(f"[hook 配線] {stack}", False, f"settings.json を読めません: {exc}")
            continue
        wired = {
            entry.get("matcher")
            for entry in pre
            for hook in entry.get("hooks", [])
            if "check-" in hook.get("command", "")
        }
        missing = [m for m in REQUIRED_MATCHERS if m not in wired]
        check(f"[hook 配線] {stack}", not missing, f"未配線の matcher: {missing}")

        hooks = glob.glob(os.path.join(STACKS_DIR, stack, ".claude", "hooks", "check-*.py"))
        if not hooks:
            check(f"[hook 実行] {stack}", False, "check-*.py がありません")
            continue
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "x.py", "content": "print('probe')\n"},
        })
        try:
            r = subprocess.run([sys.executable, hooks[0]], input=payload,
                               capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=30)
        except (OSError, subprocess.SubprocessError) as exc:
            check(f"[hook 実行] {stack}", False, f"起動できません: {exc}")
            continue
        # 撃てること自体の確認。無害な入力なので判定内容ではなく「異常終了しない」を見る。
        check(f"[hook 実行] {stack}", r.returncode == 0,
              f"rc={r.returncode} {(r.stderr or '')[:120]}")


def check_reverse_independence() -> None:
    """スタックは SFAD 無しで配布される（bootstrap.py --no-sfad）。依存してはいけない。"""
    offenders: list[str] = []
    for root, dirs, files in os.walk(STACKS_DIR):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "__pycache__", "vendor")]
        for name in files:
            if not name.endswith((".md", ".json", ".py", ".yml", ".yaml")):
                continue
            path = os.path.join(root, name)
            try:
                content = read(path)
            except (OSError, UnicodeDecodeError):
                continue
            if re.search(r"\bsfad\b|docs/specs", content, re.IGNORECASE):
                offenders.append(os.path.relpath(path, REPO))
    check("スタックが SFAD に依存していない", not offenders, "; ".join(offenders[:5]))


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    if not os.path.isdir(STACKS_DIR):
        # 配布先のプロジェクトには stacks/ が無い。継ぎ目の検査は配布元リポジトリの仕事。
        print("SKIP  stacks/ が無いため検査対象外（配布元リポジトリで実行してください）")
        return 0
    if not os.path.isfile(CONTRACT):
        print("FAIL  CONTRACT.md がありません")
        return 1

    declared, rows = parse_contract()
    found = discovered_stacks()
    check_columns(declared, found)
    check_anchors(rows, [s for s in declared if s in found])
    check_unregistered_refs(rows)
    check_delegate_capability(found)
    check_reverse_independence()

    print("FAILURES:", FAILURES)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
