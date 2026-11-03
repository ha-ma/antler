#!/usr/bin/env python3
"""SFAD guard: spec-artifact structure checks, launch gate, and commit checks.

Scope discipline: this hook guards SFAD's own artifacts (docs/specs/**) and
process gates. Code-level rules (layer boundaries, security patterns) are the
stack layer's jurisdiction — never duplicated here.

Severity model (redesign principle 3):
- deny: unambiguous structural violations only (empty matrix cells,
  missing frontmatter, secrets staged for commit). For Edit/MultiEdit the
  post-edit full content is reconstructed from disk; when reconstruction is
  impossible the check is skipped rather than risking a false deny.
- warn: everything judgement-based (launch gate, placeholder words,
  unresolved questions, missing tests). Warnings are emitted as a
  `systemMessage` JSON (exit-0 stderr visibility is undefined in the hooks
  spec) and promoted to deny only after false-positive rates are measured.
Every firing is appended to .claude/logs/sfad-guard.jsonl for measurement.

Requires `python` on PATH; substitute `python3` in the settings wiring on
systems where the launcher is named python3.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import PurePath

SPEC_DIR_RE = re.compile(r"(^|/)docs/specs/([^/]+)/([^/]+\.md)$")
SOURCE_FILE_RE = re.compile(r"(^|/)(src|app)/.*\.(py|ts|tsx|js|jsx|php|astro)$")
TEST_FILE_RE = re.compile(r"(^|/)(tests?/|__tests__/|[^/]*\.(test|spec)\.[^/]+$|[^/]*Test\.php$|test_[^/]+\.py$)")
PLACEHOLDER_WORDS_RE = re.compile(r"TODO|未定|たぶん|とりあえず|あとで決める")
SECRET_FILE_RE = re.compile(
    r"(^|/)\.env(\..+)?$|\.pem$|\.p12$|\.pfx$|(^|/)id_rsa|\.key$|(^|/)(credentials|secrets?)\.(json|ya?ml|toml)$",
    flags=re.IGNORECASE,
)
SECRET_ALLOW_RE = re.compile(r"\.(example|sample|template|dist|pub)$|\.md$", flags=re.IGNORECASE)
GIT_COMMIT_RE = re.compile(r"(^|\s)git\s+commit\b")
# add-all forms stage everything (incl. untracked); commit -a/-am stages tracked only.
GIT_ADD_ALL_RE = re.compile(r"(^|\s)git\s+add\s+(?:[^|;&]*\s)?(?:-A\b|--all\b|\.(?=\s|$))")
GIT_COMMIT_TRACKED_ALL_RE = re.compile(r"(^|\s)git\s+commit\s+(?:[^|;&]*\s)?(?:-a\b|-am\b|--all\b)")
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)

FUNCTIONAL_REQUIRED_KEYS = ("feature", "target_paths", "tier")
MATRIX_CHECKED_FILES = ("threat.md", "resilience.md")


def _log(kind: str, detail: str, path: str = "") -> None:
    try:
        os.makedirs(".claude/logs", exist_ok=True)
        with open(".claude/logs/sfad-guard.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "kind": kind,
                "path": path,
                "detail": detail,
            }, ensure_ascii=False) + "\n")
    except OSError:
        pass


DENIED = False


def _deny(messages: list[str], path: str = "", footer: str | None = None) -> int:
    global DENIED
    DENIED = True
    default_footer = (
        "Rule: specs are machine-checked artifacts. Empty cells and missing "
        "frontmatter defeat the omission-detection that SFAD exists for."
    )
    reason = "\n".join([
        "SFAD guard violation. Fix and retry.",
        *[f"- {m}" for m in messages],
        footer if footer is not None else default_footer,
    ])
    _log("deny", "; ".join(messages)[:300], path)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))
    return 0


def _emit_warnings(warnings: list[str], path: str = "", paths: list[str] | None = None) -> None:
    """Emit every warning as ONE systemMessage (the hook contract is one JSON).

    `paths` gives a per-warning path when a single command produced warnings about
    several files; without it the launch-gate dedupe would log an empty path and
    then warn about the same file forever.
    """
    if not warnings:
        return
    for i, w in enumerate(warnings):
        _log("warn", w[:300], (paths[i] if paths and i < len(paths) else path))
        print(f"SFAD: {w}", file=sys.stderr)
    # exit-0 stderr visibility is undefined in the hooks spec; systemMessage is
    # the documented channel for surfacing non-blocking messages.
    print(json.dumps({"systemMessage": "SFAD: " + " / ".join(warnings)}, ensure_ascii=False))


def _split_command_segments(command: str) -> list[str]:
    """Split a shell command into top-level segments, ignoring separators inside quotes."""
    segments: list[str] = []
    current: list[str] = []
    quote: str | None = None
    i = 0
    n = len(command)
    while i < n:
        char = command[i]
        if quote is not None:
            current.append(char)
            if char == quote:
                quote = None
            i += 1
            continue
        if char in ("'", '"'):
            quote = char
            current.append(char)
            i += 1
            continue
        if char in "&|" and i + 1 < n and command[i + 1] == char:
            segments.append("".join(current))
            current = []
            i += 2
            continue
        if char in ";|&\n":
            segments.append("".join(current))
            current = []
            i += 1
            continue
        current.append(char)
        i += 1
    segments.append("".join(current))
    return segments


def _effective_content(tool_input: dict, normalized: str) -> str | None:
    """Return the post-edit full content, or None when it cannot be known safely.

    Write → the provided content is the full file.
    Edit/MultiEdit → read the file from disk and apply the replacements; if the
    file is unreadable or an old_string does not match, return None so the
    caller skips content checks instead of denying on a fragment.
    """
    content = tool_input.get("content")
    if isinstance(content, str):
        return content.lstrip("﻿").replace("\r\n", "\n")

    file_path = tool_input.get("file_path") or tool_input.get("file") or ""
    try:
        with open(file_path, encoding="utf-8-sig", errors="replace") as f:
            current = f.read()
    except OSError:
        return None

    edits = tool_input.get("edits")
    if not isinstance(edits, list):
        single = {}
        if "old_string" in tool_input or "new_string" in tool_input:
            single = {
                "old_string": tool_input.get("old_string", ""),
                "new_string": tool_input.get("new_string", ""),
                "replace_all": tool_input.get("replace_all", False),
            }
        edits = [single] if single else []
    if not edits:
        return None

    for edit in edits:
        if not isinstance(edit, dict):
            return None
        old = edit.get("old_string", "")
        new = edit.get("new_string", "")
        if not old:
            return None
        if old not in current:
            return None  # the edit will fail anyway; do not judge a fragment
        current = current.replace(old, new) if edit.get("replace_all") else current.replace(old, new, 1)

    return current.replace("\r\n", "\n")


def _parse_frontmatter(content: str) -> dict | None:
    match = re.match(r"^---\n(.*?)\n---\n", content, re.DOTALL)
    if not match:
        return None
    keys: dict[str, str] = {}
    current_key: str | None = None
    for line in match.group(1).splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            current_key = m.group(1)
            keys[current_key] = m.group(2)
            continue
        item = re.match(r"^\s+-\s+(.*)$", line)
        if item and current_key is not None:
            keys[current_key] = (keys[current_key] + " " + item.group(1)).strip()
    return keys


SEPARATOR_ROW_RE = re.compile(r"^\|[\s:|-]+\|$")
# A bare dash or a bare "N/A" is indistinguishable from "nobody looked at this
# cell", so it counts as unfilled. "- 理由" / "N/A: 理由" carry a decision and pass.
UNFILLED_CELL_RE = re.compile(r"^(?:[-‐-―]+|[Nn]/?[Aa][.:：]?)$")


def _empty_table_cells(content: str) -> list[str]:
    """Return locations of unfilled cells in markdown tables.

    The header row is located **relative to the separator row** -- it is the
    pipe line directly above it -- not by its offset from the start of a table
    block. A data row whose cells are all dashes is still checked, and code
    fences are excluded.

    Why not count from the start of the block: any line that did not start and
    end with ``|`` reset the counter, so the next data row was taken for a
    header and skipped. Generators that interleave HTML comments between rows
    therefore had **every** row skipped.

    Measured on a synthetic table with 6 bare-dash cells: the old code
    reported 6 when the rows were contiguous, 4 with a comment above only the
    first row, 2 when blank lines split the rows, and **0** with a comment line
    above each row.
    """
    problems: list[str] = []
    scan_target = CODE_FENCE_RE.sub(lambda m: "\n" * m.group(0).count("\n"), content)
    lines = scan_target.splitlines()
    pipe_rows = [
        i
        for i, line in enumerate(lines)
        if line.strip().startswith("|") and line.strip().endswith("|")
    ]
    dash_only = {i for i in pipe_rows if SEPARATOR_ROW_RE.match(lines[i].strip())}
    # A dash-only row is a separator only when the pipe row above it is *not*
    # dash-only. That keeps the original guarantee: a data row whose cells are
    # all dashes still gets checked, because the row above it is the separator.
    separators = {
        row
        for k, row in enumerate(pipe_rows)
        if row in dash_only and (k == 0 or pipe_rows[k - 1] not in dash_only)
    }
    # Lines that are not pipe rows (comments, blank lines) are transparent here
    # on purpose: they must not turn a data row into a header.
    headers = {
        pipe_rows[k - 1]
        for k, row in enumerate(pipe_rows)
        if k > 0 and row in separators
    }
    for i in pipe_rows:
        if i in separators or i in headers:
            continue
        stripped = lines[i].strip()
        for j, cell in enumerate(stripped.strip("|").split("|")):
            if not cell.strip() or UNFILLED_CELL_RE.match(cell.strip()):
                problems.append(f"L{i + 1} 列{j + 1}")
    return problems


def _handle_spec_write(normalized: str, filename: str, tool_input: dict) -> int:
    content = _effective_content(tool_input, normalized)
    if content is None:
        return 0  # cannot reconstruct post-edit content — never deny on a fragment

    messages: list[str] = []
    warnings: list[str] = []

    if filename == "functional.md":
        fm = _parse_frontmatter(content)
        if fm is None:
            messages.append(
                "functional.md に frontmatter がありません。feature / target_paths / tier "
                "を必ず記入してください（drift 検出の錨になります）。テンプレート: "
                "references/spec-template-{fe,be}.md"
            )
        else:
            missing = [k for k in FUNCTIONAL_REQUIRED_KEYS if not fm.get(k, "").strip()]
            if missing:
                messages.append(f"functional.md の frontmatter に必須キーが不足または空です: {', '.join(missing)}")
            else:
                # Tier は儀式の重さを決める脱出口（Tier 0 は全ゲートが外れる）。
                # 脱出口があるのは設計だが、通過が記録されないのは別問題なので残す。
                _log("tier", f"tier={fm.get('tier', '').strip()}", _repo_relative(normalized))
        # Capture the whole Questions section (prose between heading and bullets
        # is allowed by the templates) and count only TOP-LEVEL bullets — nested
        # bullets belong to their parent question.
        q_sec = re.search(r"##+\s*Questions?[^\n]*\n(.*?)(?=\n##\s|\Z)", content, re.DOTALL)
        if q_sec and re.search(r"##\s*Test List", content):
            bullets = [line for line in q_sec.group(1).splitlines() if re.match(r"[-*]\s+", line)]
            open_questions = [b for b in bullets if "[Deferred:" not in b]
            if open_questions:
                warnings.append(
                    "Questions（赤カード）が未解決のまま Test List が記述されています。"
                    "Discovery に戻るか、答えられないものは [Deferred: 担当/期日/暫定挙動] にしてください。"
                )
            bad_deferred = [
                b for b in bullets
                if "[Deferred:" in b and not all(k in b for k in ("担当", "期日", "暫定"))
            ]
            if bad_deferred:
                warnings.append(
                    "Deferred に3点セット（担当・期日・暫定挙動）が揃っていない項目があります。"
                )

    if filename in MATRIX_CHECKED_FILES:
        empty = _empty_table_cells(content)
        if empty:
            messages.append(
                f"{filename} のマトリクスに未記入セルがあります（{'、'.join(empty[:5])}"
                f"{' ほか' if len(empty) > 5 else ''}）。空欄・裸の「-」・理由なしの「N/A」は禁止 — 全セルを埋めるか、"
                "該当しない場合は「N/A: 理由」を記入してください。"
            )

    if PLACEHOLDER_WORDS_RE.search(content):
        warnings.append(f"{filename} に逃げ言葉（TODO/未定/たぶん 等）があります。仕様は確定した言葉で書いてください。")

    if messages:
        return _deny(messages, normalized)
    _emit_warnings(warnings, normalized)
    return 0


def _covered_by_spec(normalized: str) -> bool:
    # Compare repo-relative paths with a path-boundary anchor so that
    # `src/app/orders` does not cover `src/app/orders-admin` or `lib/src/app/orders`.
    try:
        target = os.path.relpath(normalized).replace("\\", "/")
    except ValueError:
        target = normalized.replace("\\", "/")
    if target.startswith(".."):
        target = normalized.replace("\\", "/")
    try:
        for feature_dir in os.listdir("docs/specs"):
            func = os.path.join("docs/specs", feature_dir, "functional.md")
            if not os.path.isfile(func):
                continue
            with open(func, encoding="utf-8-sig", errors="replace") as f:
                fm = _parse_frontmatter(f.read().replace("\r\n", "\n"))
            if not fm:
                continue
            for p in re.split(r"[,\s]+", fm.get("target_paths", "").strip("[]")):
                p = p.strip("'\"- ")
                prefix = p.split("*")[0].strip("/")  # glob → literal prefix
                if prefix and (target == prefix or target.startswith(prefix + "/")):
                    return True
    except OSError:
        pass
    return False


LAUNCH_GATE_MARK = "起動ゲート:"


def _launch_gate_already_warned(path: str) -> bool:
    """The launch gate is a nudge, not a blocker.

    Warn once per path. Repeating it on every subsequent edit of the same
    uncovered file is pure noise, and noise is what makes the warn→deny
    promotion measurement in .claude/logs/sfad-guard.jsonl unreadable.
    """
    try:
        with open(".claude/logs/sfad-guard.jsonl", encoding="utf-8") as f:
            lines = f.readlines()[-2000:]
    except OSError:
        return False
    for line in reversed(lines):
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("path") == path and LAUNCH_GATE_MARK in str(rec.get("detail", "")):
            return True
    return False


def _repo_relative(path: str) -> str:
    """Write 経路（絶対パスで来る）と Bash 経路（相対で来る）の表記を揃える。

    揃えないと同じファイルが経路ごとに別物として記録され、「パスごとに1回」の
    重複抑制が破れる。
    """
    try:
        rel = os.path.relpath(path).replace("\\", "/")
    except ValueError:
        return path.replace("\\", "/")
    return path.replace("\\", "/") if rel.startswith("..") else rel


def _is_empty_package_marker(normalized: str, content: str | None) -> bool:
    """中身の無い `__init__.py` か。

    実運用の試験では起動ゲートの発火28件のうち17件が空の `__init__.py` で、
    warn→deny の昇格判断に使うログが騒音で埋まった。ただし免除するのは
    **実際に空のとき**だけ。再輸出や副作用のある import を書いた `__init__.py` は
    挙動を持つので通常どおりゲートにかける。
    """
    if os.path.basename(normalized) != "__init__.py":
        return False
    if content is None:
        try:
            with open(normalized, encoding="utf-8-sig", errors="replace") as f:
                content = f.read()
        except OSError:
            return False
    meaningful = [
        line for line in content.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    return not meaningful


def _launch_gate_message(normalized: str, content: str | None = None) -> str | None:
    """起動ゲートの警告文を返す（出さない）。出力は呼び出し側が1回だけ行う。

    Write 経路と Bash 経路の両方から使う。どちらから来ても同じ判定・同じ重複抑制に
    なるよう、パスは呼び出し前に正規化しておくこと。
    """
    if not os.path.isdir("docs/specs"):
        return None  # SFAD specs not adopted in this project yet — stay quiet
    if _is_empty_package_marker(normalized, content):
        return None
    if _covered_by_spec(normalized):
        return None
    if _launch_gate_already_warned(normalized):
        return None  # already told once; do not repeat on every edit
    is_new = not os.path.exists(normalized)
    what = "新規ソースファイル" if is_new else "既存ソースファイル"
    return (
        f"{LAUNCH_GATE_MARK} {what} {normalized} を覆う仕様が docs/specs/ に見つかりません。"
        "挙動を変える修正（Tier 1/2）なら /sfad cycle で仕様から始めてください"
        "（Tier 0 ならこのまま進んで構いません）。この警告はパスごとに1回だけ出ます。"
    )


def _handle_source_write(normalized: str, tool_input: dict) -> int:
    """Launch gate (warning mode): source file whose behaviour no spec covers.

    Fires on new files AND on edits to existing ones: most Tier 1/2 changes edit
    code that is already there, so gating only new files left the majority of
    behaviour changes ungated. Deduplicated per path to keep the signal usable.
    """
    normalized = _repo_relative(normalized)
    message = _launch_gate_message(normalized, _effective_content(tool_input, normalized))
    if message:
        _emit_warnings([message], normalized)
    return 0


def _blank_quotes(segment: str) -> str:
    """Replace quoted regions with spaces so flag/keyword matching ignores string contents."""
    out: list[str] = []
    quote: str | None = None
    for char in segment:
        if quote is not None:
            out.append(" " if char != quote else " ")
            if char == quote:
                quote = None
            continue
        if char in ("'", '"'):
            quote = char
            out.append(" ")
            continue
        out.append(char)
    return "".join(out)


def _porcelain_paths(include_untracked: bool) -> list[str]:
    porcelain = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
    ).stdout.splitlines()
    paths: list[str] = []
    for line in porcelain:
        if len(line) <= 3:
            continue
        if line.startswith("??") and not include_untracked:
            continue
        path = line[3:].strip().strip('"')
        if " -> " in path:  # rename: take the new side
            path = path.split(" -> ", 1)[1].strip().strip('"')
        paths.append(path)
    return paths


def _shell_tokens(text: str) -> list[tuple[str, bool]]:
    """(トークン, クォート内だったか) に粗く分解する。

    シェルの完全なパーサではない。必要なのは1点だけ — **演算子がクォートの外に
    あるか**。正規表現で `>` を探すと `echo "usage: a > b"` の中身を書き込み先と
    読み違え、逆にクォートを潰してから探すと `cat > "path"` を見失う。
    どちらも実測で起きた。演算子はクォート外のものだけを演算子として拾い、
    引数（パス）はクォートされていても中身を1トークンとして返す。
    """
    tokens: list[tuple[str, bool]] = []
    buf: list[str] = []
    quoted = False
    i, n = 0, len(text)

    def flush() -> None:
        nonlocal quoted
        if buf:
            tokens.append(("".join(buf), quoted))
            buf.clear()
        quoted = False

    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            buf.append(text[i + 1])
            i += 2
            continue
        if ch in "'\"":
            i += 1
            start = i
            while i < n and text[i] != ch:
                i += 1
            buf.append(text[start:i])
            quoted = True
            i += 1
            continue
        if ch.isspace():
            flush()
            i += 1
            continue
        if ch in "><|;&":
            flush()
            start = i
            while i < n and text[i] in "><|;&":
                i += 1
            tokens.append((text[start:i], False))
            continue
        buf.append(ch)
        i += 1
    flush()
    return tokens


def _heredoc_start(line: str) -> tuple[str, bool] | None:
    """行が heredoc を開くなら (終端語, タブ除去するか) を返す。

    `<<` はクォートの外にあるときだけ heredoc の開始。`echo "shift x << 2"` を
    開始と読むと、以降の本物の書き込みを丸ごと見逃す（誤爆ではなく検出漏れ）。
    `<<-` / `<<'EOF'` / `<<"EOF"` / `<<\\EOF` を認識する。
    """
    tokens = _shell_tokens(line)
    for index, (text, was_quoted) in enumerate(tokens):
        # `<<<` は here-string で本文を持たない。開始と読むと以降を丸ごと捨ててしまう。
        if was_quoted or "<<" not in text or "<<<" in text:
            continue
        dash = text.endswith("-")
        if index + 1 < len(tokens):
            delimiter = tokens[index + 1][0]
            if delimiter:
                return delimiter, dash
    return None


def _strip_heredoc_bodies(command: str) -> str:
    """ヒアドキュメントの本文を落とす。

    本文は「書き込む中身」であってコマンドではない。SFAD の文書は仕様パスを
    引用しがちで、本文の `> docs/specs/x/threat.md を参照` のような引用行を
    書き込み先と読み違えると、仕様に触れていない操作を止めてしまう。
    """
    out: list[str] = []
    lines = command.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        opened = _heredoc_start(line)
        i += 1
        if not opened:
            continue
        delimiter, dash = opened
        # bash が終端と見なすのは行そのもの。`<<-` のときだけ先頭のタブを無視する。
        while i < len(lines):
            candidate = lines[i].rstrip("\r")
            if (candidate.lstrip("\t") if dash else candidate) == delimiter:
                break
            i += 1
        i += 1  # terminator 行も本文として捨てる
    return "\n".join(out)


def _bash_write_targets(command: str) -> list[str]:
    """Bash 経由で書き込まれるファイルを拾う。

    Claude には書き込み経路が2つある: Write/Edit/MultiEdit と Bash。
    guard は前者しか検査しておらず、`cat > docs/specs/x/threat.md <<EOF` は
    空セル検査も frontmatter 検査も素通りしていた。人間の迂回ではなく
    Claude 自身の抜け道であり、「必ず」の最大の穴だった。

    **クォートを潰す前の生テキストを見る**。`_blank_quotes` を通した文字列から
    取ると、`cat > "docs/specs/x/threat.md"` のようにクォートを1つ付けるだけで
    ゲート全体が無効になる（誤爆対策がそのまま検出漏れになっていた）。

    完全な捕捉はできない: `python -c` の中の書き込み、`cd` してからの相対パス、
    変数展開、`awk`/`dd`/`curl -o` などは追えない。**この検査は迂回を防ぐ壁ではなく、
    Bash で書こうとしたときに気づかせる装置**であり、だからこそ warn に留める。
    """
    targets: list[str] = []

    def add(path: str) -> None:
        path = path.strip()
        if not path or path.startswith(("-", "$", "/dev/")):
            return
        targets.append(str(PurePath(path)).replace("\\", "/"))

    for segment in _split_command_segments(_strip_heredoc_bodies(command)):
        tokens = _shell_tokens(segment)
        words = [text for text, was_quoted in tokens if was_quoted or text[:1] not in "><|;&"]
        for index, (text, was_quoted) in enumerate(tokens):
            # リダイレクト: 演算子はクォート外、宛先はクォートされていてもよい
            if not was_quoted and set(text) <= {">"} and text and index + 1 < len(tokens):
                add(tokens[index + 1][0])
        if not words:
            continue
        head = os.path.basename(words[0])
        flags = [w for w in words[1:] if w.startswith("-")]
        operands = [w for w in words[1:] if not w.startswith("-")]
        if head == "tee" and operands:
            add(operands[0])
        elif head == "sed" and any(f.startswith("-i") for f in flags) and operands:
            add(operands[-1])
        elif head in ("cp", "mv", "install") and len(operands) >= 2:
            add(operands[-1])
    return list(dict.fromkeys(targets))


def _heredoc_bodies(command: str) -> dict[str, str]:
    """`cat > path <<EOF ... EOF` の宛先 → 本文 を返す。

    この形は**書き込む中身がコマンドの中にある**ので、Write と同じ内容検査が
    そのままかけられる。実運用の試験では Claude が仕様ファイル4本すべてを
    この形で書いており、最頻形をここで拾えれば経路差はほぼ消える。
    """
    bodies: dict[str, str] = {}
    lines = command.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        opened = _heredoc_start(line)
        i += 1
        if not opened:
            continue
        delimiter, dash = opened
        targets = [_repo_relative(t) for t in _bash_write_targets(line)]
        body: list[str] = []
        while i < len(lines):
            candidate = lines[i].rstrip("\r")
            if (candidate.lstrip("\t") if dash else candidate) == delimiter:
                break
            body.append(candidate)
            i += 1
        i += 1
        for target in targets:
            bodies[target] = "\n".join(body) + "\n"
    return bodies


def _bash_write_warnings(command: str) -> tuple[bool, list[str], list[str]]:
    """Bash 経由の書き込みを裁く。戻り値は (deny したか, 警告, 対応するパス)。

    Bash は Claude のもう一つの書き込み経路で、ここを素通りさせると
    **deny レベルのゲートが warn だけで迂回できてしまう**。実運用の試験で
    実際にそれが起き、空セル違反を含む仕様がディスクに残った。

    方針は sfad-done.py と同じ「確かめられなかったものを通さない」:

    - **本文が見える（heredoc）** → Write と同一の内容検査にかける。
      違反なら deny、問題なければ黙って通す（成果物が正しいなら経路は問わない）
    - **本文が見えない**（`sed -i` / `tee` / `cp` / 変数経由のリダイレクト）
      → 検査できないので deny。Write / Edit を使えば済むため代替は容易
    """
    warnings: list[str] = []
    paths: list[str] = []
    bodies = _heredoc_bodies(command)

    for target in _bash_write_targets(command):
        target = _repo_relative(target)
        spec_match = SPEC_DIR_RE.search(target)
        if spec_match:
            body = bodies.get(target)
            if body is None:
                _deny(
                    [f"Bash で仕様ファイル {target} を書こうとしていますが、"
                     "この書き方では中身を検査できません（空セル検査・frontmatter 検査が効かない）。"
                     "Write / Edit / MultiEdit で書いてください。"],
                    path=target,
                    footer="Rule: an unverifiable write to a spec is not allowed to pass as a verified one.",
                )
                return True, warnings, paths
            # 本文が見えるなら Write と同じ検査を通す（deny 相当ならここで deny が出る）
            _handle_spec_write(target, spec_match.group(3), {"content": body})
            if DENIED:
                return True, warnings, paths
        elif SOURCE_FILE_RE.search(target) and not TEST_FILE_RE.search(target):
            message = _launch_gate_message(target, bodies.get(target))
            if message:
                paths.append(target)
                warnings.append(message)
    return False, warnings, paths


def _handle_bash(command: str) -> int:
    segments = [_blank_quotes(seg) for seg in _split_command_segments(command)]
    denied, bash_write_warnings, bash_write_paths = _bash_write_warnings(command)
    if denied:
        return 0  # deny の JSON は既に出ている。警告を重ねない
    if not any(GIT_COMMIT_RE.search(seg) for seg in segments):
        _emit_warnings(bash_write_warnings, paths=bash_write_paths)
        return 0

    candidates: list[str] = []
    try:
        candidates += subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
        ).stdout.splitlines()
        # Staging in the same command runs after this hook sees the index, so
        # widen the scan to what that staging form will actually pick up:
        # add-all forms stage untracked files too; commit -a/-am stages tracked only.
        # (A `git add <specific file>` in the same command is not scanned — noted in README.)
        if any(GIT_ADD_ALL_RE.search(seg) for seg in segments):
            candidates += _porcelain_paths(include_untracked=True)
        elif any(GIT_COMMIT_TRACKED_ALL_RE.search(seg) for seg in segments):
            candidates += _porcelain_paths(include_untracked=False)
    except (OSError, subprocess.SubprocessError):
        return 0

    secrets = sorted({f for f in candidates if SECRET_FILE_RE.search(f) and not SECRET_ALLOW_RE.search(f)})
    if secrets:
        return _deny(
            ["シークレットらしきファイルがコミット対象です: " + ", ".join(secrets[:5])
             + "。コミットから外してください（.gitignore への追加を推奨）。"],
            footer="Rule: secrets never enter history. Use environment variables and .gitignore.",
        )

    src_changed = [f for f in candidates if SOURCE_FILE_RE.search(f) and not TEST_FILE_RE.search(f)]
    test_changed = [f for f in candidates if TEST_FILE_RE.search(f)]
    if src_changed and not test_changed:
        bash_write_warnings.append(
            f"ソース変更 {len(src_changed)} 件にテストの変更が含まれていません。"
            "挙動変更なら対応するテスト（Red→Green の証拠）を同じコミットに含めてください。"
        )
    _emit_warnings(bash_write_warnings, paths=bash_write_paths)
    return 0


def _read_stdin() -> str:
    """Read the hook payload as bytes and decode it here, not through the locale.

    `sys.stdin.read()` decodes with the console code page (cp932 on Japanese
    Windows) and keeps undecodable bytes as lone surrogates. Claude Code sends
    UTF-8 JSON, so any non-ASCII text could not be re-encoded later and the hook
    died with UnicodeEncodeError -- on a hook, a crash is a skipped check.
    UTF-8 first; cp932 only for a sender that really uses the local code page.
    """
    stream = getattr(sys.stdin, "buffer", None)
    if stream is None:
        return sys.stdin.read()
    raw = stream.read()
    for encoding in ("utf-8-sig", "cp932"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    try:
        payload = json.loads(_read_stdin() or "{}")
    except json.JSONDecodeError:
        return 0

    tool_input = payload.get("tool_input", {})
    command = tool_input.get("command")
    if isinstance(command, str):
        return _handle_bash(command)

    file_path = tool_input.get("file_path") or tool_input.get("file") or ""
    if not file_path:
        return 0
    normalized = str(PurePath(file_path)).replace("\\", "/")

    spec_match = SPEC_DIR_RE.search(normalized)
    if spec_match:
        return _handle_spec_write(normalized, spec_match.group(3), tool_input)

    if SOURCE_FILE_RE.search(normalized) and not TEST_FILE_RE.search(normalized):
        return _handle_source_write(normalized, tool_input)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
