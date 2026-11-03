#!/usr/bin/env python3
"""PR の変更ファイルに、hook と同じアーキテクチャ検査を CI で当てる（dispatcher 越し）。

なぜ要るか
==========
hook（dispatcher とチェッカー）は **Claude Code の編集にしか効かない**。エディタで直接書いたコードや、
他の人が出した PR は誰も止めない。CI に同じ検査を置いて、経路によらず同じ判定にする。
判定そのものは dispatcher に委ね、ここは『どのファイルを、どの扱いで通すか』と『検査が生きているか』を持つ。

    python scripts/ci_arch_check.py                  # 比較元との差分 + ラチェットの無い stack の全件
    python scripts/ci_arch_check.py --base origin/main
    python scripts/ci_arch_check.py --diff-only      # ラチェットの無い stack の全件を省く
    python scripts/ci_arch_check.py --all            # 全追跡ファイル（棚卸し用。強制はしない）
    python scripts/ci_arch_check.py --self-test      # 検査が生きているかだけ確かめる

ラチェット（hook と同じ扱い。``routes.toml`` の ``ratchet``）
  * ラチェットのある stack: **新規追加ファイル（git の A）→ 違反で失敗**、既存ファイルの変更 → 警告のみ
  * ラチェットのない stack: **差分に関係なく全追跡ファイルを検査**し、既存ファイルでも失敗
    （差分だけだと、誰も触っていない違反が一生出てこない）
  hook は『ファイルが実在するか』で新旧を判定するが、CI では全ファイルが実在するので git の差分状態で決める。

自己防衛（検査が生きているか）
==============================
判定を dispatcher に委ねているので、振り分けが壊れる・チェッカーが差し替わる・再同期で強化が巻き戻る、の
どれでも**『違反 0 件』で緑のまま**になる。そこで毎回、**必ず止まるはずの合成ファイル（probe）**を通し、
素通りしたら落とす。probe は案件の ``routes.toml`` に宣言する::

    [[ci_arch.probe]]
    label = "api: Route から ORM を触る"
    path  = "backend/app/routers/__arch_probe__.py"   # 実在しないパス（= 新規ファイル扱いで必ず deny になる）
    content = "from sqlalchemy import select\\n"
    expect = "must not touch DB"                       # 理由に含まれるはずの語

    [[ci_arch.probe]]                                 # 既存ファイルの違反がラチェットで警告に落ちる経路
    label = "api: 既存ファイルはラチェットで警告"
    path  = "backend/app/core/config.py"              # 実在するファイル
    content = "router = APIRouter()\\n"
    kind = "ratchet"

**checker を持つ stack には probe が 1 つ以上要る**（無い stack は『規則が一度も発火していない』ことに誰も気づけない）。
要らない stack は ``[ci_arch] allow_no_probe = ["stack"]`` に理由つきで書く。

終了コード: 0 = 違反なし / 1 = 規約違反・検査自体が壊れている・dispatcher が落ちた / 2 = 使えない（dispatcher や routes.toml が無い）。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.dont_write_bytecode = True

#: 検査対象の拡張子の既定（``[ci_arch] suffixes`` で変える）
DEFAULT_SUFFIXES = (".py", ".ts", ".tsx", ".js", ".jsx", ".astro", ".mdx", ".vue", ".svelte", ".php")
#: テストは対象外（既定。``[ci_arch] test_path_markers`` / ``test_name_markers`` で変える）。
#: 規約が縛るのは本体で、その検証コードではない。
DEFAULT_TEST_PATH_MARKERS = ("/tests/", "/test/", "/__tests__/")
DEFAULT_TEST_NAME_MARKERS = (".test.", ".spec.", "conftest.py")
#: dispatcher がラチェットで警告に落としたときの目印（dispatcher の文言と一致していること。self-test が踏む）
RATCHET_MARKER = "既存ファイルのため通します"
#: dispatcher が『この stack は検査できていない』と出すときの行頭
DISPATCH_WARN_PREFIX = "dispatch-architecture:"
WORKERS = max(1, min(8, os.cpu_count() or 1))


class Unusable(Exception):
    """使えない（dispatcher・routes.toml・git が無い）。"""


class DispatcherCrashed(RuntimeError):
    """dispatcher が 0 以外で終わった・検査できない stack があった。**『違反なし』と読んではいけない。**"""


class Project:
    """案件のルートと、routes.toml から読んだ設定。"""

    def __init__(self, root: Path, dispatcher: Path | None = None):
        self.root = root
        self.dispatcher = dispatcher or root / ".claude" / "hooks" / "dispatch-architecture.py"
        if not self.dispatcher.is_file():
            raise Unusable(f"{self.dispatcher} が無い（dispatcher 部品が要る）")
        sr_path = root / "scripts" / "stack_routes.py"
        if not sr_path.is_file():
            raise Unusable(f"{sr_path} が無い（stack-routes 部品が要る）")
        spec = importlib.util.spec_from_file_location("stack_routes_for_ci_arch", sr_path)
        self.sr = importlib.util.module_from_spec(spec)
        sys.modules["stack_routes_for_ci_arch"] = self.sr
        spec.loader.exec_module(self.sr)
        try:
            self.cfg = self.sr.load(str(root / "routes.toml"))
        except self.sr.RoutesError as exc:
            raise Unusable(str(exc))
        ci = self.cfg.get("ci_arch", {})
        self.suffixes = tuple(ci.get("suffixes", DEFAULT_SUFFIXES))
        self.test_path = tuple(ci.get("test_path_markers", DEFAULT_TEST_PATH_MARKERS))
        self.test_name = tuple(ci.get("test_name_markers", DEFAULT_TEST_NAME_MARKERS))
        self.allow_no_probe = set(ci.get("allow_no_probe", []))
        self.probes = list(ci.get("probe", []))
        self.checked_stacks = {n for n, s in self.cfg["stack"].items() if s.get("checker")}

    def stacks_of(self, path: str) -> set[str]:
        return set(self.sr.named_stacks(path, self.cfg)) & self.checked_stacks

    def is_test(self, path: str) -> bool:
        return (any(m in "/" + path for m in self.test_path)
                or any(m in Path(path).name for m in self.test_name))

    def is_checked(self, path: str) -> bool:
        return Path(path).suffix in self.suffixes and not self.is_test(path) and bool(self.stacks_of(path))

    def ratcheted(self, path: str) -> bool:
        """このファイルの stack が、全部ラチェットありか（1 つでも無ければ『常に強制』側に倒す）。"""
        stacks = self.stacks_of(path)
        return bool(stacks) and all(self.cfg["stack"][s].get("ratchet") for s in stacks)


def git(root: Path, *args: str) -> str:
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True)
    if r.returncode != 0:
        raise Unusable(f"git {' '.join(args)} に失敗: {r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout.decode("utf-8", "replace")


def changed_files(p: Project, base: str) -> list[tuple[str, str]]:
    """``(git の状態, パス)``。削除は除く。改名は新しいパス側。"""
    out = []
    for line in git(p.root, "diff", "--name-status", "--find-renames", f"{base}...HEAD").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if parts[0][:1] == "D":
            continue
        if p.is_checked(parts[-1]):
            out.append((parts[0][:1], parts[-1]))
    return out


def all_files(p: Project) -> list[tuple[str, str]]:
    return [("M", f) for f in git(p.root, "ls-files").splitlines() if p.is_checked(f)]


def dispatch(p: Project, file_path: str, content: str, *, dispatcher: Path | None = None) -> tuple[str, str] | None:
    """1 ファイル分の内容を dispatcher に掛け、``(種別, 説明)`` を返す。違反なしは None。

    種別は 3 つ。**混ぜてはいけない**:
      deny      dispatcher がブロックした規約違反
      ratchet   規約違反だが、ラチェットで警告に落とされたもの（失敗にするかは git の状態で決める）
      advisory  チェッカーが意図的にブロックしていない助言（失敗にしない: 規約の出所がずれ、直しようが無い）
    内容をディスクでなく引数で受けるのは、probe が実在しないファイルを検査させるため。
    dispatcher が 0 以外で終わる・『この stack は検査できていない』と出すときは DispatcherCrashed
    （『違反なし』として通さない）。
    """
    payload = {"tool_name": "Write", "tool_input": {"file_path": file_path, "content": content}}
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(p.root)}
    r = subprocess.run([sys.executable, str(dispatcher or p.dispatcher)], input=json.dumps(payload).encode("utf-8"),
                       capture_output=True, env=env)
    stdout = r.stdout.decode("utf-8", "replace").strip()
    stderr = r.stderr.decode("utf-8", "replace").strip()
    if r.returncode != 0:
        raise DispatcherCrashed(f"dispatcher が終了コード {r.returncode} で終わった（{file_path}）。"
                                f"『違反なし』とは読まない。\n{stderr[-800:]}")
    unchecked = [ln for ln in stderr.splitlines() if ln.startswith(DISPATCH_WARN_PREFIX)]
    if unchecked:
        raise DispatcherCrashed(f"検査できていない stack がある（{file_path}）。『違反なし』とは読まない:\n"
                                + "\n".join(unchecked))
    if stdout:
        try:
            out = json.loads(stdout)["hookSpecificOutput"]
            if out.get("permissionDecision") == "deny":
                return "deny", out.get("permissionDecisionReason", "").strip()
        except (json.JSONDecodeError, KeyError):
            pass
    # ラチェットの警告は stderr の先頭とは限らない（チェッカーが別の行を先に書くと startswith が外れ、
    # 既存ファイルの違反が『違反なし』として消える）。WARNING 行を全部見る
    warns = [ln for ln in stderr.splitlines() if ln.lstrip().startswith("WARNING:")]
    if not warns:
        return None
    return ("ratchet" if any(RATCHET_MARKER in ln for ln in warns) else "advisory"), stderr


def dispatch_many(p: Project, items: list[tuple[str, str]], **kw) -> list[tuple[str, str] | None]:
    """``(file_path, content)`` を並べて通す。**結果は入力と同じ順。** 本番も probe もここを通す。"""
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=min(WORKERS, len(items))) as pool:
        return list(pool.map(lambda it: dispatch(p, *it, **kw), items))


def inspect_many(p: Project, paths: list[str]) -> list[tuple[str, str] | None]:
    items = []
    for path in paths:
        target = p.root / path
        items.append((str(target), target.read_text(encoding="utf-8", errors="replace")))
    return dispatch_many(p, items)


# ---------------------------------------------------------------------------
# 自己防衛
# ---------------------------------------------------------------------------
def probe_problems(p: Project) -> list[str]:
    """probe の宣言の形と、『checker を持つ stack に probe がある』ことの問題。"""
    out: list[str] = []
    covered: set[str] = set()
    if not p.checked_stacks:
        # 検査する stack が 0 のまま『違反なし』と言わない
        return ["routes.toml のどの stack にも checker が無い。この検査は何も検査しない（緑が何も言っていない）"]
    for i, pr in enumerate(p.probes):
        where = f"[[ci_arch.probe]] {i + 1} 番目"
        if not (isinstance(pr, dict) and all(isinstance(pr.get(k), str) and pr.get(k) != ""
                                              for k in ("label", "path", "content"))):
            out.append(f"{where}: label・path・content は必須の文字列")
            continue
        kind = pr.get("kind", "deny")
        if kind not in ("deny", "ratchet", "advisory"):
            out.append(f"{where}: kind は deny / ratchet / advisory")
            continue
        if kind == "deny" and not pr.get("expect"):
            out.append(f"{where}（{pr['label']}）: deny の probe には expect（理由に含まれる語）が要る"
                       "（別の規則で偶然止まっていないことを確かめるため）")
        exists = (p.root / pr["path"]).is_file()
        if kind == "ratchet" and not exists:
            out.append(f"{where}（{pr['label']}）: ratchet の probe の path は実在するファイルにする（{pr['path']} が無い）")
        if kind in ("deny", "advisory") and exists:
            out.append(f"{where}（{pr['label']}）: {kind} の probe の path は実在しない名前にする"
                       "（実在すると、ラチェットで警告に落ちて deny にならない／違反を直すと自己防衛まで死ぬ）")
        covered |= p.stacks_of(pr["path"])
    for name in sorted(p.checked_stacks - covered - p.allow_no_probe):
        out.append(f"[{name}] checker があるのに probe が 1 つも無い。この stack の規則が今も発火するかを誰も確かめていない"
                   f"（要らないなら [ci_arch] allow_no_probe に理由つきで書く）")
    return out


def crash_problems(p: Project) -> list[str]:
    """dispatcher が落ちたら『違反なし』でなく止まるか（合成の偽 dispatcher で確かめる。実物は壊さない）。"""
    import tempfile

    out: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        crash = Path(tmp) / "crash.py"
        crash.write_text("import sys\nsys.exit(3)\n", encoding="utf-8")
        quiet = Path(tmp) / "quiet.py"
        quiet.write_text("import sys\nsys.stdin.buffer.read()\n", encoding="utf-8")
        warn = Path(tmp) / "warn.py"
        warn.write_text("import sys\nsys.stdin.buffer.read()\nprint('dispatch-architecture: x', file=sys.stderr)\n",
                        encoding="utf-8")
        for dispatcher, label in ((crash, "終了コード 3 で落ちる"), (warn, "検査できていない stack を警告する")):
            try:
                dispatch(p, "__arch_probe__/x.py", "", dispatcher=dispatcher)
            except DispatcherCrashed:
                pass
            else:
                out.append(f"dispatcher が{label}のに例外になりませんでした。**その回が『違反なし』として通ります。**")
        try:
            found = dispatch(p, "__arch_probe__/y.py", "", dispatcher=quiet)
        except DispatcherCrashed as exc:
            out.append(f"正常に終わる dispatcher を落ちたと読みました（過検出）: {exc}")
        else:
            if found is not None:
                out.append(f"何も出さない dispatcher から指摘が出ました（過検出）: {found}")
    return out


def self_test(p: Project) -> list[str]:
    problems = probe_problems(p) + crash_problems(p)
    probes = [pr for pr in p.probes if isinstance(pr, dict) and all(isinstance(pr.get(k), str) for k in
                                                                    ("label", "path", "content"))]
    outcomes = dispatch_many(p, [(str(p.root / pr["path"]), pr["content"]) for pr in probes])
    for pr, found in zip(probes, outcomes):
        kind = pr.get("kind", "deny")
        label = pr["label"]
        if found is None:
            problems.append(f"検出できるはずの指摘が素通りしました: {label}\n    probe: {pr['path']}\n"
                            "    この規則はもう何も止めていません。チェッカーか dispatcher の振り分けを確認すること。")
            continue
        got, reason = found
        if got != kind:
            problems.append(f"指摘の種別が想定と違います: {label}\n    期待: {kind} / 実際: {got}\n"
                            "    deny / ratchet / advisory を取り違えると、助言が失敗になるか、規約違反が警告どまりになります。")
        elif pr.get("expect") and pr["expect"] not in reason:
            problems.append(f"指摘は出ましたが、理由が想定と違います: {label}\n    期待する語: {pr['expect']!r}\n"
                            f"    実際の理由: {reason.splitlines()[0] if reason else ''}\n"
                            "    別の規則で偶然止まっている可能性があります。")
    return problems


# ---------------------------------------------------------------------------
def report(title: str, rows: list[tuple[str, str]]) -> None:
    print(f"\n--- {title} ---")
    for path, reason in rows:
        print(f"\n  {path}")
        for line in reason.splitlines():
            print(f"    {line}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".", help="案件のルート（routes.toml があるフォルダ）")
    ap.add_argument("--base", default="origin/main", help="比較元（既定 origin/main）")
    ap.add_argument("--all", action="store_true", help="全追跡ファイルを検査する（棚卸し用。強制はしない）")
    ap.add_argument("--diff-only", action="store_true", help="差分だけ見る（ラチェットの無い stack の全件を省く）")
    ap.add_argument("--self-test", action="store_true", help="検査が生きているかだけ確かめる")
    args = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):  # cp932 の端末で出せない文字があっても落ちない
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        p = Project(Path(args.root).resolve())
        # 検査を始める前に、検査そのものが生きているかを確かめる（壊れた検査の『違反なし』は無意味）
        try:
            broken = self_test(p)
        except DispatcherCrashed as exc:
            broken = [str(exc)]
        if broken:
            print("--- 検査自体が壊れています ---", file=sys.stderr)
            for problem in broken:
                print(f"\n  {problem}", file=sys.stderr)
            print("\nこの状態の『違反なし』は無意味です。検査を直すまで CI を通しません。", file=sys.stderr)
            return 1
        if args.self_test:
            kinds = Counter(pr.get("kind", "deny") for pr in p.probes)
            print(f"自己防衛 OK: probe {len(p.probes)} 件を想定どおりの種別で検出（"
                  + " / ".join(f"{k} {v}" for k, v in sorted(kinds.items())) + "）。")
            return 0

        targets = all_files(p) if args.all else changed_files(p, args.base)
        if not args.all and not args.diff_only:
            # ラチェットの無い stack は差分に関係なく全件（誰も触っていない違反を見逃さない）
            seen = {path for _, path in targets}
            targets += [("M", f) for f in git(p.root, "ls-files").splitlines()
                        if f not in seen and p.is_checked(f) and not p.ratcheted(f)]
        if not targets:
            print("検査対象の変更はありません。")
            return 0
        try:
            inspected = inspect_many(p, [path for _, path in targets])
        except DispatcherCrashed as exc:
            print(f"--- 検査を完了できませんでした ---\n\n  {exc}", file=sys.stderr)
            return 1
    except Unusable as exc:
        sys.stderr.write(f"ci_arch_check: {exc}\n")
        return 2

    failures: list[tuple[str, str]] = []
    warnings: list[tuple[str, str]] = []
    advisories: list[tuple[str, str]] = []
    for (status, path), found in zip(targets, inspected):
        if found is None:
            continue
        kind, reason = found
        if kind == "advisory":
            advisories.append((path, reason))
        elif args.all:
            warnings.append((path, reason))
        elif status == "A" or not p.ratcheted(path):
            failures.append((path, reason))
        else:
            warnings.append((path, reason))
    if advisories:
        report(f"チェッカーからの助言（{len(advisories)} 件・規約違反ではない）", advisories)
    if warnings:
        report(f"既存ファイルの規約違反（警告 {len(warnings)} 件・落とさない）", warnings)
    if failures:
        report(f"規約違反（{len(failures)} 件・失敗）", failures)
        return 1
    if args.all:
        print(f"\n棚卸し: 全 {len(targets)} ファイルを検査（強制はしない）。")
        return 0
    ratchet_names = sorted(n for n in p.checked_stacks if p.cfg["stack"][n].get("ratchet"))
    always = sorted(p.checked_stacks - set(ratchet_names))
    enforced = "・".join([f"新規ファイル（{'/'.join(sorted(p.checked_stacks))}）"]
                         + ([f"{'/'.join(always)} は全ファイル"] if always and not args.diff_only else []))
    print(f"\n検査 {len(targets)} ファイル / 強制対象（{enforced}）に違反なし。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
