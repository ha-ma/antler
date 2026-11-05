# component-guard: stop-events（2026-11-04）

対象: `apps/sim/src/features/stop-events/**`、`apps/sim/src/app/routes.tsx`、`apps/sim/src/features/plan-trip/index.ts`
規約: `apps/sim/CLAUDE.md`、`.claude/rules/react-*.md`（hooks へのロジック分離、useEffect 乱用、props drilling、feature 境界、useState 3 個まで）

## 結果: Critical 0 / Warning 3 / Info 5

検出パターンの機械的な結果:

| 検査                              | 結果                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| components/ 内の fetch・useEffect | なし（useEffect は feature 全体で 0 件）                                                                                                         |
| useState の数                     | StopScenesPage 3 個（runId・openSceneId・chosen）。上限ちょうど。StopSceneModal・ChoiceButton は 0 個                                            |
| 派生値への useEffect              | なし（useMemo / 直接計算のみ）                                                                                                                   |
| store.ts 以外の Zustand create()  | なし（Zustand 不使用。types.ts に State 設計の宣言あり）                                                                                         |
| any                               | なし                                                                                                                                             |
| feature 間 import                 | `@/features/plan-trip`（barrel）経由のみ。`ownerTokenOf` は plan-trip/index.ts で公開済み。routes.tsx も `@/features/stop-events` の barrel 経由 |

## Critical

なし。

## Warning

### W1: useTripEventLog が alertEnabled の変化で送り手を作り直し、seq が 0 に戻る

`hooks/useTripEventLog.ts` 22-26 行。`useMemo` の依存に `alertEnabled` があるので、値が変わると新しい `TripEventSender`（`nextSeq = 0`）ができる。`runId` は同じままなので、api が重複扱いする `(runId, seq)` と衝突し、変更後のイベントが捨てられうる。
確認用の画面では `?alert=off` は URL 固定で顕在化しにくい。drive-link が走行中にアラートを切り替えると起きる。
対応案: 送り手は `(tripId, runId, ownerToken)` で 1 つにし、`alertEnabled` は `log()` のたびに渡す（または ref で最新値を読む）。切り替えたら新しい runId にする設計なら、その旨を仕様に書く。

### W2: StopScenesPage にロジックが残っている（hooks への分離）

`components/StopScenesPage.tsx` 35-50 行の `choose`（scene・choice から `choice` イベントを組み立てる、trigger の kind による leg / km の分岐、選んだ文言の解決）はコンポーネント内のロジック。useState も上限ちょうどなので、1 つ増えると規約違反になる。
対応案: `hooks/useStopScenesPreview.ts` に `openSceneId`・`chosen`・`choose` をまとめ、ページは描画だけにする。イベントの組み立て（`toChoiceEvent(scene, choice, day)`）は純関数にして `utils/` に置くと、drive-link からも使え、テストしやすい。

### W3: 時刻の文言（翌日の判定）が 2 か所で重複

`StopSceneModal.tsx` 51-55 行の `arrivalTime` と `ChoiceButton.tsx` 26-28 行の `timeText` が同じ式（`isAfterDate ? nextDay : hhmm`）。片方だけ直すと表示がずれる。
対応案: `timeText` を `utils/format.ts` に移し、両方から使う。`placeName`（ChoiceButton）と StopSceneModal の `placeById(...)?.name[lang] ?? id` も同様。

## Info

- I1: `utils/event-sender.ts` が `fetch` で POST する。components/ ではないので Critical ではないが、CLAUDE.md の「データ取得は TanStack Query」の方針では書き込みは `useMutation` が素直。seq の採番と送り直しを自前で持つ設計の理由（待たずに順序を保つ）を types.ts か event-sender.ts の冒頭に 1 行残すとよい。`fetchStopDeck` は hooks/、送信は utils/ とfetch の置き場がそろっていない。
- I2: `lang` と `date` が StopScenesPage → StopSceneModal → ChoiceButton の 3 段で渡る。どれも表示用の葉の props で、間のコンポーネントは使うので、いまは Zustand にするほどではない。段が増える（drive-link で Modal の上にもう 1 層）ようなら Context か store を検討。
- I3: `useState(newRunId)`（StopScenesPage 26 行）は set しない値。`useRef` / `useMemo` でも同じで、W2 の hook に移せば useState の数も 1 つ減る。
- I4: `utils/api.ts` の `errorCode`・`apiBase` が型アサーション（`as`）に頼る。any ではないが、zod の `safeParse` で絞るほうが `parse-deck.ts` とそろう。
- I5: `ownerTokenOf` は plan-trip の `hooks/useCreateTrip.ts` にあり、stop-events（と今後の drive-link）が barrel 経由で使う。使う feature が 3 つ目になったら `shared/` への昇格を検討（今は barrel 経由なので規約どおり）。

## 問題なしの確認

- routes.tsx: app → features の方向で barrel 経由。確認用ルートの追加のみ。
- plan-trip/index.ts: `ownerTokenOf` の公開 1 行のみ。内部ファイルへの直接 import は発生していない。
- StopSceneModal の `useCallback` ref によるフォーカスは useEffect を避けた良い書き方。
