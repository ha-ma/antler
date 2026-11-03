#!/usr/bin/env python3
"""Block high-signal React feature-based architecture violations before writes."""

from __future__ import annotations

import json
import posixpath
import re
import sys
from pathlib import PurePath

PYTHON_CMD = r"(?<![\w.])(?:python|python3|py)\b"
READ_ONLY_PYTHON_CHECK_RE = re.compile(
    rf"{PYTHON_CMD}\s+(?:-\S+\s+)*-m\s+"
    r"(?:py_compile|compileall|pytest|unittest|mypy|ruff|bandit|coverage|flake8|black|isort|pylint|pip|build|tox)\b",
    flags=re.IGNORECASE,
)
SRC_SOURCE_PATH_RE = re.compile(r"src[\\/][^;|&]*\.(tsx?|jsx?)\b", flags=re.IGNORECASE)
PYTHON_WRITE_INTENT_RE = re.compile(
    r"\b(open|write_text|touch|Path|write|generate|generator|scaffold|codemod)\b",
    flags=re.IGNORECASE,
)

WRITEY_SHELL_PATTERNS = (
    r">\s*['\"]?[^'\"\s;|&]*src/[^'\"\s;|&]*\.(tsx?|jsx?)\b",
    r">>\s*['\"]?[^'\"\s;|&]*src/[^'\"\s;|&]*\.(tsx?|jsx?)\b",
    r"\btee\s+[^;|&]*src/[^;|&]*\.(tsx?|jsx?)\b",
    r"\btouch\b[^;\n]*src[\\/][^;\n]*\.(tsx?|jsx?)\b",
    r"\bSet-Content\b[^;\n]*src[\\/][^;\n]*\.(tsx?|jsx?)\b",
    r"\bAdd-Content\b[^;\n]*src[\\/][^;\n]*\.(tsx?|jsx?)\b",
    r"\bOut-File\b[^;\n]*src[\\/][^;\n]*\.(tsx?|jsx?)\b",
    r"\b(?:New-Item|ni)\b[^;\n]*src[\\/][^;\n]*\.(tsx?|jsx?)\b",
    r"\b(?:curl|Invoke-WebRequest|iwr|wget)\b[^;\n]*(?:-o|-OutFile)\s+['\"]?[^'\"\s;|&]*src[\\/][^'\"\s;|&]*\.(tsx?|jsx?)\b",
    rf"{PYTHON_CMD}[\s\S]*(open|write_text|touch)\s*\([\s\S]*src[\\/][\s\S]*\.(tsx?|jsx?)",
    rf"{PYTHON_CMD}[\s\S]*Path\s*\([\s\S]*src[\\/][\s\S]*\.(tsx?|jsx?)",
)

IMPORT_SPECIFIER_RE = re.compile(r"(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['\"]([^'\"]+)['\"]")
ZUSTAND_IMPORT_RE = re.compile(r"^\s*import\s+[^;]*from\s+['\"]zustand(?:/|['\"])", flags=re.MULTILINE)
USE_EFFECT_RE = re.compile(r"\buseEffect\s*\(")
TEST_FILE_RE = re.compile(r"(^|/)(__tests__/|[^/]+\.(?:test|spec)\.(?:ts|tsx|js|jsx)$)")


def _block(messages: list[str]) -> int:
    if not messages:
        return 0

    reason = "\n".join(
        [
            "React architecture violation. Fix the edit and retry.",
            *[f"- {message}" for message in messages],
            "Rule: app -> features -> shared. Cross-feature imports go through the "
            "barrel (index.ts); Zustand lives only in features/{name}/store.ts.",
        ]
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            },
            ensure_ascii=False,
        )
    )
    return 0


def _split_command_segments(command: str) -> list[str]:
    """Split a shell command into top-level segments, ignoring separators inside quotes."""
    segments: list[str] = []
    current: list[str] = []
    quote: str | None = None
    index = 0
    length = len(command)
    while index < length:
        char = command[index]
        if quote is not None:
            current.append(char)
            if char == quote:
                quote = None
            index += 1
            continue
        if char in ("'", '"'):
            quote = char
            current.append(char)
            index += 1
            continue
        if char in "&|" and index + 1 < length and command[index + 1] == char:
            segments.append("".join(current))
            current = []
            index += 2
            continue
        if char in ";|&\n":
            segments.append("".join(current))
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    segments.append("".join(current))
    return segments


def _handle_bash(command: str) -> int:
    normalized = command.replace("\\", "/")
    messages: list[str] = []

    if any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in WRITEY_SHELL_PATTERNS):
        messages.append(
            "Do not generate or overwrite `src/**/*.ts(x)` from Bash/Python shell commands. "
            "Use Write/Edit/MultiEdit so the architecture hook can inspect the target file content."
        )

    for segment in _split_command_segments(normalized):
        if READ_ONLY_PYTHON_CHECK_RE.search(segment):
            continue
        if not (re.search(PYTHON_CMD, segment, flags=re.IGNORECASE) and SRC_SOURCE_PATH_RE.search(segment)):
            continue
        if PYTHON_WRITE_INTENT_RE.search(segment):
            messages.append(
                "Python-in-Bash appears to write `src/**/*.ts(x)`. Use Write/Edit/MultiEdit instead, "
                "then run Bash only for read-only checks such as eslint, tsc, tests, or build."
            )
        else:
            messages.append(
                "Do not run Python shell/scripts against `src/**/*.ts(x)` from Bash unless it is a "
                "known read-only check. Create or update source files with Write/Edit/MultiEdit."
            )
        break

    return _block(messages)


def _extract_content(tool_input: dict) -> str:
    content = tool_input.get("content") or tool_input.get("new_string") or ""
    if content:
        return content

    edits = tool_input.get("edits")
    if isinstance(edits, list):
        return "\n".join(e.get("new_string", "") for e in edits if isinstance(e, dict))

    return ""


def _normalized_path(file_path: str) -> str:
    return str(PurePath(file_path)).replace("\\", "/").lower()


def _current_feature(normalized: str) -> str | None:
    match = re.search(r"(?:^|/)src/features/([^/]+)/", normalized)
    return match.group(1) if match else None


#: Where an import points, once resolved: `@/features/x/...` or `.../src/features/x/...`.
#: Limited to `src/features/` on purpose: a legacy `src/components/features/` tree (code that
#: predates the feature layout) is a different thing and must not be flagged.
FEATURE_IMPORT_RE = re.compile(r"(?:^@/|(?:^|/)src/)features/([^/'\"]+)(?:/(.*))?$")


def _resolve_specifier(specifier: str, normalized: str) -> str:
    """Resolve a relative import against the edited file's location.

    Looking for `features/` in the raw text misses `'../../auth/hooks/useSession'`, which
    crosses features without ever containing the word.
    """
    if not specifier.startswith("."):
        return specifier
    return posixpath.normpath(posixpath.join(posixpath.dirname(normalized), specifier))


def _cross_feature_violations(content: str, normalized: str, current_feature: str | None) -> list[str]:
    """Imports that reach into another feature's internals instead of its barrel.

    `current_feature` is None outside `src/features/` (the app layer: router, providers).
    That is the layer the rule exists for - app -> features must go through the barrel -
    so it is checked too; only the same-feature exemption needs a current feature.
    """
    violations: list[str] = []
    for specifier in IMPORT_SPECIFIER_RE.findall(content):
        match = FEATURE_IMPORT_RE.search(_resolve_specifier(specifier, normalized))
        if not match:
            continue
        target_feature, rest = match.group(1), match.group(2) or ""
        if current_feature is not None and target_feature.lower() == current_feature.lower():
            continue
        if rest in ("", "index", "index.ts", "index.tsx"):
            continue
        violations.append(specifier)
    return violations


def _code_without_comments_and_strings(content: str) -> str:
    """Return TS code with comments and string bodies blanked for token checks."""
    out: list[str] = []
    i = 0
    n = len(content)

    while i < n:
        char = content[i]
        nxt = content[i + 1] if i + 1 < n else ""

        if char == "/" and nxt == "/":
            out.extend("  ")
            i += 2
            while i < n and content[i] not in "\r\n":
                out.append(" ")
                i += 1
            continue

        if char == "/" and nxt == "*":
            out.extend("  ")
            i += 2
            while i < n - 1 and not (content[i] == "*" and content[i + 1] == "/"):
                out.append("\n" if content[i] in "\r\n" else " ")
                i += 1
            if i < n - 1:
                out.extend("  ")
                i += 2
            continue

        if char in ("'", '"', "`"):
            quote = char
            out.append(" ")
            i += 1
            while i < n:
                current = content[i]
                if current == "\\":
                    out.extend("  ")
                    i += 2
                    continue
                if current == quote:
                    out.append(" ")
                    i += 1
                    break
                out.append("\n" if current in "\r\n" else " ")
                i += 1
            continue

        out.append(char)
        i += 1

    return "".join(out)


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
    content = _extract_content(tool_input)
    normalized = _normalized_path(file_path)

    if not normalized.endswith((".ts", ".tsx", ".js", ".jsx")) or TEST_FILE_RE.search(normalized):
        return 0

    messages: list[str] = []
    is_store_file = normalized.endswith("/store.ts") or normalized.endswith("/store.tsx")

    if ZUSTAND_IMPORT_RE.search(content) and not is_store_file:
        messages.append(
            "Zustand may only be imported in `src/features/{name}/store.ts`. "
            "Consume the store's exported hooks (with selectors) elsewhere."
        )

    current_feature = _current_feature(normalized)
    violations = _cross_feature_violations(content, normalized, current_feature)
    if violations:
        messages.append(
            "Feature internals must be imported through the barrel (index.ts). Violations: "
            + ", ".join(f"`{v}`" for v in violations)
            + ". Import as `@/features/{name}` instead."
        )
    if current_feature:
        if re.search(r"(?:\bfrom\s+|\bimport\s*\(\s*)['\"][^'\"]*(?:^|/)?src/app/|['\"]@/app(?:/|['\"])", content):
            messages.append("Features must not import `src/app/`. The dependency direction is app -> features -> shared.")

    if "/src/shared/" in normalized or normalized.startswith("src/shared/"):
        for specifier in IMPORT_SPECIFIER_RE.findall(content):
            if re.search(r"(?:^|/)features/", specifier) or specifier.startswith("@/features"):
                messages.append(
                    "`src/shared/` must not import features (reverse dependency). "
                    "Move the shared piece into shared, or keep it in the feature."
                )
                break

    code = _code_without_comments_and_strings(content)
    if USE_EFFECT_RE.search(code):
        print(
            "WARNING: useEffect を追加しようとしています。代替を検討してください:\n"
            "  - データ取得 -> TanStack Query (useQuery)\n"
            "  - 派生値の計算 -> useMemo\n"
            "  - ユーザー操作への反応 -> event handler\n"
            "  - コンポーネントリセット -> key prop\n"
            "  - 購読/タイマー -> カスタムhookに隔離\n"
            "本当に必要な場合は、ESLint disable コメントに理由を書いてください。",
            file=sys.stderr,
        )

    return _block(messages)


if __name__ == "__main__":
    raise SystemExit(main())
