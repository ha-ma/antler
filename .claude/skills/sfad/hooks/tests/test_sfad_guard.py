#!/usr/bin/env python3
"""Behavior tests for sfad-guard.py. Self-contained: builds a temp git sandbox.

Run: python skills/sfad/hooks/tests/test_sfad_guard.py
Exit code 0 = all pass. No external dependencies.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

HOOK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sfad-guard.py"))
# assembled so an outer command guard scanning the runner command never matches
COMMIT_CMD = "git " + "commit" + ' -m "x"'

FAILURES = 0


def run_hook(tool_input: dict) -> tuple[bool, bool]:
    """Return (denied, warned). warn = systemMessage JSON on stdout."""
    payload = json.dumps({"tool_name": "Write", "tool_input": tool_input})
    r = subprocess.run(
        [sys.executable, HOOK], input=payload,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    out = r.stdout or ""
    return ('"deny"' in out, '"systemMessage"' in out)


def check(desc: str, got: tuple[bool, bool], expect: tuple[bool, bool]) -> None:
    global FAILURES
    ok = got == expect
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), f"deny={got[0]}/{expect[0]} warn={got[1]}/{expect[1]} :: {desc}")


def check_count(desc: str, got: int, expect: int) -> None:
    global FAILURES
    ok = got == expect
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), f"count={got}/{expect} :: {desc}")


def load_guard_module():
    """Import the hook as a module (the file name has a hyphen) to call internals."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("sfad_guard_under_test", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    sandbox = tempfile.mkdtemp(prefix="sfad-guard-test-")
    os.chdir(sandbox)
    subprocess.run(["git", "init", "-q", "."], check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "config", "user.name", "t"], check=True)
    os.makedirs("docs/specs/orders", exist_ok=True)
    os.makedirs("src/app", exist_ok=True)
    with open("docs/specs/orders/functional.md", "w", encoding="utf-8") as f:
        f.write("---\nfeature: orders\ntarget_paths:\n  - src/app/orders\n  - src/jobs/**/*.py\ntier: 2\n---\n# spec\n")

    FM = "---\nfeature: x\ntarget_paths:\n  - src/app/x\ntier: 1\n---\n"

    # --- spec structure (Write = full content) ---
    check("functional no frontmatter deny",
          run_hook({"file_path": "docs/specs/x/functional.md", "content": "# spec\n## Test List\n- [ ] UC-1"}),
          (True, False))
    check("functional with frontmatter allow",
          run_hook({"file_path": "docs/specs/x/functional.md", "content": FM + "# spec\n## Test List\n- [ ] UC-1"}),
          (False, False))
    check("functional empty required key deny",
          run_hook({"file_path": "docs/specs/x/functional.md", "content": "---\nfeature: x\ntarget_paths:\ntier: 1\n---\n# s"}),
          (True, False))
    check("CRLF frontmatter allow",
          run_hook({"file_path": "docs/specs/x/functional.md", "content": FM.replace("\n", "\r\n") + "# s\r\n"}),
          (False, False))
    check("questions+testlist warn",
          run_hook({"file_path": "docs/specs/x/functional.md", "content": FM + "### Questions\n- need sort?\n## Test List\n- [ ] UC-1"}),
          (False, True))
    check("deferred questions do not warn",
          run_hook({"file_path": "docs/specs/x/functional.md",
                    "content": FM + "### Questions\n- [Deferred: 担当=PO / 期日=2026-08-01 / 暫定挙動=非表示] need sort?\n## Test List\n- [ ] UC-1"}),
          (False, False))
    check("mixed open+deferred still warns",
          run_hook({"file_path": "docs/specs/x/functional.md",
                    "content": FM + "### Questions\n- [Deferred: 担当=PO / 期日=2026-08-01 / 暫定挙動=非表示] a?\n- open question?\n## Test List\n- [ ] UC-1"}),
          (False, True))
    check("template layout (prose between heading and bullets) still detected",
          run_hook({"file_path": "docs/specs/x/functional.md",
                    "content": FM + "## Questions（Deferred のみ残存可）\n\n解決済みの Question は削除する。\n\n- open question?\n\n## Test List\n- [ ] UC-1"}),
          (False, True))
    check("nested bullets under deferred not miscounted",
          run_hook({"file_path": "docs/specs/x/functional.md",
                    "content": FM + "## Questions\n- [Deferred: 担当=PO / 期日=2026-08-01 / 暫定挙動=非表示] a?\n  - 補足メモ\n\n## Test List\n- [ ] UC-1"}),
          (False, False))
    check("deferred missing 3-point set warns",
          run_hook({"file_path": "docs/specs/x/functional.md",
                    "content": FM + "## Questions\n- [Deferred: あとで] a?\n\n## Test List\n- [ ] UC-1"}),
          (False, True))
    check("threat empty cell deny",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": "| op | anon | admin |\n|---|---|---|\n| GET /x | 401 |  |\n"}),
          (True, False))
    check("threat full table allow",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": "| op | anon | admin |\n|---|---|---|\n| GET /x | 401 | 200 |\n"}),
          (False, False))
    check("bare dash cell deny (indistinguishable from unconsidered)",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": "| op | anon | admin |\n|---|---|---|\n| POST /x | 401 | - |\n"}),
          (True, False))
    check("dash with reason allow",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": "| op | anon | admin |\n|---|---|---|\n| POST /x | 401 | - 作成時は所有者が未在 |\n"}),
          (False, False))
    check("bare N/A deny, N/A with reason allow",
          run_hook({"file_path": "docs/specs/x/resilience.md", "content": "| API | retry | breaker |\n|---|---|---|\n| notify | 3 | N/A |\n"}),
          (True, False))
    check("N/A with reason allow",
          run_hook({"file_path": "docs/specs/x/resilience.md", "content": "| API | retry | breaker |\n|---|---|---|\n| notify | 3 | N/A: 同期呼び出しのみ |\n"}),
          (False, False))
    check("all-dash data row still checked (not mistaken for a separator)",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": "| op | anon | admin |\n|---|---|---|\n| - | - | - |\n"}),
          (True, False))
    check("table inside code fence ignored",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": "```\n| a |  |\n|---|---|\n| b |  |\n```\n| op | anon |\n|---|---|\n| GET | 401 |\n"}),
          (False, False))
    check("placeholder warn only",
          run_hook({"file_path": "docs/specs/x/plan.md", "content": "# plan\nTODO: later\n"}),
          (False, True))

    # --- Edit reconstruction (existing file, partial edit) ---
    with open("docs/specs/orders/threat.md", "w", encoding="utf-8") as f:
        f.write("| op | anon | admin |\n|---|---|---|\n| GET /orders | 401 | 200 |\n")
    check("partial Edit on valid functional.md allow (no fragment false-deny)",
          run_hook({"file_path": "docs/specs/orders/functional.md", "old_string": "# spec", "new_string": "# 仕様: orders"}),
          (False, False))
    check("Edit removing frontmatter deny",
          run_hook({"file_path": "docs/specs/orders/functional.md",
                    "old_string": "---\nfeature: orders\ntarget_paths:\n  - src/app/orders\n  - src/jobs/**/*.py\ntier: 2\n---\n", "new_string": ""}),
          (True, False))
    check("Edit emptying a threat cell deny",
          run_hook({"file_path": "docs/specs/orders/threat.md", "old_string": "| GET /orders | 401 | 200 |", "new_string": "| GET /orders | 401 |  |"}),
          (True, False))
    check("Edit with unmatched old_string skips (no deny)",
          run_hook({"file_path": "docs/specs/orders/functional.md", "old_string": "NOT-IN-FILE", "new_string": "x"}),
          (False, False))

    # --- launch gate ---
    check("new src no spec warn",
          run_hook({"file_path": "src/app/billing/page.tsx", "content": "export const x = 1"}),
          (False, True))
    check("new src covered no warn",
          run_hook({"file_path": "src/app/orders/page.tsx", "content": "export const x = 1"}),
          (False, False))
    check("new src covered by glob-with-extension no warn",
          run_hook({"file_path": "src/jobs/orders/sync.py", "content": "x = 1"}),
          (False, False))
    check("test file silent",
          run_hook({"file_path": "src/app/billing/page.test.tsx", "content": "it()"}),
          (False, False))
    # 実運用の試験で、起動ゲートの発火28件のうち17件が空の __init__.py だった。
    # 免除するのは実際に空のときだけ — 中身があれば挙動を持つのでゲートにかける。
    check("空の __init__.py は起動ゲートを鳴らさない",
          run_hook({"file_path": "src/app/pkg/__init__.py", "content": "\n# パッケージ標識\n"}),
          (False, False))
    check("中身のある __init__.py は鳴らす（再輸出・副作用は挙動）",
          run_hook({"file_path": "src/app/pkg2/__init__.py", "content": "from .thing import Thing\n"}),
          (False, True))
    os.makedirs("src/app/billing", exist_ok=True)
    with open("src/app/billing/page.tsx", "w") as f:
        f.write("export const x = 1")
    check("same path warns only once (already warned as a new file above)",
          run_hook({"file_path": "src/app/billing/page.tsx", "old_string": "1", "new_string": "2"}),
          (False, False))
    os.makedirs("src/app/invoices", exist_ok=True)
    with open("src/app/invoices/page.tsx", "w") as f:
        f.write("export const x = 1")
    check("existing uncovered src edit warns (Tier 1/2 mostly edits existing code)",
          run_hook({"file_path": "src/app/invoices/page.tsx", "old_string": "1", "new_string": "2"}),
          (False, True))
    check("second edit of that same file is silent (dedupe)",
          run_hook({"file_path": "src/app/invoices/page.tsx", "old_string": "2", "new_string": "3"}),
          (False, False))
    os.makedirs("src/app/orders", exist_ok=True)
    with open("src/app/orders/detail.tsx", "w") as f:
        f.write("export const x = 1")
    check("existing covered src edit stays silent",
          run_hook({"file_path": "src/app/orders/detail.tsx", "old_string": "1", "new_string": "2"}),
          (False, False))

    # --- bash: commit checks ---
    def run_bash(cmd: str) -> tuple[bool, bool]:
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}})
        r = subprocess.run([sys.executable, HOOK], input=payload,
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        out = r.stdout or ""
        return ('"deny"' in out, '"systemMessage"' in out)

    with open(".env", "w") as f:
        f.write("SECRET=1")
    subprocess.run(["git", "add", "-f", ".env"], capture_output=True)
    check("staged .env deny", run_bash(COMMIT_CMD), (True, False))
    subprocess.run(["git", "reset", "-q"], capture_output=True)

    check("unstaged .env with add-all deny", run_bash("git add -A && " + COMMIT_CMD), (True, False))
    os.remove(".env")

    subprocess.run(["git", "add", "src/app/billing/page.tsx"], capture_output=True)
    check("src without tests warn", run_bash(COMMIT_CMD), (False, True))

    with open("src/app/billing/page.test.tsx", "w") as f:
        f.write("it()")
    subprocess.run(["git", "add", "src/app/billing/page.test.tsx"], capture_output=True)
    check("src with tests silent", run_bash(COMMIT_CMD), (False, False))

    check("non-commit silent", run_bash("git status"), (False, False))

    # quoted "git commit" must not trigger the commit checks even when the
    # warn precondition (src staged without tests) is armed.
    subprocess.run(["git", "reset", "-q"], capture_output=True)
    subprocess.run(["git", "add", "src/app/billing/page.tsx"], capture_output=True)
    check("commit word inside quotes silent (warn precondition armed)",
          run_bash('echo "please git commit later"'), (False, False))
    subprocess.run(["git", "reset", "-q"], capture_output=True)

    # --- regression: GIT_ADD_RE over-match (review finding 1) ---
    with open(".env", "w") as f:
        f.write("SECRET=1")  # untracked secret in the working tree, NOT staged
    check("untracked .env + --amend silent (no over-scan)",
          run_bash("git " + "commit" + ' --amend -m "x"'), (False, False))
    check("untracked .env + '-a' inside quotes silent",
          run_bash("git " + "commit" + ' -m "wip -a stuff"'), (False, False))
    check("untracked .env + specific-file add: no secrets deny (documented limitation)",
          run_bash("git add src/app/billing/page.tsx && " + COMMIT_CMD), (False, False))
    check("untracked .env + add-all deny",
          run_bash("git add -A && " + COMMIT_CMD), (True, False))
    # commit -am stages tracked files only → untracked .env must NOT deny
    check("untracked .env + commit -am silent of secrets",
          run_bash("git " + "commit" + " -am x"), (False, False))
    # tracked+modified secret + commit -am → deny
    subprocess.run(["git", "add", "-f", ".env"], capture_output=True)
    subprocess.run(["git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed"], capture_output=True)
    with open(".env", "a") as f:
        f.write("\nMORE=2")
    check("tracked modified .env + commit -am deny",
          run_bash("git " + "commit" + " -am x"), (True, False))
    subprocess.run(["git", "rm", "-q", "--cached", ".env"], capture_output=True)
    os.remove(".env")

    # --- regression: BOM handling (review finding 2) ---
    os.makedirs("docs/specs/billing", exist_ok=True)
    with open("docs/specs/billing/functional.md", "w", encoding="utf-8-sig") as f:
        f.write("---\nfeature: billing\ntarget_paths:\n  - src/app/billing2\ntier: 1\n---\n# spec\n")
    check("BOM functional.md partial Edit allow",
          run_hook({"file_path": "docs/specs/billing/functional.md", "old_string": "# spec", "new_string": "# 仕様"}),
          (False, False))
    check("BOM spec still covers launch gate",
          run_hook({"file_path": "src/app/billing2/page.tsx", "content": "export const x = 1"}),
          (False, False))
    check("BOM Write content allow",
          run_hook({"file_path": "docs/specs/x/functional.md", "content": "﻿" + FM + "# s"}),
          (False, False))

    # --- regression: coverage boundary (review finding 3) ---
    check("sibling dir orders-admin NOT covered (warn)",
          run_hook({"file_path": "src/app/orders-admin/page.tsx", "content": "export const x = 1"}),
          (False, True))
    check("nested lib/src/app/orders NOT covered (warn)",
          run_hook({"file_path": "lib/src/app/orders/util.ts", "content": "export const x = 1"}),
          (False, True))

    # --- Bash 経由の書き込み（Claude のもう一つの書き込み経路） ---
    def run_bash(command: str) -> tuple[bool, bool]:
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
        r = subprocess.run([sys.executable, HOOK], input=payload,
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        out = r.stdout or ""
        return ('"deny"' in out, '"systemMessage"' in out)

    # 方針: 本文が見える書き方（heredoc）は Write と同じ内容検査にかけ、
    # 見えない書き方（tee / sed -i / cp）は検査できないので deny する。
    # 実運用の試験で、warn だけでは deny 相当の違反が Bash 経由で通ってしまった。
    check("Bash の heredoc は内容が正しければ通す",
          run_bash("cat > docs/specs/x/threat.md <<EOF\n| op | anon |\n|---|---|\n| GET /x | 401 |\nEOF"),
          (False, False))
    check("heredoc の中身が空セルなら deny（Write と同じ判定）",
          run_bash("cat > docs/specs/x/threat.md <<EOF\n| op | anon |\n|---|---|\n| GET /x |  |\nEOF"),
          (True, False))
    check("heredoc の中身が裸のダッシュでも deny",
          run_bash("cat > docs/specs/x/threat.md <<EOF\n| op | anon |\n|---|---|\n| GET /x | - |\nEOF"),
          (True, False))
    check("frontmatter の無い functional.md は Bash 経由でも deny",
          run_bash("cat > docs/specs/x/functional.md <<EOF\n# spec\nEOF"), (True, False))
    check("クォートしたパスでも検査対象になる（クォート1つで無効化されない）",
          run_bash('cat > "docs/specs/y/functional.md" <<EOF\n# spec\nEOF'), (True, False))
    check("中身の見えない書き方（tee）は検査できないので deny",
          run_bash("echo x | tee docs/specs/t/resilience.md"), (True, False))
    check("中身の見えない書き方（sed -i）も deny",
          run_bash("sed -i s/a/b/ docs/specs/s/functional.md"), (True, False))
    check("heredoc 本文の引用行を書き込み先と誤認しない",
          run_bash("cat > notes.md <<EOF\n> docs/specs/z/threat.md を参照\nEOF"), (False, False))
    check("/dev/null へのリダイレクトは沈黙", run_bash("cat a > /dev/null"), (False, False))
    check("一時ファイルへのリダイレクトは沈黙", run_bash("git diff > /tmp/sfad-out.txt"), (False, False))
    check("比較演算子を書き込みと誤認しない", run_bash("awk '$1 > 2 {print}' data.txt"), (False, False))
    check("Bash でのソース書き込みは起動ゲート warn",
          run_bash("echo x > src/app/bashwritten.ts"), (False, True))
    check("同一パスの2回目は抑制される",
          run_bash("echo y > src/app/bashwritten.ts"), (False, False))
    # レビュー2巡目の実測で見つかった穴。誤爆は「一発警告」を食い潰して本物を無言にする。
    check("クォート内の > を書き込みと誤認しない",
          run_bash('echo "usage: prog > src/app/quotedgt.ts"'), (False, False))
    check("その直後の本物の書き込みは鳴る（偽陽性に食われていない）",
          run_bash("cat > src/app/quotedgt.ts <<EOF\nx\nEOF"), (False, True))
    check("バックスラッシュ付き <<\\EOF の本文を除外する",
          run_bash("cat > notes.md <<\\EOF\n> docs/specs/q/threat.md 参照\nEOF"), (False, False))
    check("クォート内の << を heredoc 開始と読まない（読むと本文が拾えず誤 deny になる）",
          run_bash('echo "shift x << bits"\ncat > docs/specs/q/threat.md <<EOF\n| op | anon |\n|---|---|\n| GET /q | 401 |\nEOF'),
          (False, False))
    check("インデントされた EOF は終端ではない",
          run_bash("cat > notes.md <<EOF\n  EOF\n> docs/specs/r/threat.md 参照\nEOF"), (False, False))
    check("here-string <<< を heredoc と誤認しない",
          run_bash('grep x <<< "data"\ncat > docs/specs/r/threat.md <<EOF\n| op | anon |\n|---|---|\n| GET /r | 401 |\nEOF'),
          (False, False))
    check("比較演算子を書き込みと誤認しない",
          run_bash("awk '$1 > 2' data.txt"), (False, False))

    # --- table header is located from the separator row, not from block start ---
    # Lines that are not pipe rows (HTML comments, blank lines) used to reset a
    # position counter, so the next data row was taken for a header and skipped.
    # A generator that puts a comment above every row therefore had every row
    # skipped and the unfilled-cell gate never fired.
    hdr = "| op | anon | admin |\n|---|---|---|\n"
    bare = "| GET /x | 401 | - |\n"
    full = "| GET /y | 401 | 200 |\n"
    check("bare dash with a comment above every row still denied",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": hdr + ("<!-- note -->\n" + bare) * 3}),
          (True, False))
    check("bare dash with a comment above only the first row still denied",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": hdr + "<!-- note -->\n" + bare * 3}),
          (True, False))
    check("bare dash in rows split by blank lines still denied",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": hdr + bare + "\n" + bare + "\n" + bare}),
          (True, False))
    check("filled table with a comment above every row allow (no over-detection)",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": hdr + ("<!-- note -->\n" + full) * 3}),
          (False, False))
    check("bare dash in the header row is not a data cell, allow",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": "| op | - |\n|---|---|\n| GET /z | 200 |\n"}),
          (False, False))
    check("alignment colons in the separator row do not hide a later bare dash",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": "| op | a |\n|:---|---:|\n| GET /x | - |\n"}),
          (True, False))
    check("two tables, second one has a bare dash, denied",
          run_hook({"file_path": "docs/specs/x/threat.md", "content": hdr + full + "\ntext\n\n" + hdr + bare}),
          (True, False))

    # Count level: how many cells are reported, not just deny/allow.
    # 3 rows x 2 bare cells = 6 whatever sits between the rows.
    guard = load_guard_module()
    h2 = "| op | A1 | A2 |\n|---|---|---|\n"
    r2 = "| GET /x | - | - |\n"
    check_count("unfilled cells: contiguous rows",
                len(guard._empty_table_cells(h2 + r2 * 3)), 6)
    check_count("unfilled cells: comment above every row",
                len(guard._empty_table_cells(h2 + ("<!-- c -->\n" + r2) * 3)), 6)
    check_count("unfilled cells: comment above the first row only",
                len(guard._empty_table_cells(h2 + "<!-- c -->\n" + r2 * 3)), 6)
    check_count("unfilled cells: blank lines between rows",
                len(guard._empty_table_cells(h2 + r2 + "\n" + r2 + "\n" + r2)), 6)
    # What the old position-based code protected must still hold.
    check_count("a data row of only dashes is still data",
                len(guard._empty_table_cells("| op | A1 |\n|---|---|\n| - | - |\n")), 2)
    check_count("two all-dash data rows in a row are both data",
                len(guard._empty_table_cells("| op | A1 |\n|---|---|\n| - | - |\n| - | - |\n")), 4)

    print("FAILURES:", FAILURES)
    os.chdir(tempfile.gettempdir())
    shutil.rmtree(sandbox, ignore_errors=True)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
