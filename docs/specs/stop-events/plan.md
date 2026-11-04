# 計画: stop-events（A-4 観光スポット・Claude の出来事の文・イベントログ）

ブランチ `feat/stop-events` の 1 つの PR に、下の単位でコミットを切る。api（#1〜#3）と sim（#4）は触るディレクトリが重ならないので、#1 の束の形が決まったら並行に作れる。
依存（npm）は足さない（sim は zod を入れず、応答を手書きの型ガードで確かめる。lock を他のセッションとぶつけない）。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | タイトル                                  | 含むもの                                                                                                                                                                                               | 行数目安 | 依存   | テスト要件                                                            |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | --------------------------------------------------------------------- |
| 0   | docs(spec): stop-events の仕様            | functional・threat・resilience・plan                                                                                                                                                                   | 600      | なし   | sfad-guard                                                            |
| 1   | feat(api): 出来事の束の組み立て           | `domain/stop-events/`（models・rules・policies の buildStopDeck・validateStopWriting・isTripOwner・errors）                                                                                            | 700      | #0     | unit（DECK-*・WRITE-2a〜c）                                           |
| 2   | feat(api): 束の POST と Claude の gateway | ports（SceneWriterGateway・StopDeckRepository）、usecase、Claude の gateway、Drizzle の repository と表、route・schema・error-mapper・DI・CORS                                                         | 900      | #1     | unit（usecase はフェイク）、integration（SQLite）、e2e（app.request） |
| 3   | feat(api): イベントログ                   | ports（TripEventRepository）、usecase、repository と表、route・schema                                                                                                                                  | 600      | #2     | 同上（LOG-*・IDEM-32〜33・AUTH-33・35・37）                           |
| 4   | feat(sim): A-4 のモーダルと運転からの入口 | `apps/sim/src/features/stop-events/`（StopSceneModal・ChoiceButton・useStopDeck・useTripEventLog・場面の選び出し・確認用の画面）、plan-trip の barrel に `ownerTokenOf`、app の routes に確認用の 1 行 | 900      | #1     | component（RTL）、AC-32                                               |
| 5   | test: 受け入れテスト                      | AC-31（api 全体、Claude はフェイク）、AC-32（画面）                                                                                                                                                    | 200      | #3・#4 | 受け入れ                                                              |

### 依存グラフ

```
#0 仕様 ── #1 束 ──┬── #2 束の POST ── #3 イベント ──┐
                   └── #4 sim ──────────────────────┴── #5 受け入れ
```

## このフェーズで実装すること（In Scope）

- `apps/api`: 束の組み立て（純粋関数）、`POST /api/trips/:id/day/:n/stop-deck`（Claude・保存・所有者の照合・共有の上限）、`POST /api/trips/:id/events`（4 種のイベント・重複・上限）、`TripEventRepository.listByTrip`（record が読む）
- `apps/sim`: A-4 のモーダル、束の取得とイベントの送信の hook、運転からの入口（barrel）、確認用の画面 `/trip/:id/day/:n/stops`

## このフェーズで実装しないこと（Out of Scope）

- 運転中に場面を出す組み込みと、選んだ遅れを運転に反映すること（drive-link）
- 遭遇・衝突・回避を実際に送ること（drive-link・loss）
- 記録ページとイベントの集計・読み出しの API（record）
- 束を誰でも読める GET、旅の削除に合わせた行の削除（record）
- 写真の実物（Day 6）
- 複数インスタンスでのレート制限・同時の枠の共有（1 プロセス前提）

## マイグレーション統合

### 表の作成（起動時、`CREATE TABLE IF NOT EXISTS`）

- `stop_decks`（trip_id・day の主キー、status pending / done / failed、deck の JSON、writing の JSON、created_at、updated_at）
- `trip_events`（trip_id・run_id・seq の主キー、day、kind、at、alert_enabled、leg、km、data の JSON、received_at）と `trip_events_trip` 索引（trip_id, received_at）
- `schema.ts`（Drizzle）と `migrate.ts`（STATEMENTS）の両方に足す。戻す操作は表の削除だけ。`MIGR-31` で確かめる

## 共有ファイルへの最小の追加（PR に明記する）

- `apps/api/src/infrastructure/http/app.ts`: 2 つの route の登録と、CORS の許可ヘッダ `X-Owner-Token`
- `apps/api/src/infrastructure/http/error-mapper.ts`: OwnerRequiredError・EventConflictError・EventLimitError・SceneWriterError
- `apps/api/src/di/container.ts`: 2 つの usecase の組み立て。Claude の同時の枠（InProcessConcurrencyLimiter）は plan-trip と同じインスタンスを渡す
- `apps/api/src/infrastructure/db/schema.ts`・`migrate.ts`: 2 つの表
- `apps/sim/src/features/plan-trip/index.ts`: `ownerTokenOf` の export（1 行。record も同じものを使う）
- `apps/sim/src/app/routes.tsx`: 確認用の画面の 1 行（`*` の直前）

## 凍結

`packages/schema` と `packages/alert-ui` は変えない（束とイベントの型は api の HTTP 契約と sim の型に置く）。凍結 API への変更なし。
