#!/usr/bin/env python3
"""local_ci_db.py（確認つきのテスト DB 作り直し）の自己テスト。

Run: python tools/local-ci/tests/test_local_ci_db.py

本物の PostgreSQL は使わない。``LOCAL_CI_PSQL`` で **偽の psql**（呼ばれた引数を全部記録し、
DB の有無とコメントを模す）に差し替える。見ているのは『どの条件で DROP を発行するか／しないか』。
本物のサーバに対して DROP / CREATE / COMMENT が通ることは、このテストでは確かめていない。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import test_local_ci_run as run_t  # noqa: E402  合成リポジトリと CLI の補助を共有する

base = run_t.base
lc = base.lc
FAILURES = 0

FAKE = r'''
import json, os, re, sys
state_path, log_path = os.environ["FAKE_PSQL_STATE"], os.environ["FAKE_PSQL_LOG"]
args = sys.argv[1:]
sql = args[args.index("-c") + 1]
url = args[args.index("-c") - 1]
with open(log_path, "a", encoding="utf-8") as f:
    f.write(json.dumps({"url": url, "sql": sql}) + "\n")
state = json.load(open(state_path, encoding="utf-8")) if os.path.exists(state_path) else {}
fail = os.environ.get("FAKE_PSQL_FAIL", "")
def save(): json.dump(state, open(state_path, "w", encoding="utf-8"))
m = re.search(r"datname = '([^']+)'", sql)
if sql.startswith("SELECT"):
    if m and m.group(1) in state:
        print("exists:" + state[m.group(1)])
    sys.exit(1 if fail == "select" else 0)
m = re.search(r'"([^"]+)"', sql)
if sql.startswith("DROP"):
    if fail == "drop":
        sys.exit(1)
    state.pop(m.group(1), None); save(); sys.exit(0)
if sql.startswith("CREATE"):
    if fail == "create":
        sys.exit(1)
    state[m.group(1)] = ""; save(); sys.exit(0)
if sql.startswith("COMMENT"):
    if fail == "comment":
        sys.exit(1)
    state[m.group(1)] = re.search(r"IS '([^']*)'", sql).group(1); save(); sys.exit(0)
sys.exit(3)
'''


def check(desc: str, ok: bool) -> None:
    global FAILURES
    if not ok:
        FAILURES += 1
    print(("OK " if ok else "FAIL"), desc)


def main() -> int:
    sys.path.insert(0, str(base.SRC.parent))
    import local_ci_db as db

    SLUG = "ab12cd34"
    URL = f"postgresql://postgres@localhost:5433/app_test_{SLUG}"

    # ---------------- 消してよい名前の判定（psql を呼ばない）----------------
    def refused(desc: str, url: str, prefix: str = "app_test_", slug: str = SLUG) -> None:
        try:
            db.target_of(url, prefix, slug)
            check(desc, False)
        except db.DbRefused:
            check(desc, True)

    name, admin = db.target_of(URL, "app_test_", SLUG)
    check("prefix + 8 桁にぴったり一致する名前は通る。管理用の接続先は postgres DB",
          name == f"app_test_{SLUG}" and admin.endswith("/postgres"))
    refused("postgres（保護された DB）は消さない", "postgresql://u@localhost/postgres")
    refused("template1 は消さない", "postgresql://u@localhost/template1")
    refused("slug を含まない名前（共用の DB）は消さない", "postgresql://u@localhost/app_test_shared")
    refused("slug の後ろに余計な文字がある名前は消さない", f"postgresql://u@localhost/app_test_{SLUG}_x")
    refused("別の prefix の名前は消さない", f"postgresql://u@localhost/other_{SLUG}")
    refused("別の作業ツリーの slug の名前は消さない", "postgresql://u@localhost/app_test_deadbeef")
    refused("リモートの接続先は消さない", f"postgresql://u@db.example.invalid/app_test_{SLUG}")
    refused("リモートの IP も消さない", f"postgresql://u@10.0.0.5/app_test_{SLUG}")
    refused("PostgreSQL 以外の URL は扱わない", f"mysql://u@localhost/app_test_{SLUG}")
    refused("引用符を含む名前（注入）は拒否する", f'postgresql://u@localhost/app_test_{SLUG}"; DROP DATABASE x; --')
    refused("短すぎる prefix は拒否する", f"postgresql://u@localhost/t_{SLUG}", prefix="t_")
    refused("末尾が _ でない prefix は拒否する", f"postgresql://u@localhost/app{SLUG}", prefix="app")
    refused("slug 自体に引用符が混ざっても（名前が一致していても）拒否する（名前の文字の検査は単独で効く）",
            'postgresql://u@localhost/app_test_ab"cd', slug='ab"cd')
    check("127.0.0.1 と ::1 はこのマシンとして通る",
          db.target_of(f"postgresql://u@127.0.0.1:5433/app_test_{SLUG}", "app_test_", SLUG)[0] == name
          and db.target_of(f"postgresql://u@[::1]:5433/app_test_{SLUG}", "app_test_", SLUG)[0] == name)

    with tempfile.TemporaryDirectory(prefix="local-ci-db-") as td:
        tmp = Path(td)
        fake = tmp / "fake_psql.py"
        fake.write_text(FAKE, encoding="utf-8")
        state, log = tmp / "state.json", tmp / "log.jsonl"
        os.environ.update({"LOCAL_CI_PSQL": f"{Path(sys.executable).as_posix()} {fake.as_posix()}",
                           "FAKE_PSQL_STATE": str(state), "FAKE_PSQL_LOG": str(log)})
        os.environ.pop("FAKE_PSQL_FAIL", None)

        def reset(initial: dict | None = None) -> None:
            state.write_text(json.dumps(initial or {}), encoding="utf-8")
            log.write_text("", encoding="utf-8")

        def sqls() -> list[str]:
            return [json.loads(x)["sql"] for x in log.read_text(encoding="utf-8").splitlines() if x]

        def dropped() -> list[str]:
            return [s for s in sqls() if s.startswith("DROP")]

        silent = lambda *_: None  # noqa: E731

        reset()
        got = db.recreate(URL, "app_test_", SLUG, silent)
        check("DB が無ければ DROP せずに作り、印を付ける", got == URL and not dropped()
              and json.loads(state.read_text())[name] == f"local-ci:{SLUG}")
        check("psql の接続先は postgres DB（消す DB 自身ではない）",
              all(json.loads(x)["url"].endswith("/postgres") for x in log.read_text().splitlines() if x))

        reset({name: f"local-ci:{SLUG}"})
        db.recreate(URL, "app_test_", SLUG, silent)
        s = sqls()
        check("印のある DB は DROP してから作り直す（順序: 確認 → DROP → CREATE → 印）",
              [x.split()[0] for x in s] == ["SELECT", "DROP", "CREATE", "COMMENT"] and len(dropped()) == 1)
        check("DROP したのは名前が合う DB だけ", all(f'"{name}"' in d for d in dropped()))

        def stays(desc: str, initial: dict) -> None:
            reset(initial)
            try:
                db.recreate(URL, "app_test_", SLUG, silent)
                check(desc, False)
            except db.DbRefused as exc:
                check(desc + "（DROP を一度も発行していない）", not dropped() and "印" in str(exc))

        stays("名前は合うが印が無い DB（人が作ったもの）は消さない", {name: ""})
        stays("別の作業ツリーの印が付いた DB は消さない", {name: "local-ci:deadbeef"})
        stays("別のコメントが付いた DB は消さない", {name: "my production data"})

        for step, extra in (("select", "確かめられない"), ("drop", "消せない"), ("create", "作れない"),
                            ("comment", "印を付けられない")):
            reset({name: f"local-ci:{SLUG}"} if step in ("drop",) else {})
            os.environ["FAKE_PSQL_FAIL"] = step
            try:
                db.recreate(URL, "app_test_", SLUG, silent)
                check(f"psql が {step} で失敗したら止まる", False)
            except db.DbRefused as exc:
                check(f"psql が {step} で失敗したら止まる（{extra}）", extra in str(exc))
            finally:
                os.environ.pop("FAKE_PSQL_FAIL")
        reset({name: f"local-ci:{SLUG}"})
        os.environ["FAKE_PSQL_FAIL"] = "select"
        try:
            db.recreate(URL, "app_test_", SLUG, silent)
        except db.DbRefused:
            pass
        os.environ.pop("FAKE_PSQL_FAIL")
        check("有無を確かめられないときは DROP しない（分からないを『無い』にしない）", not dropped())

        # ---------------- 一覧の形 ----------------
        r = base.make_repo(tmp / "cfgrepo")

        def cfg(rd) -> subprocess.CompletedProcess:
            run_t.set_checks(r, [{"name": "d", "stack": "app", "cmd": run_t.py("print(1)"), "recreate_db": rd}])
            return run_t.cli(r, "--plan")

        res = cfg({"url": "postgresql://u@localhost/app_test_x", "prefix": "app_test_"})
        check("url に {SLUG} が無い一覧は rc=2（別の作業ツリーの DB を消すため）",
              res.returncode == 2 and "SLUG" in base.text(res))
        res = cfg({"url": "postgresql://u@localhost/t_{SLUG}", "prefix": "t_"})
        check("短い prefix の一覧は rc=2", res.returncode == 2 and "prefix" in base.text(res))
        res = cfg({"url": "postgresql://u@localhost/app_test_{SLUG}"})
        check("prefix が無い一覧は rc=2", res.returncode == 2)
        res = cfg({"url": "postgresql://u@localhost/app_test_{SLUG}", "prefix": "app_test_", "extra": "x"})
        check("未知の欄は rc=2", res.returncode == 2)
        res = cfg({"url": "postgresql://u@localhost/app_test_{SLUG}", "prefix": "app_test_"})
        check("正しい一覧は通る", res.returncode == 0)

        # ---------------- 通し: 本物の CLI で回す ----------------
        slug = lc.worktree_slug(r)
        env = run_t.clean_env()
        url_t = "postgresql://u@localhost:5433/app_test_{SLUG}"
        run_t.set_checks(r, [{"name": "db", "stack": "app",
                              "cmd": run_t.py("import os; print('DBURL=' + os.environ['DATABASE_URL'])"),
                              "recreate_db": {"url": url_t, "prefix": "app_test_", "url_env": "DATABASE_URL"}}])
        reset()
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True, env=env)
        out = base.text(res)
        check("通し: DB を作ってから検査が回り、rc=0・記録あり", res.returncode == 0 and "判定   : OK" in out)
        check("通し: 検査には作った DB の URL が url_env で渡る", f"DBURL=postgresql://u@localhost:5433/app_test_{slug}" in out)
        check("通し: 印が付いた", json.loads(state.read_text())[f"app_test_{slug}"] == f"local-ci:{slug}")

        base.commit_file(r, "feature.txt", "x2\n", "again")
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True, env=env)
        check("通し: 2 回目は DROP して作り直し、rc=0", res.returncode == 0 and len(dropped()) == 1)

        reset({f"app_test_{slug}": ""})
        base.commit_file(r, "feature.txt", "x3\n", "third")
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True, env=env)
        row = run_t.row_of(r, "db")
        check("通し: 印の無い DB に当たったら消さず、検査は fail（見送りにしない）・rc=1・本体は回らない",
              res.returncode == 1 and row["status"] == "fail" and "DBURL" not in base.text(res) and not dropped())

        run_t.set_checks(r, [{"name": "db", "stack": "app", "cmd": run_t.py("print('ran')"),
                              "recreate_db": {"url": "postgresql://u@db.example.invalid/app_test_{SLUG}",
                                              "prefix": "app_test_"}}])
        reset()
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True, env=env)
        check("通し: リモートの URL は psql を一度も呼ばず fail", res.returncode == 1 and not sqls()
              and "ran" not in base.text(res))

        env2 = {**env, "LOCAL_CI_PSQL": "no-such-psql-binary-xyz"}
        run_t.set_checks(r, [{"name": "db", "stack": "app", "cmd": run_t.py("print('ran')"),
                              "recreate_db": {"url": url_t, "prefix": "app_test_"}, "hint": "psql を入れる"}])
        res = subprocess.run([sys.executable, str(r / "scripts" / "local-ci.py")], cwd=str(r), capture_output=True, env=env2)
        check("通し: psql が無ければ見送り（通ったことにしない）・rc=1・ヒントを出す",
              res.returncode == 1 and run_t.row_of(r, "db")["status"] == "skipped" and "psql を入れる" in base.text(res))

    print("FAILURES:", FAILURES)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
