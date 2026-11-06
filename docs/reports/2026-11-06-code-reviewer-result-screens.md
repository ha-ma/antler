# code-reviewer: result-screens（A-1 の文言・A-6 の落下・A-7 の「クリア」）

日付: 2026-11-06 / 対象: 未コミットの変更（git diff ＋ 未追跡）/ 仕様: `docs/specs/result-screens/functional.md`
読んだもの: record の `celebration.ts`・`useCelebration.ts`・`RecordPage.tsx`・`RecordContent.tsx`・`ClearBanner.tsx`・`text.ts`・`index.ts`・`record.css`（クリア部分）、loss の `drop.ts`・`LossPage.tsx`・`loss.css`・各コンポーネントの `drop` 配線、plan-trip の `text.ts`、テスト 5 本（`RecordPage.test.tsx`・`LossPage.test.tsx`・`celebration.test.ts`・`drop.test.ts`・`text.test.ts`）、`useTripRecord.ts`・`useSaveRun.ts`・`DriveRoute.tsx`・`@antler/trip` の `summarizeRecord`。
テストは実行していない（このレビューは読みだけ。Bash なし）。

## 結論

Critical 0 / Warning 6 / Info 8。「衝突のあとに祝いが出る経路」は、アプリ内の遷移では塞がっている。残る穴は仕様が Deferred にしている「A-6 のリンクを新しいタブで開く」等で、Warning 1 に書いた。

## 衝突のあとに祝いが出ない理由（確かめた 3 つの門）

- 門 A（入り口）: `DriveRoute.tsx` は `outcome === 'completed'` のときだけ `recordHref` へ移る。衝突で A-7 に着く経路は A-6 の「旅の記録を見る」リンクだけ（`recordHref` の使用箇所は `DriveRoute`・`LossPage` の 2 つだけ）。そのリンクは `state={RECORD_AFTER_COLLISION}` を付け、`LossPage.test.tsx` の LINK-1 が `router.state.location.state` まで確かめている。
- 門 B（古いキャッシュ）: `useCelebration` の `useState` 初期化は `RecordContent` の初回マウントでしか走らない。`RecordContent` は `RecordPage` の `isPending || (isFetching && !isFetchedAfterMount)` を抜けたあとにしかマウントされない。`useSaveRun` はフック側の `onSuccess` で無効化してから、`mutate` 側の `onSuccess` が遷移するので、保存→無効化→遷移の順は崩れない。
- 門 C（戻る・再読み込み）: 履歴の `location.key` と state は復元される。祝い済みなら `wasCelebrated`、衝突のあとなら `arrivalOf` のどちらかで止まる。
- 判定関数 `celebrationOf` 自体は仕様の R4 どおり（合図で先に null、`not-started` で null、`lastDay` の結果が `completed` のときだけ `{ day: lastDay }`）。`arrivalOf` は `unknown` を安全に読んでいる。

## Critical（修正必須）

なし。

## Warning（推奨）

1. [`apps/sim/src/features/loss/components/LossPage.tsx:201-207` ＋ `useCelebration.ts`] 合図が `<Link state>` だけなので、リンクを Ctrl/Cmd+クリック・中クリック・「新しいタブで開く」で開くと state が落ち、「A-6 から来たのに祝いが出る」経路になる。条件は「最後の日の結果が完走のまま残っている」（OFF の挑戦で衝突した日、または ON の衝突の保存が裏で終わる前に取得した場合）。仕様の Deferred（TripRecord に保存順の結果を足す）が入るまでの穴で、期日 2026-11-08。
   → 暫定の緩和案: 衝突の時点（`DriveRoute` の `lossReportFromDrive` が返したとき、または A-6 の `LossContent` の初回描画）で `localStorage` に `antler.record.collided.{tripId} = 時刻` を残し、`celebrationOf` の `arrival` に「この旅の衝突の印が、最後の完走の保存より新しい」を足す。完走の保存の成功（`useSaveRun` の `onSuccess`）で印を消す。これなら新しいタブ・ブックマークも同じ端末では塞がる。Deferred の暫定挙動に書いてあるとおり、別端末と所有者でない端末は残る。

2. [`apps/sim/src/features/record/components/RecordPage.tsx:43`・`hooks/useTripRecord.ts:42`] 「古いキャッシュで決めない」の門 B が、`QueryClient` の `staleTime` が 0（`App.tsx` の `new QueryClient()` の既定）であることに暗黙に頼っている。将来 `useTripRecord` に `staleTime` が入る、またはオフラインで取得が `paused` になる（`isFetching` が false のまま）と、取り直しが起きないままキャッシュで `RecordContent` がマウントされ、FRESH-1 が静かに壊れる。FRESH-1 のテストは `retry: false` だけのテスト用 client（staleTime 0）なので、この壊れ方はテストで捕まらない。
   → `useTripRecord` に `refetchOnMount: 'always'` を明示し、「祝いの判定のために毎回取り直す」とコメントする。`staleTime` に依存しなくなる。

3. [`apps/sim/src/features/record/hooks/useCelebration.ts:23`・`RecordPage.tsx:50`] 「祝いは最初の描画で 1 回だけ決め、再取得では足さない・消さない」（R4）が、`RecordContent` が同じ履歴のまま再マウントされると破れる。`RecordPage` は `query.isError` を取得済みのデータがあっても先に見るので、フォーカスの再取得が失敗する→エラー画面→「もう一度」で成功→`RecordContent` が新しく作られ、`useState` の初期化が新しいデータでやり直される。前回が「出さない」（null）だったときは `markCelebrated` が呼ばれていないので、データが完走に変わっていれば今度は祝いが出る。
   → 決めた結果を履歴ごとに覚える（`celebrated` と別に「判定済み」を残す）か、判定を `RecordPage` に上げて `useState` を `RecordPage` で持つ（エラー画面の分岐より前に呼ぶ）。後者のほうが小さい。

4. [`RecordPage.test.tsx` FRESH-1・ONCE-1] 仕様の R4「そのあとの再取得では足さない・消さない」を確かめるテストが無い。FRESH-1 は「取り直しが来るまで読み込み中」と「来た記録で判定」だけ。
   → 描画後に `queryClient.invalidateQueries`（または `refetch`）で逆の結果を返させ、(a) 祝いが出ていたなら消えない・フォーカスが動かない、(b) 出ていなかったなら足されない、の 2 本を足す。Warning 3 を直すなら、エラー→「もう一度」の経路も 1 本。

5. [`RecordPage.test.tsx:21-26`・`:349-352`] 先頭の `afterEach` は `localStorage.clear()` だけで `sessionStorage` を消さない。前半の describe（AC-2 ほか）は全部 `renderRecord`（最初の履歴の key は `default`）で、D2 が完走の `DONE` を使うので、1 本目だけ祝いが出て以降は「祝い済み」になる、という順序依存が隠れている（コメントで説明はあるが、`-t` での単独実行や順序の入れ替えで挙動が変わる）。
   → 先頭の `afterEach` に `sessionStorage.clear()` を足し、後半の `beforeEach` をやめる。前半に祝いを出さたくない意図があるなら、前半で `sessionStorage` を「祝い済み」に初期化するのではなく、祝いの有無に影響されない問い合わせ（`findByRole('heading', …)`）のままにする。

6. [`celebration.test.ts`・`drop.test.ts`] 仕様の項目に対して確かめていないものがある。
   - `wasCelebrated` / `markCelebrated` の単体テストが無い（新しい 20 件に切る・同じ key の重複を作らない・壊れた JSON や配列でない値のとき空として扱う・`setItem` が投げても落ちない）。ONCE-1 は画面経由で 1 本あるだけ。
   - `drop.test.ts` の DROP-1 は「傾きの表は番号が表の長さを超えたら頭に戻る」（R2）を確かめていない。12 回呼んだ 2 つの数え手を比べるだけなので、表を超えたあとが常に `0deg` でも通る。
     → `Array.from({ length: DROP_TILTS.length + 1 })` で、最後の傾きが `DROP_TILTS[0]` になることを見る。
   - R4 の「`offResult: 'collided'` では止めない」という決定を固定するテストが無い。CLEAR-2 は合図ありだけ。
     → 合図なし（`null`）で `OFF の衝突を含む記録` が `{ day }` を返すことを 1 本足す（決定を変えたとき、意図して落ちるように）。

## Info（参考）

- 良い点: `celebrationOf` が純粋関数で、合図の読み取り（`arrivalOf`）と分かれていて単体テストしやすい。`dropSequence` を描画ごとに作る（モジュールの変数にしない）ので StrictMode・再描画でずれず、JSX の評価順が DOM の順と一致している。CLEAR-5 は `OFF_CRASHED`（最後の日が完走のまま）を使っているので、合図の判定を外すと確実に落ちる。FRESH-1 は「読み込み中」を先に確かめるので、ゲートを外すと落ちる。`ONCE-1` の `sessionStorage` 不可のテストも入っている。色の直書きが無く、紙吹雪・円は `aria-hidden`、動きは transform・opacity・stroke-dashoffset だけ。
- [`LossPage.tsx:183-185`] 導線の `<nav>` だけ `dropClass` を使わず `"loss-actions loss-drop loss-drop--fade"` を直書きしている（ほかの 4 つは `dropClass`）。意図（フェード）は分かるが、`dropClass(base, drop, 'fade')` のように揃えると、`drop` が無いときの「動かない」規則も同じ場所に集まる。import の並びも `../utils/drop` が `../utils/format` の後ろ（ESLint が並べ替えを求めるなら）。
- [`record.css`:`.record-clear__mark`] R3 は円・チェックにも `pointer-events: none` を求めているが、付いているのは紙吹雪の入れ物（`.record-clear__confetti`）だけ。操作要素ではないので害は小さいが、仕様と揃えるなら `.record-clear__mark` に足す。
- [`useCelebration.ts:22`] 履歴の識別が `${location.key}:${location.pathname}`。ブラウザで最初の読み込みや新しいタブの履歴の key は `default` になるので、同じタブで同じ `/t/:id` を URL 入力で開き直すと「祝い済み」と見なされる（祝いが出ない側に倒れるだけで、安全側）。
- [`@antler/trip` `summarizeRecord`] 日の結果は「その日の最後の ON の run、無ければ最後の OFF の run」。先に ON で衝突した日を OFF で走りきっても、日の結果は `collided` のまま（直の訪問で祝いが出ない）。祝いが出ない側の取りこぼしで、Deferred（保存順の結果）で一緒に直る。
- [`LossPage.test.tsx:413-496`] DROP-2〜5 と LINK-1 が `describe('LOSS-1: …')`（読み込み中の言語）の中に入っている。`describe('落ちて積み重なる')` を外に出すと読みやすい。DROP-3・5 と CLEAR-6 は CSS の文字列の検査（jsdom は CSS を空にするため）で、ルールの順序・書式に弱い。テストの注記に「見た目は手元の確認で補う」と書いておくとよい。
- [`RecordPage.tsx:14-19` と `RecordContent.tsx:22-27`] `htmlLang` と `focusOnMount` が 2 ファイルに同じ形で複製されている（`LossPage.tsx` にもある）。YAGNI の範囲だが、3 つ目が増えたら `shared/utils` へ。`RECORD_AFTER_COLLISION` は書き換えられるオブジェクトなので `as const` か `Object.freeze` にする。ref コールバックの中でフォーカス移動と `sessionStorage` の書き込みをしているのは、`useEffect` を避けるこのリポジトリの流儀に沿うが、StrictMode では 2 回呼ばれる（どちらも冪等で問題なし）。
- 範囲外の確認: 「衝突の 3 秒前を見る」（replay）の走行が完走で終わった場合の遷移は、この仕様の範囲外（`DriveRoute` は別セッション）。plan-trip の仕様（R5・AC-2）と `useSubmitTrip`・`useCreateTrip` のコメントは、この worktree では新しい文言に揃っている（`守りに行く` が残るのは `text.test.ts` の否定の検査だけ。`docs/reports/` の過去の報告は記録なので対象外）。
