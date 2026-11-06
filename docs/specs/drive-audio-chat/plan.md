# 計画: drive-audio-chat（A-3 運転中の音・車内の会話）

ブランチ `feat/drive-audio-chat`。PR は 2 本に分ける。

- **PR 1（この cycle）**: 部品だけ。api の会話の生成、sim の `features/drive/audio/` と `features/drive/chat/`。drive の既存ファイルは編集しない（運転は今までどおり）
- **PR 2（drive-tune が main に入った後）**: 組み込み。main を取り込み、drive-tune の合図（回転数・ブレーキの強さ・ABS）に `signalsFromSnapshot` を合わせ、`StartOverlay` の出発・もう一度で `driveAudio.start()`、`DriveScreen` に `ChatFeed` と `AudioControls` を置く

drive の運転の中身は別のセッション（drive-3d、ブランチ drive-tune）が直しているので、同じファイルを 2 つのセッションが書かないように、PR 1 は drive の新しいディレクトリ（audio/・chat/）だけを作る。合図の取り決めは共有のメモ `drive-audio-chat-handover.md` に書いた。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | タイトル                                   | 含むもの                                                                                                                                                                                                                                                                                                                         | 行数の目安 |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0   | docs(spec): drive-audio-chat の仕様        | `docs/specs/drive-audio-chat/` の 4 ファイル、spec-adversary のレポート                                                                                                                                                                                                                                                          | 500        |
| 1   | feat(api): POST /api/trips/:id/day/:n/chat | domain（chats の models・policies・errors・rules）、ports（ChatRepository・ChatWriterGateway）、usecase と材料、`trip_chats` の表（schema.ts・migrate.ts。SCHEMA_VERSION 3）、Drizzle の repository、Claude の gateway とプロンプト、route と schema、app.ts・container.ts・error-mapper.ts の追加、record の deleteTrip に 1 行 | 1,000      |
| 2   | feat(sim): 運転の音の部品                  | `features/drive/audio/`（鳴らすかの決まり・エンジン・ブレーキ・混ぜ方・BGM の曲・通知音の純粋関数、Web Audio の差し込み口、`DriveAudio` コントローラ、設定の store、`AudioControls`）                                                                                                                                            | 800        |
| 3   | feat(sim): 車内の会話の部品                | `features/drive/chat/`（束の型と応答の検証、`useChatDeck`、見本の会話、`advanceChat`、`ChatFeed`）                                                                                                                                                                                                                               | 700        |
| 4   | test: 受け入れテスト                       | AC-41（api 全体、Claude はフェイク）、AC-42（部品をスナップショットの列で通す、音はフェイク）                                                                                                                                                                                                                                    | 250        |
| 5   | （PR 2）feat(sim): 運転画面への組み込み    | `DriveScreen`・`StartOverlay`・HUD の CSS の最小の変更、`signalsFromSnapshot` の差し替え、DriveScreen の結合テスト                                                                                                                                                                                                               | 200        |

### 依存グラフ

```
#0 spec ──┬── #1 api ─────────────┐
          ├── #2 audio ──┐        ├── #4 受け入れ ── (drive-tune のマージ) ── #5 組み込み（PR 2）
          └── #3 chat ───┴────────┘
```

## このフェーズで実装すること（In Scope）

- `apps/api`: `POST /api/trips/:id/day/:n/chat`（所有者の確かめ・束の計画・Claude の一言・保存と再利用・共有の上限と枠）
- `apps/sim`: 音と会話の部品、音量の操作、端末の見本の会話
- `CREDITS.md` に「運転の音: 自作（Web Audio の合成）」
- `apps/sim/.env.example` に `VITE_GAME_AUDIO=off`

## このフェーズで実装しないこと（Out of Scope）

- 運転画面への組み込み（PR 2。drive-tune の後）
- 会話の読み上げ（A3-8 の「音声」。Deferred）
- A-2 で会話を先に作っておくこと
- 鹿の警告の音（alert-ui。凍結済み）の変更
- 複数インスタンスでの同時の枠の共有（1 プロセス前提。plan-trip と同じ）

## マイグレーション統合

### 表の作成（起動時、`CREATE TABLE IF NOT EXISTS`）

- `trip_chats`（key_hash 主キー、trip_id、day、deck の JSON、created_at）と `trip_chats_trip_id` の索引
- `SCHEMA_VERSION` を 2 → 3。既存の表は変えない。戻す操作は表の削除だけ。`MIGR-41` で確かめる
- **Vercel（Turso）**: runbook（`docs/runbooks/2026-11-05-deploy-a-vercel-turso.md`）のとおり、この PR を main に入れる前に、production と preview に `npm run db:migrate` を流す（ユーザーの `.env.turso-*` が要る。流すまでマージしない）

## 共有ファイルへの最小の追加（PR に明記する）

- api: `app.ts`（route 1 つ）、`di/container.ts`（usecase と gateway の組み立て）、`error-mapper.ts`（ChatLimitError 409・ChatWriterError 502）、`db/schema.ts`・`db/migrate.ts`（表 1 つと版）、`drizzle-record.repository.ts` の deleteTrip（`trip_chats` を消す 1 行）
- sim: `.env.example`（1 行）。drive の既存ファイルは PR 1 では触らない

## 凍結

`@antler/schema`・`@antler/alert-ui` は変えない（会話の束の形は api と sim の feature の中の zod で確かめる。A と B の契約ではない）。凍結 API への変更なし。
