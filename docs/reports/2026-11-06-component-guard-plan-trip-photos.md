# component-guard レビュー: feat/plan-trip-photos (apps/sim/src/features/plan-trip)

日付: 2026-11-06
対象: PleasureCard・PhotoCredit・AllocationBar・PleasurePicker・store.ts・utils/photos.ts・utils/photo-rules.ts・utils/hours.ts・src/test/trip-day.ts
方法: 対象ファイルを直接読み、plan-trip 配下を Grep で検査した（Bash が無いので `git diff` は実行していない。ブランチ上の現状のファイルを見た）。

## 結果: Critical 0 / Warning 0 / Info 4

## チェック項目

1. components/ 内のデータ取得: 該当なし。plan-trip 配下の fetch は hooks/useCreateTrip.ts だけ（hooks/ 内）。
2. useState の数: components/ に useState は 0 個。useTripPreview.ts に 1 個（hooks/ 内、問題なし）。
3. useEffect: 使用 0 件。store.ts のコメントにだけ「使わない」と出る。派生値は描画中に計算している。
4. props drilling: PleasurePicker -> PleasureCard -> PhotoCredit の 2 段。lang は store から直接読むので 3 段以上にはならない。
5. feature 間 import: plan-trip 内に `features/` を指す import は 0 件。他は `@antler/trip` `@antler/schema` のパッケージ参照のみ。
6. Zustand create(): store.ts の 1 箇所だけ。
7. any 型: 0 件。photos.ts は zod で JSON を検証し、型は z.infer から作っている。
8. 色の直書き（CLAUDE.md の MUST）: tsx / ts / css に hex・rgb は 0 件。

## Info

- I1 `components/PleasureCard.tsx:10` コンポーネントのファイルから定数 `LIMIT_MESSAGE_ID` を export している。ESLint の `react-refresh/only-export-components` が有効なら警告になりうる。`types.ts` か `text.ts` に移すと安全。PleasurePicker が import しているのでその分も直す。
- I2 `components/PhotoCredit.tsx:12` PleasureCard と PhotoCredit がそれぞれ store から `lang` を購読している。2 段なので許容できる。PhotoCredit を表示専用にしたいなら props で受ける手もある。
- I3 `components/AllocationBar.tsx:15-17` 描画のたびに flatMap と sort をしている。最大 10 件なので実害は無い。重くなったら `useMemo` にする。
- I4 `utils/photos.ts:48-53` モジュール読み込み時に zod の parse で例外を投げるため、photos.json が不正だと `/plan` 全体が落ちる。仕様 R6 の「例外」どおりで意図的。CI のテスト（photos.test.ts）で守られている前提。

## 補足

- `src/test/trip-day.ts` はテスト専用の補助で、node:fs を使うが画面のバンドルには入らない。楽しみを 2 つに固定した理由もコメントに書いてある。問題なし。
- store.ts の State 設計の宣言は、重さを持たなくなった変更に合わせて更新されている。
- `store.ts:38` の `selections[PERSONA_INPUT.area]` は、PERSONA_INPUT の楽しみがすべて PERSONA_INPUT.area の中にあることが前提。夜のアイヌコタンを足した変更で別エリアの楽しみが混ざっていないかは、`@antler/trip` 側のデータを確かめていない。store.test.ts が通っていれば問題ない。
