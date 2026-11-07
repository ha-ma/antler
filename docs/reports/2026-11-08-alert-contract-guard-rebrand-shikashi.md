# alert-contract-guard 結果: rebrand-shikashi（2026-11-08）— Critical 0 / Warning 0 / Info 2

対象: `git diff origin/main`（c03c061・fe2840c）。
エージェントは呼べなかったので、メインセッションが `.claude/agents/alert-contract-guard.md` の観点で自分で確かめた。

## Critical

なし。

- `packages/alert-ui`・`packages/schema` のファイルは 1 つも変えていない（`git diff --stat origin/main -- packages/alert-ui packages/schema` が空）。凍結の公開 API・props・3 状態の色と形・音は変わらない
- A と B は今までどおり `@antler/alert-ui` の `AlertState` を使う。PWA の接続画面の 3 つのプレビューもそのまま（UC-5c のテストが通る）
- tokens.json は `name`（EZO ROAD → SHIKASHI）だけを変えた。`name` は生成物（`tokens.css`・`tokens.ts`）に出ない。色・文字・余白の値は同じ。ブランドの色を足していない（ロゴは画像）
- `alert-danger` を新しく使ったところは無い。製品の行は `ink-muted`
- AlertFlag・Capture・TripPlan の型、WebSocket のフラグ、`t_frame`・`t_sent`・`t_shown`、同意の流れに触れていない
- edge は設定ページ（http の `/`）の文字だけ。CA・証明書・ホスト名（`ezoroad.local`）・ポート・パスは同じ

## Warning

なし。

## Info

- `docs/design/AlertState.md` は変えていない。要件・デザインの写しの「EZO ROAD」は旧名と読む注記を CLAUDE.md と ch0-about.md に足した。エージェントの説明（このファイルの元）の読み替えにも足した
- PWA の文言の表に `tagline` を足した（`apps/pwa` の中だけ。alert-ui の文言の表ではない）

## 未確認

- なし
