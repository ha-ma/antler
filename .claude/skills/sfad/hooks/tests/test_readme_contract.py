#!/usr/bin/env python3
"""The README severity table is a contract; this test holds the hook to it.

hooks/README.md declares, per check, whether sfad-guard denies or warns. Nothing
used to verify that the code agreed: the matrix check was documented as denying
a cell with no reason while the implementation only looked for an empty string,
and the mismatch survived because the declaration and the behaviour were never
compared. Every row of that table now needs a probe here, and every probe's real
severity must match what the row says.

Adding a row without a probe fails. Rewording a row fails until the author
re-confirms the behaviour. That is deliberate: the row is the claim, and a claim
nobody re-checks is how the last drift happened.

Run: python skills/sfad/hooks/tests/test_readme_contract.py
Exit code 0 = all pass. No external dependencies.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "..", "sfad-guard.py")
README = os.path.join(HERE, "..", "README.md")
TABLE_HEADER = "## 検査内容と重大度"

FM = "---\nfeature: x\ntarget_paths:\n  - src/app/x\ntier: 1\n---\n"
SECRET_COMMIT = "git " + "commit" + " -a -m x"
PLAIN_COMMIT = "git " + "commit" + ' -m "x"'

# README の (対象, 検査) → その重大度を実際に引き起こす入力。
# 検査列は README の文言そのままを使う（言い換えたら失敗して再確認を強制する）。
PROBES: dict[tuple[str, str], dict] = {}


def probe(target: str, check: str, tool: str, tool_input: dict, setup=None) -> None:
    PROBES[(target, check)] = {"tool": tool, "input": tool_input, "setup": setup}


probe(
    "`docs/specs/*/functional.md`",
    "frontmatter（feature / target_paths / tier）の欠落・空値",
    "Write", {"file_path": "docs/specs/x/functional.md", "content": "# spec\n"},
)
probe(
    "`docs/specs/*/threat.md` `resilience.md`",
    "マトリクスの未記入セル（空欄・裸の `-`・理由なしの `N/A` を禁止。該当なしは「N/A: 理由」または「- 理由」。コードフェンス内は対象外）",
    "Write", {"file_path": "docs/specs/x/threat.md",
              "content": "| op | anon |\n|---|---|\n| POST /x | - |\n"},
)
probe(
    "`docs/specs/*/*.md`",
    "逃げ言葉（TODO / 未定 / たぶん 等）",
    "Write", {"file_path": "docs/specs/x/plan.md", "content": "# plan\nTODO: あとで\n"},
)
probe(
    "`docs/specs/*/functional.md`",
    "Questions 未解決のまま Test List 記述（`[Deferred: 担当/期日/暫定挙動]` 付きは未解決に数えない。3点セット不足は warn）",
    "Write", {"file_path": "docs/specs/x/functional.md",
              "content": FM + "## Questions\n- ソートは必要か?\n\n## Test List\n- [ ] UC-1: a\n"},
)
probe(
    "ソースファイルの作成・編集",
    "覆う仕様（functional.md の target_paths）が無い（**起動ゲート**。新規・既存の両方で発火。Tier 0 は無視してよい。同一パスにつき1回だけ）",
    "Write", {"file_path": "src/uncovered/thing.py", "content": "x = 1\n"},
)


def _stage_secret() -> None:
    with open(".env", "w", encoding="utf-8") as f:
        f.write("SECRET=1\n")
    subprocess.run(["git", "add", "-A"], check=True, capture_output=True)


probe(
    "`git commit`",
    "シークレットらしきファイル（.env / *.pem / credentials 等。`.example`/`.pub` 系は除外）。`git add -A` 等の add-all を伴うコマンドは未追跡分も検査",
    "Bash", {"command": SECRET_COMMIT}, _stage_secret,
)


def _stage_source_without_tests() -> None:
    # 前の検証が staged にした .env を必ず落とす。ここが残ると
    # シークレット deny が先に出て、この行の重大度を測れない。
    subprocess.run(["git", "reset", "-q"], check=True, capture_output=True)
    if os.path.exists(".env"):
        os.remove(".env")
    os.makedirs("src/app/x", exist_ok=True)
    with open("src/app/x/service.py", "w", encoding="utf-8") as f:
        f.write("x = 2\n")
    subprocess.run(["git", "add", "src/app/x/service.py"], check=True, capture_output=True)


probe(
    "`git commit`",
    "ソース変更にテスト変更が伴わない",
    "Bash", {"command": PLAIN_COMMIT}, _stage_source_without_tests,
)


probe(
    "Bash での仕様書き込み（本文が見える）",
    "`cat > docs/specs/.../x.md <<EOF` は本文がコマンド内にあるので、Write と同じ内容検査にかける。違反があれば同じ理由で deny、問題なければ黙って通す",
    "Bash", {"command": "cat > docs/specs/x/threat.md <<EOF\n| op | anon |\n|---|---|\n| GET /x |  |\nEOF"},
)
probe(
    "Bash での仕様書き込み（本文が見えない）",
    "`tee` / `sed -i` / `cp`・`mv` / 変数経由のリダイレクトは中身を検査できない。**検査できないものを検査済みとして通さない**（Write / Edit を使えば済む）",
    "Bash", {"command": "echo x | tee docs/specs/x/resilience.md"},
)


def parse_readme_rows() -> list[tuple[str, str, str]]:
    text = open(README, encoding="utf-8-sig").read().replace("\r\n", "\n")
    section = text.split(TABLE_HEADER, 1)[1].split("\n## ", 1)[0]
    rows: list[tuple[str, str, str]] = []
    for line in section.splitlines():
        line = line.strip()
        if not (line.startswith("|") and line.endswith("|")):
            continue
        if re.match(r"^\|[\s:|-]+\|$", line):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 3 or cells[0] == "対象":
            continue
        severity = cells[2].replace("*", "").strip()
        rows.append((cells[0], cells[1], severity))
    return rows


def observe(tool: str, tool_input: dict) -> str:
    payload = json.dumps({"tool_name": tool, "tool_input": tool_input})
    r = subprocess.run(
        [sys.executable, HOOK], input=payload,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    out = r.stdout or ""
    if '"deny"' in out:
        return "deny"
    if '"systemMessage"' in out:
        return "warn"
    return "silent"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    rows = parse_readme_rows()
    if not rows:
        print("FAIL: README の重大度表を読めませんでした")
        return 1

    sandbox = tempfile.mkdtemp(prefix="sfad-readme-contract-")
    origin = os.getcwd()
    os.chdir(sandbox)
    subprocess.run(["git", "init", "-q", "."], check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "config", "user.name", "t"], check=True)
    os.makedirs("docs/specs/x", exist_ok=True)
    with open("docs/specs/x/functional.md", "w", encoding="utf-8") as f:
        f.write(FM + "# spec\n")

    failures = 0
    for target, check, declared in rows:
        key = (target, check)
        spec = PROBES.get(key)
        if spec is None:
            print(f"FAIL  README 行に対応する検証がありません :: {target} / {check[:48]}")
            failures += 1
            continue
        if spec["setup"]:
            spec["setup"]()
        actual = observe(spec["tool"], spec["input"])
        ok = actual == declared
        failures += 0 if ok else 1
        print(("OK  " if ok else "FAIL"),
              f"宣言={declared} 実際={actual} :: {target} / {check[:48]}")

    unused = set(PROBES) - {(t, c) for t, c, _ in rows}
    for target, check in sorted(unused):
        print(f"FAIL  README にない検証が残っています :: {target} / {check[:48]}")
        failures += 1

    print("FAILURES:", failures)
    os.chdir(origin)
    shutil.rmtree(sandbox, ignore_errors=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
