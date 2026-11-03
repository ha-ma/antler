# 計画: plan-trip（A-1 旅をつくる・Claude がしおりを仕上げる）

ブランチ `feat/plan-trip` の 1 つの PR に、下の単位でコミットを切る。速度優先のため、#1 のあと #3（api）と #4（sim）をサブエージェントで並行に作る（触るディレクトリが重ならない）。
依存（npm）は #1 の前にまとめて入れる（並行の作業が同時に `npm install` しないため）。合計が 1,000 行を大きく超えるときは、#1〜#2 / #3 / #4 の 3 つの PR に分ける。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | タイトル                                       | 含むもの                                                                                                                                                                                                                                                  | 行数目安 | 依存   | テスト要件                                                                                   |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------- |
| 0   | chore: 依存を足す                              | api に `@anthropic-ai/sdk`・`drizzle-orm`・`@libsql/client`、sim に `react-router`・`zustand`・`react-hook-form`・`@hookform/resolvers`、新しい `packages/trip` の workspace 登録と `routes.toml`                                                         | 50       | なし   | registry_check                                                                               |
| 1   | feat(trip): しおりとリスクの純粋関数とマスター | `packages/trip/`（input・pleasures・places・itinerary・risk・locale・title、data の pleasures.json・places.json・stats.json・rates.json）。stats.json を apps/sim から移し、hook と CLAUDE.md の参照を直す                                                | 900      | #0     | unit（UC-1〜UC-4・UC-6）                                                                     |
| 2   | feat(schema): TripDetails を追加               | `packages/schema/src/trip-details.ts`、index の export（edge は使わないので JSON Schema には書き出さない）                                                                                                                                                | 60       | なし   | AC-1 で形を検証                                                                              |
| 3   | feat(api): POST /api/trips                     | domain（trips の models・policies・errors）、ports（TripRepository・TripWriterGateway・IdGenerator・TokenHasher・Clock）、usecase、Drizzle + libsql の repository と表の作成、Claude の gateway とプロンプト 2 部品、route・schema・error-mapper・env・DI | 1,000    | #1・#2 | unit（usecase はフェイク注入）、integration（SQLite のファイル）、e2e（Hono の app.request） |
| 4   | feat(sim): A-1 の画面                          | `apps/sim/src/features/plan-trip/`（store・入力フォーム・エリアタブ・PleasureCard・しおりパネル・リスク・言語切替・作成の mutation）、`/plan` と `/trip/:id/brief`（仮）                                                                                  | 900      | #1・#2 | component（RTL）、AC-2                                                                       |
| 5   | test: 受け入れテスト                           | AC-1（api 全体、Claude はフェイク）、AC-2（画面）                                                                                                                                                                                                         | 200      | #3・#4 | 受け入れ                                                                                     |

### 依存グラフ

```
#0 依存 ──┬── #1 trip ──┬── #3 api ──┐
          │             └── #4 sim ──┼── #5 受け入れ
          └── #2 schema ─────────────┘
```

## このフェーズで実装すること（In Scope）

- `packages/trip`: 入力の検証、楽しみ・地点のマスター（4 言語）、しおりの組み立て、リスクと根拠文、初期言語と通貨の表示、入力中の決まった形のタイトル
- `@antler/schema` に `TripDetails` を追加（凍結 API への追加。推奨で決定）
- `apps/api`: `POST /api/trips`（冪等キー・レート制限・1 日の上限・Claude の文・保存）
- `apps/sim`: A-1 の画面（`/plan`）と、作成後に移る `/trip/:id/brief` の仮の画面

## このフェーズで実装しないこと（Out of Scope）

- `GET /api/trips/{id}/day/{n}`、地図、ゾーン通過の予定時刻（brief-map）
- `/t/{id}` の記録ページ、削除の画面と API（record。所有者トークンの照合はそこで書く）
- 出来事の文（stop-events）、喪失文（loss）、今日の鹿レポート（deer-report）
- 楽しみの写真の実物（Day 6、CC0 / CC-BY のみ。当面は `photo-placeholder`）
- 保持期間による削除（Deferred）
- 複数インスタンスでのレート制限の共有（1 プロセス前提）

## マイグレーション統合

### 表の作成（起動時、`CREATE TABLE IF NOT EXISTS`）

- `trips`（id 主キー、plan の JSON、details の JSON、owner_token_hash、created_at）
- `trip_requests`（key 主キー、body_hash、status、trip_id、updated_at）
- 作成件数は `trips.created_at` から数える（専用の表は作らない）
- 戻す操作は表の削除だけ（データファイルを消せば初期状態）。`MIGR-1` で「空から作れる・2 回目でも壊れない」を確かめる

## 凍結

`@antler/schema` への `TripDetails` の追加は凍結 API への変更なので、PR に「推奨で決定（凍結 API への追加。既存の型は変えない）」と書き、alert-contract-guard の Critical 0 を確かめる。
