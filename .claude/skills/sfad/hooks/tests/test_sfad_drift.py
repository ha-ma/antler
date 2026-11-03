#!/usr/bin/env python3
"""Behavior tests for sfad-drift.py. Self-contained temp git sandbox.

Run: python skills/sfad/hooks/tests/test_sfad_drift.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

DRIFT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sfad-drift.py"))
FAILURES = 0


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout.strip()


def commit_all(msg: str) -> str:
    git("add", "-A")
    subprocess.run(["git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], capture_output=True)
    return git("rev-parse", "--short", "HEAD")


def run_drift(*args: str) -> tuple[int, str]:
    r = subprocess.run([sys.executable, DRIFT, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "")


def check(desc: str, got: tuple[int, bool], expect: tuple[int, bool]) -> None:
    global FAILURES
    ok = got == expect
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), f"rc={got[0]}/{expect[0]} drift={got[1]}/{expect[1]} :: {desc}")


def write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def spec(feature: str, sha: str, extra: str = "") -> str:
    return (f"---\nfeature: {feature}\ntarget_paths:\n  - src/{feature}\n"
            f"tier: 2\nspec_confirmed_at: {sha}\n---\n# 仕様: {feature}\n{extra}")


def main() -> int:
    sandbox = tempfile.mkdtemp(prefix="sfad-drift-test-")
    os.chdir(sandbox)
    subprocess.run(["git", "init", "-q", "."], check=True)
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")

    # feature "orders": code + spec, confirmed at current SHA
    write("src/orders/api.py", '@router.get("/orders")\nasync def list_orders(): ...\n')
    write("docs/specs/orders/functional.md", spec("orders", "PENDING"))
    sha = commit_all("seed")
    write("docs/specs/orders/functional.md", spec("orders", sha))
    write("docs/specs/orders/threat.md", "| 操作 | 未認証 | 管理者 |\n|---|---|---|\n| GET /orders | 401 | 200 |\n")
    sha = commit_all("confirm spec")
    write("docs/specs/orders/functional.md", spec("orders", sha))
    sha = commit_all("record sha")
    write("docs/specs/orders/functional.md", spec("orders", sha))
    commit_all("final sha")

    rc, out = run_drift()
    check("clean baseline", (rc, "DRIFT" in out), (0, False))

    # 1. stale: code changes after confirmed SHA, spec untouched
    write("src/orders/api.py", '@router.get("/orders")\nasync def list_orders():\n    return []\n')
    commit_all("change code only")
    rc, out = run_drift()
    check("stale spec detected", (rc, "STALE" in out), (1, True))

    # spec updated too → clean again
    cur = git("rev-parse", "--short", "HEAD")
    write("docs/specs/orders/functional.md", spec("orders", cur))
    commit_all("update spec sha")
    cur = git("rev-parse", "--short", "HEAD")
    write("docs/specs/orders/functional.md", spec("orders", cur))
    commit_all("final")
    rc, out = run_drift()
    check("spec updated → clean", (rc, "STALE" in out), (0, False))

    # 2. threat gap: new endpoint not in threat.md
    write("src/orders/api.py",
          '@router.get("/orders")\nasync def a(): ...\n@router.delete("/orders/{id}")\nasync def b(): ...\n')
    cur = git("rev-parse", "--short", "HEAD")
    write("docs/specs/orders/functional.md", spec("orders", cur))
    rc, out = run_drift()
    check("threat gap detected", (rc, "THREAT GAP" in out and "DELETE" in out), (1, True))

    write("docs/specs/orders/threat.md",
          "| 操作 | 未認証 | 管理者 |\n|---|---|---|\n| GET /orders | 401 | 200 |\n| DELETE /orders/{id} | 401 | 204 |\n")
    rc, out = run_drift()
    check("threat covered → clean", (rc, "THREAT GAP" in out), (0, False))

    # 3. bridge: mapping table pointing at a missing location
    bridge = ("\n## Rule → ドメイン語彙対応\n\n"
              "| Rule | 語彙 | 置き場所 | 証明 |\n|---|---|---|---|\n"
              "| R1: 返金は前日まで | RefundPolicy | src/orders/policies | UC-2 |\n")
    cur = git("rev-parse", "--short", "HEAD")
    write("docs/specs/orders/functional.md", spec("orders", cur, bridge))
    rc, out = run_drift()
    check("bridge gap detected", (rc, "BRIDGE GAP" in out), (1, True))

    os.makedirs("src/orders/policies", exist_ok=True)
    write("src/orders/policies/refund_policy.py", "class RefundPolicy: ...\n")
    rc, out = run_drift()
    check("bridge resolved → clean", (rc, "BRIDGE GAP" in out), (0, False))

    # 4. missing SHA → INFO only
    write("docs/specs/billing/functional.md",
          "---\nfeature: billing\ntarget_paths:\n  - src/billing\ntier: 1\n---\n# 仕様\n")
    rc, out = run_drift("billing")
    check("missing sha → INFO not DRIFT", (rc, "INFO" in out and "DRIFT" not in out.replace("SFAD drift", "")), (0, True))

    # 5. tier 1 (no threat.md) with routes → no threat check
    write("src/billing/api.py", '@router.post("/billing")\nasync def c(): ...\n')
    rc, out = run_drift("billing")
    check("tier1 no threat.md → no THREAT GAP", (rc, "THREAT GAP" in out), (0, False))

    # 6. regression F1: plan.md commits must NOT silence STALE
    commit_all("settle working tree")
    cur = git("rev-parse", "--short", "HEAD")
    write("docs/specs/orders/functional.md", spec("orders", cur, bridge))
    commit_all("spec is the latest word")
    # now change ONLY code, then ONLY plan.md — the plan checkpoint must not
    # count as a spec update
    write("src/orders/api.py",
          '@router.get("/orders")\nasync def a(): ...\n@router.delete("/orders/{id}")\nasync def b(): ...\n# changed\n')
    git("add", "src/orders/api.py")
    subprocess.run(["git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "code change"], capture_output=True)
    write("docs/specs/orders/plan.md", "# plan\nPR #1 done\n")
    git("add", "docs/specs/orders/plan.md")
    subprocess.run(["git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "plan checkpoint"], capture_output=True)
    rc, out = run_drift("orders")
    check("plan.md commit does not silence STALE", (rc, "STALE" in out), (1, True))
    cur = git("rev-parse", "--short", "HEAD")
    write("docs/specs/orders/functional.md", spec("orders", cur, bridge))
    commit_all("spec updated")
    rc, out = run_drift("orders")
    check("functional update clears STALE", (rc, "STALE" in out), (0, False))

    # 7. regression F2: template placeholder row must not be a BRIDGE GAP
    write("docs/specs/billing/functional.md",
          "---\nfeature: billing\ntarget_paths:\n  - src/billing\ntier: 2\n---\n# 仕様\n"
          "\n## Rule → ドメイン語彙対応（Tier 2 推奨）\n\n| Rule | 語彙 | 置き場所 | 証明 |\n|---|---|---|---|\n"
          "| R1: {ルール} | {PolicyName} | {domain policies のパス} | UC-N |\n")
    rc, out = run_drift("billing")
    check("placeholder bridge row not a gap", (rc, "BRIDGE GAP" in out), (0, False))

    # 8. regression: threat coverage needs exact path token (substring is not enough)
    write("src/billing/api.py", '@router.get("/billing")\nasync def a(): ...\n@router.get("/billing/{id}")\nasync def b(): ...\n')
    write("docs/specs/billing/threat.md",
          "| 操作 | 未認証 |\n|---|---|\n| GET /billing/{id} | 401 |\n")
    cur = git("rev-parse", "--short", "HEAD")
    write("docs/specs/billing/functional.md",
          "---\nfeature: billing\ntarget_paths:\n  - src/billing\ntier: 2\nspec_confirmed_at: " + cur + "\n---\n# 仕様\n")
    rc, out = run_drift("billing")
    check("substring path does not fake coverage", (rc, "THREAT GAP" in out and "GET /billing" in out), (1, True))

    # 9. invalid SHA → INVALID BASE finding, not silent clean
    write("docs/specs/payments/functional.md",
          "---\nfeature: payments\ntarget_paths:\n  - src/payments\ntier: 1\nspec_confirmed_at: deadbeef99\n---\n# 仕様\n")
    write("src/payments/api.py", "x = 1\n")
    rc, out = run_drift("payments")
    check("invalid sha reported not silent", (rc, "INVALID BASE" in out), (1, True))

    # 10. Test List → real tests (COVERAGE GAP)
    write("docs/specs/refunds/functional.md",
          "---\nfeature: refunds\ntarget_paths:\n  - src/refunds\ntier: 1\n---\n"
          "# 仕様\n\n## Test List\n- [ ] UC-1: 返金できる\n- [ ] UC-2: 二重返金を弾く\n- [ ] AUTH-1: 未認証は 401\n")
    write("src/refunds/api.py", "x = 1\n")
    rc, out = run_drift("refunds")
    check("Test List with no tests at all → COVERAGE GAP",
          (rc, "COVERAGE GAP" in out and "UC-1" in out), (1, True))

    write("tests/test_refunds.py", '"""@coverage UC-1 / UC-2"""\ndef test_uc_1(): ...\n')
    rc, out = run_drift("refunds")
    check("partially covered → only the missing id reported",
          (rc, "COVERAGE GAP" in out and "AUTH-1" in out and "UC-1" not in out), (1, True))

    write("src/refunds/auth_check.py", "# AUTH-1 handled here\n")
    rc, out = run_drift("refunds")
    check("non-test file does not fake coverage",
          (rc, "COVERAGE GAP" in out and "AUTH-1" in out), (1, True))

    write("tests/test_refunds_auth.py", "# AUTH-1\ndef test_auth(): ...\n")
    rc, out = run_drift("refunds")
    check("all ids covered → clean", (rc, "COVERAGE GAP" in out), (0, False))

    # 連番のあとの一文字を落とすと、Test List に無い ID を探して偽陽性を出す。
    # `UC-7a` を `UC-7` に切り詰めると、テストが `UC-7a` と書いてあっても
    # 単語境界付きの `UC-7` には当たらず「見つかりません」になる。
    write("docs/specs/suffixed/functional.md",
          "---\nfeature: suffixed\ntarget_paths:\n  - src/suffixed\ntier: 1\n---\n"
          "# 仕様\n\n## Test List\n- [ ] UC-7a: 重複を弾く\n- [ ] UC-10h: 改竄を弾く\n")
    write("src/suffixed/api.py", "x = 1\n")
    write("tests/test_suffixed.py", '"""@coverage UC-7a / UC-10h"""\ndef test_it(): ...\n')
    rc, out = run_drift("suffixed")
    check("suffixed ids (UC-7a) matched whole, not truncated to UC-7",
          (rc, "COVERAGE GAP" in out), (0, False))

    write("docs/specs/notify/functional.md",
          "---\nfeature: notify\ntarget_paths:\n  - src/notify\ntier: 1\n---\n# 仕様\n")
    write("src/notify/api.py", "x = 1\n")
    rc, out = run_drift("notify")
    check("no Test List section → no COVERAGE GAP", (rc, "COVERAGE GAP" in out), (0, False))

    # 11. 認可マトリクスの ❌ セル数 vs AUTH-* 件数
    write("src/tickets/api.py",
          '@router.get("/tickets")\nasync def a(): ...\n@router.delete("/tickets/{id}")\nasync def b(): ...\n')
    write("docs/specs/tickets/threat.md",
          "## Authorization Matrix\n\n| 操作 | 未認証 | 一般 | 管理者 |\n|---|---|---|---|\n"
          "| GET /tickets | ❌ 401 | ✅ | ✅ |\n| DELETE /tickets/{id} | ❌ 401 | ❌ 403 | ✅ |\n")
    write("docs/specs/tickets/functional.md",
          "---\nfeature: tickets\ntarget_paths:\n  - src/tickets\ntier: 2\n---\n"
          "# 仕様\n\n## Test List\n- [ ] UC-1: 一覧\n- [ ] AUTH-1: 未認証は 401\n")
    write("tests/test_tickets.py", "# UC-1 AUTH-1\ndef test_a(): ...\n")
    rc, out = run_drift("tickets")
    check("denied cells outnumber AUTH-* → AUTHZ COVERAGE GAP",
          (rc, "AUTHZ COVERAGE GAP" in out and "3 件" in out), (1, True))

    write("docs/specs/tickets/functional.md",
          "---\nfeature: tickets\ntarget_paths:\n  - src/tickets\ntier: 2\n---\n"
          "# 仕様\n\n## Test List\n- [ ] UC-1: 一覧\n- [ ] AUTH-1: 未認証は GET で 401\n"
          "- [ ] AUTH-2: 未認証は DELETE で 401\n- [ ] AUTH-3: 一般は DELETE で 403\n")
    write("tests/test_tickets.py", "# UC-1 AUTH-1 AUTH-2 AUTH-3\ndef test_a(): ...\n")
    rc, out = run_drift("tickets")
    check("one AUTH-* per denied cell → clean", (rc, "AUTHZ COVERAGE GAP" in out), (0, False))

    # テンプレートは AUTH-* を threat.md の Test List に置かせる。functional.md
    # だけを数えると、書いてある仕様が「0 件」と報告される。別 feature でやるのは
    # tickets の threat.md を上書きすると後続の CONTRACT 検査が壊れるため。
    write("src/authzonly/api.py", '@router.delete("/x/{id}")'+chr(10)+'async def b(): ...'+chr(10))
    write("docs/specs/authzonly/threat.md",
          "## Authorization Matrix\n\n| 操作 | 未認証 | 一般 | 管理者 |\n|---|---|---|---|\n"
          "| DELETE /x/{id} | ❌ 401 | ❌ 403 | ✅ |\n"
          "\n## Test List\n- [ ] AUTH-1: 未認証は 401\n- [ ] AUTH-2: 一般は 403\n")
    write("docs/specs/authzonly/functional.md",
          "---\nfeature: authzonly\ntarget_paths:\n  - src/authzonly\ntier: 2\n---\n"
          "# 仕様\n\n## Test List\n- [ ] UC-1: 削除できる\n")
    write("tests/test_authzonly.py", "# UC-1 AUTH-1 AUTH-2"+chr(92)+"ndef test_a(): ..."+chr(92)+"n")
    rc, out = run_drift("authzonly")
    check("threat.md 側の AUTH-* も数える", (rc, "AUTHZ COVERAGE GAP" in out), (0, False))

    # マトリクス駆動の宣言。1 セル 1 項目の数合わせは、表を読んで全セルに展開する
    # テストを書いたときに散文を量産させるだけになるので、宣言を認める。ただし
    # 件数と参照先を毎回照合する。
    matrix = ("## Authorization Matrix\n\n| 操作 | 未認証 | 一般 | 管理者 |\n"
              "|---|---|---|---|\n"
              "| DELETE /x/{id} | ❌ 401 | ❌ 403 | ✅ |\n")
    write("src/authzdecl/api.py", '@router.delete("/x/{id}")\nasync def b(): ...\n')
    write("docs/specs/authzdecl/functional.md",
          "---\nfeature: authzdecl\ntarget_paths:\n  - src/authzdecl\ntier: 2\n---\n"
          "# 仕様\n\n## Test List\n- [ ] UC-1: 削除できる\n")
    write("tests/test_matrix.py", "# every cell\ndef test_all(): ...\n")

    # 宣言した件数が ❌ 数と一致し、参照先が実在するテスト → clean
    write("docs/specs/authzdecl/threat.md", matrix +
          "\n## Test List\n- [x] AUTH-1: 全セル <!-- authz-covers: 2 tests/test_matrix.py -->\n")
    rc, out = run_drift("authzdecl")
    check("authz-covers が一致 → clean", (rc, "AUTHZ COVERAGE GAP" in out), (0, False))

    # 表が増えたのに宣言が古い → 落ちる（1:1 規則が狙っていた性質）
    write("docs/specs/authzdecl/threat.md", matrix +
          "| DELETE /y/{id} | ❌ 401 | ❌ 403 | ✅ |\n"
          "\n## Test List\n- [x] AUTH-1: 全セル <!-- authz-covers: 2 tests/test_matrix.py -->\n")
    rc, out = run_drift("authzdecl")
    check("authz-covers が古い → AUTHZ COVERAGE GAP",
          (rc, "AUTHZ COVERAGE GAP" in out and "4 件" in out), (1, True))

    # 参照先が実在しない → 落ちる（宣言だけで通せない）
    write("docs/specs/authzdecl/threat.md", matrix +
          "\n## Test List\n- [x] AUTH-1: 全セル <!-- authz-covers: 2 tests/test_missing.py -->\n")
    rc, out = run_drift("authzdecl")
    check("authz-covers の参照先が無い → AUTHZ COVERAGE GAP",
          (rc, "AUTHZ COVERAGE GAP" in out and "test_missing" in out), (1, True))

    # 12. CONTRACT GAP: threat.md にあるルートがコードから消えた
    write("src/tickets/api.py", '@router.get("/tickets")\nasync def a(): ...\n')
    rc, out = run_drift("tickets")
    check("route removed from code → CONTRACT GAP",
          (rc, "CONTRACT GAP" in out and "DELETE /tickets/{id}" in out), (1, True))

    write("docs/specs/tickets/threat.md",
          "## Authorization Matrix\n\n| 操作 | 未認証 | 一般 | 管理者 |\n|---|---|---|---|\n"
          "| GET /tickets | ❌ 401 | ✅ | ✅ |\n")
    rc, out = run_drift("tickets")
    check("spec updated to match → CONTRACT GAP clears", (rc, "CONTRACT GAP" in out), (0, False))

    # 検出器が何も拾えないときは騒がない（誤爆防止）
    write("docs/specs/nolang/functional.md",
          "---\nfeature: nolang\ntarget_paths:\n  - src/nolang\ntier: 2\n---\n# 仕様\n")
    write("docs/specs/nolang/threat.md",
          "## Authorization Matrix\n\n| 操作 | 未認証 |\n|---|---|\n| GET /nolang | ❌ 401 |\n")
    write("src/nolang/notes.txt", "no routes here\n")
    rc, out = run_drift("nolang")
    check("no routes detectable → no CONTRACT GAP", (rc, "CONTRACT GAP" in out), (1, False))

    # 13. テンプレート例示（フェンス内）を Test List 項目と数えない
    write("docs/specs/fenced/functional.md",
          "---\nfeature: fenced\ntarget_paths:\n  - src/fenced\ntier: 1\n---\n"
          "この文書の ## Test List に一覧があります。\n\n"
          "## Test List\n- [ ] UC-1: 本物\n\n"
          "テンプレート:\n\n```markdown\n- [ ] AC-9: {例示}\n```\n")
    write("src/fenced/api.py", "x = 1\n")
    write("tests/test_fenced.py", "# UC-1\ndef test_a(): ...\n")
    rc, out = run_drift("fenced")
    check("フェンス内の例示は COVERAGE GAP にしない / 散文の見出し語で本節を飛ばさない",
          (rc, "AC-9" in out), (0, False))

    # 14. ルータ自身の prefix を解決する（実運用の試験で出た誤爆の回帰）
    #     APIRouter(prefix="/api/v1") + @router.post("/contacts") を `POST /contacts` と
    #     読み違え、同じ1つのルートに THREAT GAP と CONTRACT GAP が同時に出ていた。
    write("src/prefixed/api.py",
          'router = APIRouter(prefix="/api/v1", tags=["x"])\n'
          '@router.post("/contacts")\nasync def create(): ...\n')
    write("docs/specs/prefixed/threat.md",
          "## Authorization Matrix\n\n| 操作 | 未認証 |\n|---|---|\n| POST /api/v1/contacts | ✅ (公開) |\n")
    write("docs/specs/prefixed/functional.md",
          "---\nfeature: prefixed\ntarget_paths:\n  - src/prefixed\ntier: 2\n---\n# 仕様\n")
    rc, out = run_drift("prefixed")
    check("ルータの prefix を前置して照合する（THREAT/CONTRACT の同時誤爆を防ぐ）",
          (rc, "THREAT GAP" in out or "CONTRACT GAP" in out), (0, False))

    print("FAILURES:", FAILURES)
    os.chdir(tempfile.gettempdir())
    shutil.rmtree(sandbox, ignore_errors=True)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
