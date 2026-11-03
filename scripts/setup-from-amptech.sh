#!/bin/sh
# Amptech_AI_docs から開発ハーネスを antler に配る。何度打っても同じ結果になる（取り込み直しにも使う）。
#
#   AMPTECH=../Amptech_AI_docs sh scripts/setup-from-amptech.sh
#
# 配るもの:
#   stack   react → apps/sim, react → apps/pwa, hono → apps/api（各 stack の CLAUDE.md・docs・設定・scripts）
#   tools   stack-routes, local-ci, dispatcher, ci-arch-check, stack-registry-check（案件のルート）
#   SFAD    .claude/skills/sfad、sfad-guard / sfad-drift / sfad-done、spec-adversary（案件のルート）
#   agents  code-reviewer, security-auditor, test-writer, accessibility-checker, performance-analyzer, debugger, doc-writer
#   skill   frontend-design
# そのあと Amptech の HOWTO-monorepo.md 手順 5「手で寄せるところ」をここで自動で行い、antler のモデル指定を当てる。
#
# 上書きしないもの: antler 固有の CLAUDE.md・routes.toml・local_ci_checks.toml・.claude/settings.json の既存 hook・
#   .claude/hooks/dispatch_local_rules.py・ch9-status.py・antler の agents 4 体（sim-3d-architect・alert-contract-guard・edge-latency-reviewer・repo-explorer）・
#   apps/api/local_ci_checks.toml・scripts/templates/。
# 上書きするもの: Amptech 由来のファイル（取り込み直したら git diff で確かめてから採る）。
set -eu

: "${AMPTECH:?AMPTECH=<Amptech_AI_docs のパス> を付けて実行する（例: AMPTECH=../Amptech_AI_docs sh scripts/setup-from-amptech.sh）}"
PY="${PYTHON:-python}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
A="$(cd "$AMPTECH" && pwd)"
[ -f "$A/scripts/bootstrap.py" ] || { echo "setup-from-amptech: $A/scripts/bootstrap.py がありません（AMPTECH の指す先を確かめる）" >&2; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' \
  || { echo "setup-from-amptech: Python 3.11 以上が要る（tomllib）。PYTHON=python3.12 などで指定する" >&2; exit 1; }

echo "== Amptech_AI_docs: $A ($(git -C "$A" rev-parse --short HEAD 2>/dev/null || echo 'git でない'))"

echo "== stack を配る"
"$PY" "$A/scripts/bootstrap.py" --stack react --dest "$ROOT/apps/sim" --no-sfad --force >/dev/null
"$PY" "$A/scripts/bootstrap.py" --stack react --dest "$ROOT/apps/pwa" --no-sfad --force >/dev/null
"$PY" "$A/scripts/bootstrap.py" --stack hono --dest "$ROOT/apps/api" --no-sfad --force >/dev/null
echo "  apps/sim (react), apps/pwa (react), apps/api (hono)"

echo "== 部品を入れる"
"$PY" "$A/scripts/bootstrap.py" --tools-only --dest "$ROOT" \
  --with-tools stack-routes,local-ci,dispatcher,ci-arch-check,stack-registry-check

echo "== SFAD を案件のルートに入れる"
# bootstrap.py は SFAD を stack と一緒にしか配らないので、同じ関数を直接呼ぶ（中身の写しを持たない）
"$PY" - "$A/scripts" "$ROOT" <<'EOF'
import sys
sys.path.insert(0, sys.argv[1])
import bootstrap
for item in bootstrap.install_sfad(sys.argv[2]):
    print(f"  + {item}")
EOF

echo "== stack の .claude をルートに寄せる（HOWTO-monorepo 手順 5）"
cd "$ROOT"
mkdir -p .claude/hooks .claude/rules .claude/agents .claude/skills
for app in sim pwa api; do
  d="apps/$app/.claude"
  [ -d "$d" ] || continue
  cp "$d"/hooks/check-*-architecture.py .claude/hooks/
  for sub in rules agents skills; do
    [ -d "$d/$sub" ] && cp -R "$d/$sub/." ".claude/$sub/"
  done
  # stack の settings.json はチェッカーを直につなぐので、dispatcher と二重に走って誤爆する。ルートに寄せたら消す
  rm -rf "$d"
  # サブフォルダの workflows は GitHub が読まない。CI はルートの .github/workflows/checks.yml
  rm -rf "apps/$app/.github"
  echo "  apps/$app/.claude → .claude/"
done

echo "== stack の検査の一覧の名前を routes.toml に合わせる"
for app in sim pwa; do
  f="apps/$app/local_ci_checks.toml"
  [ -f "$f" ] || continue
  "$PY" - "$f" "$app" <<'EOF'
import re, sys
path, name = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
start = text.find("\n[stack]")
if start < 0:
    sys.exit(f"{path}: [stack] 節がありません")
head, tail = text[:start], text[start:]
tail, n = re.subn(r'(?m)^name\s*=\s*"[^"]*"', f'name = "{name}"', tail, count=1)
if n != 1:
    sys.exit(f"{path}: [stack] name を書き換えられませんでした")
open(path, "w", encoding="utf-8", newline="\n").write(head + tail)
EOF
  echo "  $f: [stack] name = \"$app\""
done

echo "== ESLint 設定を antler のものに差し替える（Amptech の設定は eslint.amptech.config.js として残す）"
for app in sim pwa api; do
  [ -f "apps/$app/eslint.config.js" ] || continue
  if head -1 "apps/$app/eslint.config.js" | grep -q "antler の ESLint 設定"; then continue; fi
  mv "apps/$app/eslint.config.js" "apps/$app/eslint.amptech.config.js"
  case "$app" in api) t=hono ;; *) t=react ;; esac
  cp "scripts/templates/eslint.$t.config.js" "apps/$app/eslint.config.js"
  echo "  apps/$app/eslint.config.js（scripts/templates/eslint.$t.config.js）"
done

echo "== npm workspaces に合わせて検査の一覧の依存の置き場所を直す（node_modules はルートに集まる）"
for app in sim pwa; do
  f="apps/$app/local_ci_checks.toml"
  [ -f "$f" ] || continue
  "$PY" - "$f" <<'PYEOF'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
new = text.replace('needs_path = "node_modules"', 'needs_path = "../../node_modules"')
open(path, "w", encoding="utf-8", newline="\n").write(new)
PYEOF
  echo "  $f: needs_path = \"../../node_modules\""
done

echo "== CI は PR で回す版（checks-on-pr.yml）を使う。手動版と雛形は消す"
if [ -f .github/workflows/checks-on-pr.yml ]; then
  rm -f .github/workflows/checks.yml .github/workflows/checks-on-pr.yml.example
  echo "  .github/workflows/checks.yml と .example を消した"
fi

echo "== Amptech の agents とスキル"
for agent in code-reviewer security-auditor test-writer accessibility-checker performance-analyzer debugger doc-writer; do
  cp "$A/agents/$agent.md" ".claude/agents/$agent.md"
done
mkdir -p .claude/skills/frontend-design
cp -R "$A/skills/frontend-design/." .claude/skills/frontend-design/
echo "  agents 7 体、frontend-design"

echo "== antler の上書き（Amptech の agents に、モデル・ツール・報告の返し方を当てる）"
# 正は CLAUDE.md の「エージェントチームの動かし方」。取り込み直しのたびにここで当て直す。
"$PY" - <<'EOF'
import re

REPORT = """
## antler: 報告の返し方

結果の全文は `docs/reports/YYYY-MM-DD-<agent名>-<対象>.md` に書く（Write はこのフォルダにだけ使う）。
呼び出したメインセッションには **レポートのパスと 10 行以内の要約**（Critical / 数値の結論 / 次の一手）だけを返す。
全文をメッセージに貼らない（メインセッションのコンテキストを守るため。CLAUDE.md「エージェントチームの動かし方」）。
"""

# (path, model, tools, 報告ルールを足すか)
OVERRIDES = [
    (".claude/agents/spec-adversary.md", "opus", None, False),
    (".claude/agents/doc-writer.md", "haiku", None, False),
    (".claude/agents/performance-analyzer.md", None, "Read, Grep, Glob, Bash, Write", True),
]
for path, model, tools, report in OVERRIDES:
    text = open(path, encoding="utf-8").read()
    if model:
        text, n = re.subn(r"(?m)^model:\s*\S+\s*$", f"model: {model}", text, count=1)
        if n != 1:
            raise SystemExit(f"{path}: frontmatter に model 行が無い")
    if tools:
        text, n = re.subn(r"(?m)^tools:.*$", f"tools: {tools}", text, count=1)
        if n != 1:
            raise SystemExit(f"{path}: frontmatter に tools 行が無い")
    if report and "## antler: 報告の返し方" not in text:
        text = text.rstrip("\n") + "\n" + REPORT
    open(path, "w", encoding="utf-8", newline="\n").write(text)
    print(f"  {path}: " + ", ".join(x for x in (f"model={model}" if model else "", f"tools={tools}" if tools else "", "報告の返し方" if report else "") if x))
EOF

chmod +x .githooks/pre-push 2>/dev/null || true

cat <<'MSG'

配り終えました。続けて:
  sh scripts/setup.sh                              # clone ごとに 1 回（pre-push と記録の保存先）
  python scripts/registry_check.py                 # stack の登録の食い違い
  python scripts/ci_arch_check.py --self-test      # 検査自体が生きているか（probe）
  python scripts/tests/test_antler_hooks.py        # antler の hook の自己テスト
そのあと Claude Code を antler のルートで起動し、最初に /sfad init。
MSG
