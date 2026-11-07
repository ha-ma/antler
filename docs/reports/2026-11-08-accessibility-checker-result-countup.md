# アクセシビリティチェック結果: result-countup（A-6・A-7 の数え上げ）

- 日付: 2026-11-08
- 基準: WCAG 2.1 AA（ほかに読み上げ・動きを減らす設定・フォーカス）
- 対象: `apps/sim/src/shared/components/CountUpText.tsx`・`count-up.css`・`apps/sim/src/shared/hooks/useCountUp.ts`、使う側の `loss/components/LossPage.tsx`・`StatsCard.tsx`、`record/components/StatTiles.tsx`
- 方法: accessibility-checker のチェックリスト（`.claude/agents/accessibility-checker.md`）で実装したセッションが自分で読んだ（サブエージェントは呼べなかった）。jsdom のテスト（読み上げの名前は dom-accessibility-api）と、Playwright の Chromium で 1280 px・360 px・`prefers-reduced-motion: reduce` の画面を確かめた。スクリーンリーダーの実機（VoiceOver・NVDA）では確かめていない

## Critical（WCAG 違反）

なし。

## Warning（改善推奨）

- [shared/components/count-up.css `.count-up__final`] 動いているあいだ、最後の値は `opacity: 0` の写し（読み上げはこれを読み、見える数字は `aria-hidden`）。主なスクリーンリーダーは opacity 0 の文字を読むが、実機では確かめていない | 修正: Day 6 の実機確認で VoiceOver（Safari）・NVDA（Chrome）が統計カードの見出し・4 指標の値を最後の値で読むかを見る。読まない環境があれば `.loss-visually-hidden` と同じ clip の隠し方の写しを足し、幅をとる写しは `aria-hidden` にする（3 つに分ける）
- [CountUpText.tsx] 動いているあいだに文字を選んでコピーすると、途中の値と最後の値の両方が入る（1.2 秒のあいだだけ） | 修正: 今は直さない（数え終わると 1 つの文字の並びに戻る）

## 確かめたこと（OK）

- 1.3.1・4.1.2: 統計カードの `aria-labelledby` の名前は、数え上げの途中でも最後の値（「これは、北海道で 2025 年に 6,705 件起きたこと」。CountUpText.test COUNT-3、LossPage.test result-countup LOSS-1）
- 4.1.3: `aria-live` を付けない。途中の値を知らせない
- 2.2.2（一時停止・停止・非表示）: 動きは 1 回だけ・1.2 秒（5 秒未満）で終わる。`prefers-reduced-motion: reduce` では最初から最後の値（分けた形を作らない。Playwright で `.count-up--running` が 0）
- 2.3.1（閃光）: 文字の数字が替わるだけで、明滅する面は無い
- 2.4.3・2.4.7（フォーカス）: フォーカスの移り方（A-6 の h1、A-7 の「クリア」）と Tab の順は変えていない。数え上げる要素はフォーカスを受けない
- 1.4.10（リフロー）: 360 px で横スクロールなし（Playwright で `scrollWidth − clientWidth = 0`）。数字は最後の値の幅をとるので、途中で文が折り返し直さない
- 1.4.3（コントラスト）: 色は置いた場所のまま（金額の clay・A-7 の spruce）。新しい色を使わない
- IntersectionObserver の無い環境は最初から最後の値（古いブラウザで 0 のまま止まらない）
