# 計画: deploy-a（Vercel・Turso・Vercel Blob の準備）

PR は 1 つ（ブランチ `feat/deploy-a`、base は main）。実装 約 700 行、テスト 約 800 行、手順書 約 300 行の見込み。入口・接続・数え・保存先が揃って初めて受け入れ（AC-1〜4）が通るので分けない。コミットを分けて読みやすくする。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | コミット                                         | 含むもの                                                                                                                                                                      | 行数目安 | 依存 | テスト要件                                |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | ----------------------------------------- |
| 1   | docs(spec): deploy-a                             | functional / threat / resilience / plan                                                                                                                                       | 500      | なし | なし                                      |
| 2   | feat(api): マイグレーションと Turso の接続       | `migrate.ts`（版・新しい表）、`remote-connection.ts`、`commands/migrate-db.ts`、`env.ts`（`TURSO_AUTH_TOKEN`）                                                                | 250      | #1   | unit（MIG・DB・ENV-2c）                   |
| 3   | feat(api): レート制限の数えを差し込み口に        | `rate-limit-counter.ts`、`rate-limit.ts`、`app.ts`                                                                                                                            | 250      | #2   | unit（RL）                                |
| 4   | feat(api): Vercel の組み立てと Blob              | `di/`（platform）、`vercel.ts`、`vercel-env.ts`、`vercel-client-ip.ts`、`blob-capture.repository.ts`、`vercel-blob-image.gateway.ts`、`vite.vercel.config.ts`、`@vercel/blob` | 450      | #3   | unit・integration（VH・ENV・IP・CAP・AC） |
| 5   | feat(sim): Vercel のプロジェクトと record の URL | `apps/sim/vercel.json`、`apps/sim/api/index.mjs`、`package.json`、`links.ts`、record の SSR のリンク                                                                          | 100      | #4   | unit（CFG・REC）                          |
| 6   | docs: 手順書・レビュー・前の feature の追記      | `docs/runbooks/2026-11-05-deploy-a-vercel-turso.md`、`docs/reports/`、plan-trip・edge-capture・record の追記と `spec_confirmed_at`                                            | 400      | #5   | なし                                      |

### 依存グラフ

```
#1 spec ── #2 DB ── #3 数え ── #4 Vercel の組み立て ── #5 sim ── #6 手順書・報告
```

## このフェーズで実装すること（In Scope）

- Vercel のプロジェクトの設定（`vercel.json`）・関数の入口・api の bundle
- Turso の接続（HTTP）・マイグレーションのコマンドと版・`/health/ready` の版の検査
- レート制限の数えの差し込み口と Turso の実装（HMAC の鍵・掃除・fail-open）
- Vercel のヘッダからの IP、Vercel の env の既定と検査
- Capture の保存先（Turso の行と Vercel Blob の画像）
- record の共有の URL（絶対の URL・`?app=1`）
- 手順書と `.env.example`

## このフェーズで実装しないこと（Out of Scope）

- 実際のデプロイ・アカウント・秘密の入力（ユーザー）
- B の PWA の公開（`ws://` と HTTPS の混在。別 feature）
- OG 画像の日本語のフォント（ライセンスの判断が要る。Deferred）
- `dataset/` の Blob からの取り込み（Deferred）
- 監視・ログの転送・Turso のバックアップ

## リスクと対策

| リスク                                                      | 対策                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 関数の中で Node の ESM が `@antler/*` を読めない            | Vite の SSR で bundle。AC-1 で bundle を Node で import して `/health` を確かめる。`vercel build`（手元）でも確かめる |
| `libsql` のネイティブが関数に入らず起動で落ちる             | 関数の経路は `@libsql/client/http` だけ。ローカルの組み立ては動的 import の先。AC-1 で実行の経路に無いことを確かめる  |
| 書き換えのあとのパス・resvg の Linux・Blob の OIDC          | 実際のデプロイでしか分からない（Deferred）。手順書の「デプロイの確かめ方」で 3 つを順に確かめる                       |
| 他の feature の仕様が STALE になる（plan-trip は api 全体） | 最後のコミットで plan-trip・edge-capture・record の functional.md に追記し、`spec_confirmed_at` を進める              |
| lock の作り直しで他のプラットフォームの optional が抜ける   | `npx -y npm@10 install` で `@vercel/blob` を足す（手元の npm 11 で作り直さない）                                      |
