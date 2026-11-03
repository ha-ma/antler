#!/usr/bin/env python3
"""stack_routes.py の自己テスト。Run: python tools/stack-routes/tests/test_stack_routes.py

配布先では scripts/tests/test_stack_routes.py として同じ形で動く（stack_routes.py は 1 つ上の階層）。
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import stack_routes as sr  # noqa: E402

SCRIPT = os.path.join(os.path.dirname(HERE), "stack_routes.py")
FAILURES = 0

GOOD = """
[stack.api]
ratchet = true
checker = "check-api.py"
[stack.web]
[[route]]
pattern = '^api/'
stacks = ["api"]
[[route]]
pattern = '^web/'
stacks = ["web"]
[[route]]
pattern = '^docs/|^[^/]+\\.md$'
stacks = []
[[route]]
pattern = '^\\.github/workflows/'
stacks = ["*"]
"""


def check(desc: str, ok: bool) -> None:
    global FAILURES
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), desc)


def cfg_of(text: str) -> dict:
    return sr.tomllib.loads(text)


def run(routes_text: str | None, stdin: str, *args: str) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory(prefix="stack-routes-test-") as d:
        path = os.path.join(d, "routes.toml")
        if routes_text is not None:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(routes_text)
        return subprocess.run(
            [sys.executable, SCRIPT, "--routes", path, *args],
            input=stdin.encode("utf-8"), capture_output=True,
        )


def out(r: subprocess.CompletedProcess) -> list[str]:
    return r.stdout.decode("utf-8", "replace").split()


def main() -> int:
    cfg = cfg_of(GOOD)
    check("正常な routes.toml に問題が無い", sr.problems(cfg) == [])

    # --- 振り分け ---
    d = sr.decide
    check("api だけ触れば api だけ", d(["api/x.py"], cfg) == {"api": True, "web": False})
    check("web だけ触れば web だけ", d(["web/src/a.ts"], cfg) == {"api": False, "web": True})
    check("両方触れば両方", d(["api/x.py", "web/a.ts"], cfg) == {"api": True, "web": True})
    check("文書だけなら何も回さない（空配列の規則）", d(["docs/a.md", "README.md"], cfg) == {"api": False, "web": False})
    check("未知のパスは全 stack（fail-safe）", d(["tools/x.sh"], cfg) == {"api": True, "web": True})
    check("['*'] は全 stack", d([".github/workflows/ci.yml"], cfg) == {"api": True, "web": True})
    check("Windows の区切り \\ を / に直す", d(["api\\x.py"], cfg) == {"api": True, "web": False})
    check("先頭の ./ を落とす", d(["./web/a.ts"], cfg) == {"api": False, "web": True})
    check("最初に当たった規則を採る（api/ の README.md は api）",
          d(["api/README.md"], cfg) == {"api": True, "web": False})
    check("1 つでも未知のパスが混ざれば全 stack", d(["docs/a.md", "weird/x"], cfg) == {"api": True, "web": True})
    check("出力の並びは宣言順", list(d(["api/x"], cfg)) == ["api", "web"])

    # --- named_stacks（編集を止める側が使う。『迷ったら全部』にしない）---
    n = sr.named_stacks
    check("named_stacks: 名指しされた stack だけ", n("api/x.py", cfg) == {"api"} and n("web/a.ts", cfg) == {"web"})
    check("named_stacks: 未知のパスは空（stacks_for と違い全部にしない）", n("tools/x.sh", cfg) == frozenset())
    check("named_stacks: ['*'] と [] は空", n(".github/workflows/ci.yml", cfg) == frozenset()
          and n("docs/a.md", cfg) == frozenset())
    check("named_stacks: Windows の区切りも同じ", n("api\\x.py", cfg) == {"api"})

    # --- 形の検査（壊れた routes.toml を全部落とす）---
    def bad(desc: str, text: str, needle: str) -> None:
        probs = sr.problems(cfg_of(text))
        check(f"問題を検出: {desc}", any(needle in p for p in probs))

    bad("stack が無い", "[[route]]\npattern='a'\nstacks=[]\n", "宣言されていない")
    bad("規則が無い", "[stack.a]\n", "[[route]] が 1 つも無い")
    bad("壊れた正規表現", "[stack.a]\n[[route]]\npattern='('\nstacks=['a']\n", "正規表現として壊れている")
    bad("宣言されていない stack を指す", "[stack.a]\n[[route]]\npattern='x'\nstacks=['zzz']\n", "宣言されていない")
    bad("どの規則も起こさない stack", "[stack.a]\n[stack.b]\n[[route]]\npattern='x'\nstacks=['a']\n", "起こさない")
    bad("重複した pattern", "[stack.a]\n[[route]]\npattern='x'\nstacks=['a']\n[[route]]\npattern='x'\nstacks=[]\n", "重複")
    bad("stack 名が不正", "[stack.A_b]\n[[route]]\npattern='x'\nstacks=['*']\n", "小文字")
    bad("ratchet が真偽値でない", "[stack.a]\nratchet='yes'\n[[route]]\npattern='x'\nstacks=['a']\n", "true / false")
    bad("pattern が無い", "[stack.a]\n[[route]]\nstacks=['a']\n", "pattern")
    bad("dir が文字列でない", "[stack.a]\ndir=3\n[[route]]\npattern='x'\nstacks=['a']\n", "dir")
    bad("dir が空", "[stack.a]\ndir='/'\n[[route]]\npattern='x'\nstacks=['a']\n", "dir")
    check("dir を宣言した正しい routes.toml は通る",
          sr.problems(cfg_of("[stack.a]\ndir='backend'\n[[route]]\npattern='x'\nstacks=['a']\n")) == [])

    # --- コマンド（終了コードまで踏む）---
    r = run(GOOD, "api/x.py\n")
    check("rc=0 で stack=true|false の行を出す", r.returncode == 0 and out(r) == ["api=true", "web=false"])
    r = run(GOOD, "")
    check("空入力は rc=2（黙って全 false にしない）", r.returncode == 2 and b"0" in r.stderr)
    r = run(GOOD, "", "--allow-empty")
    check("--allow-empty なら全 false で rc=0", r.returncode == 0 and out(r) == ["api=false", "web=false"])
    r = run(None, "api/x\n")
    check("routes.toml が無ければ rc=2", r.returncode == 2)
    r = run("[stack.a\n", "x\n")
    check("TOML が壊れていれば rc=2", r.returncode == 2)
    r = run("[stack.a]\n", "x\n")
    check("形が壊れていれば rc=2（全 false で通さない）", r.returncode == 2 and r.stdout == b"")
    r = run(GOOD, "", "--check")
    check("--check は入力が空でも形だけ検査して rc=0", r.returncode == 0)
    r = run("[stack.a]\n", "", "--check")
    check("--check は形が壊れていれば rc=2", r.returncode == 2)
    r = run(GOOD, "api/日本語.py\r\nweb/x\r\n")
    check("日本語のパスと CRLF を受ける", r.returncode == 0 and out(r) == ["api=true", "web=true"])

    # --- 雛形がそのまま使える ---
    ex = os.path.join(os.path.dirname(HERE), "routes.toml.example")
    if os.path.isfile(ex):
        check("routes.toml.example が形の検査を通る", not sr.problems(sr.load(ex)))

    print("FAILURES:", FAILURES)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
