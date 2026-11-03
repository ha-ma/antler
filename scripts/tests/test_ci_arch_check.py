#!/usr/bin/env python3
"""ci_arch_check.py の自己テスト。

Run: python tools/ci-arch-check/tests/test_ci_arch_check.py

使い捨ての git リポジトリに、**本物の dispatcher と stack-routes**、偽のチェッカー 2 本を置き、
本物の CLI を走らせて終了コードと出力を見る。偽のチェッカーは、入力に ``VIOLATION`` があれば deny、
``ADVISE`` があれば助言（ブロックしない WARNING）を出す。
配布先では scripts/tests/test_ci_arch_check.py として動く。
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SRC = next(p for p in (HERE.parent / "ci_arch_check.py",) if p.is_file())
TOOLS = HERE.parent.parent
DISPATCH_SRC = next(p for p in (TOOLS / "dispatcher" / "dispatch-architecture.py",) if p.is_file())
ROUTES_SRC = next(p for p in (TOOLS / "stack-routes" / "stack_routes.py",) if p.is_file())
FAILURES = 0

CHECKER = r'''
import json, sys
data = sys.stdin.buffer.read().decode("utf-8", "replace")
if "NOISE" in data:  # 上流の再同期で、チェッカーが別の行を先に書くようになった状況
    print("DeprecationWarning: something unrelated", file=sys.stderr)
if "VIOLATION" in data:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": "layer rule broken (" + sys.argv[0].split("/")[-1].split("\\")[-1] + ")"}}))
elif "ADVISE" in data:
    print("WARNING: consider something (advice only)", file=sys.stderr)
'''

ROUTES = '''
[stack.legacy]
ratchet = true
checker = "check-legacy.py"
[stack.fresh]
checker = "check-fresh.py"
[[route]]
pattern = '^legacy/'
stacks = ["legacy"]
[[route]]
pattern = '^fresh/'
stacks = ["fresh"]

[[ci_arch.probe]]
label = "legacy: layer rule"
path = "legacy/src/__arch_probe__.py"
content = "VIOLATION\\n"
expect = "layer rule broken (check-legacy.py)"

[[ci_arch.probe]]
label = "fresh: layer rule"
path = "fresh/src/__arch_probe__.py"
content = "VIOLATION\\n"
expect = "layer rule broken (check-fresh.py)"

[[ci_arch.probe]]
label = "legacy: existing files fall to the ratchet"
path = "legacy/src/old.py"
content = "VIOLATION\\n"
kind = "ratchet"

[[ci_arch.probe]]
label = "fresh: advice is not a violation"
path = "fresh/src/__arch_probe_advice__.py"
content = "ADVISE\\n"
kind = "advisory"
'''


def check(desc: str, ok: bool) -> None:
    global FAILURES
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), desc)


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=True)


def write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8", newline="\n")


def make(root: Path, *, routes: str = ROUTES, checkers=("legacy", "fresh")) -> Path:
    """origin/main に基礎を積み、feat ブランチに切った案件。"""
    root.mkdir(parents=True)
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "t@example.invalid")
    git(root, "config", "user.name", "t")
    git(root, "config", "core.autocrlf", "false")
    hooks = root / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    shutil.copy2(DISPATCH_SRC, hooks / "dispatch-architecture.py")
    for c in checkers:
        (hooks / f"check-{c}.py").write_text(CHECKER, encoding="utf-8")
    (root / "scripts").mkdir()
    shutil.copy2(ROUTES_SRC, root / "scripts" / "stack_routes.py")
    write(root / "routes.toml", routes)
    write(root / "legacy" / "src" / "old.py", "fine\n")
    write(root / "legacy" / "src" / "other.py", "fine\n")
    write(root / "fresh" / "src" / "untouched.py", "fine\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "base")
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(root, "switch", "-q", "-c", "feat")
    return root


def commit(root: Path, files: dict[str, str]) -> None:
    for rel, body in files.items():
        write(root / rel, body)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "change")


class R:
    def __init__(self, p: subprocess.CompletedProcess):
        self.rc = p.returncode
        raw = p.stdout + p.stderr
        try:
            self.out = raw.decode("utf-8")
        except UnicodeDecodeError:
            self.out = raw.decode("cp932", "replace")
        self.out = self.out.replace("\r\n", "\n")  # Windows の text mode の改行


def run(root: Path, *args: str) -> R:
    return R(subprocess.run([sys.executable, str(SRC), "--root", str(root), *args], capture_output=True))


def main() -> int:
    bad_chars = sorted({hex(ord(c)) for c in SRC.read_text(encoding="utf-8") if not c.encode("cp932", "ignore")})
    check(f"本体の全文字が cp932 で出せる（日本語 Windows の端末で落ちない）: {bad_chars}", not bad_chars)

    with tempfile.TemporaryDirectory(prefix="ci-arch-") as td:
        tmp = Path(td)

        # ---------------- 自己防衛 ----------------
        r = run(make(tmp / "st"), "--self-test")
        check("自己防衛: probe が全部想定どおりの種別で検出される → rc=0", r.rc == 0 and "自己防衛 OK" in r.out
              and "deny 2" in r.out and "ratchet 1" in r.out and "advisory 1" in r.out)

        dead = make(tmp / "dead")
        (dead / ".claude" / "hooks" / "check-fresh.py").write_text("import sys\nsys.stdin.buffer.read()\n", encoding="utf-8")
        r = run(dead)
        check("陽性対照: チェッカーが何も検出しなくなったら、検査の前に rc=1 で『検査自体が壊れています』",
              r.rc == 1 and "検査自体が壊れています" in r.out and "素通りしました: fresh: layer rule" in r.out)

        swapped = make(tmp / "swapped")
        (swapped / ".claude" / "hooks" / "check-fresh.py").write_text(
            CHECKER.replace("layer rule broken", "some other rule"), encoding="utf-8")
        r = run(swapped)
        check("別の規則で偶然止まっている（理由の語が違う）なら rc=1", r.rc == 1 and "理由が想定と違います" in r.out)

        noprobe = make(tmp / "noprobe", routes=ROUTES.split("[[ci_arch.probe]]")[0])
        r = run(noprobe)
        check("checker を持つ stack に probe が 1 つも無ければ rc=1（規則が発火するかを誰も確かめていない）",
              r.rc == 1 and "probe が 1 つも無い" in r.out)
        allowed = make(tmp / "allowed", routes=ROUTES.split("[[ci_arch.probe]]")[0] + '[ci_arch]\nallow_no_probe = ["legacy", "fresh"]\n')
        check("allow_no_probe に書けば probe 無しでも通る", run(allowed).rc == 0)

        nostack = make(tmp / "nostack", routes=ROUTES.replace('checker = "check-legacy.py"', "").replace(
            'checker = "check-fresh.py"', "").split("[[ci_arch.probe]]")[0])
        r = run(nostack)
        check("どの stack にも checker が無ければ rc=1（何も検査しないのに緑にしない）", r.rc == 1 and "checker が無い" in r.out)

        bad_probe_path = make(tmp / "pp", routes=ROUTES.replace('path = "legacy/src/__arch_probe__.py"', 'path = "legacy/src/old.py"'))
        r = run(bad_probe_path)
        check("deny の probe が実在するパスなら rc=1（ラチェットで警告に落ちて deny にならないため）",
              r.rc == 1 and "実在しない名前にする" in r.out)
        miss_ratchet = make(tmp / "mr", routes=ROUTES.replace('path = "legacy/src/old.py"', 'path = "legacy/src/gone.py"'))
        check("ratchet の probe が実在しないパスなら rc=1", run(miss_ratchet).rc == 1)
        no_expect = make(tmp / "ne", routes=ROUTES.replace('expect = "layer rule broken (check-legacy.py)"\n', ""))
        check("deny の probe に expect が無ければ rc=1", run(no_expect).rc == 1)

        # ---------------- dispatcher の異常 ----------------
        crash = make(tmp / "crash")
        (crash / ".claude" / "hooks" / "dispatch-architecture.py").write_text("import sys\nsys.exit(3)\n", encoding="utf-8")
        r = run(crash)
        check("dispatcher が落ちたら『違反なし』でなく rc=1・終了コードが出る",
              r.rc == 1 and "終了コード 3" in r.out and "に違反なし" not in r.out)
        r = run(make(tmp / "cfg", routes=ROUTES + "\n[[route]]\npattern = '('\nstacks = []\n"))
        check("routes.toml が壊れていれば rc=2", r.rc == 2)
        nod = make(tmp / "nod")
        (nod / ".claude" / "hooks" / "dispatch-architecture.py").unlink()
        r = run(nod)
        check("dispatcher が無ければ rc=2・何を入れるかを出す", r.rc == 2 and "dispatcher" in r.out)
        nosr = make(tmp / "nosr")
        (nosr / "scripts" / "stack_routes.py").unlink()
        check("stack-routes が無ければ rc=2", run(nosr).rc == 2)
        missing_checker = make(tmp / "mc")
        (missing_checker / ".claude" / "hooks" / "check-fresh.py").unlink()
        check("宣言したチェッカーのファイルが無ければ rc=1（検査できていない stack を『違反なし』にしない）",
              run(missing_checker).rc == 1)

        # ---------------- ラチェット ----------------
        clean = make(tmp / "clean")
        r = run(clean, "--diff-only")
        check("差分が無ければ『検査対象の変更はありません』で rc=0（自己防衛は先に通っている）",
              r.rc == 0 and "検査対象の変更はありません" in r.out)
        r = run(clean)
        check("差分が無くても、ラチェットの無い stack は全件を検査する（既定）",
              r.rc == 0 and "検査 1 ファイル" in r.out and "fresh" in r.out)

        p = make(tmp / "added")
        commit(p, {"legacy/src/new.py": "VIOLATION\n"})
        r = run(p)
        check("ラチェットのある stack: 新規ファイルの違反は失敗（rc=1・ファイル名が出る）",
              r.rc == 1 and "legacy/src/new.py" in r.out and "規約違反（1 件・失敗）" in r.out)

        p = make(tmp / "modified")
        commit(p, {"legacy/src/old.py": "VIOLATION\n"})
        r = run(p)
        check("ラチェットのある stack: 既存ファイルの違反は警告のみ（rc=0）で、理由は全文出る",
              r.rc == 0 and "警告 1 件" in r.out and "legacy/src/old.py" in r.out and "layer rule broken" in r.out)

        p = make(tmp / "fresh-mod")
        commit(p, {"fresh/src/untouched.py": "VIOLATION\n"})
        r = run(p)
        check("ラチェットの無い stack: 既存ファイルの違反でも失敗", r.rc == 1 and "fresh/src/untouched.py" in r.out)

        p = make(tmp / "fresh-untouched")
        commit(p, {"legacy/src/other.py": "fine too\n"})
        write(p / "fresh" / "src" / "untouched.py", "VIOLATION\n")
        git(p, "add", "-A")
        git(p, "commit", "-q", "-m", "violation on main side")
        git(p, "update-ref", "refs/remotes/origin/main", "HEAD")
        r = run(p)
        check("ラチェットの無い stack: 誰も触っていない（差分に無い）違反も全件検査で失敗にする",
              r.rc == 1 and "fresh/src/untouched.py" in r.out)
        r = run(p, "--diff-only")
        check("--diff-only なら全件検査を省く（rc=0）", r.rc == 0)

        p = make(tmp / "adv")
        commit(p, {"fresh/src/new.py": "ADVISE\n"})
        r = run(p)
        check("助言（ブロックしない WARNING）は失敗にしない（rc=0）。助言として出す",
              r.rc == 0 and "助言" in r.out and "fresh/src/new.py" in r.out)

        p = make(tmp / "tests")
        commit(p, {"legacy/tests/test_x.py": "VIOLATION\n", "fresh/src/a.test.py": "VIOLATION\n",
                   "fresh/src/conftest.py": "VIOLATION\n", "fresh/README.md": "VIOLATION\n"})
        r = run(p)
        check("テストファイル・テストの名前・対象外の拡張子は検査しない", r.rc == 0)

        p = make(tmp / "unnamed")
        commit(p, {"elsewhere/x.py": "VIOLATION\n"})
        check("どの stack にも名指しされないパスは検査しない", run(p).rc == 0)

        p = make(tmp / "del")
        git(p, "rm", "-q", "legacy/src/other.py")
        git(p, "commit", "-q", "-m", "delete")
        check("削除したファイルは検査しない（落ちない）", run(p).rc == 0)

        p = make(tmp / "rename")
        git(p, "mv", "legacy/src/other.py", "legacy/src/renamed.py")
        write(p / "legacy" / "src" / "renamed.py", "VIOLATION\n")
        git(p, "add", "-A")
        git(p, "commit", "-q", "-m", "rename")
        r = run(p)
        check("改名は新しいパス側を見る。内容が大きく変わる改名は新規扱い（A）か警告（R）かが git の判定に従う",
              "legacy/src/renamed.py" in r.out)

        p = make(tmp / "all")
        write(p / "legacy" / "src" / "old.py", "VIOLATION\n")
        git(p, "add", "-A")
        git(p, "commit", "-q", "-m", "x")
        write(p / "fresh" / "src" / "untouched.py", "VIOLATION\n")
        git(p, "add", "-A")
        git(p, "commit", "-q", "-m", "y")
        r = run(p, "--all")
        check("--all は全件を警告として出し、強制しない（ラチェットの無い stack の違反でも rc=0）",
              r.rc == 0 and "強制はしない" in r.out and "fresh/src/untouched.py" in r.out)

        # ---------------- ラチェットの警告は stderr の先頭とは限らない ----------------
        p = make(tmp / "noise")
        commit(p, {"legacy/src/old.py": "VIOLATION NOISE\n"})
        r = run(p)
        check("チェッカーが別の stderr を先に書いても、既存ファイルのラチェットの警告を落とさない",
              r.rc == 0 and "警告 1 件" in r.out and "legacy/src/old.py" in r.out)

        # ---------------- 自己防衛が自分自身を守っている ----------------
        import importlib.util
        spec = importlib.util.spec_from_file_location("cac_under_test", SRC)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["cac_under_test"] = mod
        spec.loader.exec_module(mod)
        proj = mod.Project(make(tmp / "selfguard"))
        check("健全な環境では自己防衛の問題は 0 件", mod.self_test(proj) == [])
        mod.dispatch = lambda *a, **k: None  # 終了コードも警告も読まない、壊れた dispatch を差し込む
        broken = "\n".join(mod.self_test(proj))
        check("dispatch が終了コード・警告を読まなくなったら、自己防衛が『例外になりませんでした』で自分で気づく",
              "例外になりませんでした" in broken)

        # ---------------- probe の種別の取り違え ----------------
        wrong_kind = make(tmp / "wk", routes=ROUTES.replace('content = "ADVISE\\n"', 'content = "VIOLATION\\n"'))
        r = run(wrong_kind)
        check("助言のはずの probe が deny になったら（種別の取り違え）rc=1",
              r.rc == 1 and "指摘の種別が想定と違います" in r.out)

        # ---------------- 並列で結果を取り違えない ----------------
        p = make(tmp / "many")
        files = {f"fresh/src/f{i:02d}.py": ("VIOLATION\n" if i % 3 == 0 else "fine\n") for i in range(24)}
        commit(p, files)
        r = run(p)
        expected = {f"fresh/src/f{i:02d}.py" for i in range(24) if i % 3 == 0}
        flagged = {f for f in files if f"\n  {f}\n" in r.out}
        check("24 ファイルを並べて通しても、違反のあるファイルだけが指摘される（取り違えない）",
              r.rc == 1 and flagged == expected and len(expected) == 8)

        # ---------------- 取り込み（配布元でだけ） ----------------
        bootstrap = TOOLS.parent / "scripts" / "bootstrap.py"
        if bootstrap.is_file():
            proj = tmp / "installed"
            proj.mkdir()
            res = subprocess.run([sys.executable, str(bootstrap), "--tools-only", "--dest", str(proj),
                                  "--with-tools", "ci-arch-check"], capture_output=True)
            check("dispatcher・stack-routes 無しで取ろうとすると止まる（自動では足さない）",
                  res.returncode == 1 and b"dispatcher" in res.stdout + res.stderr)
            res = subprocess.run([sys.executable, str(bootstrap), "--tools-only", "--dest", str(proj),
                                  "--with-tools", "stack-routes,dispatcher,ci-arch-check"], capture_output=True)
            check("揃えて取れば入る", res.returncode == 0 and (proj / "scripts" / "ci_arch_check.py").is_file())

    print("FAILURES:", FAILURES)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
