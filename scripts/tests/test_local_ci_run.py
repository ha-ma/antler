#!/usr/bin/env python3
"""local-ci.py（G-1b: 検査の実行・木ごと停止・枠・再入禁止）の自己テスト。

Run: python tools/local-ci/tests/test_local_ci_run.py

合成したリポジトリで**本物の CLI を走らせ、検査を実際に回し、記録を作り、--status と
pre-push が読むところまで**を踏む。枠は本物のプロセスを kill -9 / taskkill /F で殺して戻るかを見る。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import test_local_ci as base  # noqa: E402  合成リポジトリの組み立てを共有する

lc = base.lc
FAILURES = 0


def check(desc: str, ok: bool) -> None:
    global FAILURES
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), desc)


def clean_env(**extra: str) -> dict:
    """このテスト自体が local-ci の検査として走っていても、子の起動が入れ子に見えないようにする。"""
    env = {k: v for k, v in os.environ.items() if k != lc.SELFTEST_DEPTH_ENV}
    env.update(extra)
    return env


def cli(root: Path, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(root / "scripts" / "local-ci.py"), *args],
                          cwd=str(root), capture_output=True, env=env or clean_env())


def toml_checks(checks: list[dict]) -> str:
    """JSON の配列・表・真偽値・数・文字列はそのまま TOML として読める。"""
    out = []
    for c in checks:
        out.append("[[check]]")
        for k, v in c.items():
            if isinstance(v, dict):  # JSON の表は TOML ではないので、インライン表で書く
                inner = ", ".join(f"{ik} = {json.dumps(iv, ensure_ascii=False)}" for ik, iv in v.items())
                out.append(f"{k} = {{ {inner} }}")
            else:
                out.append(f"{k} = {json.dumps(v, ensure_ascii=False)}")
        out.append("")
    return "\n".join(out)


def set_checks(root: Path, checks: list[dict]) -> None:
    base.write(root / "local_ci_checks.toml", base.CONFIG + "\n" + toml_checks(checks))
    base.git(root, "add", "-A")
    base.git(root, "commit", "-q", "-m", "checks")


def py(code: str) -> list:
    return ["{PYTHON}", "-c", code]


def row_of(root: Path, name_part: str) -> dict:
    rec_files = sorted((root / lc.STATE_REL).glob("*.json"), key=lambda p: p.stat().st_mtime)
    rows = json.loads(rec_files[-1].read_text(encoding="utf-8"))["checks"]
    return next(r for r in rows if name_part in r["name"])


def pid_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(h)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def wait_until(pred, seconds: float = 8.0) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.1)
    return pred()


HOLDER = '''
import importlib.util, sys, time
from pathlib import Path
spec = importlib.util.spec_from_file_location("lc", sys.argv[1])
lc = importlib.util.module_from_spec(spec); sys.modules["lc"] = lc; spec.loader.exec_module(lc)
slot = lc.acquire_slot(int(sys.argv[3]), wait=5, directory=Path(sys.argv[2]), poll=0.1)
print("held", slot.index, flush=True)
time.sleep(120)
'''


def start_holder(directory: Path, n: int) -> subprocess.Popen:
    script = directory.parent / "holder.py"
    script.write_text(HOLDER, encoding="utf-8")
    p = subprocess.Popen([sys.executable, str(script), str(base.SRC), str(directory), str(n)],
                         stdout=subprocess.PIPE, env=clean_env())
    assert p.stdout is not None and p.stdout.readline().startswith(b"held")
    return p


def hard_kill(p: subprocess.Popen) -> None:
    """異常終了を再現する: Windows は taskkill /F、それ以外は kill -9。"""
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/PID", str(p.pid)], capture_output=True)
    else:
        p.kill()
    p.wait()


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="local-ci-run-") as td:
        tmp = Path(td)
        os.environ.pop(lc.SELFTEST_DEPTH_ENV, None)

        # ================= 通し: 回す → 記録 → --status OK → 差分を変えると失効 =================
        r = base.make_repo(tmp / "e2e")
        set_checks(r, [
            {"name": "build", "stack": "app", "cmd": py("print('built {BASE_SHA}')")},
            {"name": "shared", "stack": "common", "cmd": py("print('common ok')")},
            {"name": "other", "stack": "web", "cmd": py("print('other stack')")},
        ])
        res = cli(r)
        out = base.text(res)
        check("検査を実際に回すと rc=0", res.returncode == 0)
        check("比較元の sha が {BASE_SHA} に差し込まれる",
              base.git(r, "rev-parse", "origin/main").stdout.decode().strip() in out)
        check("記録ができて、その場の判定が OK", "記録   :" in out and "判定   : OK" in out)
        check("--status が OK を返す（rc=0）", cli(r, "--status").returncode == 0)
        rows = json.loads(next((r / lc.STATE_REL).glob("*.json")).read_text(encoding="utf-8"))["checks"]
        check("記録に回した検査の行が全部ある（common と全 stack）",
              sorted(x["name"] for x in rows) == ["app: build", "common: shared", "web: other"])
        res = base.push(r, "feat")
        check("回した直後の push は通る（裸のリポジトリ相手）", res.returncode == 0)
        base.commit_file(r, "feature.txt", "changed\n", "diff changes")
        res = cli(r, "--status")
        check("差分を変える（コミットを足す）と --status は失効して rc=1", res.returncode == 1 and "記録が無い" in base.text(res))
        check("失効した状態の push は止まる", base.push(r, "feat").returncode != 0)
        res = cli(r)
        check("回し直すと rc=0 で、--status が再び OK", res.returncode == 0 and cli(r, "--status").returncode == 0)
        base.git(r, "commit", "-q", "--amend", "-m", "言い直し")
        check("中身が同じ amend では記録が生きている", cli(r, "--status").returncode == 0)

        res = cli(r, "--stacks", "web")
        check("--stacks で絞ると、その stack と common だけ回る",
              res.returncode == 0 and "other stack" in base.text(res) and "built" not in base.text(res))
        res = cli(r, "--stacks", "nope")
        check("一覧に無い stack の指定は rc=2", res.returncode == 2 and "一覧に無い" in base.text(res))
        n_before = len(list((r / lc.STATE_REL).glob("*.json")))
        res = cli(r, "--plan")
        check("--plan は回さず記録も作らない",
              res.returncode == 0 and "app: build" in base.text(res) and "built" not in base.text(res)
              and len(list((r / lc.STATE_REL).glob("*.json"))) == n_before)
        set_checks(r, [{"name": "build", "stack": "app", "cmd": py("print('weaker')")}])
        check("検査の一覧を変える（コミットする）と記録は失効する", cli(r, "--status").returncode == 1)

        # ================= 失敗・見送り・必須でない見送り =================
        r = base.make_repo(tmp / "fail")
        set_checks(r, [{"name": "boom", "stack": "app", "cmd": py("import sys; print('oops'); sys.exit(3)"),
                        "hint": "直し方のヒント"}])
        res = cli(r)
        rec_ok = cli(r, "--status")
        check("検査が落ちれば rc=1 で、記録は『落ちた』として残り、--status も rc=1",
              res.returncode == 1 and rec_ok.returncode == 1 and row_of(r, "boom")["status"] == "fail"
              and row_of(r, "boom")["code"] == 3)
        check("落ちた行に出力の末尾とヒントが残る", "oops" in row_of(r, "boom")["tail"] and "ヒント" in row_of(r, "boom")["reason"])
        check("落ちた記録では push が止まる", base.push(r, "feat").returncode != 0)

        r = base.make_repo(tmp / "skip")
        set_checks(r, [{"name": "needs-tool", "stack": "app", "cmd": py("print(1)"),
                        "needs": "no-such-tool-xyz", "hint": "xyz を入れる"},
                       {"name": "good", "stack": "app", "cmd": py("print(1)")}])
        res = cli(r)
        check("必須の検査の道具が無ければ見送り → rc=1（通ったことにしない）。ヒントを出す",
              res.returncode == 1 and row_of(r, "needs-tool")["status"] == "skipped"
              and "xyz を入れる" in base.text(res))
        check("見送りを含む記録は --status で NG", cli(r, "--status").returncode == 1 and "見送った" in base.text(cli(r, "--status")))
        res = cli(r, "--ci")
        check("--ci では必須の見送りが fail になり rc=1（手元の甘さを持ち込まない）",
              res.returncode == 1 and "見送れない" in base.text(res))
        check("--ci は記録を作らない", len(list((r / lc.STATE_REL).glob("*.json"))) == 1)  # 手元の 1 本だけ

        r = base.make_repo(tmp / "opt")
        set_checks(r, [{"name": "optional", "stack": "app", "cmd": py("print(1)"), "needs": "no-such-tool-xyz",
                        "required": False},
                       {"name": "good", "stack": "app", "cmd": py("print(1)")}])
        res = cli(r)
        check("必須でない見送りは通す（rc=0）が、件数を判定に出す",
              res.returncode == 0 and "必須でない見送り 1" in base.text(res))

        r = base.make_repo(tmp / "probe")
        set_checks(r, [{"name": "dep-bad", "stack": "app", "cmd": py("print(1)"),
                        "needs_probe": py("import sys; sys.exit(1)")},
                       {"name": "dep-ok", "stack": "app", "cmd": py("print(1)"),
                        "needs_probe": py("pass")}])
        res = cli(r)
        check("依存の確認が通らなければ見送り、通れば回る",
              row_of(r, "dep-bad")["status"] == "skipped" and row_of(r, "dep-ok")["status"] == "pass")

        r = base.make_repo(tmp / "pre")
        set_checks(r, [{"name": "prep", "stack": "app", "cmd": py("print('main ran')"),
                        "pre": [["下ごしらえ", py("import sys; sys.exit(5)")]]}])
        res = cli(r)
        check("下ごしらえの失敗は見送りでなく fail（本体は回らない）",
              res.returncode == 1 and row_of(r, "prep")["status"] == "fail" and "main ran" not in base.text(res))

        r = base.make_repo(tmp / "scope")
        other = "linux" if sys.platform == "win32" else "windows"
        set_checks(r, [{"name": "other-os", "stack": "app", "cmd": py("import sys; sys.exit(9)"), "os": [other]},
                       {"name": "local-only", "stack": "app", "cmd": py("import sys; sys.exit(9)"), "ci": False},
                       {"name": "good", "stack": "app", "cmd": py("print(1)")}])
        res = cli(r, "--ci")
        check("--ci: OS が違う検査・ci=false の検査は out_of_scope（回さず、落とさない）",
              res.returncode == 0)
        res = cli(r)
        check("手元: OS が違う検査は out_of_scope で理由つき、ci=false は回る",
              row_of(r, "other-os")["status"] == "out_of_scope" and row_of(r, "local-only")["status"] == "fail")

        # ================= 一覧の形 =================
        r = base.make_repo(tmp / "bad")
        set_checks(r, [{"name": "x", "stack": "app", "cmd": py("1"), "tiemout": 5}])
        res = cli(r)
        check("未知の欄（綴りの誤り）は黙って無視せず rc=2", res.returncode == 2 and "tiemout" in base.text(res))
        set_checks(r, [{"name": "x", "stack": "app", "cmd": py("1")}, {"name": "x", "stack": "app", "cmd": py("1")}])
        check("同じ stack の同じ名前は rc=2", cli(r).returncode == 2)
        set_checks(r, [{"name": "x", "stack": "app", "cmd": "not a list"}])
        check("cmd が配列でなければ rc=2", cli(r).returncode == 2)
        set_checks(r, [{"name": "x", "stack": "app", "cwd": "../escape", "cmd": py("1")}])
        check("cwd が案件の外へ抜けるなら rc=2", cli(r).returncode == 2)

        # ================= 時間切れは木ごと止める =================
        r = base.make_repo(tmp / "tree")
        pidfile = (r / "gc.pid").as_posix()
        grandchild = ("import subprocess,sys,time;"
                      "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']);"
                      f"open({pidfile!r},'w').write(str(p.pid));time.sleep(120)")
        base.write(r / ".gitignore", (r / ".gitignore").read_text(encoding="utf-8") + "gc.pid\n")
        set_checks(r, [{"name": "hang", "stack": "app", "cmd": py(grandchild), "timeout": 3}])
        t0 = time.time()
        res = cli(r)
        gc_pid = int((r / "gc.pid").read_text())
        check("時間切れは status=timeout・rc=1 で、制限時間のあたりで返る",
              res.returncode == 1 and row_of(r, "hang")["status"] == "timeout" and time.time() - t0 < 60)
        check("時間切れで孫プロセスも残らない（親だけ止めない）", wait_until(lambda: not pid_alive(gc_pid)))
        if pid_alive(gc_pid):
            subprocess.run(["taskkill", "/F", "/PID", str(gc_pid)] if os.name == "nt" else ["kill", "-9", str(gc_pid)],
                           capture_output=True)

        # ================= 子の環境 =================
        r = base.make_repo(tmp / "env")
        set_checks(r, [{"name": "enc", "stack": "app",
                        "cmd": py("import os,sys; sys.exit(1 if 'PYTHONIOENCODING' in os.environ else 0)")}])
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True,
                             env=clean_env(PYTHONIOENCODING="utf-8"))
        rec = json.loads(next((r / lc.STATE_REL).glob("*.json")).read_text(encoding="utf-8"))
        check("文字コードの変数は既定で子へ渡さない（親に付いていても）。記録は inherit_encoding=false",
              res.returncode == 0 and rec["inherit_encoding"] is False)
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py"), "--inherit-encoding"],
                             cwd=str(r), capture_output=True, env=clean_env(PYTHONIOENCODING="utf-8"))
        check("--inherit-encoding のときだけ渡る（子が落ちる）", res.returncode == 1)
        set_checks(r, [{"name": "enc", "stack": "app", "cmd": py("import os; print(os.environ.get('KEEP'), os.environ.get('DROPME'))"),
                        "env": {"KEEP": "yes"}, "env_drop": ["DROP*"]}])
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True,
                             env=clean_env(DROPME="x"))
        check("env_drop（末尾 * は前方一致）で外し、検査の env は残る", b"yes None" in res.stdout)

        # ================= 出力はバイトで受けて utf-8 → cp932 =================
        r = base.make_repo(tmp / "dec")
        set_checks(r, [{"name": "cp", "stack": "app",
                        "cmd": py("import sys; sys.stdout.buffer.write('日本語の失敗'.encode('cp932')); sys.exit(1)")},
                       {"name": "u8", "stack": "app",
                        "cmd": py("import sys; sys.stdout.buffer.write('漢字の失敗'.encode('utf-8')); sys.exit(1)")}])
        cli(r)
        check("cp932 で出した失敗の末尾を復号して残す", "日本語の失敗" in row_of(r, "cp")["tail"])
        check("utf-8 で出した失敗の末尾を復号して残す", "漢字の失敗" in row_of(r, "u8")["tail"])
        check("復号の関数: 壊れたバイト列でも例外にしない", isinstance(lc.decode_output(b"\xff\xfe\x00bad"), str))

        # ================= 汚れの関門（検査の途中） =================
        r = base.make_repo(tmp / "art")
        set_checks(r, [{"name": "gen", "stack": "app", "cmd": py("open('artifact.out','w').write('x')")}])
        res = cli(r)
        no_record = not (r / lc.STATE_REL).exists() or not list((r / lc.STATE_REL).glob("*.json"))
        check("検査が無視されていない生成物を残したら記録を作らず、ファイル名つきで rc=1",
              res.returncode == 1 and "artifact.out" in base.text(res) and no_record)

        # ================= 自己再入の禁止 =================
        r = base.make_repo(tmp / "re")
        marker = (r / "ran.marker").as_posix()
        base.write(r / ".gitignore", (r / ".gitignore").read_text(encoding="utf-8") + "ran.marker\n")
        set_checks(r, [{"name": "m", "stack": "app", "cmd": py(f"open({marker!r},'w').write('x')")}])
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True,
                             env=clean_env(LOCAL_CI_SELFTEST_DEPTH="1"))
        check("入れ子（深さ 1）の起動は rc=1・理由が出る・検査は 1 本も回らない・記録も作らない",
              res.returncode == 1 and "入れ子" in base.text(res) and not (r / "ran.marker").exists()
              and not (r / lc.STATE_REL).exists())
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True,
                             env=clean_env(LOCAL_CI_SELFTEST_DEPTH="abc"))
        check("壊れた値は『入れ子ではない』に倒す（拒否に倒すと素通りになるため）。検査が回る",
              res.returncode == 0 and (r / "ran.marker").exists())
        check("深さ 0 や空は入れ子ではない",
              lc.reentry_problem({}) is None and lc.reentry_problem({lc.SELFTEST_DEPTH_ENV: "0"}) is None)
        self_cmd = ["{PYTHON}", "scripts/local-ci.py", "--ci"]
        set_checks(r, [{"name": "selfref", "stack": "app", "cmd": self_cmd, "timeout": 60}])
        t0 = time.time()
        res = cli(r, "--ci")
        check("自分自身を回す検査があっても増殖しない（子は入れ子として拒否され、検査は fail で終わる）",
              res.returncode == 1 and "入れ子" in base.text(res) and time.time() - t0 < 60)

        probed = lc.run_probes(tmp, (("{PYTHON}", "-c", "import sys; print(sys.executable)"),))
        check("環境の確認コマンドの {PYTHON} は検査と同じ python に展開される（記録には宣言のまま残る）",
              probed[0]["cmd"][0] == "{PYTHON}" and probed[0]["rc"] == 0
              and os.path.samefile(probed[0]["out"], sys.executable))

        # ================= Windows の .cmd（npx / npm） =================
        bindir = tmp / "bin"
        bindir.mkdir()
        if os.name == "nt":
            (bindir / "mytool.cmd").write_bytes(b"@echo off\r\necho hello-%1\r\nexit /b 3\r\n")
            env_cmd = {**os.environ, "PATH": f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}"}
            rc, out = lc.run_streamed(["mytool", "world"], cwd=tmp, env=env_cmd, timeout=30, quiet=True)
            check("Windows: PATH 上の .cmd（npx のような物）を名前だけで起動でき、終了コードも返る",
                  rc == 3 and b"hello-world" in out)
            check("Windows: 見つからない名前はそのまま渡して『起動できない』を返す（rc=127）",
                  lc.run_streamed(["definitely-no-such-cmd-xyz"], cwd=tmp, env=env_cmd, timeout=30, quiet=True)[0] == 127)
        else:
            check("Windows 以外: コマンド名は書き換えない", lc.resolve_cmd(["npx", "tsc"]) == ["npx", "tsc"])

        # ================= 一覧の取り込み（include） =================
        def tree_of(name: str, files: dict[str, str]) -> Path:
            d = tmp / name
            for rel, body in files.items():
                base.write(d / rel, body)
            return d

        def raises(root: Path) -> str | None:
            try:
                lc.load_checks(root)
                return None
            except lc.Unusable as exc:
                return str(exc)

        frag = ('[stack]\nname = "api"\n[env]\ntool_probes = [["tool-a", "--version"]]\n'
                '[[check]]\nname = "unit"\ncmd = ["{PYTHON}", "-c", "print(1)"]\nneeds_path = "scripts/x.py"\n'
                'artifacts = ["out/log.txt"]\n')
        inc = tree_of("inc-ok", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["backend\\\\local_ci_checks.toml", '
                                                 '"web/local_ci_checks.toml"]\n'
                                                 '[env]\ntool_probes = [["root-tool"]]\n',
                                 "backend/local_ci_checks.toml": frag,
                                 "web/local_ci_checks.toml": frag.replace('"api"', '"web"')})
        got = lc.load_checks(inc)
        check("include: 2 つの stack の一覧を取り込む（Windows の区切り \\ も受ける）",
              sorted(c.label for c in got) == ["api: unit", "web: unit"])
        check("include: cwd・needs_path・artifacts が案件のルートからの相対に直る",
              {(c.cwd, c.needs_path, c.artifacts) for c in got} == {
                  ("backend", "backend/scripts/x.py", ("backend/out/log.txt",)),
                  ("web", "web/scripts/x.py", ("web/out/log.txt",))})
        check("include: 環境の確認コマンドは全部の一覧から集める",
              [list(p) for p in lc.load_config(inc).tool_probes] == [["root-tool"], ["tool-a", "--version"],
                                                                      ["tool-a", "--version"]])
        check("include: 環境の確認コマンドは、その一覧のフォルダで回す（ルートの物は \"\"）",
              lc.load_config(inc).probe_dirs == ("", "backend", "web"))
        # 受け入れ試験の発見: 取り込んだ stack の `npm ls` が案件のルートで回り、frontend/ の依存を見ていなかった
        (inc / "backend").mkdir(exist_ok=True)
        where_cmd = ("{PYTHON}", "-c", "import os; print(os.path.basename(os.getcwd()))")
        where = lc.run_probes(inc, (where_cmd, where_cmd), ("", "backend"))
        check("run_probes: dirs の指定のフォルダで回る（空は案件のルート）",
              [w["out"] for w in where] == ["inc-ok", "backend"])
        check("run_probes: ルートの probe の記録の形は変えない（cwd を足さない）。フォルダ付きだけ cwd を持つ",
              "cwd" not in where[0] and where[1].get("cwd") == "backend")

        a = tree_of("inc-cycle", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["a.toml"]\n',
                                  "a.toml": '[local_ci]\ninclude = ["b.toml"]\n',
                                  "b.toml": '[local_ci]\ninclude = ["a.toml"]\n'})
        check("include: 循環は止める", "2 度" in (raises(a) or ""))
        a = tree_of("inc-twice", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["a.toml", "a.toml"]\n', "a.toml": frag})
        check("include: 同じ一覧の二重取り込みは止める（検査が二重になるのを防ぐ）", "2 度" in (raises(a) or ""))
        a = tree_of("inc-deep", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["l1.toml"]\n',
                                 **{f"l{i}.toml": f'[local_ci]\ninclude = ["l{i + 1}.toml"]\n' for i in range(1, 6)},
                                 "l6.toml": frag})
        check("include: 深さに上限がある", "深い" in (raises(a) or ""))
        a = tree_of("inc-out", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["../outside.toml"]\n'})
        check("include: 案件の外へ抜けるパスは止める", "外へ抜ける" in (raises(a) or ""))
        a = tree_of("inc-missing", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["nope.toml"]\n'})
        check("include: 存在しないファイルは黙って飛ばさず止める", "が無い" in (raises(a) or ""))
        a = tree_of("inc-type", {lc.CHECKS_FILE: '[local_ci]\ninclude = "a.toml"\n'})
        check("include: 文字列（配列でない）は止める", "配列" in (raises(a) or ""))
        a = tree_of("inc-nostack", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["f.toml"]\n',
                                    "f.toml": '[[check]]\nname = "x"\ncmd = ["a"]\n'})
        check("include: stack も [stack] name も無い検査は止める", "stack" in (raises(a) or ""))
        a = tree_of("inc-escape", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["sub/f.toml"]\n',
                                   "sub/f.toml": '[stack]\nname = "s"\n[[check]]\nname = "x"\ncmd = ["a"]\ncwd = "../.."\n'})
        check("include: 取り込まれた一覧の cwd が案件の外へ抜けるなら止める", raises(a) is not None)
        a = tree_of("inc-base", {lc.CHECKS_FILE: '[local_ci]\nbase = "origin/main"\ninclude = ["f.toml"]\n',
                                 "f.toml": '[local_ci]\nbase = "origin/other"\n' + frag})
        check("include: base は root の一覧だけが決める", lc.load_config(a).base == "origin/main")
        a = tree_of("inc-dup", {lc.CHECKS_FILE: '[local_ci]\ninclude = ["f.toml", "g.toml"]\n', "f.toml": frag,
                                "g.toml": frag})
        check("include: 別の一覧が同じ stack の同じ名前の検査を持てば止める", "同じ名前" in (raises(a) or ""))

        # ================= 枠（OS のロック） =================
        sd = tmp / "slots" / "d"
        sd.mkdir(parents=True)
        holders = [start_holder(sd, 3) for _ in range(3)]
        try:
            check("枠は 3 本まで取れ、使用中を数えられる", lc.slots_in_use(3, sd) == 3)
            t0 = time.time()
            try:
                lc.acquire_slot(3, wait=1.0, directory=sd, poll=0.1, say=lambda *_: None)
                got = True
            except lc.SlotTimeout:
                got = False
            check("4 本目は待ち、上限で SlotTimeout（空きとして扱わない）", not got and time.time() - t0 >= 1.0)
            hard_kill(holders[0])
            s = lc.acquire_slot(3, wait=5.0, directory=sd, poll=0.1, say=lambda *_: None)
            check("1 本を kill -9 / taskkill /F で殺すと、枠が戻って取れる", s.index is not None)
            s.close()
            check("枠を返すと数が減る", lc.slots_in_use(3, sd) == 2)
        finally:
            for h in holders:
                if h.poll() is None:
                    hard_kill(h)
        check("全員いなくなれば使用中は 0", lc.slots_in_use(3, sd) == 0)

        check("workers: cpu 16・単独なら 8", lc.workers_for(1, cpu=16) == 8)
        check("workers: 他にも走っていれば 4 まで", lc.workers_for(2, cpu=16) == 4)
        check("workers: cpu 1・2 は 1", lc.workers_for(1, cpu=1) == 1 and lc.workers_for(1, cpu=2) == 1)

        # CLI: 枠が空かなければ待って、上限で rc=2。殺せば回る。子が枠を握り続けない
        r = base.make_repo(tmp / "cli-slot")
        gcfile = (r / "gc2.pid").as_posix()
        base.write(r / ".gitignore", (r / ".gitignore").read_text(encoding="utf-8") + "gc2.pid\n")
        set_checks(r, [{"name": "quick", "stack": "app",
                        "cmd": py("import subprocess,sys;"
                                  "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);"
                                  f"open({gcfile!r},'w').write(str(p.pid))")}])
        sd2 = tmp / "slots2" / "d"
        sd2.mkdir(parents=True)
        env = clean_env(LOCAL_CI_SLOTS_DIR=str(sd2), LOCAL_CI_MAX_CONCURRENT="1", LOCAL_CI_SLOT_WAIT="2")
        h = start_holder(sd2, 1)
        try:
            res = cli(r, env=env)
            check("枠が空かないと待ち、上限で rc=2・記録は作らない・『空き』扱いしない",
                  res.returncode == 2 and "空かなかった" in base.text(res) and not (r / lc.STATE_REL).exists())
            hard_kill(h)
            res = cli(r, env=env)
            check("保持者が異常終了すれば（枠が戻り）回って rc=0", res.returncode == 0)
        finally:
            if h.poll() is None:
                hard_kill(h)
        check("検査が残した孫が生きていても、local-ci が終われば枠は返っている（子へロックを継がせない）",
              lc.slots_in_use(1, sd2) == 0)
        gpid = int((r / "gc2.pid").read_text())
        if pid_alive(gpid):
            subprocess.run(["taskkill", "/F", "/PID", str(gpid)] if os.name == "nt" else ["kill", "-9", str(gpid)],
                           capture_output=True)

        # ================= 配る物 =================
        ex = HERE.parent / "local_ci_checks.toml.example"
        if ex.is_file():
            (tmp / "exroot").mkdir()
            (tmp / "exroot" / lc.CHECKS_FILE).write_bytes(ex.read_bytes())
            try:
                loaded = lc.load_checks(tmp / "exroot")
                check("一覧の雛形が load_checks を通る", len(loaded) >= 1 and loaded[0].hint != "")
            except lc.Unusable as exc:
                check(f"一覧の雛形が load_checks を通る: {exc}", False)
        src = base.SRC.read_text(encoding="utf-8")
        bad = sorted({hex(ord(ch)) for ch in src if not ch.encode("cp932", "ignore")})
        check(f"local-ci.py の全文字が cp932 で出せる（端末で本体が落ちない）: {bad}", not bad)
        out = subprocess.run([sys.executable, "-c",
                              "import importlib.util,sys;"
                              f"s=importlib.util.spec_from_file_location('m',{str(base.SRC)!r});"
                              "m=importlib.util.module_from_spec(s);sys.modules['m']=m;s.loader.exec_module(m);"
                              "sys.stdout.reconfigure(encoding='ascii');m.main(['--help'])"],
                             capture_output=True, env=clean_env())
        check("出せない文字があっても --help が落ちない（reconfigure(errors='replace')）",
              b"Traceback" not in out.stderr)

        # 差分なし
        r = base.make_repo(tmp / "nodiff")
        set_checks(r, [{"name": "x", "stack": "app", "cmd": py("print(1)")}])
        res = cli(r, "--base", "HEAD")
        check("差分が無ければ『回すものが無い』と言って rc=0（検査は回らず、記録も作らない）",
              res.returncode == 0 and "差分がありません" in base.text(res) and not (r / lc.STATE_REL).exists())

    print("FAILURES:", FAILURES)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
