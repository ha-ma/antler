# 計画: brief-map（A-2 出発前ブリーフィング・その日のルートとゾーン）

ブランチ `feat/brief-map` の 1 つの PR に、下の単位でコミットを切る。
#1 のあと #2（api）と #3（sim）は触るディレクトリが重ならない。依存（npm の `maplibre-gl`）は #0 でまとめて入れる。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | タイトル                                   | 含むもの                                                                                                                                                                   | 行数目安      | 依存 | テスト要件                                        |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---- | ------------------------------------------------- |
| 0   | chore: 依存とルートのデータ                | sim に `maplibre-gl`、`packages/trip/scripts/fetch-routes.ts`（OSRM から取得・間引き・encode）、`packages/trip/data/routes.json`、CREDITS.md                               | 300 ＋ データ | なし | UC-1f                                             |
| 1   | feat(trip): その日の行程・ゾーン・光・条件 | `packages/trip/src/day/`（roads・day-plan・passages・sun-times・conditions・rng・schema）、サブパス `@antler/trip/roads`（routes.json を読むのは api だけ）                | 700           | #0   | unit（UC-1〜UC-4）                                |
| 2   | feat(api): GET /api/trips/:id/day/:n       | usecase・RoadCatalog の port と file の gateway・route・error-mapper・DI                                                                                                   | 400           | #1   | unit（usecase）、e2e（Hono の app.request）、AC-1 |
| 3   | feat(sim): A-2 の画面                      | `apps/sim/src/features/brief-map/`（BriefPage・ZoneMap と投影・AlertToggleCard・ConditionsCard・文言）、routes の `/trip/:id/brief` の差し替え、plan-trip の仮の画面を消す | 1,000         | #1   | component（RTL）、AC-2                            |

### 依存グラフ

```
#0 依存・データ ── #1 trip ──┬── #2 api
                            └── #3 sim
```

## このフェーズで実装すること（In Scope）

- 地点間のルートの同梱データ（OSRM、開発時に 1 回）と、その取得スクリプト
- その日の行程・ゾーンの通過と光・日没と薄暮・当日の条件（`@antler/trip`。純粋関数）
- `GET /api/trips/:id/day/:n`（公開・レート制限）
- A-2 の画面: 地図（MapLibre ＋ OpenFreeMap、背景なしの縮退）・SVG の重ね・ゾーン通過の一覧・アラートのトグルと凡例・条件・操作説明・開始

## Out of Scope（明示的にやらないこと）

- 運転の画面が DayPlan で走ること（drive-3d。この feature は `/drive?trip=&day=&alert=off` の URL を渡すだけ。drive の feature のファイルを編集しない）
- `/drive` のチャンクの先読み（drive-3d のマージ後）
- ランダムなイベント（stop-events）、旅全体の地図と記録（record）、Capture の語彙への変換（capture）
- 実行時の OSRM・自前のタイルサーバー
- 条件の保存（シードから決まるので保存しない）

## 依存とブロッカー

- drive-3d（ブランチ `claude/drive-3d-531e17`、マージ前）: 条件の型の文字列（Surface・Weather）を合わせる。マージの後で drive が `@antler/trip` の型に差し替える（共有のメモに書く）
- OSRM デモサーバー（取得スクリプトのときだけ。1 秒に 1 件）
- `apps/sim/src/app/routes.tsx` は drive-3d も触る（`/drive`）。brief-map は `/trip/:id/brief` の 1 行だけを変える

## マイグレーション統合

N/A: 表を増やさない・変えない（条件はシードから決まる。R4）
