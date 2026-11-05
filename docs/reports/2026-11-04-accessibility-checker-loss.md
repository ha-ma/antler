# アクセシビリティチェック結果: A-6 喪失画面（apps/sim/src/features/loss）

対象: `components/*.tsx`、`components/loss.css`、`text.ts`。基準は WCAG 2.1 AA。色は `packages/alert-ui/src/tokens/tokens.css` と `docs/design/tokens.json`。コントラスト比は相対輝度から手計算した（誤差は 0.1 程度）。

## コントラスト計算

night（`[data-theme='night']`）。ground は #0E1512、surface は #1A2420。

| 前景              | 背景                         | 比        | 使用箇所                               | 判定                                      |
| ----------------- | ---------------------------- | --------- | -------------------------------------- | ----------------------------------------- |
| ink-muted #B9C6BF | ground                       | 10.5      | .loss-fact                             | OK                                        |
| ink-muted         | surface                      | 9.0       | story 見出し、tile label / note、stats | OK                                        |
| clay #F0A26B      | ground                       | 8.9       | .loss-eyebrow（12px）                  | OK                                        |
| clay              | surface                      | 7.7       | tile 値（24px）                        | OK                                        |
| on-spruce #0E1512 | spruce #3FA98C               | 6.4       | 主ボタン                               | OK                                        |
| on-spruce         | spruce-deep #1E6F5C（hover） | 3.07      | 主ボタン hover                         | 大きい文字（20px・太字）の 3:1 でぎりぎり |
| spruce #3FA98C    | ground / surface             | 6.4 / 5.5 | フォーカス枠 3px                       | OK（1.4.11 は 3:1）                       |
| line #2C3C34      | ground                       | 1.59      | 副ボタンの枠                           | 下の Info 参照                            |

trip（LossCard の紙）。ground は #FBF8F1。

| 前景                 | 背景   | 比   | 使用箇所                                  | 判定                                                                                             |
| -------------------- | ------ | ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ink-muted #4A5A53    | ground | 6.9  | カード見出し、タイトル、D ラベル、lost 行 | OK                                                                                               |
| spruce #1E6F5C       | ground | 5.7  | ✓                                         | OK                                                                                               |
| alert-danger #D83B1E | ground | 4.34 | 衝突行の文字と ✕                          | 4.5:1 未満。20px・太字（大きい文字）なので 3:1 で通る。行の中のどの文字も 20px・太字になっている |

## Critical（WCAG 違反）

なし。

## Warning（改善推奨）

- [LossPage.tsx:40] 読み込み中の `<main aria-busy="true">` の中に `<p role="status">`。busy の祖先の中のライブ領域は読み上げが抑止される。このとき `<main>` は差し替えで消えるので、`aria-busy` が false に戻ることもない。読み込み中の通知が出ない | 修正: `aria-busy` を外す。`role="status"` の `<p>` はそのまま残す。
- [StoryPanel.tsx:22,27,46] 二重の問題。(1) `aria-busy` を `<section>` に付けている。busy が false になる更新と本文の差し替えが同じコミットで起きるので、読み上げが取りこぼされることがある。(2) `aria-live="polite"` の中に `role="status"`（暗黙の polite）を入れ子にしていて、二重に読まれることがある | 修正: `aria-busy` は `aria-live` の `<div>` に移す。内側の `<p role="status">` から `role` を外す（外側の領域が読み上げる）。
- [StoryPanel.tsx:36-42] 「もう一度」を押すと `isFetching` が true になり、ボタンが消えて読み込み中の `<p>` に替わる。フォーカスが `<body>` に落ち、キーボード利用者は先頭から辿り直しになる | 基準: WCAG 2.4.3 | 修正: 再試行のあと `tabIndex={-1}` の story 見出しか領域にフォーカスを移す。または失敗の表示のままボタンを `aria-disabled` にして残す。
- [LossPage.tsx:183] `<aside>` が `<main>` の中にある。complementary ランドマークが top-level でなくなる（axe: landmark-complementary-is-top-level） | 修正: `<main>` は `.loss-body` の中身全体ではなく左カラムだけにして、`<aside>` は main の外に出す。または `<aside>` を `<div>` に替える（中は `<section aria-labelledby>` なので領域は残る）。
- [loss.css:319-323] `.loss-row__mark` が `flex: 0 0 28px`（px 固定）。lost 行の「D2」が mark 列に入る。文字だけを 200% に拡大すると（Firefox の文字のみ拡大、OS のフォント倍率）、12px が 24px になり「D2」は約 29px で 28px を超える。「D10」以上だと隣の文字に重なる | 基準: WCAG 1.4.4 | 修正: `flex: 0 0 auto; min-width: 3ch` にする。

## Info

- [loss.css:249] 主ボタンの hover は文字 3.07:1。20px・太字なので大きい文字として通るが余裕がない。night で spruce-deep の上に on-spruce を載せる組み合わせは、フォントが 700 未満に落ちると 4.5:1 が要る | 案: hover は背景を変えず、`filter: brightness()` か影だけで表す。
- [loss.css:340] 衝突行の 4.34:1 は「大きい文字」に依存している。コメントのとおり意図的だが、行を 14px に戻した瞬間に違反になる。この前提を `loss-card.test` かコメントで固定しておく。日本語フォントが太字（700 以上）で読み込まれていることも前提になる。
- [loss.css:253-258] 副ボタンの枠（line）は ground に対して 1.59:1。ラベルの文字があるので 1.4.11 の違反ではないが、ボタンに見えにくい。枠だけ `ink-faint`（night #7A8C84、約 5:1）にすると見つけやすくなる。
- [loss.css:237-247] 主ボタンは `border: 0` で、影（box-shadow）で立体感を出している。Windows のハイコントラスト（forced-colors）では背景も影も消えて、ボタンの境界が無くなる | 案: `border: 2px solid transparent` を足す。
- [LossCard.tsx:65, StatsCard.tsx:37] `list-style: none` の `<ol>` / `<ul>` は Safari + VoiceOver でリストの意味が落ちる | 案: `role="list"` を足す。
- [loss.css:271] `rotate(-1.5deg)` は WCAG 違反ではない（1.3.4 は画面の向きの話）。ただし回転した文字はサブピクセルの描画が荒れ、ロービジョンの拡大で読みにくくなる。操作要素は中に無く、横スクロールは出ない（ページの余白 40px が受ける）。デザイン意図のとおり維持してよい。`@media (forced-colors: active)` と `prefers-contrast: more` では `transform: none` にする案がある。
- [LossPage.tsx:161] 値「3 / 5」は読み上げで「3 スラッシュ 5」になる。ラベルが「楽しみ 5 つのうち」なので意味は取れるが、`<span aria-label>` か `<data>` で補うとよい。
- [LossPage.tsx:37-56,40] 読み込み中と、旅が読めない場合の状態表示は `lang="ja"` 固定。旅の言語が分からないための仕様どおり。読み込み中の `<main>` には `lang` 属性が無く、文書側の lang に従う。見出し（`<h1>`）も無い（`<title>` と status だけ）。
- [loss.css:51-59] ページの左右余白が 40px 固定で、320px 幅（1.4.10 リフロー、400% 拡大）では本文が約 240px になる。縦スクロールだけで読めるので違反ではない。狭い画面は `var(--space-4)` に落とすと読みやすい。
- [LossPage.tsx:169] 3 つの導線を `<nav aria-label="つぎに">` にしている。遷移リンクなので許容。ランドマークが増えすぎるなら `<div>` でも足りる。

## 確認して問題なしとしたもの

- 見出し: h1（フォーカス移動先）→ h2 ×4（story、指標（読み上げ専用）、しおり、統計）の順で、スキップなし。読み上げ専用の h2（`loss-visually-hidden`）は DOM の順序と見た目が合っている。
- 取り消し線: `<s>` は読み上げでほぼ無視されるが、`（取り消し）` を `loss-visually-hidden` で添えている。タイトルと lost 行の両方で 4 言語分ある。achieved 行には `（済み）`。
- ✓ / ✕ の SVG: `aria-hidden` と `focusable=false` で、`stroke: currentcolor`。意味は文字（済み / 衝突）が持つので、色と形だけに頼っていない（1.4.1 OK）。
- タップ領域: `.loss-button` は min-height 48px、主ボタンは 64px。横幅も 44px 以上。
- フォーカス: `.loss :focus-visible` の 3px spruce と offset 2px（night 上で 5.5〜6.4:1）。見出しへのプログラム的なフォーカスの枠は `:focus:not(:focus-visible)` で抑えて、キーボードのときは残している。LossCard（trip）の中にフォーカスできるものは無い。
- `dl` の中の `div` でまとめた `dt` + `dd` ×2 は正しい構造。
- 絵文字なし、色の直書きなし。`prefers-reduced-motion` はグローバルで対応済み（`apps/sim/src/app/global.css:15`）。この画面に動きは無い。

## スコア: 88/100
