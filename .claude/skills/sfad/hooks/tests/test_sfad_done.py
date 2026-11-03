#!/usr/bin/env python3
"""Behavior tests for sfad-done.py. Self-contained: builds a temp git sandbox.

sfad-done.py は「完成」の判定を Claude の自己申告から機械に移すためのもの。
その判定器自身にテストが無ければ、判定器が自己申告になる。ここで固定するのは
とくに **緑になってはいけない状況で緑にならないこと**（設計意図は「検証できな
かった項目は合格にしない」）。

Run: python skills/sfad/hooks/tests/test_sfad_done.py
Exit code 0 = all pass. No external dependencies.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

HOOKS_SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FAILURES = 0

FM_T1 = "---\nfeature: {name}\ntarget_paths:\n  - src/{name}\ntier: 1\n---\n"
FM_T2 = "---\nfeature: {name}\ntarget_paths:\n  - src/{name}\ntier: 2\n---\n"


def write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def run_done(*args: str, env: dict | None = None) -> tuple[int, str]:
    environ = dict(os.environ)
    environ.setdefault("SFAD_TEST_CMD", "python -c \"pass\"")
    if env:
        environ.update(env)
    r = subprocess.run(
        [sys.executable, os.path.join("hooks", "sfad-done.py"), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=environ,
    )
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def check(desc: str, got: tuple[int, bool], expect: tuple[int, bool]) -> None:
    global FAILURES
    ok = got == expect
    if not ok:
        FAILURES += 1
    print(("OK  " if ok else "FAIL"), f"rc={got[0]}/{expect[0]} hit={got[1]}/{expect[1]} :: {desc}")


def complete_feature(name: str = "demo") -> None:
    """4項目すべてが緑になる最小構成を作る。"""
    write(f"docs/specs/{name}/functional.md",
          FM_T1.format(name=name)
          + f"# 仕様\n\n## Test List\n- [x] UC-1: 正常系\n- [x] UC-2: 異常系\n")
    write(f"src/{name}/api.py", "x = 1\n")
    write(f"tests/test_{name}.py", "# UC-1 UC-2\ndef test_a(): ...\n")


def main() -> int:
    sandbox = tempfile.mkdtemp(prefix="sfad-done-test-")
    origin = os.getcwd()
    shutil.copytree(HOOKS_SRC, os.path.join(sandbox, "hooks"),
                    ignore=shutil.ignore_patterns("tests", "__pycache__"))
    os.chdir(sandbox)
    subprocess.run(["git", "init", "-q", "."], check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "config", "user.name", "t"], check=True)

    # --- 緑になるべき基準ケース。これが無いと以下の「赤」は常に赤でも通ってしまう ---
    complete_feature()
    rc, out = run_done()
    check("4項目すべて緑 → 完成", (rc, "完成" in out), (0, True))

    # --- 緑になってはいけない ---
    write("docs/specs/demo/functional.md",
          FM_T1.format(name="demo") + "# 仕様\n\n## Test List\n- [x] UC-1: 正常系\n- [ ] UC-2: 異常系\n")
    rc, out = run_done()
    check("Test List に未消化 → 未完成", (rc, "未消化" in out), (1, True))

    write("docs/specs/demo/functional.md",
          FM_T1.format(name="demo")
          + "この文書の ## Test List に一覧があります。\n\n## Test List\n- [ ] UC-1: 正常系\n")
    rc, out = run_done()
    check("散文中の見出し語に先に当たらない（行頭アンカー）", (rc, "未消化" in out), (1, True))

    write("docs/specs/demo/functional.md",
          FM_T1.format(name="demo") + "# 仕様\n\n## Test List\n- [x] UC-1: 済\n- [ ] ID の無い未着手項目\n")
    rc, out = run_done()
    check("ID の無い未チェック項目も数える", (rc, "未消化" in out), (1, True))

    complete_feature()
    write("docs/specs/demo/threat.md", "## Authorization Matrix\n\n| 操作 | 未認証 |\n|---|---|\n| GET /x |  |\n")
    rc, out = run_done()
    check("空セルのある仕様 → 仕様ゲート FAIL", (rc, "deny" in out), (1, True))

    os.remove("docs/specs/demo/threat.md")
    write("docs/specs/demo/functional.md",
          FM_T2.format(name="demo") + "# 仕様\n\n## Test List\n- [x] UC-1: 正常系\n")
    rc, out = run_done()
    check("Tier 2 なのに threat/resilience が無い → FAIL（両方を名指しする）",
          (rc, "threat.md" in out and "resilience.md" in out), (1, True))

    write("docs/specs/demo/functional.md",
          FM_T2.format(name="demo").replace("tier: 2", 'tier: "2"')
          + "# 仕様\n\n## Test List\n- [x] UC-1: 正常系\n")
    rc, out = run_done()
    check("クォートされた tier: \"2\" でも Tier 2 判定になる",
          (rc, "threat.md" in out), (1, True))

    complete_feature()
    rc, out = run_done(env={"SFAD_TEST_CMD": "python -c \"raise SystemExit(1)\""})
    check("テストが赤 → 未完成", (rc, "テスト" in out), (1, True))

    # guard が異常終了したら「確かめられなかった」ので不合格
    guard = os.path.join("hooks", "sfad-guard.py")
    backup = guard + ".bak"
    shutil.copy2(guard, backup)
    write(guard, "raise SystemExit(3)\n")
    rc, out = run_done()
    check("guard が異常終了 → UNKNOWN で不合格", (rc, "UNKNOWN" in out), (1, True))
    write(guard, "raise SystemExit(2)\n")
    rc, out = run_done()
    check("rc=2 も許容しない（0 以外は全て UNKNOWN）", (rc, "UNKNOWN" in out), (1, True))
    shutil.move(backup, guard)

    complete_feature()
    rc, out = run_done(env={"SFAD_TEST_CMD": ""})
    check("テストコマンドを特定できない → UNKNOWN で不合格",
          (rc, "UNKNOWN" in out), (1, True))

    # --- 誤爆してはいけない ---
    complete_feature()
    write("docs/specs/demo/functional.md",
          FM_T1.format(name="demo")
          + "# 仕様\n\n## Test List\n- [x] UC-1: 正常系\n- [x] UC-2: 異常系\n\n"
            "テンプレート例:\n\n```markdown\n- [ ] AC-1: {シナリオ}\n```\n")
    rc, out = run_done()
    check("コードフェンス内の例示は項目として数えない", (rc, "完成" in out), (0, True))

    write("docs/specs/demo/functional.md",
          FM_T1.format(name="demo")
          + "# 仕様\n\n## Test List\n"
            "- [x] UC-1: 正常系\n"
            "説明の途中に ``` を含む行があり\n"
            "- [ ] UC-2: 未着手\n"
            "もう一度 ``` を含む行がある\n")
    rc, out = run_done()
    check("行中の裸のバッククォート3連で未消化項目を消さない",
          (rc, "未消化" in out), (1, True))

    # --- 対象の指定 ---
    rc, out = run_done("typo-feature")
    check("存在しない feature 名 → exit 2（黙って完成にしない）",
          (rc, "見つかりません" in out), (2, True))

    shutil.rmtree("docs/specs", ignore_errors=True)
    rc, out = run_done()
    check("仕様が1つも無い → exit 2", (rc, "対象の仕様がありません" in out), (2, True))

    print("FAILURES:", FAILURES)
    os.chdir(origin)
    shutil.rmtree(sandbox, ignore_errors=True)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
