## レビュー結果（sticky-cta）

対象: `git diff origin/main`（`apps/sim/src/shared/components/ActionBar.tsx`・`action-bar.css`、`PlanForm.tsx`・`BriefPage.tsx`・`LossPage.tsx`・`RecordContent.tsx`・`plan-trip/text.ts`、各画面の CSS、新しいテスト 5 つ）。
やり方: code-reviewer のエージェントはこのセッションから呼べないので、`.claude/agents/code-reviewer.md` の観点（可読性・設計・エラー処理・テストしやすさ）で自己レビューした。

### Critical（修正必須）

なし（0 件）。

### Warning（推奨）

1. [record.css `.record-actions > .record-button`] 主ボタンを帯に入れたので、子孫の選択子が帯の中の主ボタンにも当たり（`flex: 1 1 140px`）、読み込みの順で帯の主ボタンの幅を上書きしていた。直の子だけにして直した（見つけた時点で修正済み）。ページの CSS が `.action-bar .action-bar__primary`（詳細度 0,2,0）と同じ強さの子孫の選択子を持つと同じことが起きる。新しい画面で帯を使うときは、ページ側のボタンの規則を直の子・単独の class に保つ
2. [action-bar.css] 帯の高さの予約が固定の値。実測と合っているが、帯の中身を増やすと予約も直す必要がある（コメントに式を書いた）。JS で測る案（ResizeObserver で CSS 変数を入れる）は useEffect とリスナーが要るので採らなかった
3. [LossPage.tsx] 主ボタンを `nav`（`.loss-drop`）の外に出したので、主ボタンは「導線」の `nav` のランドマークに入らない。`main` の中にはある。副の導線とまとめて読みたい場合は、帯を `nav` にする（`ActionBar` に `as` を足す）案がある

### Info（参考）

- `ActionBar` は shared に置いた（4 画面で使う。feature を import しない・ドメインの語を持たない）。主ボタンの class は定数 `ACTION_BAR_PRIMARY` で渡す
- 行き先・押したときの処理・文言は変えていない（各画面の既存のテストがそのまま Green）。result-screens の DROP-2（落ちる順の番号）も変わらない
- A-1 の「直すところ」は `preview.problems`（TripInputSchema の問題）と入力欄のラベルの文言から作る。新しい検証は足していない
- result-countup（A-6・A-7 の数字）・rebrand（ブランド名）の作業と同じファイル（`LossPage.tsx`・`RecordContent.tsx`・`text.ts`）に触れるが、差分は導線の部分と表の末尾だけ
