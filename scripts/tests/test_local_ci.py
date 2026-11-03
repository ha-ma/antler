#!/usr/bin/env python3
"""local-ci.py（G-1a）の自己テスト。Run: python tools/local-ci/tests/test_local_ci.py

配布先では scripts/tests/test_local_ci.py として動く（local-ci.py は 1 つ上の階層、
pre-push は ../.githooks/ か、配布元では ../githooks/）。

合成したリポジトリに**本物を走らせ、終了コードまで踏む**。判定関数だけ見て満足しない
（検出はするが止めない、を許さない）。
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "local-ci.py"
HOOK = next(p for p in (HERE.parent / "githooks" / "pre-push", HERE.parent.parent / ".githooks" / "pre-push")
            if p.is_file())
FAILURES = 0

spec = importlib.util.spec_from_file_location("local_ci_under_test", SRC)
lc = importlib.util.module_from_spec(spec)
sys.modules["local_ci_under_test"] = lc
spec.loader.exec_module(lc)


def check(desc: str, ok: bool) -> None:
    global FAILURES
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), desc)


def git(root: Path, *args: str, ok: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True)
    if ok and r.returncode != 0:
        raise RuntimeError(f"git {args} -> {r.returncode}: {r.stderr.decode('utf-8', 'replace')}")
    return r


def text(r: subprocess.CompletedProcess) -> str:
    # 子の出力は Windows では cp932、他では UTF-8。バイトで受けて両方で復号する
    raw = r.stdout + r.stderr
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp932", "replace")


def write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body.encode("utf-8"))


PROBE_FILE = "v.txt"  # .gitignore 済み。中身を変えても作業ツリーは汚れない
CONFIG = (
    '[local_ci]\nbase = "origin/main"\n[env]\n'
    f'tool_probes = [["{Path(sys.executable).as_posix()}", "-c", "print(open(\'{PROBE_FILE}\').read())"]]\n'
)


def make_repo(tmp: Path, *, ignore_state: bool = True, config: bool = True) -> Path:
    """origin（bare）に main を押した作業用リポジトリ。feat は main から 1 コミット進んでいる。"""
    remote, root = tmp / "remote.git", tmp / "work"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    root.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(root)], check=True)
    git(root, "config", "user.email", "t@example.invalid")
    git(root, "config", "user.name", "t")
    git(root, "config", "core.autocrlf", "false")
    git(root, "remote", "add", "origin", str(remote))
    write(root / ".gitignore", (".claude/state/\n" if ignore_state else "") + f"{PROBE_FILE}\n")
    write(root / PROBE_FILE, "1\n")
    write(root / "a.txt", "a\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    git(root, "push", "-q", "origin", "main")  # フック前なので記録は要らない。origin/main ができる
    git(root, "switch", "-q", "-c", "feat")
    write(root / "scripts" / "local-ci.py", SRC.read_text(encoding="utf-8"))
    db_module = SRC.parent / "local_ci_db.py"
    if db_module.is_file():  # 確認つき DB 作り直しの部品。同じフォルダに置く約束
        write(root / "scripts" / "local_ci_db.py", db_module.read_text(encoding="utf-8"))
    write(root / ".githooks" / "pre-push", HOOK.read_bytes().decode("utf-8"))
    # Linux / macOS では実行権限が無いと git が hook を黙って無視し、『止まる』試験が全部すり抜ける（Windows では不要）
    (root / ".githooks" / "pre-push").chmod(0o755)
    if config:
        write(root / "local_ci_checks.toml", CONFIG)
    write(root / "feature.txt", "f1\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "feature")
    git(root, "config", "core.hooksPath", ".githooks")
    return root


def head(root: Path) -> str:
    return git(root, "rev-parse", "HEAD").stdout.decode().strip()


def record(root: Path, rows=None, probes=None, sha: str | None = None) -> Path:
    cfg = lc.load_config(root)
    t = lc.target_for(root, sha or head(root), cfg.base)
    rows = rows if rows is not None else [{"name": "t", "status": "pass", "required": True}]
    probes = lc.run_probes(root, cfg.tool_probes) if probes is None else probes
    return lc.write_record(root, t, rows, probes)


def push(root: Path, *refspecs: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    return subprocess.run(["git", "-C", str(root), "push", "origin", *refspecs], capture_output=True, env=env)


def commit_file(root: Path, name: str, body: str, msg: str) -> None:
    write(root / name, body)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", msg)


def cli(root: Path, *args: str, stdin: bytes = b"") -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(root / "scripts" / "local-ci.py"), *args],
                          cwd=str(root), input=stdin, capture_output=True)


def main() -> int:
    # ---------------- record_is_ok の分岐（リポジトリ不要）----------------
    B, T = "b" * 40, "t" * 40
    good = {"schema": 1, "base_sha": B, "head_tree": T, "verdict": "pass",
            "checks": [{"name": "x", "status": "pass"}], "env_fingerprint": None, "env": {}}

    def ok_of(rec, probes=None):
        return lc.record_is_ok(rec, base_sha=B, head_tree=T, now_probes=probes)

    def variant(**kw):
        r = json.loads(json.dumps(good))
        r.update(kw)
        return r

    check("記録が無い → NG", ok_of(None) == (False, "記録が無い"))
    check("全部 pass → OK", ok_of(good)[0])
    check("別の比較元 → NG", not ok_of(variant(base_sha="c" * 40))[0])
    check("別のツリー → NG", not ok_of(variant(head_tree="u" * 40))[0])
    check("fail の行 → NG（verdict が pass でも通さない）",
          not ok_of(variant(checks=[{"name": "x", "status": "fail"}]))[0])
    check("verdict が行と食い違う → NG",
          "食い違う" in ok_of(variant(verdict="fail"))[1])
    check("verdict を pass と偽った fail 行は NG",
          not ok_of(variant(verdict="pass", checks=[{"name": "x", "status": "timeout"}]))[0])
    inc = variant(verdict="incomplete", checks=[{"name": "x", "status": "skipped", "required": True}])
    check("必須の検査の見送り（incomplete）→ NG", not ok_of(inc)[0] and "見送った" in ok_of(inc)[1])
    opt = variant(checks=[{"name": "x", "status": "pass"}, {"name": "y", "status": "skipped", "required": False}])
    check("必須でない見送りは通す（件数を出す）", ok_of(opt)[0] and "見送り 1" in ok_of(opt)[1])
    oos = variant(checks=[{"name": "x", "status": "pass"}, {"name": "y", "status": "out_of_scope"}])
    check("対象外は通す（件数を出す）", ok_of(oos)[0] and "対象外 1" in ok_of(oos)[1])
    check("行が 0 本の記録は NG（何も回していない緑）", not ok_of(variant(checks=[]))[0])
    check("行が壊れている → NG", not ok_of(variant(checks=["x"]))[0])
    check("verdict fail の記録 → NG", not ok_of(variant(verdict="fail", checks=[{"name": "x", "status": "fail"}]))[0])
    check("環境の指紋: 同じなら OK", ok_of(*(lambda p: (variant(env_fingerprint=lc.fingerprint_of(p), env={"probes": p}), p))(
        [{"cmd": ["t"], "rc": 0, "out": "1"}]))[0])
    p1, p2 = [{"cmd": ["t"], "rc": 0, "out": "1"}], [{"cmd": ["t"], "rc": 0, "out": "2"}]
    rec_env = variant(env_fingerprint=lc.fingerprint_of(p1), env={"probes": p1})
    check("環境の指紋: 版が違えば NG（push を止める）", not ok_of(rec_env, p2)[0] and "手元の環境" in ok_of(rec_env, p2)[1])
    check("環境の指紋: 記録に無く今は宣言がある → NG", not ok_of(good, p1)[0])
    check("環境の指紋: 記録にあり今は宣言が無い → NG", not ok_of(rec_env, [])[0])
    check("環境の指紋: 宣言がどちらにも無ければ照合しない", ok_of(good, [])[0])

    with tempfile.TemporaryDirectory(prefix="local-ci-test-") as td:
        tmp = Path(td)

        # ---------------- 鍵 ----------------
        r1 = make_repo(tmp / "k")
        t1 = lc.target_for(r1, head(r1), "origin/main")
        check("差分があれば鍵ができる", t1.digest is not None and len(t1.digest) == 16)
        a = lc.digest_of("d", head_tree="t1", base_sha="b1")
        check("鍵は head_tree で動く", a != lc.digest_of("d", head_tree="t2", base_sha="b1"))
        check("鍵は base_sha で動く", a != lc.digest_of("d", head_tree="t1", base_sha="b2"))
        check("鍵は差分で動く", a != lc.digest_of("e", head_tree="t1", base_sha="b1"))
        git(r1, "commit", "-q", "--amend", "-m", "同じ中身で言い直した")
        t1b = lc.target_for(r1, head(r1), "origin/main")
        check("中身が同じ amend では鍵が動かない（commit sha でなく tree）",
              t1b.digest == t1.digest and t1b.sha != t1.sha)
        git(r1, "switch", "-q", "main")
        check("差分が無ければ digest は None", lc.target_for(r1, head(r1), "origin/main").digest is None)
        try:
            lc.target_for(r1, head(r1), "origin/nope")
            check("解決できない比較元は止まる", False)
        except lc.Unusable:
            check("解決できない比較元は止まる（『差分なし』にしない）", True)
        r = cli(make_repo(tmp / "u"), "--status", "--base", "origin/nope")
        check("解決できない比較元: CLI は rc=2", r.returncode == 2 and "解決できません" in text(r))

        # ---------------- 汚れの関門 ----------------
        r2 = make_repo(tmp / "d")
        check("きれいなら汚れ 0 件", lc.worktree_dirt(r2) == [])
        write(r2 / "a.txt", "changed\n")
        check("追跡ファイルの変更を数える", len(lc.worktree_dirt(r2)) == 1)
        git(r2, "checkout", "--", "a.txt")
        write(r2 / "untracked.txt", "x\n")
        check("未追跡ファイルも数える", len(lc.worktree_dirt(r2)) == 1)
        os.remove(r2 / "untracked.txt")
        write(r2 / PROBE_FILE, "ignored change\n")
        check("無視されたファイルは数えない", lc.worktree_dirt(r2) == [])
        write(r2 / PROBE_FILE, "1\n")
        write(r2 / "untracked.txt", "x\n")
        r = cli(r2)
        check("汚れていれば CLI は rc=1 で理由を出す（終了コードまで）",
              r.returncode == 1 and "未追跡" in text(r))
        r = cli(r2, "--allow-dirty")
        check("--allow-dirty は記録は作らない（この一覧には検査が無いので rc=2、記録ファイル 0）",
              r.returncode == 2 and "記録は作りません" in text(r)
              and not (r2 / lc.STATE_REL).exists())
        os.remove(r2 / "untracked.txt")
        r = cli(r2)
        check("きれいなら関門を通るが、[[check]] が 0 本の一覧は『全部通った』にせず rc=2",
              r.returncode == 2 and "1 本も無い" in text(r))
        t2 = lc.target_for(r2, head(r2), "origin/main")
        write(r2 / "late.txt", "x\n")
        try:
            lc.write_record(r2, t2, [{"name": "t", "status": "pass"}], [])
            check("検査の間に作業ツリーが動いたら記録を作らない", False)
        except lc.RecordRefused as exc:
            check("検査の間に作業ツリーが動いたら記録を作らない（ファイル名が出る）", "late.txt" in str(exc))
        os.remove(r2 / "late.txt")
        commit_file(r2, "moved.txt", "m\n", "moved")
        try:
            lc.write_record(r2, t2, [{"name": "t", "status": "pass"}], [])
            check("検査の間に HEAD が動いたら記録を作らない", False)
        except lc.RecordRefused:
            check("検査の間に HEAD が動いたら記録を作らない", True)
        r2b = make_repo(tmp / "ni", ignore_state=False)
        t = lc.target_for(r2b, head(r2b), "origin/main")
        try:
            lc.write_record(r2b, t, [{"name": "t", "status": "pass"}], [])
            check("記録の保存先が .gitignore に無ければ作らない", False)
        except lc.RecordRefused as exc:
            check("記録の保存先が .gitignore に無ければ作らない", ".gitignore" in str(exc))
        try:
            lc.write_record(r2, lc.target_for(r2, head(r2), "origin/main"),
                            [{"name": "t", "status": "bogus"}], [])
            check("未知の状態の行を書かない", False)
        except lc.RecordRefused:
            check("未知の状態の行を書かない", True)

        # ---------------- 記録の往復と --status ----------------
        r3 = make_repo(tmp / "s")
        r = cli(r3, "--status")
        check("記録が無ければ --status は rc=1", r.returncode == 1 and "記録が無い" in text(r))
        p = record(r3)
        r = cli(r3, "--status")
        check("記録があれば --status は rc=0", r.returncode == 0 and "OK" in text(r))
        data = json.loads(p.read_text(encoding="utf-8"))
        check("記録に schema・base_sha・head_tree・環境の指紋が残る",
              data["schema"] == 1 and data["base_sha"] and data["head_tree"] and data["env_fingerprint"])
        data["schema"] = 99
        p.write_text(json.dumps(data), encoding="utf-8")
        r = cli(r3, "--status")
        check("形式が違う記録は移行せず明示的に拒否（rc=1）", r.returncode == 1 and "形式が違う" in text(r))
        data["schema"] = 1
        p.write_text(json.dumps(data), encoding="utf-8")
        p.write_text("{壊れた", encoding="utf-8")
        check("壊れた記録は rc=1", cli(r3, "--status").returncode == 1)
        record(r3)
        write(r3 / PROBE_FILE, "2\n")
        r = cli(r3, "--status")
        check("手元の版が記録のときと違えば rc=1（決定 1=A: push を止める）",
              r.returncode == 1 and "手元の環境" in text(r))
        write(r3 / PROBE_FILE, "1\n")
        check("版を戻せば rc=0", cli(r3, "--status").returncode == 0)
        write(r3 / "local_ci_checks.toml", "[env\n")
        r = cli(r3, "--status")
        check("検査の一覧が壊れていれば黙って既定に落とさず rc=2", r.returncode == 2 and "壊れています" in text(r))
        git(r3, "checkout", "--", "local_ci_checks.toml")
        gone = lc.run_probes(r3, (("no-such-tool-xyz",),))
        check("道具が無い probe は例外にせず『無い』という指紋になる",
              gone[0]["rc"] is None and lc.fingerprint_of(gone) is not None)

        # ---------------- pre-push（本物の git push で）----------------
        r4 = make_repo(tmp / "p")
        res = push(r4, "feat")
        check("記録が無ければ push は止まる", res.returncode != 0 and "記録" in text(res))
        record(r4)
        res = push(r4, "feat")
        check("記録があれば push は通る（裸のリポジトリ相手）", res.returncode == 0)
        commit_file(r4, "feature.txt", "f2\n", "more")
        res = push(r4, "feat")
        check("新しいコミットを足すと止まる", res.returncode != 0)
        git(r4, "reset", "-q", "--hard", "HEAD~1")
        git(r4, "switch", "-q", "-c", "feat2")
        record(r4)
        git(r4, "commit", "-q", "--amend", "-m", "言い直し")
        res = push(r4, "feat2")
        check("中身が同じ amend なら通る", res.returncode == 0)
        # 比較元が進んだら止まる
        git(r4, "switch", "-q", "-c", "feat3")
        commit_file(r4, "feat3.txt", "x\n", "feat3")
        record(r4)
        git(r4, "switch", "-q", "main")
        commit_file(r4, "m.txt", "m\n", "main advances")
        git(r4, "push", "-q", "--no-verify", "origin", "main")
        git(r4, "switch", "-q", "feat3")
        res = push(r4, "feat3")
        check("比較元が進んだら止まる（base_sha が鍵に入っている）", res.returncode != 0)
        # HEAD 以外のブランチは押す sha で判定する
        git(r4, "switch", "-q", "feat")
        git(r4, "reset", "-q", "--hard", "origin/feat")
        git(r4, "switch", "-q", "-c", "recorded")
        commit_file(r4, "rec.txt", "r\n", "recorded")
        record(r4)
        git(r4, "switch", "-q", "-c", "unrecorded")
        commit_file(r4, "unrec.txt", "u\n", "unrecorded")  # HEAD は記録の無い unrecorded
        res = push(r4, "recorded:recorded")
        check("HEAD でなく押す sha で判定する（HEAD に記録が無くても、押す側に記録があれば通る）",
              res.returncode == 0)
        git(r4, "switch", "-q", "recorded")
        res = push(r4, "unrecorded:unrecorded")
        check("HEAD に記録があっても、押す側に無ければ止まる", res.returncode != 0)
        res = push(r4, "recorded:recorded2", "unrecorded:unrecorded")
        check("複数の ref は全部通ること（1 つでも NG なら止まる）", res.returncode != 0)
        res = push(r4, ":feat")
        check("消すだけの push は記録を要求しない", res.returncode == 0)
        os.replace(r4 / "scripts" / "local-ci.py", r4 / "scripts" / "local-ci.py.off")
        git(r4, "switch", "-q", "unrecorded")
        res = push(r4, "unrecorded:unrecorded")
        check("local-ci.py が無ければ飛ばすが、飛ばしたことを標準エラーに出す",
              res.returncode == 0 and "飛ばします" in text(res))
        os.replace(r4 / "scripts" / "local-ci.py.off", r4 / "scripts" / "local-ci.py")

        # ---------------- setup.sh ----------------
        r5 = make_repo(tmp / "setup", ignore_state=False)
        git(r5, "config", "--unset", "core.hooksPath")
        write(r5 / "scripts" / "setup.sh", (HERE.parent / "setup.sh").read_bytes().decode("utf-8"))
        res = subprocess.run(["sh", "scripts/setup.sh"], cwd=str(r5), capture_output=True)
        check("setup.sh: core.hooksPath を設定する",
              git(r5, "config", "--get", "core.hooksPath").stdout.decode().strip() == ".githooks")
        check("setup.sh: 保存先が無視されていなければ .gitignore に追記する",
              ".claude/state/" in (r5 / ".gitignore").read_text(encoding="utf-8") and lc.state_is_ignored(r5))
        before = (r5 / ".gitignore").read_bytes()
        subprocess.run(["sh", "scripts/setup.sh"], cwd=str(r5), capture_output=True)
        check("setup.sh: 2 回目は何も足さない（冪等）", (r5 / ".gitignore").read_bytes() == before)

        # ---------------- シェルのスクリプトは LF ----------------
        for name in ("setup.sh",):
            raw = (HERE.parent / name).read_bytes()
            check(f"{name} に CR が無い（CRLF だと sh で動かない）", b"\r" not in raw)
        check("pre-push に CR が無い", b"\r" not in HOOK.read_bytes())
        check("local-ci.py が 3.11 未満では明示のエラーで止まる記述を持つ",
              "Python 3.11 以上が必要" in SRC.read_text(encoding="utf-8"))

    print("FAILURES:", FAILURES)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
