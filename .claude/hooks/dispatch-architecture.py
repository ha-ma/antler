#!/usr/bin/env python3
"""複数 stack のチェッカーを呼び分ける PreToolUse の hook（dispatcher）。

各 stack のチェッカー（``check-*-architecture.py``）は「単一の stack が案件の直下にある」前提で
書かれており、``app/**`` や ``src/**`` のようなパス片で判定する。無条件に全部走らせると互いに誤爆する
（別の stack の ``src/app/`` を、ある stack の ``app/`` の規則が掴む、など）。そこで編集先を先に
決め、**名指しされた stack のチェッカーだけ**に、受け取った stdin を**そのまま**渡す。

振り分けの規則は案件の ``routes.toml``（stack-routes 部品が読む）。ここには持たない。

    [stack.api]
    ratchet = true                           # 既存ファイルは警告のみ、新規ファイルは止める
    checker = "check-fastapi-architecture.py"  # この hook と同じフォルダのチェッカー

    [[route]]
    pattern = '^backend/'
    stacks = ["api"]

判断の原則
==========
* **名指しされていないものは検査しない。** どの規則にも当たらないパス、``stacks = []``、
  ``["*"]`` は何も呼ばない（検査を回す側と違い、止める側は『迷ったら全部』にしない: 誤爆するため）
* **stdin はバイトで読み、バイトのまま渡す。** ロケール（cp932 など）で復号して再符号化すると、
  日本語を含む入力で落ち、落ちた回だけ規約の遮断が効かなくなる
* **決められないときは黙って通さず、止めもしない。** ``routes.toml`` が無い・壊れている、
  チェッカーが無い・出力が読めない、は**目に見える警告**を標準エラーに出す。終了コード 2 は使わない
  （2 は編集やコマンドの実行そのものを止める。設定の不備で全部が止まる）。壊れた設定は終了コード 1
  （ブロックしない失敗）で、利用者の画面に出る
* Bash / PowerShell は、コマンドの中のパスらしい語を ``routes.toml`` に当てて、触る stack を決める。
  既存/新規は区別できないので、ラチェットは掛けない（シェルでソースを生成するな、という規約は
  既存ファイルにも掛かる）

案件固有の規則は ``dispatch_local_rules.py``（任意。同じフォルダ）に書く。``local_violations(tool_input,
relative, stack)`` が理由の文字列の配列を返す。
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path, PurePath

HOOKS_DIR = Path(__file__).resolve().parent
LOCAL_RULES = "dispatch_local_rules.py"
#: コマンドの中の『パスらしい語』を取り出す。引用符・区切り・リダイレクトで切る
_TOKEN = re.compile(r"""[^\s'"`=();|&<>,]+""")


def project_root() -> Path:
    """案件のルート。``CLAUDE_PROJECT_DIR`` があればそれ、無ければ ``.claude/hooks/`` の 2 つ上。"""
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    return Path(env).resolve() if env else HOOKS_DIR.parents[1]


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class ConfigProblem(Exception):
    """routes.toml や stack-routes が使えない。"""


def load_routes(root: Path):
    """``(stack_routes のモジュール, 読み込んだ設定)``。使えなければ ConfigProblem。"""
    module_path = root / "scripts" / "stack_routes.py"
    if not module_path.is_file():
        raise ConfigProblem(f"{module_path} が無い（stack-routes 部品が要る: "
                            "bootstrap.py --tools-only --with-tools stack-routes）")
    sr = _load_module(module_path, "stack_routes_for_dispatch")
    try:
        return sr, sr.load(str(root / "routes.toml"))
    except sr.RoutesError as exc:
        raise ConfigProblem(str(exc))


def relative_path(file_path: str, root: Path) -> str:
    """編集先を、案件のルートからの ``/`` 区切りの相対パスにする。ルートの外・相対にできないときは元の表記。"""
    raw = PurePath(file_path)
    if raw.is_absolute():
        try:
            return Path(file_path).resolve().relative_to(root).as_posix()
        except (ValueError, OSError):
            pass
    return str(raw).replace("\\", "/")


def stacks_of_command(command: str, sr, cfg: dict, root: Path) -> list[str]:
    """Bash / PowerShell のコマンドが触る stack（宣言順）。

    コマンドの中のパスらしい語を ``routes.toml`` に当てる。``cd backend`` のように末尾の ``/`` が
    ない語も、``/`` を足して当てる。
    """
    found: set[str] = set()
    for token in _TOKEN.findall(command):
        rel = relative_path(token, root) if (":" in token or token.startswith(("/", "\\"))) else token.replace("\\", "/")
        for candidate in (rel, rel.rstrip("/") + "/"):
            found |= sr.named_stacks(candidate, cfg)
    return [name for name in cfg["stack"] if name in found]


def deny_reason(stdout: str) -> str | None:
    stripped = stdout.strip()
    if not stripped:
        return None
    try:
        out = json.loads(stripped).get("hookSpecificOutput", {})
    except (json.JSONDecodeError, AttributeError):
        raise ValueError("チェッカーの出力が JSON として読めない")
    if out.get("permissionDecision") != "deny":
        return None
    return out.get("permissionDecisionReason") or "Architecture violation."


def run_checker(script: Path, payload: bytes) -> tuple[str, str]:
    r = subprocess.run([sys.executable, str(script)], input=payload, capture_output=True, check=False)
    return r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")


def warn(message: str) -> None:
    print(f"dispatch-architecture: {message}", file=sys.stderr)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    # バイトで読む（ロケールで復号して再符号化しない）。子へもこのバイトをそのまま渡す
    raw_bytes = sys.stdin.buffer.read() or b"{}"
    try:
        payload = json.loads(raw_bytes.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return 0
    tool_input = payload.get("tool_input", {}) if isinstance(payload, dict) else {}
    if not isinstance(tool_input, dict):
        return 0

    root = project_root()
    try:
        sr, cfg = load_routes(root)
    except ConfigProblem as exc:
        # 決められない。黙って通さず目に見える形で知らせる。ブロックはしない（終了コード 1）
        warn(f"設定が使えないので、この編集は検査していません: {exc}")
        return 1

    command = tool_input.get("command")
    if isinstance(command, str):
        # Bash / PowerShell。既存か新規かは分からないので、ラチェットは掛けない
        targets = [(name, False, None) for name in stacks_of_command(command, sr, cfg, root)]
    else:
        file_path = tool_input.get("file_path") or tool_input.get("file") or tool_input.get("notebook_path") or ""
        if not isinstance(file_path, str) or not file_path:
            return 0
        rel = relative_path(file_path, root)
        existing = False
        try:
            p = Path(file_path)
            existing = (p if p.is_absolute() else root / p).is_file()
        except OSError:
            pass
        targets = [(name, existing, rel) for name in cfg["stack"] if name in sr.named_stacks(rel, cfg)]
    if not targets:
        return 0

    local_rules = None
    if (HOOKS_DIR / LOCAL_RULES).is_file() and not isinstance(command, str):
        local_rules = _load_module(HOOKS_DIR / LOCAL_RULES, "dispatch_local_rules")

    reasons: list[str] = []
    for name, existing, rel in targets:
        spec = cfg["stack"][name]
        ratcheted = bool(spec.get("ratchet")) and existing
        denials: list[str] = []
        checker = spec.get("checker")
        if checker:
            script = HOOKS_DIR / checker
            if not script.is_file():
                warn(f"[{name}] チェッカー {checker} が {HOOKS_DIR} に無いので、この stack は検査していません")
            else:
                stdout, stderr = run_checker(script, raw_bytes)
                if stderr:
                    print(stderr.rstrip("\n"), file=sys.stderr)
                try:
                    denial = deny_reason(stdout)
                except ValueError as exc:
                    warn(f"[{name}] {exc}（{checker}）。この stack は検査できていません: {stdout.strip()[:120]!r}")
                    denial = None
                if denial:
                    denials.append(denial)
        if local_rules is not None and rel is not None:
            for message in local_rules.local_violations(tool_input, rel, name):
                if message not in denials:
                    denials.append(message)
        if not denials:
            continue
        reason = "\n".join(denials)
        if ratcheted:
            # 規約より先に存在したコード。新規ファイルだけを縛る
            print(f"WARNING: [{name}] 既存ファイルのため通します（新規ファイルならブロック対象）。\n{reason}",
                  file=sys.stderr)
            continue
        reasons.append(f"[{name}] {reason}")

    if reasons:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "deny",
            "permissionDecisionReason": "\n\n".join(reasons)}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
