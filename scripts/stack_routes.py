#!/usr/bin/env python3
"""変更ファイルから、検査を回す stack を決める（案件の routes.toml が規則）。

使い方::

    git diff --name-only --no-renames origin/main...HEAD | python scripts/stack_routes.py
    python scripts/stack_routes.py --base origin/main
    python scripts/stack_routes.py --check          # routes.toml の形だけ検査する

出力は ``<stack>=true|false`` を stack ごとに 1 行（routes.toml の宣言順）。

判定の原則（ある実案件の振り分けスクリプトで、事故から学んだもの）:
  1. **迷ったら全部回す。** どの規則にも当たらないパスは全 stack。
     「余分に回る」より「回るべき検査が黙って回らない」方が損害が大きい。
  2. 規則は上から順に、最初に当たったものを採る。特殊なものを先に書く。
  3. ``stacks = []`` は「どの stack も回さない」（文書だけの変更など）。
  4. 入力が空なら **何も回さずに通さず**、rc=2 で止める（``--allow-empty`` で全 false）。
  5. 規則が壊れていたら、黙って全 false にせず rc=2。

終了コード: 0 = 判定した / 2 = routes.toml が壊れている・入力が空・使い方の誤り。
Python 3.11 以上（``tomllib``）が要る。
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 以下。黙って別の形式に落とさない
    sys.stderr.write("stack_routes: Python 3.11 以上が必要です（tomllib）。\n")
    raise SystemExit(2)

#: ``stacks = ["*"]`` は全 stack の意味。
ALL = "*"
_NAME = re.compile(r"^[a-z][a-z0-9-]*$")


class RoutesError(Exception):
    """routes.toml が使えない。"""


def normalize(path: str) -> str:
    """区切りを ``/`` に、先頭の ``./`` を落とす（Windows の ``\\`` を受ける）。"""
    p = path.strip().replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    return p


def problems(cfg: dict) -> list[str]:
    """routes.toml の形の問題を全部返す（空なら使える）。"""
    out: list[str] = []
    stacks = cfg.get("stack")
    if not isinstance(stacks, dict) or not stacks:
        return ["[stack.<名前>] が 1 つも宣言されていない"]
    for name, body in stacks.items():
        if not _NAME.match(name):
            out.append(f"stack 名 {name!r} は小文字の英数字とハイフンだけ（先頭は英字）")
        if not isinstance(body, dict):
            out.append(f"[stack.{name}] は表でなければならない")
            continue
        if "ratchet" in body and not isinstance(body["ratchet"], bool):
            out.append(f"[stack.{name}] ratchet は true / false")
        if "checker" in body and not isinstance(body["checker"], str):
            out.append(f"[stack.{name}] checker は文字列（検査スクリプトの名前）")
        if "dir" in body and not (isinstance(body["dir"], str) and body["dir"].strip("/")):
            out.append(f"[stack.{name}] dir は案件のルートからのフォルダ名の文字列（stack-registry-check が使う）")
    routes = cfg.get("route")
    if not isinstance(routes, list) or not routes:
        return out + ["[[route]] が 1 つも無い（規則が空だと全部が『未知のパス』になる）"]
    seen: set[str] = set()
    referenced: set[str] = set()
    for i, r in enumerate(routes):
        where = f"[[route]] {i + 1} 番目"
        pat = r.get("pattern") if isinstance(r, dict) else None
        sts = r.get("stacks") if isinstance(r, dict) else None
        if not isinstance(pat, str) or not pat:
            out.append(f"{where}: pattern（正規表現）が無い")
            continue
        try:
            re.compile(pat)
        except re.error as exc:
            out.append(f"{where}: pattern {pat!r} が正規表現として壊れている（{exc}）")
        if pat in seen:
            out.append(f"{where}: pattern {pat!r} が重複している（後ろの規則は決して使われない）")
        seen.add(pat)
        if not isinstance(sts, list) or not all(isinstance(s, str) for s in sts):
            out.append(f"{where}: stacks は文字列の配列（空配列 = どの stack も回さない）")
            continue
        for s in sts:
            if s == ALL:
                referenced.update(stacks)
            elif s not in stacks:
                out.append(f"{where}: stack {s!r} が [stack.*] に宣言されていない")
            else:
                referenced.add(s)
    for name in stacks:
        if name not in referenced:
            out.append(f"stack {name!r} をどの [[route]] も起こさない（未知のパスの時しか回らない）")
    return out


def load(path: str) -> dict:
    try:
        with open(path, "rb") as f:
            cfg = tomllib.load(f)
    except FileNotFoundError:
        raise RoutesError(f"{path} が無い")
    except tomllib.TOMLDecodeError as exc:
        raise RoutesError(f"{path} が TOML として壊れている（{exc}）")
    bad = problems(cfg)
    if bad:
        raise RoutesError(f"{path}:\n  - " + "\n  - ".join(bad))
    return cfg


def named_stacks(path: str, cfg: dict) -> frozenset[str]:
    """最初に当たった規則が**名指しした** stack。当たらない・``[]``・``["*"]`` は空集合。

    ``stacks_for`` は迷ったら全部（検査を回す側の fail-safe）だが、編集を止める側
    （dispatcher）は逆で、**名指しされていないものに他の stack の規約を当てない**
    （互いの誤爆を避ける）。そのため『どれにも当たらない』を全部にしない版が要る。
    """
    p = normalize(path)
    for r in cfg["route"]:
        if re.search(r["pattern"], p):
            return frozenset(s for s in r["stacks"] if s != ALL)
    return frozenset()


def stacks_for(path: str, cfg: dict) -> frozenset[str]:
    """1 ファイルが起こす stack。どの規則にも当たらなければ全 stack。"""
    declared = frozenset(cfg["stack"])
    p = normalize(path)
    for r in cfg["route"]:
        if re.search(r["pattern"], p):
            return declared if ALL in r["stacks"] else frozenset(r["stacks"])
    return declared


def decide(paths: list[str], cfg: dict) -> dict[str, bool]:
    """宣言順の ``{stack: 回すか}``。paths が空なら全部 False（呼び出し側で空を弾く）。"""
    hit: set[str] = set()
    for p in paths:
        hit |= stacks_for(p, cfg)
    return {name: name in hit for name in cfg["stack"]}


def _git_changed(base: str) -> list[str]:
    # --no-renames: 改名は旧名・新名の両方を出す（旧名側の stack を取りこぼさない）
    res = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", f"{base}...HEAD"],
        capture_output=True,
    )
    if res.returncode != 0:
        raise RoutesError(f"git diff が失敗した: {res.stderr.decode('utf-8', 'replace').strip()}")
    return [ln for ln in res.stdout.decode("utf-8", "replace").splitlines() if ln.strip()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--routes", default="routes.toml", help="規則ファイル（既定: routes.toml）")
    ap.add_argument("--base", help="比較元。指定すると git diff で変更ファイルを得る（無ければ標準入力）")
    ap.add_argument("--check", action="store_true", help="routes.toml の形だけ検査して終わる")
    ap.add_argument("--allow-empty", action="store_true", help="入力が空でも全 false で通す")
    args = ap.parse_args(argv)
    try:
        cfg = load(args.routes)
        if args.check:
            print(f"OK: {args.routes}（stack {len(cfg['stack'])} 個、規則 {len(cfg['route'])} 本）")
            return 0
        paths = _git_changed(args.base) if args.base else [
            ln for ln in sys.stdin.buffer.read().decode("utf-8", "replace").splitlines() if ln.strip()
        ]
        if not paths and not args.allow_empty:
            raise RoutesError("変更ファイルが 0 件。何も回さずに通さない（意図した空なら --allow-empty）")
        for name, on in decide(paths, cfg).items():
            print(f"{name}={'true' if on else 'false'}")
        return 0
    except RoutesError as exc:
        sys.stderr.write(f"stack_routes: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
