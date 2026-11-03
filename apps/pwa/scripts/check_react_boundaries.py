#!/usr/bin/env python3
"""React の feature 境界を grep 相当で見る 4 つの規則（手元の local-ci と CI で同じ物を回すため）。

`.github/workflows/quality-check.yml` の architecture ジョブにあった bash の grep を、そのまま
Python に移したもの。手元と CI で**同じ規則を 2 か所に書かない**ために 1 本にした。

    python scripts/check_react_boundaries.py
    python scripts/check_react_boundaries.py --rule zustand-store-only

違反があれば `path:行:本文` を出して rc=1。`src/` が無い（cwd が違う）と rc=2:
元の bash は『フォルダが無ければ違反なし』で通っていたが、何も見ずに緑になるのを避ける。
テストファイル（`__tests__/`、`*.test.*`、`*.spec.*`）は見ない。
"""
from __future__ import annotations

import argparse
import os
import re
import sys

#: テストファイル（元の bash の TEST_FILE_PATTERN。パスに対して当てる）
TEST_FILE = re.compile(r"(^|/)(__tests__/|[^/]+\.(test|spec)\.(ts|tsx|js|jsx)$)")
STORE_FILE = re.compile(r"/store\.tsx?$")
_FEATURE_IMPORT = re.compile(r"""from ['"][^'"]*features/[^'"]*/""")
_BARREL = re.compile(r"""/index['"]""")
_TARGET = re.compile(r"""features/([^/'"]+)""")
_CURRENT = re.compile(r"features/([^/]+)")


def walk(root: str, rel_dir: str):
    """``grep -r`` と同じく、フォルダの下を全ファイル再帰で（相対パス, 行の一覧）として返す。"""
    top = os.path.join(root, rel_dir)
    for base, dirs, files in os.walk(top, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in ("node_modules", ".git"))
        for name in sorted(files):
            path = os.path.join(base, name)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            if TEST_FILE.search(rel):
                continue
            try:
                with open(path, "rb") as f:
                    yield rel, f.read().decode("utf-8", "replace").splitlines()
            except OSError:
                continue


def feature_barrel(root: str) -> list[str]:
    """feature の中から別の feature の内部ファイルを直に import している行（barrel 経由でないもの）。"""
    hits = []
    for rel, lines in walk(root, "src/features"):
        current = _CURRENT.search(rel)
        for n, line in enumerate(lines, 1):
            if not _FEATURE_IMPORT.search(line) or _BARREL.search(line):
                continue
            target = _TARGET.search(line)
            if target and current and current.group(1) != target.group(1):
                hits.append(f"{rel}:{n}:{line}")
    return hits


def zustand_store_only(root: str) -> list[str]:
    """zustand を store.ts(x) 以外で import しているファイル。"""
    hits = []
    for rel, lines in walk(root, "src"):
        if STORE_FILE.search(rel):
            continue
        if any(re.search(r"""from ['"]zustand""", line) for line in lines):
            hits.append(rel)
    return hits


def shared_no_features(root: str) -> list[str]:
    """shared から features への逆向きの import。"""
    if not os.path.isdir(os.path.join(root, "src", "shared")):
        return []
    return [f"{rel}:{n}:{line}" for rel, lines in walk(root, "src/shared")
            for n, line in enumerate(lines, 1) if re.search(r"""from ['"][^'"]*features/""", line)]


def features_no_app(root: str) -> list[str]:
    """features から app への import。"""
    pattern = re.compile(r"""from ['"]@/app|from ['"][^'"]*src/app/""")
    return [f"{rel}:{n}:{line}" for rel, lines in walk(root, "src/features")
            for n, line in enumerate(lines, 1) if pattern.search(line)]


RULES = {
    "feature-barrel": (feature_barrel,
                       "feature 間の直接 import が検出されました（barrel 経由にしてください）"),
    "zustand-store-only": (zustand_store_only,
                           "zustand は src/features/{name}/store.ts でのみ import してください"),
    "shared-no-features": (shared_no_features,
                           "shared から features への import は禁止です（依存方向: app -> features -> shared）"),
    "features-no-app": (features_no_app, "features から app への import は禁止です"),
}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".", help="プロジェクトのルート（src/ があるフォルダ）")
    ap.add_argument("--rule", choices=sorted(RULES), help="1 つの規則だけ")
    args = ap.parse_args(argv)
    if not os.path.isdir(os.path.join(args.root, "src")):
        sys.stderr.write(f"check_react_boundaries: {args.root}/src が無い（cwd が違う？）。何も見ずに通さない\n")
        return 2
    bad = 0
    for name, (fn, message) in RULES.items():
        if args.rule and name != args.rule:
            continue
        hits = fn(args.root)
        if hits:
            bad += 1
            print(f"NG {name}: {message}")
            for h in hits:
                print(f"    {h}")
        else:
            print(f"OK {name}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
