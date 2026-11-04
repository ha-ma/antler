# アクセシビリティチェック結果: A-7 旅の記録（record）

- 日付: 2026-11-04
- 基準: WCAG 2.1 AA（ほかにタップ領域 44px、見出しの構造、フォーカス、言語属性）
- 対象
  - sim: `apps/sim/src/features/record/components/`（RecordPage.tsx・RecordHeader.tsx・RecordSections.tsx・DeleteSection.tsx・ResultMark.tsx・record.css）
  - api: `apps/api/src/infrastructure/http/views/record-page.ts`（SSR・JS なし）
  - 文言: `packages/trip/src/record/text.ts`、表示の形: `packages/trip/src/record/view.ts`
- 方法: コードの静的読み取りと、tokens.json の値からの手計算（相対輝度）。ブラウザ・スクリーンリーダーでの実機確認はしていない。実機で確かめるべき点は各項目に書いた。

## コントラスト計算（tokens.json、trip テーマ。night は B の導線のみ）

| 組み合わせ                                                    | 用途                                       | 比            | 基準                | 判定                                                 |
| ------------------------------------------------------------- | ------------------------------------------ | ------------- | ------------------- | ---------------------------------------------------- |
| ink #1B2A24 / surface #FFF                                    | 本文                                       | 約 15.0:1     | 4.5                 | OK                                                   |
| ink-muted #4A5A53 / ground #FBF8F1                            | lead・log の `when`・note・status          | 約 6.9:1      | 4.5                 | OK                                                   |
| ink-muted / surface #FFF                                      | stat の dt・kept の note                   | 約 7.3:1      | 4.5                 | OK                                                   |
| ink-muted / photo-placeholder #CFDCD4                         | 「写真は準備中」12px                       | 約 5.2:1      | 4.5                 | OK（余裕は小さい）                                   |
| spruce #1E6F5C / ground                                       | eyebrow 12px（太字）                       | 約 5.7:1      | 4.5                 | OK                                                   |
| spruce / surface                                              | chip・回避・stat の数値                    | 約 6.0:1      | 4.5                 | OK                                                   |
| on-spruce #FFF / spruce                                       | 主ボタン                                   | 約 6.0:1      | 4.5                 | OK                                                   |
| clay-deep #B34E14 / ground                                    | 間一髪・衝突・OFF・削除エラー（12px 太字） | 約 4.9:1      | 4.5                 | OK（余裕は小さい）                                   |
| clay-deep / surface #FFF                                      | 同上（カード内）                           | 約 5.2:1      | 4.5                 | OK                                                   |
| 白 / clay-deep                                                | 削除ボタン                                 | 約 5.2:1      | 4.5                 | OK                                                   |
| night ink-muted #B9C6BF / night surface #1A2420               | B の導線の本文 12px                        | 約 9.0:1      | 4.5                 | OK                                                   |
| night on-spruce #0E1512 / night spruce #3FA98C                | B の導線のリンク                           | 約 6.4:1      | 4.5                 | OK                                                   |
| focus 輪郭 spruce 3px / ground・surface                       | フォーカス                                 | 約 5.7〜6.0:1 | 3                   | OK（night 内も spruce #3FA98C / #1A2420 で約 5.5:1） |
| **line #E6DFD0 / surface #FFF**（ground に対しては約 1.25:1） | **入力枠・副ボタン枠**                     | **約 1.3:1**  | **3（非テキスト）** | **NG（C2）**                                         |
| ink-faint #6B7A73 / 白                                        | SSR の「未走行」マーク（図形）             | 約 4.5:1      | 3                   | OK                                                   |

タップ領域: `.record-button` 44px、`.record-url` 44px、`.record-actions` 48px、`.record-b__link` 48px、SSR の `.links a`・`.b a` 48px。すべて 44px 以上で OK。

## Critical（WCAG 違反）

- **C1** [`apps/sim/src/features/record/components/DeleteSection.tsx:69-77`（押すボタン）と `:37-61`（出てくる確認欄）] 「この記録を削除」を押すと、そのボタンが DOM から消えて確認欄に入れ替わる。フォーカスが失われて `body` に戻り、確認欄が出たことはスクリーンリーダーにも伝わらない（確認欄に role も live もない）。キーボード利用者は先頭から Tab をやり直すことになり、破壊的操作の確認に気づけない。「やめる」（`:51-58`）でも同じで、戻ったボタンにフォーカスが戻らない | 基準: WCAG 2.4.3 フォーカスの順序、4.1.3 ステータスメッセージ | 修正: 確認欄を `role="group"`＋`aria-labelledby`（見出し `record-delete`）にして、出た時点でフォーカスを安全側の「やめる」に移す（ref コールバックで `el?.focus()`。`useEffect` は使わない）。「やめる」を押したら元の「この記録を削除」ボタンへフォーカスを戻す（ボタンに ref を持たせ、`setConfirming(false)` の後で focus。ボタンを消さずに `hidden` で切り替えても可）。`deleteConfirm` の文は `aria-describedby` で「削除する」ボタンに結び付ける
- **C2** [`apps/sim/src/features/record/components/record.css:78-88`（`.record-url`）] 入力欄の枠が `line`（#E6DFD0）で、隣接色（surface #FFF／header の ground #FBF8F1）との比が約 1.3:1。入力欄の境界が見えず（塗りも surface と ground で約 1.04:1 と差がない）、コピー用の欄だと識別しにくい。読み取り専用でも、`copyFailed` が「URL を選んでコピーしてください」と案内しており、選択できる欄だと認識できることが操作の前提なので、1.4.11 の対象と判断した | 基準: WCAG 1.4.11 非テキストのコントラスト（3:1） | 修正: コントロールの枠だけ `var(--ink-faint)`（#6B7A73、白に 4.5:1／ground に 4.2:1）にする。tokens.json の `line` の用途に「入力枠」とあるため、token 側の用途を見直す提案も ch8 に出す（カードの枠と区切りは `line` のままでよい）。**同じ理由で副ボタンの枠（`record.css:129-133`、SSR は `record-page.ts:82`）も Warning（W1）**

## Warning（改善推奨）

- **W1** [`record.css:129-133`、`record-page.ts:82`] 副ボタン（`record-button--secondary`、`.secondary`）の枠が `line` で約 1.3:1。文字は 15:1 なのでボタンだとは読めるが、白地に白い面で「押せる面」の手がかりが弱い。C2 と同じく枠を `ink-faint` にするか、背景を `surface-sunken` にする | 基準: 1.4.11（文字で識別できるため違反とは断定しない）
- **W2** [`RecordPage.tsx:47`] 読み込み中の `<main aria-busy="true">` の中に `<p role="status">` がある。`aria-busy` が付いた祖先の中の live region は、スクリーンリーダーが更新を保留して読み上げないことがある。同時に status 要素が文言と一緒に挿入されるので、読み上げられにくい | 修正: `aria-busy` を外す。status 要素は空のまま先に描画しておく構造にするか、`role="status"` の文言を入れ替える形にする
- **W3** [`RecordPage.tsx:47`、`:55`] 読み込み中・エラー時の `<main>` に `lang` がない（`:35` の削除完了画面にはある）。`index.html` は `lang="ja"`、文言は既定の ja なので今は一致するが、`query.data` が無いのに ja と決め打ちしているため、将来変わると崩れる。許容はできるが `lang="ja"` を明示しておく | 基準: 3.1.1（実害は現状なし）
- **W4** [`RecordPage.tsx:60-67`（再試行）] 「もう一度」を押しても、取得中であることが画面にも読み上げにも出ない。失敗が続くと、押しても何も起きないように見える。`query.isFetching` のあいだ `aria-disabled` と「読み込んでいます」の status を出す | 基準: 4.1.3
- **W5** [`RecordHeader.tsx:54`（画像の保存）、`DeleteSection.tsx:44`（削除する）] `disabled={isPending}` で、押した瞬間にそのボタンが無効になりフォーカスを失う（キーボード・スクリーンリーダー利用者）。失敗して有効に戻っても、フォーカスは `body` のまま | 基準: 2.4.3 | 修正: `disabled` の代わりに `aria-disabled="true"` ＋ クリックを無視する形にする。見た目は `:disabled` のスタイルを `[aria-disabled=true]` にも当てる
- **W6** [`RecordHeader.tsx:62-65`、`useRecordActions.ts:43-60`] 画像の保存は、成功しても何も通知されず（ダウンロードが始まるだけ）、保存中の通知もない。コピーも、2 回目以降は同じ文言のため再度は読み上げられず、「コピーしました」が消えない。失敗は `role="status"`（polite）で読まれる | 基準: 4.1.3 | 修正: 保存中は「保存しています」、成功は「保存しました」を status に出す（文言は `text.ts` に 4 言語で足す）。コピーの文言は数秒で消す（`setTimeout`、またはイベントハンドラ内で更新）。失敗は `role="alert"`
- **W7** [`RecordPage.tsx:117`] `<nav aria-label={t('shioriHeading')}>` の名前が「旅のしおり」で、中身は「別の旅をつくる／アラート OFF で挑戦」。ナビゲーションの名前として合わず、同名のセクション（`RecordSections.tsx:73`）とも重なる。ランドマーク一覧で区別がつかない | 修正: 名前を「次の操作」に相当する文言にするか、`<nav>` をやめて `<div role="group">`／素の `<div>` にする（リンクが 2 つだけなので `nav` は不要）。SSR の `<nav class="links">`（`record-page.ts:238`）も同様。単独なので名前なしは許容だが、まぎらわしければ `div` にする
- **W8** [`record.css:236-239`、`record-page.ts:55`] stat の単位 `small` が数値 24px の 0.4em ＝ 約 9.6px。「回」「s」「×」が小さすぎて読みにくい（ch8 の「単位は数値の 40%」に従った結果）。tokens.json は ink-faint でも「12px 以上」と決めているので、最小値と合わない | 修正: `font-size: max(12px, 0.4em)`
- **W9** [`RecordSections.tsx:30, 53, 79`、`record.css:267-270, 304-307, 373-376`、SSR `record-page.ts:58, 62`] `list-style: none` を当てた `ul`/`ol` は、Safari＋VoiceOver でリストの意味が失われる（件数が読まれない）。「鹿ゾーンでの 3 回」の件数はリストの件数と対応するので影響が大きい | 修正: `<ul role="list">`／`<ol role="list">`
- **W10** [`record-page.ts:164`] `<span class="url" aria-label="…">`。`span`（generic）への `aria-label` は仕様上使えず、スクリーンリーダーに無視されることが多い。URL の前に何の URL かが伝わらない | 修正: 見える `<span class="url-label">この旅の URL</span>` を足して `<p>` にまとめる、または視覚的に隠したラベルを先頭に置く（`aria-label` は外す）
- **W11** [`record-page.ts:174`、`RecordSections.tsx:9`] `<dl aria-label>`。`dl` に対する `aria-label` の扱いはスクリーンリーダーで差がある。見出しも付かないので、記録の数字のまとまりが見出しナビゲーションに出ない | 修正: `<section aria-labelledby>` ＋ 視覚的に隠した `h2`、またはラベルを視覚上も出す
- **W12** [`view.ts:107, 128`、`text.ts:64`] 値がないとき「—」だけを出している（stat の「アラート→ブレーキ 平均」と log の `brake`）。スクリーンリーダーは「—」を読まない／「ダッシュ」と読み、意味が伝わらない。log の行は他の欄が文章なので、そこだけ空に聞こえる | 修正: 「—」は `aria-hidden` にして、隣に視覚的に隠した「計測なし」（4 言語）を置く。または文言自体を「計測なし」にする
- **W13** [`record-page.ts:127-142, 160-161, 245`] `head()` が `<html><head>…</head></html>` を返し、その後に `<body>…</body></html>` が続く。`</html>` が 2 回あり、`<body>` の前に `</html>` が来る。HTML の仕様どおりの回復（暗黙の body → after body → `<body>` の属性を併合）が働くので、どのブラウザでも DOM は同じになる。妥当性のパースエラーであり、実害は小さい | 基準: 4.1.1（2.1 の旧基準） | 修正: `head()` は `</head>` までにして `<html>` を閉じず、`renderRecordPage`・`renderNotFoundPage` で `<body>…</body></html>` で閉じる
- **W14** [`record-page.ts:251`] 見つからないページの `<title>` が「EZO ROAD」だけ。404 だとわからない | 基準: 2.4.2 ページタイトル | 修正: `recordText('notFound','ja')` に近い短い題（4 言語の併記）にする
- **W15** [`record-page.ts:264`] リンク文言「自分の旅をつくる / Plan your own trip」の英語部分に `lang="en"` がない。日本語の読み上げ音声で英語を読む | 基準: 3.1.2 部分の言語 | 修正: 英語を `<span lang="en">` に包む
- **W16** [`record-page.ts:236`] リンクの末尾の `→` が読み上げに入る（「右矢印」）。sim の `RecordSections.tsx:120` は `aria-hidden` にしている。sim と SSR で揃える | 修正: `<span aria-hidden="true">→</span>`

## Info（確認・今後）

- **I1** 見出しの構造は sim・SSR とも h1 → h2（守れたもの／鹿ゾーンでの N 回／旅のしおり／B の導線／削除）で飛びなし。OK。ただし h1 は「守りきった。」で、旅の題名はただの `<p>`（`RecordPage.tsx:107`、`record-page.ts:171`）。見出し一覧では何の旅かわからない。題名を h1 に含めるか、`<title>`（pageTitle）が担っていることを許容する
- **I2** 色だけで区別していない点は良い。回避／間一髪／衝突は文言（`outcomeLabel`）付き、しおりの日の結果は円＋チェック／✕／横線の形と `resultLabel` 付き、OFF は文字。SVG は `aria-hidden` で、意味は隣の文字が持つ（`ResultMark.tsx`）
- **I3** `lang` は sim（`RecordPage.tsx:97`）も SSR（`record-page.ts:129`、zh → zh-Hant）も正しく付く。残りは、本文の中の英語の `eyebrow`（「TRIP RECORD ・ 日付」は 4 言語とも英語。`text.ts:17-22`）と「EZO ROAD」。3.1.2 の対象だが固有名詞に近いので許容。`eyebrow` を `lang="en"` の span にすると読み上げは安定する
- **I4** `<title>` は React 19 のホイストで head に入る（`RecordPage.tsx:98`、react ^19.3.1）。OK。ただし読み込み中・エラー・削除完了の 3 画面では `<title>` が更新されず、前の画面の題が残る（2.4.2）。「削除しました。」などを `<title>` に出すとよい
- **I5** フォーカス: `.record :focus-visible` の 3px spruce は十分に見える。`h1:focus` の輪郭を消している（`record.css:19-22`）のは、プログラムで当てるだけの見出しなので許容。画面遷移後に h1 へフォーカスを移す（`focusOnMount`）のは良い。SSR はフォーカスのスタイルを定義しておらず、ブラウザ既定に任せている（night の青緑地のリンクでも既定の二重リングで見える）。必要なら `a:focus-visible{outline:3px solid var(--spruce);outline-offset:2px}` を足す
- **I6** 先頭のスキップリンクはない。header に Tab 停止が 3 つ（入力・2 ボタン）あり、`<main>` ランドマークで回避できるので 2.4.1 は満たす。短縮したければ main へのスキップリンクを足す
- **I7** フォントサイズが px 固定（record.css と SSR の `STYLE`）。ブラウザのズームでは拡大できるが、ブラウザの「文字サイズだけ大きく」の設定には追従しない。`rem` が望ましい。12px の小さな文字が多い（note・B の導線の本文・log）。折り返しは 320px 幅でも成立する作りだが（`min-width:0`、`flex-wrap`、`overflow-wrap`）、実機での確認が必要
- **I13** 1.4.12 文字間隔: 高さ固定は `.record-photo` の `height: 120px`（SSR は `.photo` の 110px）だけで、行間を広げると文字が切れる可能性がある。ほかは `min-height`。`min-height` に変える
- **I8** `.record-photo`（`RecordSections.tsx:33`）の「写真は準備中」が守れたものの数だけ繰り返され、読み上げが冗長。`aria-hidden` にして、リスト項目の側にまとめて 1 回だけ出す案もある
- **I9** `.record-url`（`RecordHeader.tsx:34-43`）は `aria-label` のみで見えるラベルがない。入力欄の用途は隣のボタンでわかるが、見えるラベルを置くほうが望ましい（3.3.2）。文字サイズ 13px は iOS で入力時のズームが起きる境目（16px 未満）。読み取り専用なので影響は小さい
- **I10** 「・」区切り（log の `what`、shiori の `detail`）は読み上げで読まれる／無視されるが、意味は通る。矢印「→」の `title`（`view.ts:151`）も同様
- **I11** 動きや点滅はなく、`alert-danger` も使っていない（record.css・SSR とも）。reduced-motion の対応は不要
- **I12** 実機で確かめるとよい点: (1) VoiceOver／NVDA で C1 の削除フロー、(2) 320px 幅と 200% 拡大での折り返し、(3) 読み込み中の status が読まれるか（W2）、(4) SSR の `</html>` の二重（W13）が各ブラウザで同じ DOM になるか

## スコア: 78/100

- 減点: C1 −8、C2 −6、Warning（W1〜W16）合計 −8
- 良い点: コントラストは文字がすべて 4.5:1 以上、タップ領域は 44px 以上、見出し構造・lang・色だけに頼らない表現・フォーカスの可視化・遷移後の h1 フォーカスが揃っている
- 最優先の直し: C1（削除フローのフォーカス）、C2（入力枠）
