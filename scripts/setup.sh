#!/bin/sh
# clone したら最初に 1 回打つもの:  sh scripts/setup.sh
# git のフックは clone に含まれない（.git/hooks は転送されない）ので、有効化は人の 1 手が要る。
set -eu
root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "-- git のフックを有効にする --"
# core.hooksPath は worktree 間で共有される（.git/config は共通）
git config core.hooksPath .githooks
echo "  core.hooksPath = $(git config --get core.hooksPath)"
chmod +x .githooks/pre-push 2>/dev/null || true
git update-index --chmod=+x .githooks/pre-push 2>/dev/null || true

echo "-- 記録の保存先を .gitignore に入れる --"
# 入っていないと、記録を作った瞬間に作業ツリーが汚れ、検査が自分の記録で止まる
if git check-ignore -q .claude/state/local-ci/probe.json; then
  echo "  入っている"
else
  printf '\n# local-ci の記録（コミットしない）\n.claude/state/\n' >> .gitignore
  echo "  .gitignore に .claude/state/ を追記した（コミットしてください）"
fi

echo "-- 自己テスト --"
python scripts/tests/test_local_ci.py | tail -1

cat <<'MSG'

セットアップが終わりました。
  記録を見る   python scripts/local-ci.py --status
push の前に pre-push フックが記録の有無を見ます（--no-verify では飛びます）。
MSG
