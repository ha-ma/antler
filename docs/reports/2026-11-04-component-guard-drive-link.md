# component-guard: drive-link（apps/sim/src/features/drive）

対象: DriveScreen.tsx・DrivePage.tsx・StartOverlay.tsx・hud/EndBanner.tsx・hooks/use-trip-day.ts・hooks/use-drive-params.ts・api/trip-day.ts・app/routes.tsx
注: Bash が使えなかったため `git diff` ではなく対象ファイルを直接読んだ。コードは直していない。

## Critical

なし。

- components/ 内に fetch・データ取得の useEffect は無い（取得は hooks/use-trip-day.ts の useQuery、fetch は api/trip-day.ts のみ）
- Zustand の create() は drive 内に無い
- feature 間の import は無い（`@/features/...` の直 import は 0 件。routes.tsx は barrel の `@/features/drive` 経由）
- `any` は非テストコードに 0 件

## Warning

### W-1 内部遷移が `<a href>` で、SPA 遷移にならない（フルリロード）

- 箇所: DriveScreen.tsx の TripMessage（118-122 行）、StartOverlay.tsx（53-58 行）、EndBanner.tsx（24-28 行）
- brief-map は同じ A-2 / plan への遷移に react-router の `<Link to>` を使っている（BriefPage.tsx 71・75・144 行）。drive だけ `<a href>` なので、A-2 に戻るたびに全体を再読込する。QueryClient のキャッシュ（`staleTime: Infinity` の意図）も捨てられ、A-2 の地図とその日の行程を読み直す。
- 直し方: `Link`（`react-router`）に替える。jsdom のテストは MemoryRouter 配下なので影響は小さいはず。

### W-2 エラー応答の形が想定外のとき TypeError になる（api/trip-day.ts 46-49 行）

- `{ "error": null }` のような本文だと `'error' in body` は真で、`body.error.code` が TypeError になる。TripDayError ではない例外が queryFn から出るので、`shouldRetryTripDay` も `code` 判定も外れ、利用者には「失敗」の汎用文だけが出る。
- 直し方: `error` がオブジェクトかを確かめてから `code` を読む（zod で `{ error: { code: string } }` を parse してもよい）。
- 補足: 54-56 行の `b as Record<string, unknown>` も、body が配列・文字列のとき `b['plan']` が undefined になるだけで落ちはしないが、`unknown` を safeParse するほうが素直。

### W-3 TripDrive の key に `params.search` を含めている（DriveScreen.tsx 44 行）

- 無関係なクエリ（例: `?utm_...`）が変わっただけでも DrivePage が作り直され、走行が最初に戻る。意図は「alert が変わったら作り直す」なら、`params.alertOn` を key に使えば足りる。`search` は場面のシードに効くなら意図どおりだが、その場合は仕様（R1）に書いてあるか確かめる。
- 逆に demo 側（29-37 行）は key が無く、search が変わってもエンジンは作り直されない。trip 側と挙動がそろっていない。

## Info

- I-1 useState: DrivePage は 3 個（engine・started・soundOn）で上限ちょうど。次に足すなら hooks/ か store.ts に出す。State 設計の宣言コメント（23-29 行）は規約どおり。
- I-2 useEffect は hooks/ 内の 3 件のみ（use-alert-sound の dispose、use-keyboard-drive、use-auto-pause）で、いずれも外部の購読・片づけ。派生値の useEffect は無い。
- I-3 `TRIP_ID`・`parseDay`・`briefHref`・`TripDayError` 周りは brief-map と重複している。feature 間 import 禁止のため仕様どおりだが、3 つ目の feature（A-6・A-7）が必要としたら `shared/` への昇格を検討する。queryKey が別（`drive-trip-day`）なのは、形が違うので妥当。
- I-4 DrivePage.tsx 53 行の `defaultEngine` は `window.location.search` を直に読む。DriveScreen が `useSearchParams` から demo の search を渡しているので、DrivePage 単体を使う箇所（テスト・barrel の再 export）だけで使われる。URL 状態は DriveScreen に一本化するか、既定を削って createEngine を必須にするとよい。
- I-5 DrivePage.tsx 79 行 `engine.world.scenario` を描画中に読んでいる。外部の可変オブジェクトだが、scenario は engine の生涯で不変なら問題ない（変わりうるなら useSyncExternalStore 経由にする）。
- I-6 DriveScreen.tsx に DriveScreen・TripDrive・TripMessage の 3 コンポーネントがある。短いので許容。TripMessage は他の画面でも使うなら components/ に分ける。
- I-7 `AbortSignal.any` は比較的新しい API（Safari 17.4+）。対象ブラウザを ch6 で確かめる。
- I-8 routes.tsx は lazy + barrel 経由で規約どおり。`Suspense fallback={null}` は、3D 読込前に空白が出る。DriveScreen 自体が three を含まないので、影響は小さい。
- I-9 TripMessage は `role` を busy に応じて status / alert に切り替えており、aria の使い方は妥当。
