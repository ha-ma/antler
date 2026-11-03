# component-guard: apps/sim plan-trip（A-1）と app 層

日付: 2026-11-03 / 対象: `apps/sim/src/features/plan-trip/**`、`apps/sim/src/app/App.tsx`、`apps/sim/src/app/routes.tsx` / 読み取りのみ（ソースは未編集）

結果: Critical 0 / Warning 5 / Info 7

## チェック結果（規約ごと）

| 項目                                      | 結果                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| components/ 内の fetch・データ取得        | なし。fetch は `hooks/useCreateTrip.ts`（useMutation）のみ                                                                                                       |
| useEffect                                 | features/ と app/ 全体で 0 件（grep 済み）                                                                                                                       |
| useState 3 個以下                         | components は全て 0 個。`App.tsx` は 2 個（QueryClient・router の lazy 初期化）                                                                                  |
| Zustand の import                         | `store.ts` のみ。components / hooks は `usePlanTripStore(selector)` 経由                                                                                         |
| selector 使用                             | 全て selector（`useStore()` の全体取得なし）。`useAreaSelections` の参照も安定                                                                                   |
| 他 feature の内部 import                  | なし。`routes.tsx` は `@/features/plan-trip` の barrel のみ                                                                                                      |
| barrel（index.ts）                        | `export *` なし、store・内部コンポーネント非公開、実行コードなし                                                                                                 |
| 1 ファイル 1 コンポーネント・named export | 守られている。default export は 0 件                                                                                                                             |
| `any`                                     | 0 件                                                                                                                                                             |
| app 層に feature UI                       | なし。`routes.tsx` は element の組み立てだけ、`App.tsx` はプロバイダのみ                                                                                         |
| props drilling                            | 3 段未満。`preview` は PlanForm → ItineraryPanel → RiskBand / AllocationBar で、各段が分解して使う。lang は各コンポーネントが store から直接読むので受け渡しなし |

## Critical

なし。

## Warning

### W1. PlanForm に送信のロジックが残っている（hooks への分離が不十分）

`components/PlanForm.tsx:20-43`
`send` / `onValid` / `onRetry`、`useNavigate` による遷移、`startAttempt` / `pendingAttempt`（sessionStorage の読み書き）が全てコンポーネント本体にある。`hooks/useCreateTrip.ts` の非フック関数（`startAttempt`、`pendingAttempt`、型 `CreateTripAttempt`）をコンポーネントが直接 import している。
直し方: `hooks/useSubmitTrip.ts` を作り、`{ onSubmit, onRetry, isPending, failure }` だけ返す。PlanForm は `handleSubmit(onSubmit)` と表示だけにする。`startAttempt` / `pendingAttempt` は hook の内側に閉じる。

### W2. しおりが「最後に通った入力」のままだと、store 側の変更が反映されない

`hooks/useTripPreview.ts:50-56`
入力欄が不正なあいだ、`current` は `lastValid` 全体（area・pleasures・lang を含む）になる。この間に楽しみを選び直す、エリアを替える、言語を替えると、PleasurePicker のカウンターと AllocationBar / しおりの内容がずれる。`TripInputSchema` は pleasures を 0 件でも許す（`packages/trip/src/input.ts:38-40`）ので、store 側の値は常に有効にできる。spec UC-1 の「しおりは前の値のまま」は欄の値の話で、楽しみやエリアまでは言っていない。
直し方: 保持するのを「最後に通ったフォーム値（PlanFormValues）」にして、`parseTripInput(lastValidValues, { area, pleasures, lang })` で毎回組み立てる。または `current` を `{ ...lastValid, area, pleasures, lang }` にする。意図した挙動なら spec に 1 行書く。

### W3. PlanPage が store の area / pleasures を購読している目的が resolver の context だけ

`components/PlanPage.tsx:12-21`
選択を 1 つ切り替えるたびに PlanPage が再描画され、`{...form}` の新しいオブジェクトで FormProvider の全 consumer も再描画される。
直し方: `hooks/usePlanForm.ts` に `useForm` の組み立てを移し、resolver の context は `usePlanTripStore.getState()` から送信時に読む（`store.ts` の export 経由なので components の zustand 禁止には触れない）。これで PlanPage は lang だけの購読になる。`useTripPreview` と resolver が同じ `parseTripInput` を二重に呼ぶ点も、W1 の hook で `preview.valid` に一本化できる。

### W4. App.tsx の createBrowserRouter が StrictMode の dev で二重に作られる

`app/App.tsx:16`、`main.tsx:13-17`
`useState(() => createBrowserRouter(routes))` の初期化関数は StrictMode の dev で 2 回呼ばれ、捨てた側の router も popstate を購読したまま残る（本番では起きない）。
直し方: router をモジュールスコープで 1 回だけ作る（`routes.tsx` から `createAppRouter()` を export して `App` の外で呼ぶ、または `let` のキャッシュ）。テスト用の `router` props はそのまま使える。QueryClient の `useState` 初期化は問題なし。

### W5. TripBriefPlaceholder に location state の検証ロジックが入っている

`components/TripBriefPlaceholder.tsx:7-15`
`readTitles` は純粋関数なので、`utils/` か hook（`useBriefTitles`）に出す。あわせて `lang === 'zh' ? 'zh-Hant' : lang` が PlanPage（24 行）、TripBriefPlaceholder（26 行）、LangSelect（33 行）に 3 回ある。`text.ts` か `utils/` に `htmlLang(lang)` を 1 つ置く。

## useTripPreview の render 中 setState について（質問への回答）

妥当。React docs の「前のレンダーの情報を保存する」形になっている。確認した点:

- setState は条件つき（`parsed.success && !sameInput(...)`）で、同じ値なら 2 回目の描画で止まる。無限ループにならない。
- 同じコンポーネント（PlanForm）の描画中に自分の state を更新しているので許される形。子の描画前に React が破棄してやり直す。
- 更新前の描画でも `current` は `parsed.input` を使うので、1 フレームだけ古い値が出ることはない。
- useEffect + setState（二重描画で古い値が一瞬出る形）より良い。ESLint の react-you-might-not-need-an-effect にも触れない。
- 代替は難しい。「最後に通った値」は過去の履歴なので useMemo だけでは作れず、描画中に ref を書き換える方法は避けるべき。
- `sameInput` の `JSON.stringify` 比較は、zod の parse 結果のキー順が固定なので安全。コストも入力の大きさからして無視できる。

直すなら W2 の点（何を保持するか）だけ。パターンそのものは変えなくてよい。

## Info

- I1. `hooks/useCreateTrip.ts` に fetch・sessionStorage・エラークラス・フックが同居している（107 行）。規約上は hooks/ に fetch を置いてよいが、`api.ts`（`postTrip`・`CreateTripError`・`startAttempt` など）と `useCreateTrip.ts`（useMutation だけ）に分けると W1 の hook が読みやすくなる。
- I2. `store.ts` は state 3 ＋ action 5 の 8 プロパティ。react-store-rules の「5 プロパティを超えたら分割を検討」は state と action のどちらを数えるか曖昧。現状は 1 画面の選択・エリア・言語で凝集しており、分割は不要と判断。`lang` が他 feature（brief-map など）でも要るようになったら `shared/` に昇格を検討する。
- I3. `store.ts:46-51` の `togglePleasure` は上限到達時に `current` をそのまま返すが、`updateArea` が新しい `selections` オブジェクトを作るので購読者が再描画される。`set` の中で同じ参照を返す（`return state`）形にすると無駄な描画がなくなる。
- I4. `AreaTabs.tsx:15` は `s.selections` 全体を購読している。両エリアの件数を出すため妥当。
- I5. `AreaTabs.tsx:26` の `document.getElementById(...).focus()` は DOM 直接操作。ref 配列に替えるとテストしやすい。動作に問題はない。
- I6. 型アサーションが数か所ある（`useTripPreview.ts:39` の `as Partial<PlanFormValues>`、`useCreateTrip.ts:60,86`、`TripBriefPlaceholder.tsx:9-14`）。`useCreateTrip.ts` の `pendingAttempt` は zod で parse すると `as` が消える。
- I7. `TripBriefPlaceholder` は plan-trip の store の lang を読む。brief-map ができて差し替えるとき、barrel の export 名（`TripBriefPlaceholder`）と `BriefLocationState` を消す手順を `docs/roadmap.md` か spec に書いておくとよい。

## 良い点

- State設計が `store.ts` 冒頭に宣言されていて、実装と一致している（useEffect 0、Local UI state 0）。
- 文言の言語は各コンポーネントが selector で読み、props で回していない。
- 日時・予算・検証は `utils/trip-input.ts` の純粋関数に出ていて、フォームと preview が同じ `TripInputSchema` を使う。
- barrel は最小で、store を公開していない。app 層は composition だけ。
