#!/usr/bin/env python3
"""ローカル CI の核（記録・鍵・汚れの関門・--status・pre-push・検査の実行・枠・再入禁止）。

手元で検査を回し、結果を「この差分に対する記録」として残し、記録が無ければ push できない
ようにする。v1 は検査を 1 本ずつ直列に回す（前回の記録からの引き継ぎはしない）。

使い方::

    python scripts/local-ci.py                     # 検査を回して記録を作る
    python scripts/local-ci.py --status            # HEAD の差分に合う記録があるか（rc 0 = ある）
    python scripts/local-ci.py --pre-push          # git の pre-push が標準入力で渡す ref ごとに判定
    python scripts/local-ci.py --ci                # CI 用: 記録も枠も作らず回して rc を返す
    python scripts/local-ci.py --plan              # 何を回すかだけ出す

記録が主張すること
==================
鍵 = sha256(head_tree, base_sha, 差分) の先頭 16 桁。

* ``head_tree``: コミットの sha でなく tree。中身が同じ amend で鍵が動かない
* ``base_sha``: 比較元の **tip の sha**（merge-base ではない）。マージ対象が動いたら別の検証
* 差分

ロックファイルや検査の一覧はコミットされているので、変われば ``head_tree`` が動く（鍵に足しても
何も塞がない）。本当の穴は「**手元に実際に入っている版がロックファイルと違う**」こと
（node_modules や venv が古いまま通る）。そこで検査の一覧の ``[env] tool_probes`` が宣言した
コマンドの出力のハッシュを ``env_fingerprint`` として記録に残し、``--status`` が今の値と比べて、
**違えば NG（push を止める）**。

限界（文書にも書く）
====================
* ``base_sha`` は手元の追跡ブランチから取る。fetch していなければ古いまま。鮮度は
  「最後に fetch した時点」までしか保証しない
* 記録は git に入らない（コミットすると汚れの関門が自分の記録で止まる）。CI からは見えない。
  **手元の記録は嘘（回さずに記録だけ作る）を止められない。** 止められるのは CI の回し直しだけ
* clone では pre-push が有効にならない（``scripts/setup.sh`` が要る）。``--no-verify`` で飛ぶ

終了コード: 0 = 通ってよい / 1 = 通さない（記録なし・不一致・失敗・汚れ） / 2 = 使えない
（比較元を解決できない・設定が壊れている・枠が空かなかった）。
Python 3.11 以上（``tomllib``）が要る。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import posixpath
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

if sys.version_info < (3, 11):  # 黙って別の形式に落とさない
    sys.stderr.write("local-ci: Python 3.11 以上が必要です（tomllib）。\n")
    raise SystemExit(2)

import tomllib  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = 1
#: 比較元の既定。追跡ブランチは見ない（1 度 push すると比較元が自分のブランチになる事故を避ける）。
DEFAULT_BASE = "origin/main"
STATE_REL = ".claude/state/local-ci"
CHECKS_FILE = "local_ci_checks.toml"
#: 状態。skipped（見送り）は通ったことにしない。incomplete は「必須の検査を見送った」。
STATUSES = ("pass", "fail", "skipped", "incomplete", "out_of_scope", "timeout")
_ZERO_SHA = re.compile(r"^0+$")


class Unusable(Exception):
    """使えない（比較元を解決できない・設定が壊れている・git が失敗した）。main が rc=2 にする。"""


class RecordRefused(Exception):
    """記録を作ってはいけない（汚れ・ずれ・無視されていない保存先）。理由は文面。"""


# ---------------------------------------------------------------------------
# git（失敗を空と混ぜない）
# ---------------------------------------------------------------------------
def _git(root: Path, *args: str) -> tuple[int, str]:
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True)
    return r.returncode, r.stdout.decode("utf-8", "replace")


def _git_ok(root: Path, *args: str) -> str:
    rc, out = _git(root, *args)
    if rc != 0:
        raise Unusable(f"local-ci: git {' '.join(args)} が失敗しました（rc={rc}）")
    return out


# ---------------------------------------------------------------------------
# 設定（案件の検査の一覧から、この部品が読む欄だけ）
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Config:
    base: str
    tool_probes: tuple[tuple[str, ...], ...]
    #: tool_probes と同じ並びで、各 probe を回すフォルダ（案件のルートからの相対。ルートの一覧のものは ""）。
    #: 取り込んだ stack の一覧の probe は、その一覧のフォルダで回す（``npm ls`` が frontend/ の依存を見るため）。
    probe_dirs: tuple[str, ...] = ()


MAX_INCLUDE_DEPTH = 4


def _read_toml(path: Path, shown: str) -> dict:
    try:
        return tomllib.loads(path.read_bytes().decode("utf-8-sig"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        raise Unusable(f"local-ci: {shown} が壊れています（{exc}）")


def read_files(root: Path) -> list[tuple[str, str, dict]]:
    """検査の一覧の並び: ``(root からの相対パス, そのフォルダ, 中身)``。root の一覧が先頭。

    ``[local_ci] include = [...]`` で他の一覧（stack ごとの一覧）を取り込める。パスは取り込む側の
    ファイルのフォルダからの相対。**案件の外へ抜ける・存在しない・同じファイルを 2 度（循環を含む）
    読む**ものは黙って無視せず止める。root の一覧が無ければ空。
    """
    if not (root / CHECKS_FILE).is_file():
        return []
    out: list[tuple[str, str, dict]] = []
    seen: set[str] = set()

    def visit(rel: str, depth: int, via: str) -> None:
        if rel in seen:
            raise Unusable(f"local-ci: {rel} を 2 度読み込もうとした（循環または二重の include。{via}）")
        if depth > MAX_INCLUDE_DEPTH:
            raise Unusable(f"local-ci: include が {MAX_INCLUDE_DEPTH} 段より深い（{via}）")
        seen.add(rel)
        data = _read_toml(root / rel, rel)
        folder = posixpath.dirname(rel)
        out.append((rel, folder, data))
        inc = data.get("local_ci", {}).get("include", [])
        if not (isinstance(inc, list) and all(isinstance(i, str) and i for i in inc)):
            raise Unusable(f"local-ci: {rel} の [local_ci] include は『パスの文字列の配列』にしてください")
        for item in inc:
            target = posixpath.normpath(posixpath.join(folder, item.replace("\\", "/")))
            if target == ".." or target.startswith("../") or posixpath.isabs(target):
                raise Unusable(f"local-ci: {rel} の include {item!r} が案件の外へ抜ける")
            if not (root / target).is_file():
                raise Unusable(f"local-ci: {rel} の include {item!r} が無い（{target}）")
            visit(target, depth + 1, f"{rel} → {target}")

    visit(CHECKS_FILE, 0, CHECKS_FILE)
    return out


def load_config(root: Path) -> Config:
    """``local_ci_checks.toml`` の ``[local_ci] base`` と、全ファイルの ``[env] tool_probes`` を読む。

    ファイルが無いのは正常（既定の比較元・版の照合なし）。**壊れているのは正常でない**ので
    黙って既定に落とさず止める（版の照合が黙って外れるのを防ぐ）。比較元は root の一覧だけが決める
    （取り込まれた stack の一覧の ``base`` は読まない）。
    """
    files = read_files(root)
    if not files:
        return Config(DEFAULT_BASE, ())
    base = files[0][2].get("local_ci", {}).get("base", DEFAULT_BASE)
    probes: list = []
    dirs: list[str] = []
    for _rel, _folder, data in files:
        got = data.get("env", {}).get("tool_probes", [])
        if not (isinstance(got, list) and all(isinstance(p, list) and p and all(isinstance(a, str) for a in p)
                                              for p in got)):
            raise Unusable(f"local-ci: {_rel} の [env] tool_probes は『コマンドの配列の配列』にしてください")
        probes += got
        dirs += [_folder] * len(got)
    if not isinstance(base, str) or not base:
        raise Unusable(f"local-ci: {CHECKS_FILE} の [local_ci] base は文字列にしてください")
    return Config(base, tuple(tuple(p) for p in probes), tuple(dirs))


# ---------------------------------------------------------------------------
# 比較元・鍵
# ---------------------------------------------------------------------------
def resolve_base(spec: str, root: Path) -> tuple[str, str]:
    """(比較元の表記, その commit の sha)。解決できなければ止める。

    解決できないことを「差分なし」に倒さない。綴りを間違えた比較元を通すと、回すものが無いので
    緑になる（沈黙を成功とみなす型）。
    """
    rc, out = _git(root, "rev-parse", "--verify", "--quiet", f"{spec}^{{commit}}")
    sha = out.strip()
    if rc != 0 or not sha:
        raise Unusable(f"local-ci: 比較元 '{spec}' を解決できません。綴りを確かめるか "
                         "git fetch してください（解決できないことを『差分なし』として通さない）")
    return spec, sha


def digest_of(diff_text: str, *, head_tree: str, base_sha: str) -> str:
    payload = f"{head_tree}\n{base_sha}\n{diff_text}"
    return hashlib.sha256(payload.encode("utf-8", "replace")).hexdigest()[:16]


@dataclass(frozen=True)
class Target:
    digest: str | None  # 差分が無ければ None
    files: tuple[str, ...]
    base: str
    base_sha: str
    head_tree: str
    sha: str


def target_for(root: Path, sha: str, base_spec: str) -> Target:
    """``sha`` を比較元と突き合わせた対象。pre-push は HEAD でなく押す sha で呼ぶ。"""
    base, base_sha = resolve_base(base_spec, root)
    rc, tree = _git(root, "rev-parse", "--verify", "--quiet", f"{sha}^{{tree}}")
    if rc != 0 or not tree.strip():
        raise Unusable(f"local-ci: {sha[:12]} の tree を読めません")
    head_tree = tree.strip()
    diff = _git_ok(root, "diff", f"{base_sha}...{sha}")
    if not diff.strip():
        return Target(None, (), base, base_sha, head_tree, sha)
    # --no-renames: 改名は旧名・新名の両方を出す
    files = tuple(x for x in _git_ok(root, "diff", "--name-only", "--no-renames",
                                     f"{base_sha}...{sha}").splitlines() if x)
    return Target(digest_of(diff, head_tree=head_tree, base_sha=base_sha),
                  files, base, base_sha, head_tree, sha)


# ---------------------------------------------------------------------------
# 汚れの関門
# ---------------------------------------------------------------------------
def worktree_dirt(root: Path) -> list[str]:
    """作業ツリーと HEAD のずれ（``git status --porcelain`` の行）。**未追跡も数える。**

    鍵はコミット済みの差分から、検査は作業ツリーのファイルから作られる。未コミットの変更や、
    木を歩く検査が読むのに差分に出ない未追跡ファイルがあると、「ハッシュは修正前・結果は修正後」
    になり、記録が「この差分を検査した」という主張を満たさない。``.gitignore`` は git が見る。
    """
    rc, out = _git(root, "status", "--porcelain")
    if rc != 0:
        raise Unusable("local-ci: git status が失敗しました（作業ツリーの状態を確かめられない）")
    return [ln for ln in out.splitlines() if ln.strip()]


def dirty_gate(dirt: list[str], *, allow_dirty: bool) -> str | None:
    """記録を作ってよいか。作ってはいけないなら理由の文面を返す。

    判定と遮断を 1 か所にまとめ、``main`` がこの文面をそのまま rc=1 へつなぐ
    （検出はするが止めない、を避ける）。自己テストは終了コードまで踏む。
    """
    if not dirt:
        return None
    head = "\n".join(f"    {ln}" for ln in dirt[:10])
    more = f"\n    …ほか {len(dirt) - 10} 件" if len(dirt) > 10 else ""
    base = f"未コミットの変更または未追跡のファイルが {len(dirt)} 件あります。\n{head}{more}\n"
    if allow_dirty:
        return base + "  --allow-dirty なので検査は回しますが、記録は作りません（鍵と検査の対象が食い違うため）。"
    return (base + "  このまま回すと『通った』が嘘になります。先にコミットする（または無視の対象に入れる）"
            "か、検査だけ回したいなら --allow-dirty（記録は作らない）。")


def tree_moved_during_run(root: Path, head_tree: str) -> str | None:
    """検査の間に作業ツリーか HEAD が動いたら、その理由。記録の直前に呼ぶ。

    始めの確認だけでは足りない。回している最中に誰かが同じ作業ツリーを書き換えると、鍵と
    検査した中身がずれる。検査が無視されていない生成物を残す場合も毎回ここで鳴る
    （黙って除外せず、ファイル名つきで落とす。stack の雛形の .gitignore に入れる）。
    """
    dirt = worktree_dirt(root)
    if dirt:
        return (f"検査の間に未コミットの変更ができた（{len(dirt)} 件: "
                f"{', '.join(d.strip() for d in dirt[:5])}）")
    rc, out = _git(root, "rev-parse", "HEAD^{tree}")
    if rc != 0 or not out.strip():
        return "検査の後に HEAD の tree を読めない"
    if out.strip() != head_tree:
        return f"検査の間に HEAD が動いた（tree {head_tree[:8]} → {out.strip()[:8]}）"
    return None


# ---------------------------------------------------------------------------
# 環境の指紋（手元に入っている版がロックファイルと違う穴）
# ---------------------------------------------------------------------------
def run_probes(root: Path, probes: tuple[tuple[str, ...], ...], dirs: tuple[str, ...] = ()) -> list[dict]:
    """宣言された版の確認コマンドを回し、出力をそのまま残す。

    道具が無い・落ちる場合も例外にせず、その事実を指紋に入れる（無いことが別の指紋になる）。
    出力はバイトで受けて復号する。
    """
    out: list[dict] = []
    for i, cmd in enumerate(probes):
        folder = dirs[i] if i < len(dirs) else ""
        extra = {"cwd": folder} if folder else {}  # ルートの probe の記録の形は変えない
        try:
            real = [sys.executable if a == "{PYTHON}" else a for a in cmd]  # 検査と同じ python で調べる
            r = subprocess.run(resolve_cmd(real), cwd=str(root / folder), capture_output=True, timeout=60)
            text = (r.stdout + r.stderr).decode("utf-8", "replace").strip()
            out.append({"cmd": list(cmd), "rc": r.returncode, "out": text, **extra})
        except (OSError, subprocess.SubprocessError) as exc:
            out.append({"cmd": list(cmd), "rc": None, "out": f"実行できない: {type(exc).__name__}", **extra})
    return out


def fingerprint_of(probe_results: list[dict]) -> str | None:
    """probe が宣言されていなければ None（照合しない）。"""
    if not probe_results:
        return None
    blob = json.dumps(probe_results, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def env_mismatch(rec: dict, now_probes: list[dict]) -> str | None:
    """記録の環境と今の環境が違えば理由。決定 1=A: 違えば NG（push を止める）。

    記録に指紋が無く今は宣言がある、またはその逆（検査の定義が変わった）も不一致として扱う。
    """
    now = fingerprint_of(now_probes)
    then = rec.get("env_fingerprint")
    if now == then:
        return None
    old = {tuple(p.get("cmd", [])): p.get("out") for p in (rec.get("env", {}).get("probes") or [])}
    diffs = [f"{' '.join(p['cmd'])}: 記録 {old.get(tuple(p['cmd']), '（無い）')!r} → いま {p['out']!r}"
             for p in now_probes if old.get(tuple(p["cmd"])) != p["out"]]
    detail = "; ".join(diffs[:3]) or "版の確認コマンドの宣言が変わった"
    return f"手元の環境が記録のときと違う（{detail}）。回し直すこと"


# ---------------------------------------------------------------------------
# 記録
# ---------------------------------------------------------------------------
def state_dir(root: Path) -> Path:
    return root / STATE_REL


def state_is_ignored(root: Path) -> bool:
    """保存先が .gitignore に入っているか。入っていないと、記録を作った瞬間に汚れの関門が
    自分の記録で止まる（作ったあと必ず NG になる）。"""
    rc, _ = _git(root, "check-ignore", "-q", f"{STATE_REL}/probe.json")
    return rc == 0


def entry_passed(row: dict) -> bool:
    st = row.get("status")
    if st in ("pass", "out_of_scope"):
        return True
    # 必須でない検査の見送りだけは通す（件数と理由は判定の文面に出す）
    return st == "skipped" and row.get("required", True) is False


def verdict_of(rows: list[dict]) -> str:
    if any(r.get("status") in ("fail", "timeout") for r in rows):
        return "fail"
    if any(r.get("status") in ("incomplete", "skipped") and not entry_passed(r) for r in rows):
        return "incomplete"
    return "pass"


def write_record(root: Path, target: Target, rows: list[dict], probe_results: list[dict],
                 *, jobs: int = 1, inherit_encoding: bool = False) -> Path:
    """記録を書く。**書いてはいけないときは RecordRefused**（遮断をここに集める）。"""
    if target.digest is None:
        raise RecordRefused("差分が無いので記録は要らない")
    if not state_is_ignored(root):
        raise RecordRefused(f"{STATE_REL}/ が .gitignore に入っていない。記録を作ると作業ツリーが"
                            "汚れ、次の検査が自分の記録で止まる（scripts/setup.sh が追記する）")
    moved = tree_moved_during_run(root, target.head_tree)
    if moved:
        raise RecordRefused(moved)
    bad = [r for r in rows if r.get("status") not in STATUSES]
    if bad:
        raise RecordRefused(f"未知の状態の行がある: {bad[0].get('name')!r} = {bad[0].get('status')!r}")
    d = state_dir(root)
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{target.digest}.json"
    path.write_text(json.dumps({
        "schema": SCHEMA,
        "digest": target.digest,
        "base": target.base,
        "base_sha": target.base_sha,
        "head_tree": target.head_tree,
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "host": platform.platform(),
        "env": {"interpreter": sys.executable, "python": platform.python_version(),
                "probes": probe_results},
        "env_fingerprint": fingerprint_of(probe_results),
        "jobs": jobs,
        # 文字コード変数を子へ渡したか（既定は渡さない。渡したときは素の端末と違う条件で通した記録）
        "inherit_encoding": inherit_encoding,
        "changed_files": len(target.files),
        "checks": rows,
        # 行と食い違う verdict を書かない
        "verdict": verdict_of(rows),
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def read_record(root: Path, digest: str) -> tuple[dict | None, str | None]:
    """(記録, 読めない理由)。形式が違う記録は移行せず、明示的に拒否する。"""
    path = state_dir(root) / f"{digest}.json"
    if not path.is_file():
        return None, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, "記録ファイルが読めない（壊れている）"
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        got = data.get("schema") if isinstance(data, dict) else None
        return None, f"記録の形式が違う（schema {got!r} / 期待 {SCHEMA}）。回し直すこと"
    return data, None


def record_is_ok(rec: dict | None, *, base_sha: str, head_tree: str,
                 now_probes: list[dict] | None = None) -> tuple[bool, str]:
    """記録として通してよいか。**verdict を信じず、行ごとの合否から導き直す。**

    base_sha / head_tree の照合は保険（鍵に混ざっているので、食い違う記録は引けない）。
    鳴るのは鍵から落とす変更が入ったときで、そのとき本番の経路でも止まる。
    """
    if rec is None:
        return False, "記録が無い"
    if rec.get("base_sha") != base_sha:
        return False, (f"記録は別の比較元で取られている（記録 {str(rec.get('base_sha'))[:8]} / "
                       f"いま {base_sha[:8]}）。回し直すこと")
    if rec.get("head_tree") != head_tree:
        return False, (f"記録は別のツリーで取られている（記録 {str(rec.get('head_tree'))[:8]} / "
                       f"いま {head_tree[:8]}）。回し直すこと")
    rows = rec.get("checks")
    if not isinstance(rows, list) or not rows or not all(isinstance(r, dict) for r in rows):
        return False, "記録の検査の行が読めない（または 1 行も無い）"
    derived = verdict_of(rows)
    stated = rec.get("verdict")
    if stated != derived:
        return False, f"記録の verdict（{stated!r}）が行の合否（{derived!r}）と食い違う"
    if derived == "fail":
        failed = [str(r.get("name")) for r in rows if r.get("status") in ("fail", "timeout")]
        return False, f"検査が失敗している: {', '.join(failed[:3])}"
    if derived == "incomplete":
        left = [str(r.get("name")) for r in rows if not entry_passed(r)]
        return False, f"必須の検査を見送った（通ったことにしない）: {', '.join(left[:3])}"
    if now_probes is not None:
        why = env_mismatch(rec, now_probes)
        if why:
            return False, why
    notes = []
    oos = [r for r in rows if r.get("status") == "out_of_scope"]
    skipped = [r for r in rows if r.get("status") == "skipped"]
    if oos:
        notes.append(f"対象外 {len(oos)} 本")
    if skipped:
        notes.append(f"必須でない見送り {len(skipped)} 本")
    return True, "検査を通過している" + (f"（{', '.join(notes)}）" if notes else "")


# ---------------------------------------------------------------------------
# 検査の定義（local_ci_checks.toml の [[check]]）
# ---------------------------------------------------------------------------
CHECK_KEYS = {"name", "stack", "cwd", "cmd", "needs", "needs_path", "needs_probe", "pre", "env",
              "env_drop", "required", "hint", "timeout", "os", "ci", "artifacts", "self_test_of",
              "recreate_db"}
RECREATE_KEYS = {"url", "prefix", "url_env"}
_STACK_NAME = re.compile(r"^[a-z][a-z0-9-]*$")
_OS_NAMES = {"win32": "windows", "linux": "linux", "darwin": "macos"}
DEFAULT_TIMEOUT = 900.0


@dataclass(frozen=True)
class Check:
    name: str
    stack: str  # "common" は毎回回す
    cwd: str  # 案件のルートからの相対
    cmd: tuple[str, ...]  # {PYTHON} {BASE_SHA} {SLUG} {WORKERS} を差し込む
    needs: str | None = None  # 無ければ見送り（コマンド）
    needs_path: str | None = None  # 無ければ見送り（パス）
    needs_probe: tuple[str, ...] | None = None  # rc=0 でなければ見送り（版・依存の確認）
    pre: tuple[tuple[str, tuple[str, ...]], ...] = ()  # 下ごしらえ。落ちたら fail（見送りに化けさせない）
    env: tuple[tuple[str, str], ...] = ()
    env_drop: tuple[str, ...] = ()
    required: bool = True
    hint: str = ""  # 見送り・失敗のとき『どうすれば回せるか』
    timeout: float = DEFAULT_TIMEOUT
    os: tuple[str, ...] = ()  # 空なら全 OS。外れたら見送りでなく out_of_scope
    ci: bool = True  # False なら --ci では回さない（手元だけの検査）
    artifacts: tuple[str, ...] = ()  # 検査が作る生成物（無視の対象に入っているべきもの）
    self_test_of: str | None = None  # 自己防衛の検査が守る対象（整合の検査が使う）
    # 確認つきのテスト DB 作り直し (url, prefix, url_env)。DROP は local_ci_db の確認を全部通ったときだけ
    recreate_db: tuple[str, str, str | None] | None = None

    @property
    def label(self) -> str:
        return f"{self.stack}: {self.name}"


def _cmd(value, where: str, problems: list[str]) -> tuple[str, ...] | None:
    if isinstance(value, list) and value and all(isinstance(a, str) for a in value):
        return tuple(value)
    problems.append(f"{where}: コマンドは『文字列の配列』（空でない）")
    return None


def load_checks(root: Path) -> list[Check]:
    """``[[check]]`` を読む（include した stack の一覧も）。形の問題は**全部まとめて**出して止める。

    取り込まれた一覧では、``cwd`` / ``needs_path`` / ``artifacts`` はその一覧のフォルダからの相対で書き、
    ここで案件のルートからの相対に直す。``stack`` を省いた検査は、その一覧の ``[stack] name`` を使う
    （同じ一覧が、単一スタックの案件のルートでも、モノレポの 1 stack としても使えるように）。
    """
    files = read_files(root)
    if not files:
        raise Unusable(f"local-ci: {CHECKS_FILE} が無い。検査の一覧（[[check]]）を置いてください")
    entries: list[tuple[str, str, str | None, int, object]] = []
    problems: list[str] = []
    for rel, folder, data in files:
        stack_table = data.get("stack", {})
        default_stack = stack_table.get("name") if isinstance(stack_table, dict) else None
        raw = data.get("check", [])
        if not isinstance(raw, list):
            problems.append(f"{rel}: [[check]] の形が違う")
            continue
        entries += [(rel, folder, default_stack, i, c) for i, c in enumerate(raw)]
    out: list[Check] = []
    seen: set[str] = set()

    def rebase(folder: str, path: str) -> str:
        return posixpath.normpath(posixpath.join(folder, path.replace("\\", "/"))) if folder else path

    for rel, folder, default_stack, i, c in entries:
        src = f"{rel}: " if rel != CHECKS_FILE else ""
        where = f"{src}[[check]] {i + 1} 番目"
        if not isinstance(c, dict):
            problems.append(f"{where}: 表でなければならない")
            continue
        where = f"{src}[[check]] {c.get('name', i + 1)!r}"
        for k in sorted(set(c) - CHECK_KEYS):
            problems.append(f"{where}: 未知の欄 {k!r}（綴りの誤りは黙って無視されるため止める）")
        name, stack, cwd = c.get("name"), c.get("stack", default_stack), c.get("cwd", ".")
        cmd = _cmd(c.get("cmd"), f"{where} cmd", problems)
        if not (isinstance(name, str) and name):
            problems.append(f"{where}: name が無い")
        if stack != "common" and not (isinstance(stack, str) and _STACK_NAME.match(stack)):
            problems.append(f"{where}: stack は 'common' か小文字の英数字とハイフン"
                            "（省くなら、その一覧の [stack] name が要る）")
        parts = str(cwd).replace("\\", "/").split("/")
        if not isinstance(cwd, str) or Path(cwd).is_absolute() or ".." in parts:
            problems.append(f"{where}: cwd は案件の中の相対パス")
        pre = []
        for j, p in enumerate(c.get("pre", [])):
            if isinstance(p, list) and len(p) == 2 and isinstance(p[0], str):
                pc = _cmd(p[1], f"{where} pre {j + 1}", problems)
                if pc:
                    pre.append((p[0], pc))
            else:
                problems.append(f"{where}: pre は [ラベル, コマンドの配列] の並び")
        probe = _cmd(c["needs_probe"], f"{where} needs_probe", problems) if "needs_probe" in c else None
        env = c.get("env", {})
        if not (isinstance(env, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in env.items())):
            problems.append(f"{where}: env は文字列の表")
            env = {}
        timeout = c.get("timeout", DEFAULT_TIMEOUT)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            problems.append(f"{where}: timeout は正の数（秒）")
            timeout = DEFAULT_TIMEOUT
        oses = tuple(c.get("os", []))
        if not all(o in _OS_NAMES.values() for o in oses):
            problems.append(f"{where}: os は {sorted(_OS_NAMES.values())} のいずれか")
        for key in ("required", "ci"):
            if key in c and not isinstance(c[key], bool):
                problems.append(f"{where}: {key} は true / false")
        for key in ("needs", "needs_path", "hint", "self_test_of"):
            if key in c and not isinstance(c[key], str):
                problems.append(f"{where}: {key} は文字列")
        recreate = None
        if "recreate_db" in c:
            rd = c["recreate_db"]
            if not (isinstance(rd, dict) and isinstance(rd.get("url"), str) and isinstance(rd.get("prefix"), str)
                    and set(rd) <= RECREATE_KEYS and isinstance(rd.get("url_env", ""), str)):
                problems.append(f"{where}: recreate_db は {{ url, prefix, url_env }} の表（url と prefix は必須の文字列）")
            elif "{SLUG}" not in rd["url"]:
                problems.append(f"{where}: recreate_db の url に {{SLUG}} が無い"
                                "（作業ツリーごとの DB 名にしないと、別の作業ツリーの DB を消す）")
            elif not _load_db().valid_prefix(rd["prefix"]):
                problems.append(f"{where}: recreate_db の prefix {rd['prefix']!r} は小文字英数字と _ で、"
                                "4 文字以上・末尾 _")
            else:
                recreate = (rd["url"], rd["prefix"], rd.get("url_env") or None)
        lists = {k: tuple(c.get(k, [])) for k in ("env_drop", "artifacts")}
        if not all(isinstance(a, str) for v in lists.values() for a in v):
            problems.append(f"{where}: env_drop / artifacts は文字列の配列")
        if isinstance(name, str) and isinstance(stack, str):
            if f"{stack}: {name}" in seen:
                problems.append(f"{where}: 同じ stack に同じ名前の検査がある")
            seen.add(f"{stack}: {name}")
        if cmd and isinstance(name, str) and isinstance(stack, str):
            full_cwd = rebase(folder, str(cwd))
            if full_cwd == ".." or full_cwd.startswith("../"):
                problems.append(f"{where}: cwd が案件の外へ抜ける")
                continue
            out.append(Check(
                name=name, stack=stack, cwd=full_cwd, cmd=cmd, needs=c.get("needs"),
                needs_path=rebase(folder, c["needs_path"]) if isinstance(c.get("needs_path"), str) else None,
                needs_probe=probe, pre=tuple(pre),
                env=tuple(sorted(env.items())), env_drop=lists["env_drop"],
                required=bool(c.get("required", True)), hint=str(c.get("hint", "")),
                timeout=float(timeout), os=oses, ci=bool(c.get("ci", True)),
                artifacts=tuple(rebase(folder, a) for a in lists["artifacts"]),
                self_test_of=c.get("self_test_of"),
                recreate_db=recreate))
    if problems:
        raise Unusable(f"local-ci: {CHECKS_FILE} の検査の定義に問題があります:\n  - " + "\n  - ".join(problems))
    if not out:
        # 検査が 0 本の『全部通った』を作らない
        raise Unusable(f"local-ci: {CHECKS_FILE} に [[check]] が 1 本も無い（何も回さずに通さない）")
    return out


# ---------------------------------------------------------------------------
# 子の環境・出力・木ごと停止
# ---------------------------------------------------------------------------
#: 文字コードの変数は既定で子へ渡さない（渡すと cp932 でしか出ない不具合を隠した）
ENCODING_ENV = ("PYTHONIOENCODING", "PYTHONUTF8", "PYTHONLEGACYWINDOWSSTDIO")
#: 自己再入の禁止。深さであって真偽値ではない
SELFTEST_DEPTH_ENV = "LOCAL_CI_SELFTEST_DEPTH"


def reentry_problem(env: dict | None = None) -> str | None:
    """local-ci が local-ci の検査から呼ばれた（入れ子）ときの拒む理由。入れ子でなければ None。

    検査の一覧に自分自身を回す検査が入ると、合成環境などで本物を引数なしに起動したとき
    無限に増える（実案件で 235 プロセスまで増えた）。後始末では防げない（kill されると
    片付けが走らない）ので、そもそも入れ子にしない。黙って成功を返すと対照が何も回さずに
    緑になるので、理由を出して rc=1 で落とす。**壊れた値は『入れ子ではない』に倒す**: 拒否に
    倒すと、環境変数が壊れただけで検査が永久に何も回さず素通りするため（元の案件の判断を踏襲）。
    """
    raw = (os.environ if env is None else env).get(SELFTEST_DEPTH_ENV, "")
    try:
        depth = int(str(raw).strip() or "0")
    except ValueError:
        depth = 0
    if depth <= 0:
        return None
    return (f"local-ci の入れ子の起動を検出した（{SELFTEST_DEPTH_ENV}={depth}）。ここで止める。"
            "検査の一覧に自分自身を回す検査があると無限に増える。対照を書くときは"
            "本物を引数なしに起動せず、判定の関数を直接呼ぶこと。")


def child_env(check_env: tuple[tuple[str, str], ...], *, inherit_encoding: bool = False,
              drop: tuple[str, ...] = (), base: dict | None = None) -> dict[str, str]:
    """子へ渡す環境。文字コードの設定は既定で引き継がず、``drop``（末尾 * は前方一致）を外し、
    検査が明示した ``env`` は必ず残す。入れ子の深さを 1 足す。"""
    env = dict(os.environ if base is None else base)
    if not inherit_encoding:
        for key in ENCODING_ENV:
            env.pop(key, None)
    for key in list(env):
        if any(key == d or (d.endswith("*") and key.startswith(d[:-1])) for d in drop):
            env.pop(key)
    env.update(dict(check_env))
    try:
        depth = max(int(str(env.get(SELFTEST_DEPTH_ENV, "0")).strip() or "0"), 0)
    except ValueError:
        depth = 0
    env[SELFTEST_DEPTH_ENV] = str(depth + 1)
    return env


def decode_output(data: bytes) -> str:
    """子の出力は**バイトで受けて**から復号する。utf-8、だめなら cp932（黙って False にしない）。"""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp932", "replace")


def kill_tree(pid: int) -> None:
    """``pid`` とその子・孫を止める。孫（xdist のワーカーなど）が残ると DB の接続も残る。"""
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, check=False)
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


TAIL_BYTES = 8192


def resolve_cmd(cmd: list[str], env: dict | None = None) -> list[str]:
    """Windows では ``npx`` / ``npm`` のような ``.cmd`` を PATH で探して、見つけた完全なパスにする。

    ``subprocess`` は ``.exe`` しか補わないので、そのままでは ``npx`` が『無い』ことになる。
    見つからなければそのまま渡す（起動できない理由が出る）。他の OS では何もしない。
    """
    if os.name != "nt" or not cmd:
        return list(cmd)
    found = shutil.which(cmd[0], path=(env or os.environ).get("PATH"))
    return [found, *cmd[1:]] if found else list(cmd)


def run_streamed(cmd: list[str], *, cwd: Path, env: dict, timeout: float,
                 quiet: bool = False) -> tuple[int | None, bytes]:
    """子を走らせ、出力（stdout と stderr）をそのまま流しつつ末尾を集める。

    返すのは (終了コード, 出力の末尾のバイト列)。時間切れは (None, ...)。時間切れでは**木ごと**止める。
    起動できない（コマンドが無い等）のは (127, 理由)。
    """
    sys.stdout.flush()
    try:
        proc = subprocess.Popen(resolve_cmd(cmd, env), cwd=str(cwd), env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, start_new_session=(os.name != "nt"))
    except OSError as exc:
        return 127, f"起動できない: {exc}".encode("utf-8")
    tail = bytearray()

    def pump() -> None:
        assert proc.stdout is not None
        with proc.stdout:
            for chunk in iter(lambda: proc.stdout.read1(65536), b""):
                if not quiet:
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                tail.extend(chunk)
                del tail[:-TAIL_BYTES]

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    try:
        rc: int | None = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        kill_tree(proc.pid)
        proc.wait()
        rc = None
    reader.join(timeout=5)  # 孫が出力の口を握ったままでも、ここで抜ける
    return rc, bytes(tail)


# ---------------------------------------------------------------------------
# 同時実行の枠（OS のファイルロック）
# ---------------------------------------------------------------------------
# pid の生死で判定する方式は取らない: Windows は pid がすぐ別のプロセスに再利用され、死んだ枠が
# 生きて見える。OS のロックはプロセスの死（kill -9 / taskkill /F を含む）と同時に解ける。
# 中身の pid と時刻は表示にだけ使う。
DEFAULT_SLOTS = 3
DEFAULT_SLOT_WAIT = 600.0


class SlotTimeout(Exception):
    """待ち時間の上限に達した。空きとして扱わない。"""


def slots_dir() -> Path:
    return Path(os.environ.get("LOCAL_CI_SLOTS_DIR") or Path(tempfile.gettempdir()) / "local-ci-slots")


def _lock(fh) -> bool:
    try:
        if os.name == "nt":
            import msvcrt
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _unlock(fh) -> None:
    try:
        if os.name == "nt":
            import msvcrt
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh, fcntl.LOCK_UN)
    except OSError:
        pass


class Slot:
    """取った枠。``with`` で抜けるか close() で返す。プロセスが死ねば OS が返す。"""

    def __init__(self, fh, index: int):
        self._fh, self.index = fh, index

    def close(self) -> None:
        if self._fh is not None:
            _unlock(self._fh)
            self._fh.close()
            self._fh = None

    def __enter__(self) -> "Slot":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def _try_slot(directory: Path, index: int) -> Slot | None:
    fh = open(directory / f"slot-{index}.lock", "a+b")  # 非継承（子へ渡らない）
    if not _lock(fh):
        fh.close()
        return None
    try:  # 表示用。失敗しても枠は取れている
        fh.seek(0)
        fh.truncate()
        fh.write(f"{os.getpid()} {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n".encode())
        fh.flush()
    except OSError:
        pass
    return Slot(fh, index)


def slots_in_use(n: int, directory: Path | None = None) -> int:
    """使用中の枠の数（各枠のロックを試して、取れなかったものを数える）。"""
    d = directory or slots_dir()
    d.mkdir(parents=True, exist_ok=True)
    used = 0
    for i in range(n):
        s = _try_slot(d, i)
        if s is None:
            used += 1
        else:
            s.close()
    return used


def acquire_slot(n: int, *, wait: float, say=print, directory: Path | None = None,
                 poll: float = 1.0) -> Slot:
    """空いている枠を 1 つ取る。無ければ待つ（**待つのは空きだけ**。他人が全部終わるのは待たない）。

    待ち時間に上限を付け、超えたら SlotTimeout（空きとして扱わない）。
    """
    d = directory or slots_dir()
    d.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + wait
    announced = 0
    while True:
        for i in range(n):
            s = _try_slot(d, i)
            if s is not None:
                return s
        if time.monotonic() >= deadline:
            raise SlotTimeout(f"枠（同時 {n} 本）が {wait:g} 秒空かなかった")
        if announced % 10 == 0:
            say(f"  … 他の local-ci が {n} 本走っているので待っています（上限 {wait:g} 秒）")
        announced += 1
        time.sleep(poll)


def workers_for(in_use: int, cpu: int | None = None) -> int:
    """``{WORKERS}`` = clamp(cpu // 2, 1, 8)。ほかに local-ci が走っているときは 4 まで下げる。"""
    base = max(1, min(8, (cpu or os.cpu_count() or 2) // 2))
    return min(base, 4) if in_use > 1 else base


# ---------------------------------------------------------------------------
# 検査を回す
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RunContext:
    root: Path
    base_sha: str
    slug: str
    workers: int
    inherit_encoding: bool = False
    ci: bool = False


def worktree_slug(root: Path) -> str:
    """作業ツリーごとの 8 桁。DB 名などを worktree ごとに分けたい stack が ``{SLUG}`` で使う。"""
    return hashlib.sha1(str(root.resolve()).encode("utf-8")).hexdigest()[:8]


def expand(cmd: tuple[str, ...], ctx: RunContext) -> list[str]:
    subs = {"{PYTHON}": sys.executable, "{BASE_SHA}": ctx.base_sha, "{SLUG}": ctx.slug,
            "{WORKERS}": str(ctx.workers)}

    def one(part: str) -> str:
        for k, v in subs.items():
            part = part.replace(k, v)
        return part
    return [one(p) for p in cmd]


def _load_db():
    """確認つき DB 作り直しの部品（同じフォルダの local_ci_db.py）。使う検査があるときだけ読む。"""
    here = str(Path(__file__).resolve().parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    try:
        import local_ci_db
    except ImportError:
        raise Unusable("local-ci: DB の作り直し（recreate_db）に要る local_ci_db.py が、このスクリプトと同じフォルダに無い")
    return local_ci_db


def _skip_reason(c: Check, ctx: RunContext, cwd: Path, env: dict) -> str | None:
    if c.recreate_db and shutil.which(_load_db().psql_command()) is None:
        return "psql が無い（DB の作り直しに要る）"
    if c.needs and shutil.which(c.needs) is None:
        return f"{c.needs} が無い"
    if c.needs_path and not (ctx.root / c.needs_path).exists():
        return f"{c.needs_path} が無い（依存を入れていない）"
    if c.needs_probe:
        rc, _ = run_streamed(expand(c.needs_probe, ctx), cwd=cwd, env=env, timeout=60, quiet=True)
        if rc != 0:
            return f"依存の確認（{' '.join(c.needs_probe)}）が通らない（rc={rc}）"
    return None


def run_one(c: Check, ctx: RunContext, say=print) -> dict:
    """1 本の検査を回して記録の 1 行にする。

    見送り（skipped）は通ったことにしない。『道具が無い』と『検査が落ちた』は混ぜず、
    見送り・失敗には hint（どうすれば回せるか）を付ける。下ごしらえの失敗は fail
    （見送りに化けさせると、手順の踏み損ねが『環境が無かった』になる）。
    """
    row = {"name": c.label, "stack": c.stack, "status": "pass", "required": c.required, "seconds": 0.0}
    here = _OS_NAMES.get(sys.platform, sys.platform)
    if c.os and here not in c.os:
        return {**row, "status": "out_of_scope", "reason": f"OS {here} は対象外（{', '.join(c.os)} のみ）"}
    if ctx.ci and not c.ci:
        return {**row, "status": "out_of_scope", "reason": "CI では回さない検査（手元だけ）"}
    cwd = ctx.root / c.cwd
    env = child_env(c.env, inherit_encoding=ctx.inherit_encoding, drop=c.env_drop)
    if not cwd.is_dir():
        missing: str | None = f"{c.cwd} が無い"
    else:
        missing = _skip_reason(c, ctx, cwd, env)
    if missing:
        hint = f"\n      {c.hint}" if c.hint else ""
        if ctx.ci and c.required:
            # CI で道具が無いのは環境の欠陥。手元の甘さを持ち込まない
            say(f"  NG 見送れない（--ci） {c.label}（{missing}）{hint}")
            return {**row, "status": "fail", "reason": f"--ci では見送れない: {missing}{hint}"}
        say(f"  - {'見送り' if c.required else '任意'}  {c.label}（{missing}）{hint}")
        return {**row, "status": "skipped", "reason": f"{missing}{hint}"}
    say(f"  >> {c.label}")
    t0 = time.time()
    if c.recreate_db:
        # DROP の前の確認は local_ci_db が全部持つ。確認を通らなければ消さずに fail（見送りにしない）
        db = _load_db()
        url, prefix, url_env = c.recreate_db
        try:
            url = db.recreate(expand((url,), ctx)[0], prefix, ctx.slug, say)
        except db.DbRefused as exc:
            why = f"DB の作り直しを止めた: {exc}" + (f"\n      {c.hint}" if c.hint else "")
            say(f"    NG {why}")
            return {**row, "status": "fail", "code": None, "reason": why, "seconds": round(time.time() - t0, 1)}
        if url_env:
            env = {**env, url_env: url}
    for label, pcmd in c.pre:
        say(f"    - {label}")
        rc, tail = run_streamed(expand(pcmd, ctx), cwd=cwd, env=env, timeout=c.timeout)
        if rc != 0:
            why = (f"下ごしらえ『{label}』が" + ("時間切れ" if rc is None else f"失敗した（rc={rc}）")
                   + (f"\n      {c.hint}" if c.hint else ""))
            say(f"    NG {why}")
            return {**row, "status": "fail", "code": rc, "reason": why, "seconds": round(time.time() - t0, 1),
                    "tail": decode_output(tail)[-2000:]}
    rc, tail = run_streamed(expand(c.cmd, ctx), cwd=cwd, env=env, timeout=c.timeout)
    dt = round(time.time() - t0, 1)
    if rc is None:
        why = f"制限時間 {c.timeout:g} 秒を超えたので木ごと止めた"
        say(f"    NG {dt} 秒（{why}）")
        return {**row, "status": "timeout", "code": None, "reason": why, "seconds": dt,
                "tail": decode_output(tail)[-2000:]}
    ok = rc == 0
    say(f"    {'OK' if ok else 'NG'} {dt} 秒")
    out = {**row, "status": "pass" if ok else "fail", "code": rc, "seconds": dt}
    if not ok:
        out["tail"] = decode_output(tail)[-2000:]
        if c.hint:
            out["reason"] = c.hint
    return out


def run_checks(checks: list[Check], stacks: set[str], ctx: RunContext, say=print) -> list[dict]:
    """``common`` と選ばれた stack の検査を、定義の順に 1 本ずつ回す（v1 は直列）。"""
    return [run_one(c, ctx, say) for c in checks if c.stack == "common" or c.stack in stacks]


# ---------------------------------------------------------------------------
# コマンド
# ---------------------------------------------------------------------------
def check_one(root: Path, sha: str, cfg: Config, *, label: str, out=sys.stdout) -> bool:
    t = target_for(root, sha, cfg.base)
    print(f"[{label}] 比較元 {t.base} ({t.base_sha[:8]})", file=out)
    if t.digest is None:
        print(f"[{label}] 差分なし（記録は要らない）", file=out)
        return True
    print(f"[{label}] 差分 {len(t.files)} ファイル / ハッシュ {t.digest}", file=out)
    rec, why = read_record(root, t.digest)
    if why:
        print(f"[{label}] NG {why}", file=out)
        return False
    ok, reason = record_is_ok(rec, base_sha=t.base_sha, head_tree=t.head_tree,
                              now_probes=run_probes(root, cfg.tool_probes, cfg.probe_dirs))
    print(f"[{label}] {'OK' if ok else 'NG'} {reason}", file=out)
    return ok


def cmd_status(root: Path, base_spec: str | None, sha: str | None = None) -> int:
    cfg = load_config(root)
    if base_spec:
        cfg = Config(base_spec, cfg.tool_probes, cfg.probe_dirs)
    sha = sha or _git_ok(root, "rev-parse", "HEAD").strip()
    return 0 if check_one(root, sha, cfg, label=sha[:8]) else 1


def cmd_pre_push(root: Path, stdin_text: str, base_spec: str | None) -> int:
    """標準入力の ``<local ref> <local sha> <remote ref> <remote sha>`` ごとに、押す sha で判定する。

    HEAD を見ない: ``git push origin other`` で HEAD 以外のブランチを押しても、別の記録で
    通ってしまわない。消すだけの push（local sha が 0）は見ない。複数あれば全部通ること。
    """
    cfg = load_config(root)
    if base_spec:
        cfg = Config(base_spec, cfg.tool_probes, cfg.probe_dirs)
    shas: dict[str, str] = {}
    for line in stdin_text.splitlines():
        parts = line.split()
        if len(parts) != 4:
            continue
        ref, sha = parts[0], parts[1]
        if _ZERO_SHA.match(sha):
            continue
        shas.setdefault(sha, ref)
    if not shas:
        print("local-ci: 検査が要る ref が無い（削除のみ、または何も押さない）", file=sys.stderr)
        return 0
    ok = True
    for sha, ref in shas.items():
        ok = check_one(root, sha, cfg, label=f"{ref} {sha[:8]}") and ok
    return 0 if ok else 1


def main(argv: list[str] | None = None, *, root: Path = ROOT) -> int:
    # 日本語 Windows の端末は cp932。出せない文字（検査名や子の出力に混ざる記号）で本体が落ちると、
    # 『検査が通った』でも『落ちた』でもない状態になる。落とさず ? に置き換える。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        return _main(argv, root)
    except Unusable as exc:
        # 使えないことを『通ってよい』にも『差分なし』にもしない（rc=2。pre-push はこれも止める）
        sys.stderr.write(f"{exc}\n")
        return 2


def _main(argv: list[str] | None, root: Path) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true", help="HEAD の差分に合う記録があるか")
    ap.add_argument("--pre-push", action="store_true", help="git の pre-push から（標準入力を読む）")
    ap.add_argument("--base", help=f"比較元（既定: {CHECKS_FILE} の [local_ci] base、無ければ {DEFAULT_BASE}）")
    ap.add_argument("--sha", help="--status で HEAD でなくこの sha を判定する")
    ap.add_argument("--allow-dirty", action="store_true", help="検査だけ回す（記録は作らない）")
    ap.add_argument("--ci", action="store_true",
                    help="CI 用: 記録も枠も作らず、同じ一覧を回して rc を返す。見送りは fail にする")
    ap.add_argument("--plan", action="store_true", help="何を回すかだけ出して、検査は回さない")
    ap.add_argument("--stacks", help="回す stack をカンマ区切りで指定（既定: 一覧にある全部）")
    ap.add_argument("--inherit-encoding", action="store_true",
                    help="PYTHONIOENCODING などの文字コード変数を子へも渡す（既定は渡さない。記録に残る）")
    args = ap.parse_args(argv)
    if args.status:
        return cmd_status(root, args.base, args.sha)
    if args.pre_push:
        return cmd_pre_push(root, sys.stdin.buffer.read().decode("utf-8", "replace"), args.base)
    return cmd_run(root, args)


def cmd_run(root: Path, args: argparse.Namespace) -> int:
    """検査を回して記録する。関門（入れ子・汚れ）は実行より前に効かせ、終了コードへつなぐ。"""
    problem = reentry_problem()
    if problem:
        sys.stderr.write(f"{problem}\n")
        return 1
    cfg = load_config(root)  # 壊れた設定は実行の前に止める
    base_spec = args.base or cfg.base
    # 汚れの関門は何を回すか決めるより前に効かせる（10 分かけたあとで『記録は作れません』にしない）
    reason = None
    if not args.ci:
        reason = dirty_gate(worktree_dirt(root), allow_dirty=args.allow_dirty)
        if reason and not args.allow_dirty:
            sys.stderr.write(f"local-ci: {reason}\n")
            return 1
        if reason:
            sys.stderr.write(f"local-ci: {reason}\n")
    checks = load_checks(root)
    known = {c.stack for c in checks if c.stack != "common"}
    stacks = known
    if args.stacks:
        stacks = {s.strip() for s in args.stacks.split(",") if s.strip()}
        unknown = sorted(stacks - known)
        if unknown:
            raise Unusable(f"local-ci: 一覧に無い stack: {', '.join(unknown)}（ある stack: {', '.join(sorted(known))}）")
    uses_base = any("{BASE_SHA}" in a for c in checks for a in c.cmd)

    if args.ci:  # 記録も枠も作らない。同じ一覧を回して rc を返す（手元の記録は CI からは見えない）
        base_sha = resolve_base(base_spec, root)[1] if uses_base else ""
        ctx = RunContext(root, base_sha, worktree_slug(root), workers_for(0), args.inherit_encoding, ci=True)
        rows = run_checks(checks, stacks, ctx)
        verdict = verdict_of(rows)
        print(f"\n判定   : {verdict}（--ci。記録は作らない）")
        return 0 if verdict == "pass" else 1

    head = _git_ok(root, "rev-parse", "HEAD").strip()
    target = target_for(root, head, base_spec)
    if target.digest is None:
        print(f"{target.base} ({target.base_sha[:8]}) との差分がありません。回すものがありません。")
        return 0
    todo = [c for c in checks if c.stack == "common" or c.stack in stacks]
    print(f"比較元 : {target.base} ({target.base_sha[:8]})")
    print(f"差分   : {len(target.files)} ファイル / ハッシュ {target.digest}")
    print(f"対象   : {', '.join(sorted(stacks)) or '（共通のみ）'}（検査 {len(todo)} 本）")
    if args.plan:
        for c in todo:
            print(f"  - {c.label}")
        return 0
    n = int(os.environ.get("LOCAL_CI_MAX_CONCURRENT") or DEFAULT_SLOTS)
    wait = float(os.environ.get("LOCAL_CI_SLOT_WAIT") or DEFAULT_SLOT_WAIT)
    try:
        slot = acquire_slot(n, wait=wait)
    except SlotTimeout as exc:
        # 時間切れを『空き』として扱わない（沈黙が成功に化ける）
        sys.stderr.write(f"local-ci: {exc}。記録は作りません\n")
        return 2
    with slot:
        workers = workers_for(slots_in_use(n))
        ctx = RunContext(root, target.base_sha, worktree_slug(root), workers, args.inherit_encoding)
        print(f"枠     : {slot.index + 1}/{n}（workers={workers}）")
        print()
        rows = run_checks(checks, stacks, ctx)
    probes = run_probes(root, cfg.tool_probes, cfg.probe_dirs)  # 検査が環境を変えうるので、終わった後の姿を残す
    verdict = verdict_of(rows)
    print()
    if reason:  # --allow-dirty
        print("記録   : ★ 作りませんでした ★ 未コミットの変更があるためです")
        print(f"判定   : {verdict}（検査の結果。push の根拠にはなりません）")
        return 0 if verdict == "pass" else 1
    try:
        path = write_record(root, target, rows, probes, jobs=1, inherit_encoding=args.inherit_encoding)
    except RecordRefused as exc:
        print(f"記録   : ★ 作りませんでした ★ {exc}")
        print(f"判定   : {verdict}（検査の結果。push の根拠にはなりません。回し直してください）")
        return 1
    print(f"記録   : {path.relative_to(root).as_posix()}")
    rec, why = read_record(root, target.digest)
    ok, msg = record_is_ok(rec, base_sha=target.base_sha, head_tree=target.head_tree, now_probes=probes)
    print(f"判定   : {'OK' if ok else 'NG'} {msg}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
