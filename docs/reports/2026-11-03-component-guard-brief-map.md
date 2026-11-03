# component-guard: brief-map（A-2 出発前ブリーフィング）

対象: apps/sim/src/features/brief-map/ 全体、apps/sim/src/app/routes.tsx、plan-trip から仮の画面を外した変更。コードは直していない。

## 結果

Critical 0 / Warning 5 / Info 7

通った項目:

- components/ 内に fetch・useEffect は無い。データ取得は hooks/useTripDay.ts の useQuery だけ
- useEffect は hooks/useBaseMap.ts の 1 箇所だけ。MapLibre と ResizeObserver という外部システムの作成と片付けで、eslint-disable に理由がある。派生値には使っていない
- useState は useBaseMap の 2 個だけ。components/ 内は 0 個
- Zustand は使っていない。types.ts の State 設計と実装が一致している
- feature 境界は問題なし。index.ts は BriefPage だけを公開し、routes.tsx は barrel 経由。brief-map から他 feature への import は無く、plan-trip も brief-map を import していない。`@/shared/utils/logger` は shared なので可
- `any` は無い
- props の深さは最大 2 段（BriefPage → BriefContent → ZoneMap → SunChip の 3 コンポーネントだが、渡すのは day と lang だけで、途中で加工も中継もしていない）。3 段超の drilling は無い
- useMemo の依存は正しい。`lines`（[day]）→ `bounds`（[lines]）→ `overlay`（[day, project]）→ `stayPoint` の連鎖に漏れや過剰は無い。`day` は TanStack Query の同一参照なので無駄な再計算も起きない

## Warning

### W1. 日を切り替えると、片付け済みの地図の投影が残る（useBaseMap.ts:56-154、BriefPage.tsx:23-37）

`useTripDay` は `staleTime: Infinity` なので、一度見た日に戻るとキャッシュが即座に返る。その場合 `query.isPending` が立たず、BriefPage は BriefContent を作り直さない。ZoneMap と useBaseMap のインスタンスも残る。

このとき `boundsKey` が変わるので effect の cleanup で `map.remove()` が走る。しかし `state` は `loading` に戻らず、`state.project` は削除済みの MapLibre の `m.project` を指したままになる。新しい日の `day` に対して古い投影で `buildOverlay` が走り、新しい地図の `style.load` までの間、新しい日のルートが古い地図の座標系で描かれる。fallback のときは古い bounds で作った投影が残る。

`BriefPage.test.tsx` は日の切り替えをキャッシュ済みの状態で確かめているか不明。
対応案:

- BriefContent に `key={`${id}:${day.day}`}` を付けて日ごとに作り直す。BriefHeader の `h1` へのフォーカス移動（`focusOnMount`）も日の切り替えで効くようになる
- または effect の先頭で `setState(loading)` に戻す。ただし「effect の中で setState」になるので、key を使う案を勧める

### W2. 派生値と文言の組み立てがコンポーネントの中にある（BriefPage.tsx:79-99、ZoneMap.tsx:16-49）

- BriefContent の `route` / `totalKm` / `summary` / `note` / `nextDay`、ZoneMap の `zonesText` / `label` は、DayPlan と lang から決まる純粋な文字列組み立て。hooks/ か utils/ に出すとテストしやすくなり、JSX が短くなる（例: `utils/summary.ts` の `buildDaySummary(day, plan, details, lang)`、`utils/mapLabel.ts` の `buildMapLabel(day, lang)`）
- ZoneMap の名札の文字・幅・位置の計算（87-110 行）は `overlay.labels` に載せるか、`buildOverlay` の後段の純粋関数にまとめる。JSX の中で `fillText` や `Math.min` を回している

### W3. ZoneMap が大きい（ZoneMap.tsx 193 行、JSX 約 125 行）

地図の枠、SVG の重ね、名札、地点、凡例、注記、出典、SunChip を 1 つが担当している。
対応案: `ZoneOverlay`（SVG のみ。props は overlay・day・lang・size・mode）、`MapLegend`（figcaption）に分ける。`overlay.routeOutside` / `routeInside` / `bands` の 3 つの `<g>` の `<path>` 繰り返しは `PathGroup` にまとめると 20 行減る。

### W4. BriefPage.tsx に 3 つのコンポーネントと分岐が同居（157 行）

BriefPage / BriefError / BriefContent が同じファイルにある。BriefError のエラー → 文言の三項演算子の入れ子（45-54 行）と、遷移先の三項演算子の入れ子（60-72 行）は読みにくい。
対応案: BriefError.tsx と BriefContent.tsx に分け、`errorKind(error)` → `{ message, action }` を返す純粋関数にする。

### W5. useTripDay が Query の AbortSignal を使っていない（useTripDay.ts:28-35）

`AbortSignal.timeout(10_000)` だけを渡しているので、日の切り替えやアンマウントで進行中の fetch が止まらない（queryFn が受け取る `signal` を使っていない）。結果は捨てられるが、通信は続く。
対応案: `queryFn: ({ signal }) => fetchTripDay(id, day, AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]))`。

## Info

- I1. `INVALID_RESPONSE`（形の違い）も `status === null` なので再試行の対象になる（useTripDay.ts:63-65）。形の違いは再試行しても直らない。通信の失敗だけを再試行するなら、`TripDayError` に `retryable` を持たせるほうが意図が伝わる
- I2. `apiBase()` が plan-trip の useCreateTrip.ts:57 と同じ内容で二重にある。`@/shared/` に昇格させる候補（feature 間で直接 import はできないため）
- I3. `briefHref` / `driveHref` / `parseDay` は URL の純粋関数だが hooks/useBriefParams.ts に置かれている。utils/ に出すと、hooks/ は React のフックだけになる
- I4. useBaseMap の effect が約 100 行で、MapLibre の作成・タイムアウト・fallback・ResizeObserver を 1 つの閉包で扱っている。`map/controller.ts` のように React 非依存の関数にして effect は呼ぶだけにすると、テストが jsdom の WebGL なしで書ける。`boundsKey` の `JSON.stringify` / `JSON.parse` は、west/south/east/north の 4 つの数値を依存にして避けられる
- I5. ConditionsCard の `word(key: string)` は `key as BriefTextKey` で型を黙らせている（ConditionsCard.tsx:12）。`vehicle${cap(c.vehicle)}` の組み立てが型で守られないので、c.vehicle の取りうる値と text.ts のキーがずれても typecheck が通らない。`Record<Vehicle, BriefTextKey>` の表にする
- I6. `lang` を全コンポーネントが props で受けている。今は 2 段までなので問題ないが、段が増えるなら `BriefLangContext`（読み取り専用の Context）を検討する。Zustand は不要
- I7. 細かい点: `day.legs[0]?.from ?? ''`（BriefPage.tsx:84）は length チェック済みなので `''` のフォールバックは到達しない。pending の文言が `BRIEF_TEXT.loading.ja` 固定（旅の言語が分かる前なので妥当）。ZonePassageList / 重ね SVG の `key={i}` は静的な並びなので実害なし
