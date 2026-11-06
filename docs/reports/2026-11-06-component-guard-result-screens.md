# component-guard レビュー: result-screens（2026-11-06）

対象: apps/sim/src/features/loss/（utils/drop.ts、components/*）、record/（hooks/useCelebration.ts、components/ClearBanner.tsx・RecordContent.tsx・RecordPage.tsx、utils/celebration.ts、text.ts、index.ts）、plan-trip/text.ts。
仕様: docs/specs/result-screens/functional.md。規約: apps/sim/CLAUDE.md、react-architecture.md。
方法: 現在のファイルを読み、grep で検査した（Bash が無く git diff は取れていない。変更前との差分ではなく現状への指摘）。

## 件数

Critical 0 / Warning 2 / Info 8

## 規約の検査結果（違反なし）

- components/ 内の fetch / useEffect: なし。fetch は hooks/ のみ（useTripRecord・useRecordActions・useSaveRun・useLossStory・useLossTripDay・useCreateTrip）。
- useEffect: 対象に 0 件。フォーカスは ref コールバックで移している。
- useState: 最大でもコンポーネントあたり 2 個（useTripPreview）。useCelebration は 1 個。
- Zustand create(): 対象に 0 件。
- any: 0 件。
- feature 間 import: すべて barrel 経由（`@/features/record`、`@/features/plan-trip`、`@/features/drive`）。深い import なし。record -> plan-trip と loss -> record は一方向で循環なし。
- props drilling: 3 段以上なし。`drop` は 1 段だけ。
- i18n: record/text.ts は `src/i18n-tables.test.ts` の glob（`./**/text.ts`）に入るので CLEAR-7 は検査される。

## Critical

なし。

## Warning

### W1. 「祝いは 1 履歴につき 1 回」のキーが、直の訪問で同じタブ内の 2 回目を止める可能性（record/hooks/useCelebration.ts:22）

`historyKey = location.key + pathname`。ブラウザで新しく開いた履歴（アドレスバー入力・外部リンク・リロード）の `location.key` は react-router で `"default"` になる。同じタブで同じ旅の `/t/:id` を直に 2 回開くと同じキーになり、2 回目に祝いが出ない。R4 の「合図の無い直の訪問は、最後の日が完走なら祝いを出す」と食い違う。リロードで繰り返さないという狙い自体は満たしている。
実機での確認が要る（私は動かしていない）。許容するなら R4 に「同じタブの直の訪問 2 回目は出ない」と書く。直すなら、キーが `"default"` のときは `performance.getEntriesByType('navigation')` の種別（reload / back_forward）で分ける。

### W2. `dropSequence()` の番号が JSX の書く順の評価に依存している（loss/components/LossPage.tsx:113〜218、utils/drop.ts:19）

`drop()` を JSX の各 prop の中で呼び、書いた順が番号になる。描画ごとに作るので再描画・StrictMode ではずれない。ただし次の脆さがある。

- JSX の並びを入れ替える・条件分岐で `drop()` を飛ばす・変数に先出しすると、DOM の順と落ちる順がだまって食い違う。UC-2 の「DOM の順に抜けなく増える」はテストで見るが、書き手に静的な保証がない。
- 導線の `<nav>` だけ `dropClass` を使わず `className="... loss-drop loss-drop--fade"` と `style={drop(0)}` を直書きしている。`drop(0)` の 0 は「傾き 0」の意味で、番号を消費する（意図どおりだが読み手が誤解しやすい）。
- 「後から足す行は次の番号を受け取れば並びに入る」（R2・R5）が、`LossContent` の中に `drop()` を書く前提になっている。別コンポーネントに分けた行は `drop` を props で受ける必要がある。

案: 落とす要素を `const order = ['story','tiles',…]` のような配列にして map で配るか、`useDropSequence()` のような hook に包んで 1 箇所で番号を配る。最低限、nav も `dropClass` と同じ形（`dropClass('loss-actions', drop)` ＋ fade 用の第 3 引数）に揃える。

## Info

1. `focusOnMount` と `htmlLang` が feature ごとに複製されている（LossPage / RecordPage / RecordContent / BriefPage / DeleteSection / AppErrorBoundary / ChatFeed）。shared/ に昇格する候補。今回の変更で RecordContent と LossPage の分が増えた。
2. `fillText` が plan-trip / loss / brief-map / stop-events に別実装で 4 つあり、record/text.ts の `clearLead`（`.replace('{n}')`）が 5 つ目になった。`UiText` 型も record/loss/brief-map/stop-events で再定義、plan-trip は types.ts から。shared/utils/fill-text.ts に集約すると i18n の検査も一本化できる。
3. `RECORD_AFTER_COLLISION` は feature 間の契約（loss が付け、record が読む）。record の barrel に置くと loss が RecordPage 一式の barrel に依存する。`@/shared` に昇格するか、少なくとも `Object.freeze` / `as const` で不変にする（今は可変オブジェクトを `<Link state>` に渡している）。
4. `useCelebration.onShown` は ref コールバックだが、フォーカス移動と sessionStorage 書き込みの 2 つの副作用を持つ。名前が `onShown` だと ref と分かりにくい（`celebrationRef` など）。`historyKey` が変わると ref が付け直されて再びフォーカスする。RecordContent は id が変わるとローディングで外れるので実害は出ない。
5. sessionStorage が使えない環境では、`RecordContent` が再マウントされる（取得失敗 -> 再試行成功）たびに祝いが出る。仕様どおり（R4）だが、再試行の経路で目立つ。
6. `ClearBanner` の `key={i}` はモジュール定数の固定配列なので問題ない。`as CSSProperties` のキャスト 1 箇所は、`DropStyle` のように型を定義すると統一できる。
7. `dropClass(base, drop)` と `style={drop}` の対が StoryPanel / StatTile / StatsCard / LossCard / nav の 5 箇所で繰り返し。`dropProps(base, drop)` が `{ className, style }` を返す形にすると付け忘れ（class だけ付けて style が無い）を防げる。
8. 可読性: `LossContent` は約 125 行（4 指標のタイルを直書き）。`LossTiles` に切り出すと `drop` の配り方もそこで閉じる。`StoryPanel` の 3 段の三項、`useLossStory(collision, true)` の真偽値の引数（意味がコードから読めない）。
