#!/usr/bin/env python3
"""Block high-signal Hono Clean Architecture boundary violations before writes."""

from __future__ import annotations

import json
import re
import sys
from pathlib import PurePath

IMPORT_RE = r"^\s*(?:import\s+(?:type\s+)?(?:.+?\s+from\s+)?|export\s+(?:type\s+)?(?:.+?\s+from\s+))['\"]"
MODULE_REF_RE = r"(?:from\s+['\"]|import\s*\(\s*['\"]|require\s*\(\s*['\"])"
# `py` must be a command token, not the `.py` file extension.
PYTHON_CMD = r"(?<![\w.])(?:python|python3|py)\b"
READ_ONLY_PYTHON_CHECK_RE = re.compile(
    rf"{PYTHON_CMD}\s+(?:-\S+\s+)*-m\s+"
    r"(?:py_compile|compileall|pytest|unittest|mypy|ruff|bandit|coverage|flake8|black|isort|pylint|pip|build|tox)\b",
    flags=re.IGNORECASE,
)
SRC_SOURCE_PATH_RE = re.compile(r"src[\\/][^;|&]*\.tsx?\b", flags=re.IGNORECASE)
PYTHON_WRITE_INTENT_RE = re.compile(
    r"\b(open|write_text|touch|Path|write|generate|generator|scaffold|codemod)\b",
    flags=re.IGNORECASE,
)

LAYER_DOMAIN = r".*(?:^|/)domain/"
LAYER_APPLICATION = r".*(?:^|/)application/"
LAYER_INFRASTRUCTURE = r".*(?:^|/)infrastructure/"
LAYER_DI = r".*(?:^|/)di/"
LAYER_REPOSITORIES = r".*(?:^|/)repositories/"
LAYER_GATEWAYS = r".*(?:^|/)(?:gateways|security)/"
MODULE_BOUNDARY = r"(?:/|(?=['\"]))"
HONO_PKG = rf"hono{MODULE_BOUNDARY}|hono['\"]|@hono/"
DRIZZLE_PKG = rf"drizzle-orm{MODULE_BOUNDARY}|drizzle-orm['\"]|drizzle-zod"
ZOD_PKG = rf"zod{MODULE_BOUNDARY}|zod['\"]"
CRYPTO_PKGS = r"bcryptjs|bcrypt\b|jsonwebtoken|jose['\"/]"
SDK_PKGS = r"stripe['\"/]|openai['\"/]|@aws-sdk/|resend['\"/]|discord"

WRITEY_SHELL_PATTERNS = (
    r">\s*['\"]?[^'\"\s;|&]*src/[^'\"\s;|&]*\.tsx?\b",
    r">>\s*['\"]?[^'\"\s;|&]*src/[^'\"\s;|&]*\.tsx?\b",
    r"\btee\s+[^;|&]*src/[^;|&]*\.tsx?\b",
    r"\btouch\b[^;\n]*src[\\/][^;\n]*\.tsx?\b",
    r"\bSet-Content\b[^;\n]*src[\\/][^;\n]*\.tsx?\b",
    r"\bAdd-Content\b[^;\n]*src[\\/][^;\n]*\.tsx?\b",
    r"\bOut-File\b[^;\n]*src[\\/][^;\n]*\.tsx?\b",
    r"\b(?:New-Item|ni)\b[^;\n]*src[\\/][^;\n]*\.tsx?\b",
    r"\b(?:curl|Invoke-WebRequest|iwr|wget)\b[^;\n]*(?:-o|-OutFile)\s+['\"]?[^'\"\s;|&]*src[\\/][^'\"\s;|&]*\.tsx?\b",
    rf"{PYTHON_CMD}[\s\S]*(open|write_text|touch)\s*\([\s\S]*src[\\/][\s\S]*\.tsx?",
    rf"{PYTHON_CMD}[\s\S]*Path\s*\([\s\S]*src[\\/][\s\S]*\.tsx?",
)

FETCH_CALL_RE = re.compile(r"\bfetch\s*\(")
TEST_FILE_RE = re.compile(r"(^|/)(__tests__/|tests?/|[^/]+\.(?:test|spec)\.tsx?$)")

FORBIDDEN_SERVICE_DIRS = (
    "src/services/",
    "application/services/",
    "application/ports/services/",
)


def _block(messages: list[str]) -> int:
    if not messages:
        return 0

    reason = "\n".join(
        [
            "Hono architecture violation. Fix the edit and retry.",
            *[f"- {message}" for message in messages],
            "Rule: Route -> UseCase -> Domain -> Repository/Gateway. "
            "domain imports nothing; application imports domain only; "
            "HTTP knowledge stays in infrastructure/http.",
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

    for forbidden in FORBIDDEN_SERVICE_DIRS:
        if forbidden in normalized.lower():
            messages.append(
                f"Bash command references `{forbidden}`, which is forbidden. "
                "Use `application/usecases/` for Application Service, `domain/{domain}/policies/` "
                "for pure decisions, `ports/gateways/` for external transport."
            )
            break

    if any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in WRITEY_SHELL_PATTERNS):
        messages.append(
            "Do not generate or overwrite `src/**/*.ts` from Bash/Python shell commands. "
            "Use Write/Edit/MultiEdit so the architecture hook can inspect the target file content."
        )

    for segment in _split_command_segments(normalized):
        if READ_ONLY_PYTHON_CHECK_RE.search(segment):
            continue
        if not (re.search(PYTHON_CMD, segment, flags=re.IGNORECASE) and SRC_SOURCE_PATH_RE.search(segment)):
            continue
        if PYTHON_WRITE_INTENT_RE.search(segment):
            messages.append(
                "Python-in-Bash appears to write `src/**/*.ts`. Use Write/Edit/MultiEdit instead, "
                "then run Bash only for read-only checks such as eslint, tsc, tests, or build."
            )
        else:
            messages.append(
                "Do not run Python shell/scripts against `src/**/*.ts` from Bash unless it is a known "
                "read-only check. Create or update source files with Write/Edit/MultiEdit."
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


def _imports(content: str, *patterns: str) -> bool:
    if not content:
        return False
    joined = "|".join(patterns)
    return (
        re.search(rf"{IMPORT_RE}(?:{joined})", content, flags=re.MULTILINE) is not None
        or re.search(rf"{MODULE_REF_RE}(?:{joined})", content, flags=re.MULTILINE) is not None
    )


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


def _has_fetch_call(content: str) -> bool:
    return FETCH_CALL_RE.search(_code_without_comments_and_strings(content)) is not None


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

    for forbidden in FORBIDDEN_SERVICE_DIRS:
        if f"/{forbidden}" in normalized or normalized.startswith(forbidden):
            return _block(
                [
                    f"`{forbidden}` is forbidden. Use `application/usecases/` for Application Service, "
                    "`domain/{domain}/policies/` for pure decisions, `application/ports/gateways/` for "
                    "external transport, and `application/ports/security/` for hash/token ports."
                ]
            )

    if not normalized.endswith(".ts") or TEST_FILE_RE.search(normalized):
        return 0

    messages: list[str] = []

    if "/src/domain/" in normalized or normalized.startswith("src/domain/"):
        if _imports(content, HONO_PKG, DRIZZLE_PKG, ZOD_PKG, CRYPTO_PKGS, SDK_PKGS):
            messages.append(
                "`domain/` must be pure TypeScript. No hono/drizzle/zod/crypto/SDK imports. "
                "Move I/O to infrastructure and contracts to infrastructure/http/schemas."
            )
        if _imports(content, LAYER_APPLICATION, LAYER_INFRASTRUCTURE, LAYER_DI):
            messages.append("`domain/` must not import application/, infrastructure/, or di/.")
        if _has_fetch_call(content):
            messages.append("`domain/` must not perform I/O. Move `fetch` to infrastructure/gateways.")

    if "/src/application/" in normalized or normalized.startswith("src/application/"):
        if _imports(content, HONO_PKG, DRIZZLE_PKG):
            messages.append(
                "`application/` must not import hono or drizzle-orm. Depend on ports; "
                "implementations live in infrastructure/."
            )
        if _imports(content, LAYER_INFRASTRUCTURE, LAYER_DI):
            messages.append("`application/` must not import infrastructure/ or di/. Depend on ports.")
        if "/usecases/" in normalized:
            if _imports(content, ZOD_PKG):
                messages.append(
                    "UseCases must not import zod. HTTP contracts live in infrastructure/http/schemas; "
                    "convert schema -> DTO in the route."
                )
            if _has_fetch_call(content):
                messages.append("UseCases must not call `fetch` directly. Depend on a Gateway port.")

    if "/infrastructure/http/routes/" in normalized:
        if _imports(content, DRIZZLE_PKG):
            messages.append("Routes must not import drizzle-orm. Data access goes through Repository via UseCase.")

    if "/infrastructure/repositories/" in normalized:
        if _imports(content, HONO_PKG):
            messages.append("Repositories must not import hono. They have no HTTP knowledge.")
        if _imports(content, LAYER_GATEWAYS):
            messages.append("Repositories must not call gateways. UseCase orchestrates both.")

    if "/infrastructure/gateways/" in normalized or "/infrastructure/security/" in normalized:
        if _imports(content, DRIZZLE_PKG, LAYER_REPOSITORIES):
            messages.append("Gateways must not access the DB or repositories. UseCase orchestrates both.")

    return _block(messages)


if __name__ == "__main__":
    raise SystemExit(main())
