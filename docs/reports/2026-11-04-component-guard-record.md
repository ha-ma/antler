# component-guard: record（A-7 旅の記録）React 設計検査

日付: 2026-11-04 / 対象: apps/sim/src/features/record/、plan-trip の barrel（ownerTokenOf・forgetOwnerToken）、app/routes.tsx の `/t/:id`
規約: apps/sim/CLAUDE.md、.claude/rules/react-*.md

## 結論

Critical 0 / Warning 4 / Info 6。

通ったもの:

- components/ にデータ取得なし。fetch は hooks/ の useQuery / useMutation だけ。
- useEffect は record 配下に 0 件。見出しへのフォーカスは ref コールバック（focusOnMount）で、適切。
- useState は RecordHeader に 1 個、DeleteSection に 1 個。上限 3 個以内。
- Zustand の import と create() は 0 件。types.ts の State 設計の宣言と一致。
- `any` は 0 件。
- feature 間の import は `@/features/plan-trip` の barrel 経由だけ。
- app/routes.tsx は `@/features/record` の barrel だけを import している。
- 依存方向に循環なし。plan-trip は record を import していない（コメントでの言及のみ）。
- barrel は名前付き re-export のみで、`export *` なし。

## Critical

なし。

## Warning

### W1. 1 ファイル 1 コンポーネントの違反（react-architecture.md MUST、components-rules）

- `components/RecordSections.tsx`: StatTiles、KeptList、ZoneLog、ShioriCard、BIntro の 5 つ。
- `components/RecordPage.tsx`: RecordPage と RecordContent の 2 つ。
- `components/ResultMark.tsx`: ResultMark と BrandMark の 2 つ。
- 対応: 1 コンポーネントごとにファイルを分ける。RecordContent は `RecordContent.tsx`、BrandMark は `BrandMark.tsx` にする。

### W2. components/ の render 中に localStorage を読んでいる

- 場所: `RecordPage.tsx:77` の `ownerTokenOf(query.data.trip.id) !== null`。
- 読み取りが component の描画に混ざり、feature 間の依存（plan-trip）も component に直接出ている。
- 対応: `hooks/useIsOwner(tripId)` を作り、ownerTokenOf はそこに閉じ込める。components/ は plan-trip を import しなくてよくなる。
- hooks 側（useSaveRun、useRecordActions）の使い方は規約どおり。

### W3. mutation の結果を 3 段渡している（props drilling の境界）

- 経路: `RecordPage`（useDeleteTrip）→ `RecordContent`（`deletion`）→ `DeleteSection`（`mutation`）。
- `UseMutationResult` をそのまま渡しているので、型も `ReturnType<typeof useDeleteTrip>` と `UseMutationResult<void, Error, void>` の 2 通りになっている。
- 対応: DeleteSection の中で `useDeleteTrip(tripId)` を呼ぶ。
- RecordPage は「削除済み」画面の判定に `isSuccess` が必要なので、次のどちらかにする。
  - 成功時に `queryClient.removeQueries` し、query が 404 になる流れで出す。
  - 削除済みかどうかを別の小さい hook にする。
- どちらでも props は `tripId` と `lang` だけになる。

### W4. `utils/` は規約のディレクトリ構成にない。apiBase が重複している

- `features/record/utils/links.ts` は規約の `components/ hooks/ store.ts types.ts index.ts` にない。
- `apiBase()` が `record/utils/links.ts` と `plan-trip/hooks/useCreateTrip.ts` で同じ実装になっている。
- 対応: `apiBase` を `src/shared/utils/` に昇格する（feature 間の複製をやめる）。
- record 固有の URL 組み立ては、hooks/ に置くか `utils/` を許容するかを決める。許容するなら規約に 1 行足す。

## Info

- I1. `t` ヘルパー（`(key) => recordText(key, lang)`）が RecordPage、RecordContent、DeleteSection、RecordHeader、BIntro の 5 か所にある。`useRecordText(lang)` にまとめられる。
- I2. 削除成功後に record の query キャッシュが残る。`/t/:id` へ戻ったとき、古い記録が一瞬出る可能性がある。`onSuccess` で `queryClient.removeQueries({ queryKey: recordQueryKey(tripId) })` するとよい。
- I3. `ownerTokenOf` と `forgetOwnerToken` が `plan-trip/hooks/useCreateTrip.ts`（mutation の hook ファイル）にある。barrel に出す関数なので、`plan-trip/hooks/ownerToken.ts` のように分けるほうが責務がはっきりする。
- I4. `types.ts` に `RecordApiError` クラス（実行時のコード）が入っている。型定義だけという規約からは外れる。許容するか、`hooks/` か `utils/` に移す。
- I5. barrel が `recordHref`（utils の関数）を re-export している。公開 API として意図したものなら問題ない。コメントどおり drive / loss が使う予定で、今は消費側がまだない。
- I6. plan-trip のログのイベント名 `record.owner-storage` は、plan-trip が record の名前を持っている。`plan-trip.owner-storage` に揃えると境界が明確。

## 確認の範囲

次のファイルは通読済み。

- record の components/、hooks/、types.ts、utils/links.ts、index.ts
- plan-trip の index.ts、hooks/useCreateTrip.ts
- app/routes.tsx

テストファイル（`RecordPage.test.tsx`、`useSaveRun.test.ts`、`test-fixtures.ts`）と `record.css` は対象外。
