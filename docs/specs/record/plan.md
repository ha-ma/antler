# 計画: record（A-7 旅の記録・走行の記録・記録ページ・削除）

ブランチ `claude/record-0a29f5` の 1 つの PR に、下の単位でコミットを切る。
#1 のあと #2（api）と #3（sim）は触るディレクトリが重ならない。依存（`@resvg/resvg-js`）は #2 で入れる（lock は npm@10 で作る）。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | タイトル                                   | 含むもの                                                                                                                                                                                                                                                                                         | 行数目安 | 依存 | テスト要件                                              |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---- | ------------------------------------------------------- |
| 0   | docs(spec): record の仕様                  | `docs/specs/record/` の 4 ファイル                                                                                                                                                                                                                                                               | 600      | なし | なし                                                    |
| 1   | feat(trip): 走行の記録の形と集計           | `packages/trip/src/record/`（`DriveRunInputSchema`・`summarizeRecord`・`TripRecordSchema`）と index の export                                                                                                                                                                                    | 350      | #0   | unit（UC-1・UC-2）                                      |
| 2   | feat(api): 走行の保存・記録・削除・SSR・OG | domain の owner-policy と errors、record の port と Drizzle 実装、表 `trip_runs`（migrate・schema）、UnitOfWork に records、usecase 3 つ、routes・schemas・views（SVG・HTML）・OG の描画、error-mapper、app.ts（route と CORS の Authorization）、DI、env（`SIM_PUBLIC_URL` など）、.env.example | 1,000    | #1   | unit（usecase・policy・view）、e2e（app.request）、AC-1 |
| 3   | feat(sim): A-7 の画面と保存・削除の hook   | `apps/sim/src/features/record/`、routes の `/t/:id`、plan-trip の barrel から `ownerTokenOf`・`forgetOwnerToken`、.env.example の `VITE_PWA_URL`                                                                                                                                                 | 900      | #1   | component（RTL）、AC-2                                  |
| 4   | docs: CREDITS・roadmap・引き継ぎ           | CREDITS.md（resvg-js）、roadmap の持ち越し                                                                                                                                                                                                                                                       | 30       | #2   | なし                                                    |

### 依存グラフ

```
#0 仕様 ── #1 trip ──┬── #2 api ── #4 docs
                    └── #3 sim
```

## このフェーズで実装すること（In Scope）

- 走行の記録（run）の形・保存（所有者トークン・冪等・上限）・日ごとの最新での集計
- 記録の JSON・共有用の SSR ページ（OG の meta・noindex・CSP）・しおりの PNG（OG 画像と保存）
- 旅の削除（所有者トークン・1 つのトランザクション・冪等キーの行も）
- A-7 の画面（StatTile・守れたもの・ゾーンのログ・しおり・B の導線・挑戦・コピー・保存・削除）
- barrel の `useSaveRun`・`recordHref`（drive・loss が使う）

## Out of Scope（明示的にやらないこと）

- drive/ の中の変更（drive-link のマージ後に、app 層の `DriveRoute` で `onFinish` を受けてつないだ。drive のファイルは変えない）
- A-6 喪失の画面（loss）。衝突の run の保存は loss / drive が `useSaveRun` で行う
- 出来事の時系列（stop-events の `POST /api/trips/:id/events`）と、その行の削除（後からマージする側が削除のトランザクションに足す）
- 楽しみの写真の実物（Day 6）、Claude の「今日の鹿レポート」（付録 A #10）
- 同意と Capture（capture）
- 保持期間による自動削除（Deferred。暫定は消さない）
- 所有者トークンの入れ替え・再発行

## 依存とブロッカー

- drive-link（`feat/drive-link`、作業中）: `DriveResult` に `zonePasses` と遭遇の時刻の材料を足してもらう（共有ノート record-handover.md）。来なければ、つなぐ側が `zonePasses` を場面のゾーン区間と最後の道のりから数える
- stop-events（作業中）: events の表の削除と runId の紐づけ（上の Out of Scope）
- `apps/api/src/infrastructure/http/app.ts`・`di/container.ts`・`error-mapper.ts`・`config/env.ts`・`db/migrate.ts`・`db/schema.ts`・`application/ports/unit-of-work.ts` は stop-events・loss も足しうる。record は自分の行を足すだけ（並べ替えない）
- `apps/sim/src/app/routes.tsx` は drive-link・loss も触る。record は `/t/:id` の 1 行だけ

## マイグレーション統合

- 表 `trip_runs` を足す（`CREATE TABLE IF NOT EXISTS`。起動時の `ensureSchema`、MIGR-1 と同じ）:
  - `trip_id TEXT NOT NULL`、`run_id TEXT NOT NULL`、`day INTEGER NOT NULL`、`payload TEXT NOT NULL`（run の JSON）、`created_at INTEGER NOT NULL`、`seq INTEGER NOT NULL`（旅の中の保存の順番 1..）、`PRIMARY KEY (trip_id, run_id)`
  - 索引 `trip_runs_trip_seq (trip_id, seq)`
- 外部キーは張らない（SQLite の外部キーは接続ごとに有効化が要る）。削除は usecase のトランザクションで明示的に消す
- 戻すときは表の削除だけ（既存の表は変えない）
- stop-events が表を足すときも同じ `STATEMENTS` の配列の末尾に足す（衝突は行の追加だけ）
