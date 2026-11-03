#!/usr/bin/env python3
"""registry_check.py（登録漏れの検査）の自己テスト。

Run: python tools/stack-registry-check/tests/test_registry_check.py

使い捨ての git リポジトリに『新しい stack を足し忘れた』状況を作り、本物の CLI を走らせて終了コードと
出力を見る。中心の陽性対照は『新しいフォルダ（package.json あり）を足したのに routes.toml に書かなかった』。
配布先では scripts/tests/test_registry_check.py として動く（registry_check.py は 1 つ上）。
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SRC = next(p for p in (HERE.parent / "registry_check.py",) if p.is_file())
ROUTES_SRC = next(p for p in (HERE.parent.parent / "stack-routes" / "stack_routes.py", HERE.parent / "stack_routes.py")
                  if p.is_file())
REAL_LOCAL_CI = HERE.parent.parent / "local-ci" / "local-ci.py"
FAILURES = 0

ROUTES = '''
[stack.api]
dir = "backend"
[stack.web]
dir = "frontend"
[[route]]
pattern = '^backend/'
stacks = ["api"]
[[route]]
pattern = '^frontend/'
stacks = ["web"]
'''

#: local-ci の部品が無いブランチでも interface（load_checks / Unusable / Check.stack）を同じ形で試すための偽物。
FAKE_LOCAL_CI = '''
import tomllib
from pathlib import Path
from types import SimpleNamespace


class Unusable(Exception):
    pass


def load_checks(root):
    data = tomllib.loads((Path(root) / "local_ci_checks.toml").read_text(encoding="utf-8"))
    return [SimpleNamespace(stack=c["stack"], name=c["name"]) for c in data.get("check", [])]
'''


def check(desc: str, ok: bool) -> None:
    global FAILURES
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), desc)


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=True)


def write(path: Path, body: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8", newline="\n")


def make(root: Path, *, routes: str | None = ROUTES) -> Path:
    root.mkdir(parents=True)
    git(root, "init", "-q")
    (root / "scripts").mkdir()
    shutil.copy2(ROUTES_SRC, root / "scripts" / "stack_routes.py")
    if routes is not None:
        write(root / "routes.toml", routes)
    write(root / "backend" / "pyproject.toml", "[project]\n")
    write(root / "frontend" / "package.json", "{}\n")
    git(root, "add", "-A")
    return root


class R:
    def __init__(self, p: subprocess.CompletedProcess):
        self.rc = p.returncode
        # 子の出力は Windows では cp932、他では UTF-8。バイトで受けて両方で復号する
        raw = p.stdout + p.stderr
        try:
            self.out = raw.decode("utf-8")
        except UnicodeDecodeError:
            self.out = raw.decode("cp932", "replace")


def run(root: Path) -> R:
    return R(subprocess.run([sys.executable, str(SRC), "--root", str(root)], capture_output=True))


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="registry-check-") as td:
        tmp = Path(td)

        # 日本語 Windows の端末（cp932）で、出力に出せない文字があって本体が落ちる事故を固定する
        bad_chars = sorted({hex(ord(c)) for c in SRC.read_text(encoding="utf-8") if not c.encode("cp932", "ignore")})
        check(f"本体の全文字が cp932 で出せる: {bad_chars}", not bad_chars)

        # ---------------- 健全な案件 ----------------
        ok = make(tmp / "ok")
        r = run(ok)
        check("全部の stack が登録済みなら rc=0", r.rc == 0 and "食い違い 0 件" in r.out)
        check("『見なかった項目』が必ず出る（dispatcher・local-ci・dependabot が無い、と）",
              all(f"SKIP {w}" in r.out for w in ("dispatcher", "local-ci", "dependabot")) and "見なかった項目" in r.out)

        # ---------------- 陽性対照: 足し忘れ ----------------
        miss = make(tmp / "miss")
        write(miss / "admin" / "package.json", "{}\n")  # git add していない新しいフォルダ
        r = run(miss)
        check("陽性対照: 新しいフォルダ（package.json あり）を足して routes.toml に書かなければ rc=1・フォルダ名が出る",
              r.rc == 1 and "登録漏れ: admin/" in r.out and "package.json" in r.out)
        git(miss, "add", "-A")
        check("git add 後も同じく検出する", run(miss).rc == 1)
        write(miss / "routes.toml", ROUTES + '[stack.admin]\ndir = "admin"\n[[route]]\npattern = \'^admin/\'\nstacks = ["admin"]\n')
        r = run(miss)
        check("routes.toml に stack と規則を足せば通る", r.rc == 0)
        write(miss / "routes.toml", ROUTES + '[[route]]\npattern = \'^admin/\'\nstacks = []\n')
        check("stacks = [] の規則（登録した上で検査しない）でも『登録済み』と数える", run(miss).rc == 0)
        write(miss / "routes.toml", ROUTES + '[registry]\nignore = ["admin"]\n')
        check("[registry] ignore に書けば通る", run(miss).rc == 0)

        nest = make(tmp / "nest")
        write(nest / "backend" / "sub" / "package.json", "{}\n")
        check("登録済み stack の下の入れ子のフォルダは、登録済みとして通る", run(nest).rc == 0)
        ign = make(tmp / "ign")
        write(ign / ".gitignore", "node_modules/\n")
        write(ign / "node_modules" / "pkg" / "package.json", "{}\n")
        check("git が無視するフォルダ（node_modules）の印は見ない", run(ign).rc == 0)
        root_marker = make(tmp / "rootmarker")
        write(root_marker / "package.json", "{}\n")
        check("案件の直下の印（ツール用の package.json など）は stack と数えない", run(root_marker).rc == 0)
        deep = make(tmp / "deep")
        write(deep / "a" / "b" / "c" / "d" / "package.json", "{}\n")
        check("4 段より深いフォルダは見ない（限界として文書にある）", run(deep).rc == 0)

        # ---------------- dispatcher ----------------
        d = make(tmp / "disp")
        write(d / ".claude" / "hooks" / "dispatch-architecture.py", "# stub\n")
        r = run(d)
        check("dispatcher があるのに checker が未宣言の stack は NG（検査が走らない）",
              r.rc == 1 and "[api] checker が未宣言" in r.out and "[web] checker が未宣言" in r.out)
        write(d / "routes.toml", ROUTES.replace('dir = "backend"', 'dir = "backend"\nchecker = ""')
              .replace('dir = "frontend"', 'dir = "frontend"\nchecker = "check-web-architecture.py"'))
        r = run(d)
        check("checker = \"\" は意図して『無い』と書いた扱いで通る。宣言した checker のファイルが無ければ NG",
              r.rc == 1 and "[api]" not in r.out.split("check-web")[0].replace("[api] dependabot", "")
              and "check-web-architecture.py が .claude/hooks/ に無い" in r.out)
        write(d / ".claude" / "hooks" / "check-web-architecture.py", "# stub\n")
        write(d / ".claude" / "hooks" / "check-orphan-architecture.py", "# stub\n")
        r = run(d)
        check("どの stack も使っていないチェッカーは NG", r.rc == 1 and "check-orphan-architecture.py をどの stack も使っていない" in r.out)
        (d / ".claude" / "hooks" / "check-orphan-architecture.py").unlink()
        r = run(d)
        check("宣言と実物が対応すれば OK（SKIP の dispatcher は出ない）",
              r.rc == 0 and "dispatcher のチェッカーの宣言と実物が対応している" in r.out and "SKIP dispatcher" not in r.out)

        # ---------------- local-ci ----------------
        use_real = REAL_LOCAL_CI.is_file()
        print(f"INFO local-ci は{'本物（tools/local-ci）' if use_real else '偽物（このブランチに部品が無いため interface だけ）'}を使う")
        lc = make(tmp / "lc")
        if use_real:
            shutil.copy2(REAL_LOCAL_CI, lc / "scripts" / "local-ci.py")
            for extra in ("local_ci_db.py",):
                if (REAL_LOCAL_CI.parent / extra).is_file():
                    shutil.copy2(REAL_LOCAL_CI.parent / extra, lc / "scripts" / extra)
        else:
            write(lc / "scripts" / "local-ci.py", FAKE_LOCAL_CI)

        def checks(*pairs: tuple[str, str]) -> str:
            return "".join(f'[[check]]\nname = "{n}"\nstack = "{s}"\ncmd = ["x"]\nhint = "h"\n' for s, n in pairs)

        write(lc / "local_ci_checks.toml", checks(("api", "unit")))
        r = run(lc)
        check("local-ci: 検査が 1 本も無い stack は NG（この stack は手元で何も回らない）",
              r.rc == 1 and "[web] local-ci の検査が 1 本も無い" in r.out)
        write(lc / "local_ci_checks.toml", checks(("api", "unit"), ("web", "unit"), ("webb", "typo")))
        r = run(lc)
        check("local-ci: routes.toml に無い stack（綴りの違い）は NG", r.rc == 1 and "local-ci の stack 'webb'" in r.out)
        write(lc / "local_ci_checks.toml", checks(("api", "unit"), ("web", "unit"), ("common", "shared")))
        r = run(lc)
        check("local-ci: 全 stack に検査があり common は例外 → OK", r.rc == 0 and "local-ci の一覧と routes.toml の stack が一致" in r.out)
        write(lc / "local_ci_checks.toml", "[[check]]\n")
        r = run(lc)
        check("local-ci: 一覧が読めなければ NG（黙って SKIP にしない）", r.rc == 1 and "読めない" in r.out)

        # ---------------- dependabot ----------------
        dep = make(tmp / "dep")
        write(dep / ".github" / "dependabot.yml",
              'version: 2\nupdates:\n  - package-ecosystem: "pip"\n    directory: "/backend"\n    schedule:\n      interval: weekly\n')
        r = run(dep)
        check("dependabot: dir を宣言した stack が対象に無ければ NG、対象なら OK",
              r.rc == 1 and "[web] dependabot の更新の対象に /frontend が無い" in r.out and "[api] dependabot" not in r.out)
        write(dep / ".github" / "dependabot.yml",
              'version: 2\nupdates:\n  - package-ecosystem: "pip"\n    directory: "/backend"\n  - package-ecosystem: "npm"\n    directory: "/frontend/"\n')
        check("dependabot: 末尾の / の違いは同じ", run(dep).rc == 0)
        write(dep / "routes.toml", ROUTES.replace('dir = "frontend"\n', ""))
        r = run(dep)
        check("dependabot: dir を書いていない stack は見ないと出力する", "SKIP dependabot（dir 未宣言の stack）" in r.out and "web" in r.out)

        # ---------------- 検査できないとき ----------------
        r = run(make(tmp / "noroutes", routes=None))
        check("routes.toml が無ければ rc=2", r.rc == 2 and "routes.toml" in r.out)
        r = run(make(tmp / "broken", routes="[stack.api\n"))
        check("routes.toml が壊れていれば rc=2", r.rc == 2)
        nosr = make(tmp / "nosr")
        (nosr / "scripts" / "stack_routes.py").unlink()
        r = run(nosr)
        check("stack-routes 部品が無ければ rc=2", r.rc == 2 and "stack-routes" in r.out)
        plain = tmp / "plain"
        (plain / "scripts").mkdir(parents=True)
        shutil.copy2(ROUTES_SRC, plain / "scripts" / "stack_routes.py")
        write(plain / "routes.toml", ROUTES)
        r = run(plain)
        check("git のリポジトリでなければ rc=2（何も見ずに緑にしない）", r.rc == 2 and "git" in r.out)

        # ---------------- 取り込み（配布元でだけ） ----------------
        bootstrap = HERE.parents[2] / "scripts" / "bootstrap.py"
        if bootstrap.is_file():
            proj = tmp / "installed"
            proj.mkdir()
            res = subprocess.run([sys.executable, str(bootstrap), "--tools-only", "--dest", str(proj),
                                  "--with-tools", "stack-registry-check"], capture_output=True)
            check("stack-routes 無しで取ろうとすると止まる（自動では足さない）",
                  res.returncode == 1 and b"stack-routes" in res.stdout + res.stderr)
            res = subprocess.run([sys.executable, str(bootstrap), "--tools-only", "--dest", str(proj),
                                  "--with-tools", "stack-routes,stack-registry-check"], capture_output=True)
            check("一緒に取れば入る", res.returncode == 0 and (proj / "scripts" / "registry_check.py").is_file())

    print("FAILURES:", FAILURES)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
