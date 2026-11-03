## 変更内容

<!-- feature 名（/sfad cycle の名前）と、要件 ID・画面名で書く。例: alert-ui / B4-2〜B4-7 / B-1〜B-3 -->

## 関連

- 要件: docs/requirements/ch?-*.md の ID
- 仕様: docs/specs/<feature>/

## 仮採用した判断（第 9 章）

<!-- ch9-decisions.md で空欄・要確認の項目に触れたら「仮採用: <項目> = <推奨>」。無ければ「なし」 -->

## 凍結した API（packages/schema・packages/alert-ui）への変更

<!-- 「なし」か、変更点と人 A・人 B 両方の合意。変更したら alert-contract-guard の結果を貼る -->

## 完成判定

- [ ] `python .claude/hooks/sfad-done.py` が exit 0（出力を貼る）
- [ ] `python scripts/local-ci.py` の記録がある（pre-push が通る）
- [ ] テストを足した・直した
- [ ] lint・型チェックのエラーなし
- [ ] 利用者の入力を検証した（Zod / JSON Schema）
- [ ] 秘密情報・個人情報・精密な位置を直書き・保存していない
- [ ] 足したアセットの出所を CREDITS.md に書いた（無ければ省略）

## レビュー

<!-- 使ったエージェントと Critical の数。例: code-reviewer Critical 0 / alert-contract-guard Critical 0。Warning は docs/reports/ に -->
