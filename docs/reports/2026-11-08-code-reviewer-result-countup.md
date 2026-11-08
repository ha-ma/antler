# コードレビュー結果: result-countup（A-6・A-7 の数え上げ）

- 日付: 2026-11-08
- 対象: `git diff origin/main` の `apps/sim/src/shared/**`（新規: `utils/count-up.ts`・`hooks/useCountUp.ts`・`components/CountUpText.tsx`・`components/count-up.css`）、`loss/components/LossPage.tsx`・`StatsCard.tsx`、`loss/utils/drop.ts`・`fill-nodes.tsx`、`record/components/StatTiles.tsx`、テストと `src/test/count-up.ts`
- 方法: code-reviewer のチェックリスト（`.claude/agents/code-reviewer.md`）で実装したセッションが自分で読んだ（サブエージェントは呼べなかった）。`npm run lint`・`typecheck`・vitest は Green

## Critical（修正必須）

なし。

## Warning（推奨）

- [shared/components/CountUpText.tsx] 値（text）が mount のあとに変わると、表示は新しい値で止まるが、`useCountUp` の rAF は 1.2 秒の終わりまで回り続ける（再描画は変わらない文字で起きる） → 値が変わるのは再取得で文字列が替わるときだけで、A-6・A-7 では画面を開いたあとに値は変わらない。必要になったら `enabled` を `text === first` にして effect の依存に入れる
- [loss/utils/drop.ts `DROP_DURATION_MS`・`DROP_STAGGER_MS`] `loss.css` の `--loss-drop-duration`・`--loss-drop-stagger` と同じ値を TS にも持つ（二重） → `drop.test.ts` が CSS を読んで突き合わせるので、片方だけ直すとテストが落ちる。CSS の変数を TS から流し込む形（style で渡す）にすれば一本になるが、result-screens の CSS を書き換えることになるので今回はしない

## Info（参考）

- 良い点: 数え上げを「出来上がった文字列の中の数字だけを替える」純粋関数（`countUpFrame`）にしたので、`formatBudget`・`buildRecordView` の書き方（記号・括弧・区切り・小数）に触れずに済み、最後の 1 コマは元の文字列をそのまま返す（作り直さない）
- 良い点: 動かない環境（IntersectionObserver なし・動きを減らす設定）と数え終わったあとは今と同じ 1 つの文字の並びに戻るので、既存の loss・record のテスト（`getByText`・`toHaveTextContent`）を 1 つも直さずに通った
- `fillNodes`（loss の utils）は文の型の `{key}` を名前で差し込む。言語ごとに置き場所の順番が違う（en は `{total}` が `{year}` の前）ので、数字の並びの番号では選ばない
- `useCountUp` の effect は IntersectionObserver の購読と rAF のタイマーだけ（`no-restricted-syntax` の除外に理由を書いた。他の hooks と同じ書き方）。時刻は rAF の引数だけで測る（時計を混ぜない）
- shared に置いた理由: loss と record の 2 か所で使う（`react-shared-rules.md` の「2 つの実際の呼び出し」）。shared から features への import は無い
- api（`apps/api`）・`@antler/trip`・STATS は変えていない（SSR の `/t/:id` と OG 画像は静的のまま）
