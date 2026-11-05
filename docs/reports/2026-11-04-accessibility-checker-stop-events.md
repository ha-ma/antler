# アクセシビリティチェック結果: stop-events（A-4 のモーダル）

- 日付: 2026-11-04
- 対象: `apps/sim/src/features/stop-events/components/` の StopSceneModal.tsx / ChoiceButton.tsx / StopScenesPage.tsx / stop-events.css
- 基準: WCAG 2.1 AA、プロジェクト基準（文字 4.5:1、タップ 44px、モーダルのフォーカス管理）、仕様 `docs/specs/stop-events/functional.md` R11
- 方法: コードの読み取りと、trip テーマのトークン値から相対輝度を計算。実ブラウザ・スクリーンリーダーでの確認はしていない（下の「未確認」を参照）
- コードは直していない

## 良い点（維持してほしいもの）

- `<button type="button">` を使い、`div` + onClick になっていない。`role="dialog"` + `aria-modal` + `aria-labelledby`（`useId`）が付いている
- 開いたら最初の選択肢へフォーカス（ref コールバック。`useCallback` で安定しているので 1 回だけ）。R11 を満たす
- Esc は `preventDefault` + `stopPropagation`。外側クリックで閉じる処理は無く、R11 を満たす
- `min-height: 44px` が `.stop-choice` に入っていて、スマホ横（`max-height: 500px`）でも維持される
- `:focus-visible` が 3px の `spruce`（surface 上 6.0:1）。`outline: none` の打ち消しは無い
- 点滅・アニメーションが無い（1 Hz 規約・`prefers-reduced-motion` の問題なし）
- アラート ON / OFF は点の色だけでなく文字でも伝えている（1.4.1 OK）
- 絵文字なし、色は CSS 変数のみ

## コントラスト計算（trip テーマ）

| 前景 / 背景                           | 比       | 用途                     | 判定                        |
| ------------------------------------- | -------- | ------------------------ | --------------------------- |
| ink-muted #4A5A53 / surface #FFFFFF   | 7.3:1    | stat の dt、note、lead   | OK                          |
| ink-muted / ground #FBF8F1            | 約 6.9:1 | lead、stop-alert、chosen | OK                          |
| ink-muted / photo-placeholder #CFDCD4 | 5.2:1    | 写真の枠の説明           | OK                          |
| clay-deep #B34E14 / surface           | 5.2:1    | 鹿ゾーン帯、到着時刻     | OK                          |
| clay-deep / ground                    | 4.9:1    | 同上（ground 上）        | OK                          |
| spruce #1E6F5C / ground               | 5.7:1    | eyebrow（12px 太字）     | OK                          |
| on-spruce #FFFFFF / spruce            | 6.0:1    | 重さのチップ             | OK                          |
| line #E6DFD0 / ground                 | 1.25:1   | OFF の点、選択肢の枠     | 文字ではない。下の W-3・I-3 |

文字のコントラスト違反は無い。

## Critical（WCAG 違反）

- **[StopSceneModal.tsx:79-82・stop-events.css:4-16] 内容が viewport より高いと、上側が切れてスクロールで届かない** | 基準: WCAG 1.4.4 / 1.4.10 | `.stop-backdrop` が `display:flex; align-items:center; overflow-y:auto`。flex の中央寄せは、はみ出しを上下に等分し、上側は scroll できない。200% 拡大（1080p で viewport 高さ約 540px、`max-height:500px` の横置き用クエリは効かない）、または狭い幅で選択肢 3 つ＋写真が縦に積まれると、写真と見出し（`h1`）が見えなくなる。拡大して見る人は「何の場面か」を読めないまま選ぶことになる | 修正: `.stop-dialog` に `margin: auto` を付け、backdrop の `align-items` / `justify-content` の中央寄せをやめる（または `align-items: safe center`）。そのうえで 200% と 400%（320 CSS px 幅）で上端まで届くことを確かめる
- **[StopScenesPage.tsx:49 ほか・StopSceneModal.tsx] モーダルを閉じたあとフォーカスの戻り先が無い** | 基準: WCAG 2.4.3 フォーカス順序 | 選ぶと `setOpenSceneId(null)` でモーダルが消え、フォーカスしていたボタンも消えるので `document.body` に落ちる。キーボード・スクリーンリーダーの人はページ先頭からやり直しになる。運転画面（R12）に組み込んだときは、運転側のキー入力に戻るところなので影響がより大きい | 修正: 開く直前の `document.activeElement` を覚えて、閉じるときに戻す。戻す先が消える場合（運転側）は決めた要素（例: `main` に `tabIndex=-1`）に移す。ページ側は、開いた一覧のボタンに戻すのが素直
- **[StopSceneModal.tsx:58-76・80-86] Esc の握りつぶしと Tab の循環が、ボタンにフォーカスがあるときしか効かない** | 基準: WCAG 2.1.1 / 2.4.3、R11 | `onKeyDown` は `ChoiceButton` にだけ付いている。ダイアログ内の文字をクリックするとフォーカスが `body` に移る（ダイアログに `tabIndex={-1}` が無い）。その状態で (1) Esc は握りつぶされず、運転側のキー（R11 が止めたいもの）に届く、(2) Tab は背面のページへ抜ける（`aria-modal` はキーボードの Tab を閉じ込めない）。R11 の「選ぶまで閉じない」を、マウス操作を 1 回挟むと破れる | 修正: `onKeyDown` を `role="dialog"` の要素に移す（ボタンからはバブリングで届く）。ダイアログに `tabIndex={-1}` を付けて、中のクリックでフォーカスが外へ出ないようにする。背面は `inert` にするのが確実（`aria-modal` だけに頼らない）
- **[StopSceneModal.tsx:79 と 80・StopScenesPage.tsx:53] 4 言語の内容に `lang` が付いていない** | 基準: WCAG 3.1.2 パーツの言語 | `index.html` は `lang="ja"` 固定。`lang` が `en` / `zh` / `ko` のとき、スクリーンリーダーは日本語の声で読む。同じ sim の `PlanPage.tsx:16`・`BriefPage.tsx:112` は `lang={htmlLang(lang)}` を付けているのに、stop-events だけ抜けている（一貫性 3.2.4 にも関わる） | 修正: `.stop-backdrop` に `lang={htmlLang(lang)}`、確認用ページの `main` にも同様に付ける

## Warning（改善推奨）

- **[StopSceneModal.tsx:118・StopScenesPage.tsx:54] `h1` が 2 つ。ダイアログ名が空になりうる** | モーダルの `h1` は、背面ページの `h1`（previewHeading）と重なる。運転画面に組み込むと、そこにも `h1` がある。見出しの階層は `h2` にするのが安全。また `headline` は、`writing` が無く `pleasure` の名前も引けない `pleasure` 場面（行 44-47）で空文字になり、`aria-labelledby` が空の名前を指す | 修正: `h2` にする。空のときの代わりの文（例: `scene.id` ではなく `STOP_TEXT.eyebrowPleasure`）を名前にする
- **[ChoiceButton.tsx:64-84] ボタンの名前が長すぎる** | 名前が「言い回し ＋ → 地点 時刻 着 ＋ 鹿ゾーン帯 ＋ 失うもの ＋ Claude の一言」の全連結になる。選択肢 3 つをフォーカス移動で聞くたびに全部を読む。区切りも無いので 1 文に聞こえる | 修正: `aria-labelledby` を言い回し＋「→ 地点 時刻」の id に、`aria-describedby` を帯と一言の id にする（`aria-label` で上書きしないこと。可視文字と名前がずれて 2.5.3 に触れる）。帯と一言の区切りに句点を入れる
- **[StopSceneModal.tsx:149-150] `role="group"` の `aria-label` が見える問いかけと重複** | 「どうする？」を group 名と `<p>` の両方で読む | 修正: `aria-labelledby` で `<p>` の id を指す（`aria-label` はやめる）
- **[stop-events.css:169-187] 選択肢の枠が見分けにくい** | 基準: WCAG 1.4.11（非テキストのコントラスト） | 非 primary の枠は `line` 1px で surface との比が約 1.2:1。ボタンは文字で見分けられるので厳密な違反ではないが、「押せる箱」であることが色の差でほぼ伝わらない。primary だけ `spruce` 2px で、見た目の格差が大きい | 修正: 枠を `ink-faint`（#6B7A73、約 4.3:1 on white）より濃くするか、`ink-muted` にする。primary は枠色だけでなく文字などでも区別
- **[stop-events.css:268-290] スマホ横で `lead` と `note` を `display:none`** | 基準: WCAG 1.4.10 リフロー（情報の欠落） | Claude の本文と各選択肢の一言（この機能の価値の部分）が消える。さらに `max-height:500px` は 1080p の 200% 拡大でも当たるので、拡大した人にだけ情報が減る。`display:none` は読み上げからも消える | 修正: 隠さずスクロールで見せる（`.stop-body` は `overflow-y:auto` 済み）。どうしても省くなら、省く対象を端末の向きと高さで限り、拡大した人を巻き込まない
- **[StopScenesPage.tsx:58-60・102-106] `role="status"` の領域が、内容と同時に DOM に入る** | 基準: WCAG 4.1.3 | 空の live region を先に置いてから文字を入れないと、読み上げられないことが多い。「選んだ結果」（previewChosen）も、モーダルが閉じてフォーカスが `body` に落ちるので、読まれないと選んだ結果が伝わらない | 修正: `role="status"` の要素は常に描画し、中身だけ変える
- **[StopSceneModal.tsx:98-106] 写真の枚数の点が `role="img"` で「3 枚」と読まれる** | 写真は枠（placeholder）で、実際の写真は無い。「写真 3 枚」は存在しないものを知らせる誤情報。Day 6 で実画像になるまでは装飾 | 修正: いまは `aria-hidden="true"`。実画像が入ったら、画像側に `alt`（楽しみの名前など）を付け、点は `aria-hidden` のまま
- **[StopSceneModal.tsx:161] 選択肢が 0 件だとフォーカス先もボタンも無く、閉じる手段が無い** | 基準: WCAG 2.1.2 キーボードトラップ（回避の手段） | `choices: SceneChoice[]` は空を許す型。空の束が来ると、Esc も効かず出口が無い | 修正: 呼ぶ側で 1 件以上を保証する（型を `[SceneChoice, ...SceneChoice[]]` にする、または描画しない）。ダイアログ自体へフォーカスを置く保険も入れる

## Info

- **I-1** [StopSceneModal.tsx:145] 到着予定が無いときの `—` は、スクリーンリーダーで「em ダッシュ」と読まれる。`STOP_TEXT.noArrival` と対にして「なし」の語を `aria-label` かテキストで置く
- **I-2** 開く操作で Enter を押しっぱなしにすると、キーリピートで新しくフォーカスした最初の選択肢が確定しうる（R11 の「選ぶまで閉じない」は守られるが、選ばずに確定する）。開いて短い間（数百 ms）はクリックを受けない、または押下の繰り返し（`event.repeat`）を無視するのを検討
- **I-3** `.stop-alert__dot--off`（`line` 色）はコントラスト 1.25:1 だが、`aria-hidden` で文字が意味を持つので違反ではない
- **I-4** フォントサイズは px 指定。ブラウザの「文字だけ拡大」は効かない（全体のブラウザ拡大は効く）。12px の caption に重要な情報（鹿ゾーン帯・失うもの）が乗っている。トークン規約どおりなので、必要なら rem 化を検討
- **I-5** モーダルを開いたときの背面のスクロールが止まらない（スクロールのロックなし）。操作の妨げは小さい
- **I-6** マウスでモーダルを開いたとき、プログラムからのフォーカスは `:focus-visible` が付かない場合がある。キーボードで開けば見える。仕様どおり最初の選択肢には `primary` の 2px 枠があるので実害は小さい
- **I-7** `onKeyDown` の Tab 循環は `querySelectorAll('button')` 固定。ボタン以外のフォーカス可能要素（リンクなど）を足したら取りこぼす。`inert` 化と合わせて見直すと不要になる

## 未確認（自動検査では分からないので人の確認が必要）

- スクリーンリーダー（VoiceOver + Safari / Chrome）で、開いた直後に「ダイアログ名 → 最初の選択肢」の順で読まれるか
- 200% / 400% 拡大と、スマホ横（高さ 360〜430px）での実機の見え方（Critical 1 つ目の確認）
- 運転画面（R12 の組み込み）に入れたとき、運転側のキーボード操作が Esc 以外（矢印キー、Space など）でモーダルの裏で動かないか

## スコア: 62/100

文字のコントラスト・タップ領域・要素の選び方（button / dl / ol）は良好。減点は、フォーカス管理（戻り先なし、ボタン以外にいるときの Esc / Tab）、拡大時の上側の切れ、`lang` 付与の抜け。この 4 つを直せば 85 前後になる見込み。
