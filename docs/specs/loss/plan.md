# 計画: loss（A-6 喪失・Claude が「失ったもの」を書く）

ブランチ `claude/loss-1adb87` の 1 つの PR に、下の単位でコミットを切る。api（#1）と sim（#2）は触るディレクトリが重ならない。
並行のセッション（stop-events・record・drive-link・edge-capture・pwa-uplink）と同じファイルを書かないよう、共有のファイル（app.ts・container.ts・error-mapper.ts・schema.ts・migrate.ts・routes.tsx）への変更は追加の数行だけにする。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | タイトル                              | 含むもの                                                                                                                                                                                                                                                                                                                                                    | 行数の目安 |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0   | docs(spec): loss の仕様               | `docs/specs/loss/` の 4 ファイル                                                                                                                                                                                                                                                                                                                            | 400        |
| 1   | feat(api): POST /api/trips/:id/losses | domain（losses の models・policies・errors）、ports（LossRepository・LossWriterGateway）、usecase、`trip_losses` の表（schema.ts・migrate.ts に追加）、Drizzle の repository、Claude の gateway と喪失のプロンプト部品、route と schema、app.ts・container.ts・error-mapper.ts の追加。plan-trip の `trip-writing-policy` から文の検査を export（追加だけ） | 900        |
| 2   | feat(sim): A-6 の画面                 | `apps/sim/src/features/loss/`（URL の読み書き・取り消し線・4 指標の純粋関数・単価の設定・文言・LossCard・StatTile・統計カード・喪失文の query・LossPage）、`app/routes.tsx` に `/loss/:id` の 1 行                                                                                                                                                          | 900        |
| 3   | test: 受け入れテスト                  | AC-1（api 全体、Claude はフェイク）、AC-2（画面、fetch はフェイク）                                                                                                                                                                                                                                                                                         | 200        |

### 依存グラフ

```
#0 spec ──┬── #1 api ──┐
          └── #2 sim ──┴── #3 受け入れ
```

## このフェーズで実装すること（In Scope）

- `apps/api`: `POST /api/trips/:id/losses`（入力の検証・記述子の鍵での保存と再利用・Claude の喪失文・共有の上限と枠）
- `apps/sim`: A-6 の画面（`/loss/:id`）と、drive から呼ぶ入口（barrel の `lossHref`・`CollisionReport`）
- 単価の設定 `features/loss/data/loss-baseline.json`（`verified:false`、概算）

## このフェーズで実装しないこと（Out of Scope）

- 運転中の衝突から `lossHref` に移る組み込み（drive-link。drive の feature は編集しない）
- 「衝突の 3 秒前を見る」の巻き戻し再生（drive。Deferred）
- A-7 の記録への喪失の表示、喪失の行の削除（record）
- 免責・NOC の実額（出典が無い。stats.json の deductible はプレースホルダ）
- 画面の言語の切り替え（`plan.lang` で出す。全画面の i18n 確認は Day 5）
- 複数インスタンスでのレート制限・同時の枠の共有（1 プロセス前提。plan-trip と同じ）

## マイグレーション統合

### 表の作成（起動時、`CREATE TABLE IF NOT EXISTS`）

- `trip_losses`（key_hash 主キー、trip_id、collision の JSON、story の JSON、created_at）と `trip_losses_trip_id` の索引
- 既存の表は変えない。戻す操作は表の削除だけ。`MIGR-1` で「空から作れる・2 回目でも壊れない」を確かめる

## 凍結

`@antler/schema`・`@antler/alert-ui` は変えない（応答の形は api と sim の feature の中の zod で確かめる。A と B の契約ではない）。凍結 API への変更なし。
