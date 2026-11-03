#!/usr/bin/env python3
"""新しい stack の登録漏れを機械で見つける（routes.toml を正として、他の登録先と食い違いを探す）。

モノレポに新しい stack（トップレベルのアプリ）を足したとき、登録先が複数あって、1 つ忘れると
**その stack の検査が 1 本も走らない**まま誰にも気づかれない（実案件で、足した stack が検査の
振り分けから抜けて数日、ビルドの失敗が見つからなかった）。散文の一覧は読まれないので、機械で見る。

    python scripts/registry_check.py            # 案件のルートで
    python scripts/registry_check.py --root <dir>

見るもの（**「あれば見る」ものは、見たものも見なかったものも必ず出力する**。何も見ずに緑にしない）
  1. routes.toml の形（stack-routes の検査）
  2. 案件の中の『stack らしいフォルダ』（package.json・pyproject.toml などがあるフォルダ）が、
     routes.toml のどれかの規則に当たること。当たらないフォルダ = 登録漏れ
  3. dispatcher があれば: 各 stack の checker の宣言と実物の対応
  4. local-ci の一覧があれば: 全 stack に検査が 1 本以上あり、一覧の stack が全部 routes.toml にある
  5. .github/dependabot.yml があれば: `dir` を宣言した stack がその更新の対象に入っている

終了コード: 0 = 食い違いなし / 1 = 食い違いあり / 2 = 検査できない（routes.toml が無い・壊れている、git が使えない）。
"""
from __future__ import annotations

import argparse
import importlib.util
import posixpath
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

#: 『ここに 1 つのアプリがある』と見なす印のファイル
MARKERS = frozenset({"package.json", "pyproject.toml", "composer.json", "go.mod", "Cargo.toml", "pom.xml",
                     "build.gradle", "Gemfile"})
#: stack の印が置かれているフォルダとして数えない深さ（案件の直下から何段目まで見るか）
MAX_DEPTH = 3


class Unusable(Exception):
    """検査できない。理由は文面。"""


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def tracked_and_new(root: Path) -> list[str]:
    """git が知っている（追跡 + 未追跡で無視されていない）ファイルの相対パス。

    まだ ``git add`` していない新しいフォルダも拾う（足した直後にこそ見つけたい）。
    """
    r = subprocess.run(["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard"],
                       capture_output=True)
    if r.returncode != 0:
        raise Unusable("git ls-files が失敗した（git のリポジトリの中で実行する）: "
                       + r.stderr.decode("utf-8", "replace").strip())
    return [ln for ln in r.stdout.decode("utf-8", "replace").splitlines() if ln]


def marker_dirs(files: list[str]) -> dict[str, str]:
    """``{フォルダ: 印のファイル名}``。案件の直下（.）と、深すぎるものは除く。"""
    out: dict[str, str] = {}
    for f in files:
        folder, name = posixpath.split(f)
        if name in MARKERS and folder and folder.count("/") < MAX_DEPTH:
            out.setdefault(folder, name)
    return out


def covered(folder: str, sr_cfg: dict) -> bool:
    """どれかの規則に当たるか（``stacks = []`` も『登録した上で検査しない』という決定として数える）。"""
    for probe in (folder + "/", folder + "/" + "x"):
        if any(re.search(r["pattern"], probe) for r in sr_cfg["route"]):
            return True
    return False


def under(folder: str, prefixes: list[str]) -> bool:
    return any(folder == p.strip("/") or folder.startswith(p.strip("/") + "/") for p in prefixes)


def check(root: Path) -> tuple[list[tuple[str, str, str]], int]:
    """``([(状態, 項目, 詳細)], 食い違いの数)``。状態は OK / NG / SKIP。"""
    rows: list[tuple[str, str, str]] = []
    bad = 0

    def add(state: str, item: str, detail: str = "") -> None:
        nonlocal bad
        rows.append((state, item, detail))
        bad += state == "NG"

    sr_path = root / "scripts" / "stack_routes.py"
    if not sr_path.is_file():
        raise Unusable(f"{sr_path} が無い（stack-routes 部品が要る）")
    sr = load_module(sr_path, "stack_routes_for_registry")
    routes_path = root / "routes.toml"
    try:
        cfg = sr.load(str(routes_path))
    except sr.RoutesError as exc:
        raise Unusable(str(exc))
    stacks = list(cfg["stack"])
    add("OK", "routes.toml の形", f"stack {len(stacks)} 個（{', '.join(stacks)}）・規則 {len(cfg['route'])} 本")

    # 2. stack らしいフォルダが規則に当たるか
    ignore = list(cfg.get("registry", {}).get("ignore", []))
    files = tracked_and_new(root)
    found = marker_dirs(files)
    missing = sorted(d for d in found if not covered(d, cfg) and not under(d, ignore))
    shown = f"stack の印のあるフォルダ {len(found)} 個を routes.toml の規則に当てた"
    if missing:
        for d in missing:
            add("NG", f"登録漏れ: {d}/", f"{found[d]} があるのに、routes.toml のどの規則にも当たらない。"
                "stack なら [stack.<名前>] と [[route]] を足す。stack でないなら [registry] ignore に書く")
    else:
        add("OK", "stack らしいフォルダは全部 routes.toml に登録済み", shown)
    if not found:
        add("SKIP", "stack の印のあるフォルダ", "git が知るファイルの中に印（package.json 等）が無い。"
            "単一スタックの案件か、印の無い stack なら、この項目は何も確かめていない")

    # 3. dispatcher
    hooks = root / ".claude" / "hooks"
    if (hooks / "dispatch-architecture.py").is_file():
        before = bad
        for name, spec in cfg["stack"].items():
            if "checker" not in spec:
                add("NG", f"[{name}] checker が未宣言",
                    "dispatcher を使っているのに、この stack のチェッカーの宣言が無い（検査が走らない）。"
                    '無いと決めたなら checker = "" と書いて意図を示す')
            elif spec["checker"] and not (hooks / spec["checker"]).is_file():
                add("NG", f"[{name}] チェッカー {spec['checker']} が .claude/hooks/ に無い", "")
        declared = {s.get("checker") for s in cfg["stack"].values()}
        for f in sorted(hooks.glob("check-*-architecture.py")):
            if f.name not in declared:
                add("NG", f"{f.name} をどの stack も使っていない", "routes.toml の checker に書くか、不要なら消す")
        if bad == before:
            add("OK", "dispatcher のチェッカーの宣言と実物が対応している", "")
    else:
        add("SKIP", "dispatcher", ".claude/hooks/dispatch-architecture.py が無い（入れていない案件）ので見ていない")

    # 4. local-ci
    lc_path = root / "scripts" / "local-ci.py"
    if (root / "local_ci_checks.toml").is_file() and lc_path.is_file():
        lc = load_module(lc_path, "local_ci_for_registry")
        try:
            checks = lc.load_checks(root)
        except Exception as exc:  # 読めない理由が何であれ、黙って SKIP にも、落ちて見えなくもしない
            add("NG", "local-ci の検査の一覧が読めない", (str(exc).splitlines() or [type(exc).__name__])[0])
        else:
            by_stack = {c.stack for c in checks}
            ok = True
            for name in stacks:
                if name not in by_stack:
                    ok = False
                    add("NG", f"[{name}] local-ci の検査が 1 本も無い", "この stack は手元の検査で何も回らない")
            for name in sorted(by_stack - {"common"} - set(stacks)):
                ok = False
                add("NG", f"local-ci の stack {name!r} が routes.toml に無い", "綴りの違いか、登録漏れ")
            if ok:
                add("OK", "local-ci の一覧と routes.toml の stack が一致している", f"検査 {len(checks)} 本")
    else:
        add("SKIP", "local-ci", "local_ci_checks.toml または scripts/local-ci.py が無い（入れていない案件）ので見ていない")

    # 5. dependabot
    dep = root / ".github" / "dependabot.yml"
    if dep.is_file():
        dirs = {m.group(1).rstrip("/") or "/" for m in
                re.finditer(r"""^\s*(?:-\s+)?directory:\s*["']?(/[^"'\s#]*)""", dep.read_text(encoding="utf-8"), re.M)}
        no_dir = [n for n, s in cfg["stack"].items() if not s.get("dir")]
        ok = True
        for name, spec in cfg["stack"].items():
            d = spec.get("dir")
            if d and "/" + d.strip("/") not in dirs and "/" not in dirs:
                ok = False
                add("NG", f"[{name}] dependabot の更新の対象に /{d.strip('/')} が無い",
                    ".github/dependabot.yml に updates を足す")
        if ok and len(no_dir) < len(stacks):
            add("OK", "dir を宣言した stack は全部 dependabot の対象", "")
        if no_dir:
            add("SKIP", "dependabot（dir 未宣言の stack）", f"[stack.*] dir を書いていない: {', '.join(no_dir)}。"
                "書けば dependabot の更新の対象も見る")
    else:
        add("SKIP", "dependabot", ".github/dependabot.yml が無いので見ていない")
    return rows, bad


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".", help="案件のルート（routes.toml があるフォルダ）")
    args = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):  # cp932 の端末で出せない文字があっても落ちない
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        rows, bad = check(Path(args.root).resolve())
    except Unusable as exc:
        sys.stderr.write(f"registry_check: {exc}\n")
        return 2
    for state, item, detail in rows:
        print(f"{state:4} {item}" + (f" - {detail}" if detail else ""))
    ran = sum(1 for r in rows if r[0] != "SKIP")
    print(f"\n確かめた項目 {ran} 件・見なかった項目 {len(rows) - ran} 件・食い違い {bad} 件")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
