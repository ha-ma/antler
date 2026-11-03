#!/usr/bin/env python3
"""SFAD drift detector: are the specs still telling the truth about the code?

Deterministic checks only (judgement-based review belongs to agents):

1. **Stale spec** — commits touched `target_paths` after `spec_confirmed_at`
   but the spec files were not updated alongside them.
2. **Threat coverage** — route/endpoint definitions found under `target_paths`
   that do not appear in threat.md's operations column (best-effort,
   per-stack regex detection; absence of detectable routes is not an error).
3. **Test List coverage** — every `{PREFIX}-{N}` item in functional.md's
   Test List must appear in at least one test file (repo-wide, filename-based
   detection). Closes the spec→test direction, which had no check.
4. **Authorization coverage** — threat.md の ❌ セル数を Test List の AUTH-* 件数が
   下回っていないか（埋めさせた拒否が検証に届いているかの回収率）。
5. **Contract** — threat.md の操作列にあるルートがコードから消えていないか
   （THREAT GAP の逆向き＝無記録の破壊的変更）。
6. **Vocabulary bridge** — when functional.md carries a
   `Rule → ドメイン語彙` mapping table, the mapped file paths must exist
   (the ubiquitous-language link between spec Rules and domain code).

plan.md is intentionally excluded — it is an archived document that may rot.

Usage:
  python sfad-drift.py [feature ...]   # all features when omitted
  exit 0 = clean, 1 = drift found, 2 = execution error
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

SPECS_ROOT = os.path.join("docs", "specs")
ROUTE_PATTERNS = (
    # FastAPI
    re.compile(r"@(?:router|app)\.(get|post|put|delete|patch)\(\s*[\"']([^\"']+)"),
    # Hono
    re.compile(r"\bapp\.(get|post|put|delete|patch)\(\s*[\"']([^\"']+)"),
    # Laravel
    re.compile(r"Route::(get|post|put|delete|patch)\(\s*[\"']([^\"']+)"),
)
NEXT_ROUTE_METHOD_RE = re.compile(r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b")
# ルータ自身が持つ prefix。ファイル内で1つだけ宣言される前提（FastAPI / Hono の慣用）。
# include_router 側で付ける prefix は追えない — 既知の限界として drift.md に記載。
ROUTER_PREFIX_RE = re.compile(r"\w+\(\s*[^)]*prefix\s*=\s*[\"']([^\"']+)")
SOURCE_EXTS = (".py", ".ts", ".tsx", ".js", ".jsx", ".php")
BRIDGE_HEADER_RE = re.compile(r"##\s*Rule\s*(?:→|->)\s*ドメイン語彙")

findings: list[str] = []
infos: list[str] = []


def run_git_rc(*args: str) -> tuple[int, str]:
    r = subprocess.run(
        ["git", *args], capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=20,
    )
    return r.returncode, r.stdout


def run_git(*args: str) -> str:
    return run_git_rc(*args)[1]


def parse_frontmatter(content: str) -> dict:
    match = re.match(r"^---\n(.*?)\n---\n", content, re.DOTALL)
    if not match:
        return {}
    keys: dict[str, str] = {}
    current: str | None = None
    for line in match.group(1).splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            current = m.group(1)
            keys[current] = m.group(2)
            continue
        item = re.match(r"^\s+-\s+(.*)$", line)
        if item and current is not None:
            keys[current] = (keys[current] + " " + item.group(1)).strip()
    return keys


def read(path: str) -> str:
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        return f.read().replace("\r\n", "\n")


def target_path_prefixes(fm: dict) -> list[str]:
    prefixes = []
    for p in re.split(r"[,\s]+", fm.get("target_paths", "").strip("[]")):
        p = p.strip("'\"- ")
        prefix = p.split("*")[0].strip("/")
        if prefix:
            prefixes.append(prefix)
    return prefixes


def check_stale(feature: str, spec_dir: str, fm: dict) -> None:
    sha = fm.get("spec_confirmed_at", "").strip()
    if not sha or "{" in sha:
        infos.append(f"[{feature}] spec_confirmed_at が未記入（承認時にコミット SHA を記入すると drift 検出が有効になる）")
        return
    prefixes = target_path_prefixes(fm)
    if not prefixes:
        return
    # Staleness is about ORDER: code commits newer than the spec's own last
    # commit mean the spec no longer reflects the code. The confirmed SHA is
    # the fallback baseline when the spec has never been committed.
    # plan.md is an archived may-rot document (drift.md) — its commits must
    # not count as "the spec was updated".
    last_spec_commit = run_git(
        "log", "-1", "--format=%h", "--", spec_dir, f":(exclude){spec_dir}/plan.md"
    ).strip()
    base = last_spec_commit or sha
    rc, code_log = run_git_rc("log", "--oneline", f"{base}..HEAD", "--", *prefixes)
    code_log = code_log.strip()
    if rc != 0:
        findings.append(
            f"[{feature}] INVALID BASE: {base} から履歴を辿れません（spec_confirmed_at の SHA を確認）"
        )
        return
    if code_log:
        commits = len(code_log.splitlines())
        findings.append(
            f"[{feature}] STALE: 仕様の最終更新以降に対象コードへ {commits} コミットあるが仕様が未更新。"
            f"仕様を見直し、変更が挙動に関わるなら functional.md を更新して spec_confirmed_at を進めること"
        )


def collect_routes(prefixes: list[str]) -> list[str]:
    routes: list[str] = []
    for prefix in prefixes:
        base = prefix if os.path.isdir(prefix) else os.path.dirname(prefix)
        if not base or not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base):
            parts = root.replace("\\", "/").split("/")
            if "node_modules" in parts or "vendor" in parts:
                continue
            for name in files:
                if not name.endswith(SOURCE_EXTS):
                    continue
                path = os.path.join(root, name)
                try:
                    content = read(path)
                except OSError:
                    continue
                # ルータ自身が持つ prefix を前置する。実運用の試験では
                # APIRouter(prefix="/api/v1") + @router.post("/contacts") を
                # `POST /contacts` と読み違え、同じ1つのルートに THREAT GAP と
                # CONTRACT GAP が同時に出た。
                prefix_match = ROUTER_PREFIX_RE.search(content)
                prefix = prefix_match.group(1).rstrip("/") if prefix_match else ""
                for pattern in ROUTE_PATTERNS:
                    for method, route in pattern.findall(content):
                        routes.append(f"{method.upper()} {prefix}{route}")
                if name in ("route.ts", "route.js"):
                    rel = path.replace("\\", "/")
                    api_path = "/" + rel.split("app/")[-1].rsplit("/", 1)[0] if "app/" in rel else rel
                    for method in NEXT_ROUTE_METHOD_RE.findall(content):
                        routes.append(f"{method} {api_path}")
    return sorted(set(routes))


def check_threat_coverage(feature: str, spec_dir: str, fm: dict) -> None:
    threat_path = os.path.join(spec_dir, "threat.md")
    if not os.path.isfile(threat_path):
        return  # Tier 1 — no threat spec required
    threat = read(threat_path)
    routes = collect_routes(target_path_prefixes(fm))
    if not routes:
        return  # nothing detectable — not an error
    def covered(route: str) -> bool:
        method, path = route.split(" ", 1)
        method_ok = re.search(rf"(^|[|\s]){method}([|\s]|$)", threat)
        path_ok = re.search(rf"(^|[|\s]){re.escape(path)}([|\s]|$)", threat)
        return bool(method_ok and path_ok)

    missing = [r for r in routes if not covered(r)]
    if missing:
        findings.append(
            f"[{feature}] THREAT GAP: コードに実在するのに threat.md の操作列に見当たらない: "
            + ", ".join(missing[:5]) + (" ほか" if len(missing) > 5 else "")
        )


def check_bridge(feature: str, functional: str) -> None:
    match = BRIDGE_HEADER_RE.search(functional)
    if not match:
        return  # bridge table is optional (recommended for Tier 2)
    section = functional[match.end():]
    section = section.split("\n## ", 1)[0]
    missing: list[str] = []
    for line in section.splitlines():
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        if re.match(r"^\|[\s:|-]+\|$", stripped):
            continue
        cells = [c.strip().strip("`") for c in stripped.strip("|").split("|")]
        if len(cells) < 3 or cells[0] in ("Rule", ""):
            continue
        location = cells[2]
        if "{" in location:
            continue  # template placeholder row — not yet filled in
        prefix = location.split("*")[0].strip().strip("/")
        if prefix and not os.path.exists(prefix):
            missing.append(f"{cells[0]} → {location}")
    if missing:
        findings.append(
            f"[{feature}] BRIDGE GAP: Rule→ドメイン語彙対応表の置き場所が実在しない: "
            + "; ".join(missing[:5])
        )


TEST_LIST_HEADER_RE = re.compile(r"^##\s*Test List", re.MULTILINE)
# 連番のあとの一文字（UC-7a / UC-10h）まで取る。ここを `\d+` で止めると
# `UC-7a` から `UC-7` を切り出してしまい、Test List に存在しない ID を探して
# 「テストが見つかりません」と報告する。実在の仕様（127 項目）で 39 件が
# この偽陽性だった。suffix 無しの `UC-1` 形式も従来どおり一致する。
TEST_LIST_ITEM_RE = re.compile(r"^[-*]\s*\[[ xX]\]\s*([A-Z]+-\d+[a-z]?)")
TEST_FILE_RE = re.compile(
    r"(^|/)(tests?|__tests__|spec)/|(^|/)test_[^/]+\.(py|php)$|"
    r"[^/]+_test\.(py|go|php)$|[^/]+\.(test|spec)\.(ts|tsx|js|jsx|mjs)$",
    re.IGNORECASE,
)
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "vendor"}


def collect_test_list_ids(functional: str) -> list[str]:
    # テンプレートの例示（```markdown フェンス内の `- [ ] AC-1: ...`）を実項目と
    # 数えると、書いた覚えのない ID の COVERAGE GAP が出る。guard の空セル検査と
    # 同じくフェンスを先に落とす。見出しは行頭に固定する（散文中の「## Test List
    # に一覧があります」に先に当たると本節を読み飛ばす）。
    body = CODE_FENCE_RE.sub("", functional)
    match = TEST_LIST_HEADER_RE.search(body)
    if not match:
        return []
    section = body[match.end():].split("\n## ", 1)[0]
    ids: list[str] = []
    for line in section.splitlines():
        m = TEST_LIST_ITEM_RE.match(line.strip())
        if m and m.group(1) not in ids:
            ids.append(m.group(1))
    return ids


def collect_test_sources() -> str:
    """Concatenate every test-looking file in the repo.

    Tests routinely live outside `target_paths` (a top-level tests/ tree), so
    the search is repo-wide and narrowed by filename instead.
    """
    chunks: list[str] = []
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            rel = os.path.join(root, name).replace("\\", "/").lstrip("./")
            if not rel.endswith(SOURCE_EXTS):
                continue
            if not TEST_FILE_RE.search(rel):
                continue
            try:
                chunks.append(read(rel))
            except OSError:
                continue
    return "\n".join(chunks)


def check_coverage(feature: str, functional: str, test_sources: str) -> None:
    """Test List → real tests. The spec→code direction was covered by BRIDGE
    and code→spec by THREAT; the spec→test direction had no check at all, so
    a Test List item could stay unimplemented forever without anyone noticing.
    """
    ids = collect_test_list_ids(functional)
    if not ids:
        return
    missing = [i for i in ids if not re.search(r"\b" + re.escape(i) + r"\b", test_sources)]
    if missing:
        findings.append(
            f"[{feature}] COVERAGE GAP: Test List の項目に対応するテストが見つかりません: "
            + "; ".join(missing[:8])
            + (" ほか" if len(missing) > 8 else "")
        )


AUTHZ_MATRIX_HEADER_RE = re.compile(r"##\s*Authorization Matrix")
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
DENY_CELL_MARK = "❌"
# 「この検査が ❌ セル N 件すべてを網羅する」の機械可読な宣言。
# 例: <!-- authz-covers: 60 tests/unit/authorization-matrix.test.ts -->
AUTHZ_COVERS_RE = re.compile(r"<!--\s*authz-covers:\s*(\d+)\s+(\S+?)\s*-->")


def count_denied_cells(threat: str) -> int:
    """❌ セルの数 = マトリクスが宣言した『拒否されるべき組み合わせ』の総数."""
    body = CODE_FENCE_RE.sub("", threat)
    match = AUTHZ_MATRIX_HEADER_RE.search(body)
    if not match:
        return 0
    section = body[match.end():].split("\n## ", 1)[0]
    total = 0
    for line in section.splitlines():
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        if re.match(r"^\|[\s:|-]+\|$", stripped):
            continue
        total += sum(1 for cell in stripped.strip("|").split("|") if DENY_CELL_MARK in cell)
    return total


def check_authz_coverage(feature: str, spec_dir: str, functional: str) -> None:
    """threat.md の ❌ セル数 > functional.md の AUTH-* 件数 なら、
    埋めさせた拒否のうち検証されていないものが残っている。
    空セル禁止という一番高い投資の回収率がそのまま出る数字なので、
    threat.md のゲートに散文で書くだけにせず機械で判定する。
    """
    threat_path = os.path.join(spec_dir, "threat.md")
    if not os.path.isfile(threat_path):
        return  # Tier 1 — 認可マトリクス自体が無い
    threat = read(threat_path)
    denied = count_denied_cells(threat)
    if denied == 0:
        return
    # threat.md 側の Test List も数える。テンプレートは AUTH-* を threat.md に
    # 置かせるので、functional.md だけを見ると「書いてあるのに 0 件」になる。
    auth_ids = {
        i
        for i in collect_test_list_ids(functional) + collect_test_list_ids(threat)
        if i.startswith("AUTH-")
    }

    # マトリクス駆動の検証を宣言できる。1 セル 1 項目の数合わせは、表を読んで
    # 全セルに展開するテストを書いたときに 48 個の散文を要求するだけになるため。
    # ただし宣言は信用しない: 件数が現在の ❌ 数と一致し、名指しされたファイルが
    # 実在するテストであることを毎回照合する。表が増えて宣言が古くなれば落ちる。
    for declared, path in AUTHZ_COVERS_RE.findall(functional + threat):
        count = int(declared)
        if not os.path.isfile(path) or not TEST_FILE_RE.search(path.replace(chr(92), '/')):
            findings.append(
                f"[{feature}] AUTHZ COVERAGE GAP: authz-covers が指すテストが無い: {path}"
            )
            return
        if count != denied:
            findings.append(
                f"[{feature}] AUTHZ COVERAGE GAP: authz-covers は {count} 件を網羅すると"
                f"宣言しているが、マトリクスの ❌ セルは {denied} 件。"
                "表が変わったなら宣言と検査の両方を更新すること"
            )
            return
        return  # 全セルが 1 つの検査で網羅されている

    if len(auth_ids) < denied:
        findings.append(
            f"[{feature}] AUTHZ COVERAGE GAP: 認可マトリクスの ❌ セルが {denied} 件あるのに "
            f"Test List の AUTH-* は {len(auth_ids)} 件。"
            "マトリクスに書いた拒否のうち検証されていないものが残っています"
        )


def check_contract(feature: str, spec_dir: str, fm: dict) -> None:
    """THREAT GAP の逆向き: threat.md の操作列にあるルートがコードから消えた。

    削除が意図的でも、仕様を直さないまま消えたなら破壊的変更が無記録で入っている。
    仕様を先に直す運用（drift の直し方）に乗せるため DRIFT として報告する。
    """
    threat_path = os.path.join(spec_dir, "threat.md")
    if not os.path.isfile(threat_path):
        return
    threat = CODE_FENCE_RE.sub("", read(threat_path))
    match = AUTHZ_MATRIX_HEADER_RE.search(threat)
    if not match:
        return
    section = threat[match.end():].split("\n## ", 1)[0]
    declared: list[str] = []
    for line in section.splitlines():
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        if re.match(r"^\|[\s:|-]+\|$", stripped):
            continue
        op = stripped.strip("|").split("|")[0].strip()
        m = re.match(r"^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)", op)
        if m:
            declared.append(f"{m.group(1)} {m.group(2)}")
    if not declared:
        return
    routes = set(collect_routes(target_path_prefixes(fm)))
    if not routes:
        return  # ルートを1つも検出できない = 検出器が効いていない。ここで騒がない
    gone = [d for d in dict.fromkeys(declared) if d not in routes]
    if gone:
        findings.append(
            f"[{feature}] CONTRACT GAP: threat.md にあるのにコードから消えたルート: "
            + ", ".join(gone[:5]) + (" ほか" if len(gone) > 5 else "")
            + "（意図的な削除なら仕様を先に直すこと — 破壊的変更が無記録で入っています）"
        )


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    if not os.path.isdir(SPECS_ROOT):
        print("SFAD drift: docs/specs/ がありません（検査対象なし）")
        return 0

    wanted = set(sys.argv[1:])
    checked = 0
    test_sources = collect_test_sources()
    for feature in sorted(os.listdir(SPECS_ROOT)):
        if wanted and feature not in wanted:
            continue
        spec_dir = os.path.join(SPECS_ROOT, feature)
        functional_path = os.path.join(spec_dir, "functional.md")
        if not os.path.isfile(functional_path):
            continue
        checked += 1
        try:
            functional = read(functional_path)
        except OSError as exc:
            print(f"SFAD drift: {functional_path} を読めません: {exc}")
            return 2
        fm = parse_frontmatter(functional)
        check_stale(feature, spec_dir.replace("\\", "/"), fm)
        check_threat_coverage(feature, spec_dir, fm)
        check_bridge(feature, functional)
        check_coverage(feature, functional, test_sources)
        check_authz_coverage(feature, spec_dir, functional)
        check_contract(feature, spec_dir, fm)

    print(f"SFAD drift: {checked} 仕様を検査")
    for info in infos:
        print(f"  INFO  {info}")
    for finding in findings:
        print(f"  DRIFT {finding}")
    if findings:
        print("結果: DRIFT あり — 仕様とコードの相互監視が破れています。仕様を先に直すこと")
        return 1
    print("結果: クリーン")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
