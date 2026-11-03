# layer-guard: brief-map（GET /api/trips/:id/day/:n）2026-11-03

エージェントに Write が無いため、メインセッションが返答を写した。対応は 2481db9。

## Critical: 0

domain・application・routes の import の向きは規約どおり。UseCase に Context・HTTPException・zod・HTTP status は無い。Route に業務の分岐・drizzle-orm は無く、HTTP status を知るのは error-mapper.ts だけ。Service レイヤは無く、`new` は di/container.ts に集まっている。

## Warning

- W1 `get-trip-day.usecase.ts` が `performance.now()` を直接呼ぶ → **対応済み**: `Clock` を deps に足し、遅延の warn をテストで決定的にした
- W2 `file-road-catalog.gateway.ts` は「Gateway は外部 transport 専用」から外れる（同梱ファイルの読み込み）。コンストラクタの `readFileSync`・`createRequire` は Workers では動かない → **対応済み（コメント）**: port に「同梱データ用の例外。Workers では別の実装」と書いた。Workers 対応は次に回す

## Info（次に回す）

- RoadCatalogGateway の型は `@antler/trip`・`@antler/zones`（zod 由来の純粋データ型）。ORM・HTTP の型は漏れていない
- `trip-errors.ts` の先頭コメントが古い → 対応済み
- `validation.ts` の `throwOnInvalidTripBody` をパスにも使っていて名前が合わない（`throwOnInvalidInput` などに）
- `trip-day.schema.ts` に response の schema が無く、`trip-day/` に dto.ts が無い
- `TRIP_ID_PATTERN` は rules/、検査は UseCase。許容
