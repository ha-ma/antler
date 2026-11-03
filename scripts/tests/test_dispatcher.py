#!/usr/bin/env python3
"""dispatch-architecture.py（dispatcher）の自己テスト。

Run: python tools/dispatcher/tests/test_dispatcher.py

本物の hook を、使い捨ての案件（偽のチェッカー 2 本と routes.toml）に対して**子プロセスとして**
走らせ、終了コード・標準出力の deny・チェッカーに渡ったバイトまで見る。
配布先では scripts/tests/test_dispatcher.py として動く（dispatch-architecture.py は .claude/hooks/）。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
SRC = next(p for p in (HERE.parent / "dispatch-architecture.py", HERE.parent.parent / ".claude" / "hooks" / "dispatch-architecture.py")
           if p.is_file())
ROUTES_SRC = next(p for p in (HERE.parent.parent / "stack-routes" / "stack_routes.py", HERE.parent / "stack_routes.py")
                  if p.is_file())
BOOTSTRAP = HERE.parents[2] / "scripts" / "bootstrap.py"
FAILURES = 0

FAKE_CHECKER = r'''
import hashlib, json, os, sys
data = sys.stdin.buffer.read()
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps({"checker": os.path.basename(__file__), "sha": hashlib.sha256(data).hexdigest()}) + "\n")
mode = os.environ.get("FAKE_MODE", "")
if mode == "garbage":
    print("this is not json")
elif mode == "crash":
    sys.stderr.write("boom\n"); sys.exit(7)
elif b"VIOLATION" in data:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                              "permissionDecisionReason": os.path.basename(__file__) + " says no"}}))
'''

ROUTES = '''
[stack.alpha]
ratchet = true
checker = "check-alpha.py"
[stack.beta]
checker = "check-beta.py"
[stack.gamma]
[[route]]
pattern = '^alpha/'
stacks = ["alpha"]
[[route]]
pattern = '^beta/'
stacks = ["beta"]
[[route]]
pattern = '^gamma/'
stacks = ["gamma"]
[[route]]
pattern = '^docs/'
stacks = []
[[route]]
pattern = '^\\.github/'
stacks = ["*"]
'''


def check(desc: str, ok: bool) -> None:
    global FAILURES
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), desc)


def make_project(root: Path, *, routes: str | None = ROUTES, checkers=("alpha", "beta")) -> Path:
    hooks = root / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    shutil.copy2(SRC, hooks / "dispatch-architecture.py")
    for c in checkers:
        (hooks / f"check-{c}.py").write_text(FAKE_CHECKER, encoding="utf-8")
    (root / "scripts").mkdir()
    shutil.copy2(ROUTES_SRC, root / "scripts" / "stack_routes.py")
    if routes is not None:
        (root / "routes.toml").write_text(routes, encoding="utf-8", newline="\n")
    return root


class Result:
    def __init__(self, r: subprocess.CompletedProcess, log: Path):
        self.rc = r.returncode
        out = r.stdout.decode("utf-8", "replace").strip()
        self.deny = None
        if out:
            try:
                data = json.loads(out)["hookSpecificOutput"]
                self.deny = data["permissionDecisionReason"] if data["permissionDecision"] == "deny" else None
            except (ValueError, KeyError):
                self.deny = "UNPARSEABLE: " + out
        self.err = r.stderr.decode("utf-8", "replace")
        self.calls = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []
        self.called = sorted(c["checker"] for c in self.calls)


def run(root: Path, payload, *, mode: str = "", raw: bytes | None = None) -> Result:
    log = root / "calls.log"
    if log.exists():
        log.unlink()
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(root), "FAKE_LOG": str(log), "FAKE_MODE": mode}
    env.pop("PYTHONIOENCODING", None)
    data = raw if raw is not None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    r = subprocess.run([sys.executable, str(root / ".claude" / "hooks" / "dispatch-architecture.py")],
                       input=data, capture_output=True, env=env)
    return Result(r, log)


def write(path: str, body: str = "x") -> dict:
    return {"tool_input": {"file_path": path, "content": body}}


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="dispatcher-test-") as td:
        tmp = Path(td)
        root = make_project(tmp / "p")

        # ---------------- 振り分け ----------------
        r = run(root, write("alpha/app/x.py", "VIOLATION"))
        check("alpha の編集は alpha のチェッカーだけを呼び、deny に [alpha] が付く",
              r.rc == 0 and r.called == ["check-alpha.py"] and r.deny and r.deny.startswith("[alpha]")
              and "check-alpha.py says no" in r.deny)
        r = run(root, write("beta/src/a.ts", "VIOLATION"))
        check("beta の編集は beta のチェッカーだけ（互いに誤爆しない）",
              r.called == ["check-beta.py"] and r.deny and r.deny.startswith("[beta]"))
        r = run(root, write("beta/src/a.ts", "fine"))
        check("違反が無ければ deny は出ない（呼ばれはする）", r.rc == 0 and r.deny is None and r.called == ["check-beta.py"])
        r = run(root, write("elsewhere/x.py", "VIOLATION"))
        check("どの規則にも当たらないパスは検査しない（『迷ったら全部』にしない）",
              r.rc == 0 and r.called == [] and r.deny is None and r.err == "")
        r = run(root, write("docs/a.md", "VIOLATION"))
        check("stacks = [] の規則は検査しない", r.called == [] and r.deny is None)
        r = run(root, write(".github/workflows/ci.yml", "VIOLATION"))
        check("['*'] の規則も検査しない（全 stack のチェッカーを呼ばない）", r.called == [] and r.deny is None)
        r = run(root, write("gamma/x.py", "VIOLATION"))
        check("checker を宣言していない stack は何も呼ばない（落とさない）", r.rc == 0 and r.called == [] and r.deny is None)

        # ---------------- パスの表記 ----------------
        r = run(root, write("alpha\\app\\x.py", "VIOLATION"))
        check("Windows の区切り \\ でも同じ", r.called == ["check-alpha.py"] and r.deny)
        abs_path = str(root / "alpha" / "app" / "x.py")
        r = run(root, write(abs_path, "VIOLATION"))
        check("絶対パスは案件のルートからの相対にして判定する", r.called == ["check-alpha.py"] and r.deny)
        r = run(root, write(str(tmp / "other-project" / "alpha" / "x.py"), "VIOLATION"))
        check("別の場所の同名ディレクトリ（案件の外）は検査しない", r.called == [] and r.deny is None)
        r = run(root, {"tool_input": {"file": "alpha/x.py", "content": "VIOLATION"}})
        check("file_path でなく file の欄でも拾う", r.called == ["check-alpha.py"])
        r = run(root, {"tool_input": {"file_path": "alpha/x.py", "edits": [{"new_string": "VIOLATION"}]}})
        check("MultiEdit の edits[] もそのまま渡る", r.called == ["check-alpha.py"] and r.deny)

        # ---------------- Bash / PowerShell ----------------
        r = run(root, {"tool_input": {"command": "cd alpha && python gen.py"}})
        check("Bash: cd alpha（末尾の / が無い語）でも alpha を拾う", r.called == ["check-alpha.py"])
        r = run(root, {"tool_input": {"command": "cat alpha/a.py beta/b.py"}})
        check("Bash: 2 つの stack を触るコマンドは両方のチェッカーを呼ぶ", r.called == ["check-alpha.py", "check-beta.py"])
        r = run(root, {"tool_input": {"command": f'echo "x" > {abs_path.replace(chr(92), "/")}'}})
        check("Bash: 絶対パスも拾う", r.called == ["check-alpha.py"])
        r = run(root, {"tool_input": {"command": "pnpm build"}})
        check("Bash: パスの語が無いコマンドは検査しない", r.called == [] and r.deny is None)
        r = run(root, {"tool_input": {"command": "ls docs/"}})
        check("Bash: stacks = [] のパスだけなら検査しない", r.called == [])
        r = run(root, {"tool_input": {"command": "Set-Content alpha\\x.py 'VIOLATION'"}})
        check("PowerShell のコマンド（Bash と同じ入力の形）も同じに扱う", r.called == ["check-alpha.py"] and r.deny)
        existing = root / "alpha" / "old.py"
        existing.parent.mkdir(parents=True, exist_ok=True)
        existing.write_text("old", encoding="utf-8")
        r = run(root, {"tool_input": {"command": "echo VIOLATION > alpha/old.py"}})
        check("Bash では既存/新規が分からないので、ラチェット対象の stack でも止める", r.deny is not None)

        # ---------------- ラチェット ----------------
        r = run(root, write(str(existing), "VIOLATION"))
        check("ラチェット: 既存ファイルは deny でなく警告（標準エラー）にして通す",
              r.rc == 0 and r.deny is None and "WARNING: [alpha]" in r.err and "says no" in r.err)
        r = run(root, write("alpha/brand_new.py", "VIOLATION"))
        check("ラチェット: 新規ファイルは止める", r.deny is not None)
        beta_existing = root / "beta" / "old.ts"
        beta_existing.parent.mkdir(parents=True, exist_ok=True)
        beta_existing.write_text("old", encoding="utf-8")
        r = run(root, write(str(beta_existing), "VIOLATION"))
        check("ラチェットを宣言していない stack は、既存ファイルでも止める", r.deny is not None)

        # ---------------- バイトのまま渡す（日本語） ----------------
        body = json.dumps({"tool_input": {"command": "echo 日本語のメモ VIOLATION > alpha/あ.py"}}, ensure_ascii=False)
        r = run(root, None, raw=body.encode("utf-8"))
        check("日本語を含む入力でも落ちず、チェッカーに渡るバイトは元と完全に同じ",
              r.rc == 0 and r.called == ["check-alpha.py"] and r.deny
              and r.calls[0]["sha"] == hashlib.sha256(body.encode("utf-8")).hexdigest())

        # ---------------- 決められないとき（黙って通さず、止めもしない） ----------------
        r = run(root, write("alpha/a.py"), raw=b"{ not json")
        check("壊れた入力は何もせず rc=0", r.rc == 0 and r.deny is None and r.called == [])
        r = run(root, {"tool_input": {"content": "x"}})
        check("パスもコマンドも無い入力は何もしない", r.rc == 0 and r.called == [])
        r = run(root, write("alpha/a.py", "VIOLATION"), mode="garbage")
        check("チェッカーの出力が JSON でなければ、目に見える警告を出して通す（deny にも沈黙にもしない）",
              r.rc == 0 and r.deny is None and "読めない" in r.err and "alpha" in r.err)
        r = run(root, write("alpha/a.py", "VIOLATION"), mode="crash")
        check("チェッカーが落ちても、その stderr を見せて dispatcher は rc=0", r.rc == 0 and "boom" in r.err)
        shutil.move(str(root / ".claude" / "hooks" / "check-beta.py"), str(root / "check-beta.moved"))
        r = run(root, write("beta/a.ts", "VIOLATION"))
        check("宣言したチェッカーが無ければ、警告を出して通す（黙って成功にしない）。rc=0",
              r.rc == 0 and r.deny is None and "check-beta.py" in r.err and "検査していません" in r.err)
        shutil.move(str(root / "check-beta.moved"), str(root / ".claude" / "hooks" / "check-beta.py"))

        broken = make_project(tmp / "broken", routes="[stack.alpha\n")
        r = run(broken, write("alpha/a.py", "VIOLATION"))
        check("routes.toml が壊れていれば rc=1（ブロックしない失敗）で、理由を出す。deny にはしない",
              r.rc == 1 and r.deny is None and "検査していません" in r.err and r.called == [])
        norouts = make_project(tmp / "noroutes", routes=None)
        r = run(norouts, write("alpha/a.py", "VIOLATION"))
        check("routes.toml が無ければ rc=1 で理由を出す（rc=2 にしない）", r.rc == 1 and "routes.toml" in r.err)
        nosr = make_project(tmp / "nosr")
        (nosr / "scripts" / "stack_routes.py").unlink()
        r = run(nosr, write("alpha/a.py", "VIOLATION"))
        check("stack-routes 部品が無ければ rc=1 で、何を入れるかを出す",
              r.rc == 1 and "stack-routes" in r.err)
        check("設定の不備では終了コード 2 を使わない（2 は編集そのものを止める）",
              all(x.rc != 2 for x in (run(broken, write("alpha/a.py")), run(norouts, write("alpha/a.py")))))

        # ---------------- 案件固有の規則 ----------------
        local = make_project(tmp / "local")
        (local / ".claude" / "hooks" / "dispatch_local_rules.py").write_text(
            "def local_violations(tool_input, relative, stack):\n"
            "    return [f'local says no ({stack}:{relative})'] if 'LOCALBAD' in str(tool_input) else []\n",
            encoding="utf-8")
        r = run(local, write("beta/a.ts", "LOCALBAD"))
        check("案件固有の規則: 名指しされた stack の編集に呼ばれ、理由に stack 名が付く",
              r.deny and "[beta]" in r.deny and "local says no (beta:beta/a.ts)" in r.deny)
        r = run(local, write("beta/a.ts", "VIOLATION LOCALBAD"))
        check("案件固有の規則とチェッカーの理由は両方出る", r.deny and "check-beta.py says no" in r.deny and "local says no" in r.deny)
        r = run(local, {"tool_input": {"command": "cat beta/a.ts LOCALBAD"}})
        check("案件固有の規則は Bash / PowerShell では呼ばない", r.deny is None)
        r = run(local, write("elsewhere/a.ts", "LOCALBAD"))
        check("案件固有の規則も、名指しされていないパスには呼ばない", r.deny is None)
        (local / ".claude" / "hooks" / "dispatch_local_rules.py").write_text(
            "def local_violations(tool_input, relative, stack):\n    raise RuntimeError('bad rule')\n", encoding="utf-8")
        r = run(local, write("beta/a.ts", "x"))
        check("案件固有の規則が例外を投げたら、黙って通さず rc≠0 で落ちて見える（rc=2 にはしない）",
              r.rc not in (0, 2) and "bad rule" in r.err)
        ex = HERE.parent / "examples" / "dispatch_local_rules.py.example"
        if ex.is_file():
            shutil.copy2(ex, local / ".claude" / "hooks" / "dispatch_local_rules.py")
            r = run(local, write("beta/zzz/a.ts", "x"))
            check("同梱の見本は stack が合わなければ何もしない", r.rc == 0 and r.deny is None)

        # ---------------- 取り込み（配布元でだけ） ----------------
        if not BOOTSTRAP.is_file():
            print("SKIP bootstrap.py が無い（配布先）ので、取り込みの試験は配布元で行う")
        else:
            proj = tmp / "installed"
            proj.mkdir()
            env = {k: v for k, v in os.environ.items() if k != "AIDOCS_TOOLS_DIR"}

            def boot(*args: str) -> subprocess.CompletedProcess:
                return subprocess.run([sys.executable, str(BOOTSTRAP), "--tools-only", "--dest", str(proj), *args],
                                      capture_output=True, env=env)

            r = boot("--with-tools", "dispatcher")
            check("dispatcher だけを取ろうとすると、依存の stack-routes が無いので止まる（自動では足さない）",
                  r.returncode == 1 and b"stack-routes" in (r.stdout + r.stderr))
            r = boot("--with-tools", "stack-routes,dispatcher")
            check("stack-routes と一緒なら入る", r.returncode == 0 and (proj / ".claude" / "hooks" / "dispatch-architecture.py").is_file())
            settings = json.loads((proj / ".claude" / "settings.json").read_text(encoding="utf-8"))
            matchers = sorted(e["matcher"] for e in settings["hooks"]["PreToolUse"])
            check("6 つの matcher（Bash・PowerShell・Write・Edit・MultiEdit・NotebookEdit）に配線される",
                  matchers == sorted(["Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit"]))
            before = (proj / ".claude" / "settings.json").read_bytes()
            boot("--with-tools", "stack-routes,dispatcher")
            check("2 回目は settings がバイト同一（hook が重ならない）", (proj / ".claude" / "settings.json").read_bytes() == before)
            command = settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
            sh = shutil.which("sh")
            if sh:
                empty = tmp / "nohook"
                empty.mkdir()
                res = subprocess.run([sh, "-c", command], env={**os.environ, "CLAUDE_PROJECT_DIR": str(empty)},
                                     capture_output=True)
                check("配線: hook のファイルが無いツリーでも rc=0 で、無いことを標準エラーに出す（シェルごと死なない）",
                      res.returncode == 0 and b"dispatch-architecture.py" in res.stderr)

    print("FAILURES:", FAILURES)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
