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

## 追記: A-6 のアクセントを赤にした（R7、2026-11-08）

tokens.json の値からの手計算（相対輝度）。Playwright で計算後の色（`rgb(216, 59, 30)`）が主ボタン・導入の帯・4 指標の線・フォーカスの枠に付き、A-7 の主ボタンは `rgb(30, 111, 92)`（spruce）のままなのを確かめた。

| 組み合わせ                                           | 用途                               | 比                         | 基準                      | 判定                                                     |
| ---------------------------------------------------- | ---------------------------------- | -------------------------- | ------------------------- | -------------------------------------------------------- |
| on-alert-danger #FFF / alert-danger #D83B1E          | 主ボタンの文字（20 px 太字）       | 4.6:1                      | 4.5                       | OK                                                       |
| 白 / accent-deep（alert-danger の oklch 明度 −0.15） | 主ボタンを押したとき・影           | 4.6:1 より高い（暗くなる） | 4.5                       | OK                                                       |
| alert-danger / night ground #0E1512                  | フォーカスの枠・導入の帯           | 4.02:1                     | 3（非テキスト）           | OK                                                       |
| alert-danger / night surface #1A2420                 | 4 指標の上の線                     | 3.47:1                     | 3（非テキスト）           | OK                                                       |
| alert-danger / trip ground #FBF8F1                   | しおりのカードの中のフォーカスの枠 | 4.34:1                     | 3（非テキスト）           | OK                                                       |
| alert-danger / night surface                         | 数字の文字に使った場合             | 3.47:1                     | 4.5（親セッションの指定） | NG → 文字には使わない。数字は clay（7.66:1）・ink のまま |
| alert-danger / trip ground #FBF8F1                   | 済みの ✓（spruce から変更）        | 4.34:1                     | 3（非テキスト）           | OK（✕ と同じ色。形で分かる）                             |

- Warning: 赤は 3 状態の danger（鹿検知）と同じ色。A-6 は鹿にぶつかった結果の画面なので意味は通るが、A-6 で赤を見慣れると、B の運転中の赤の警告の重さが薄れないかはユーザーの判断（README の原則 2 の例外としてユーザーが決めた）
- 色だけに頼らない: 主ボタンは文字で、✕ と ✓ は形で分かる。帯と線は飾り
