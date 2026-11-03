# アクセシビリティチェック: pwa-connect（dc7334b）

対象: `apps/pwa/src/features/connect/components/` の ConnectScreen.tsx・DriveScreen.tsx・connect.css（ConnectFlow.tsx・LinkIcon.tsx・i18n.ts は文脈として参照）。
基準: WCAG 2.1 AA、ch5 のアクセシビリティ（4.5:1、44px、aria-label、1 Hz）。
観点: スマホ縦画面、200% 拡大、ja / en / zh（繁体）/ ko。
方法: コード読みのみ。実機・スクリーンリーダーでは未確認。レンダリング依存の項目は「要実機確認」と書く。コードは直していない。

## Critical（WCAG 違反）

- [ConnectScreen.tsx:79-99] 「3 つの表示」のプレビューが本物の AlertState をそのまま描画している。`danger` のプレビューは `role="alert"` の中に「前方に鹿…」を入れた状態で、画面を開いた時点で出る。さらに `role="status"` と `data-testid="alert-current"` の読み上げ用文が 3 状態ぶん（計 9 段落）ある。スクリーンリーダー利用者には「前方に鹿」の誤警報として読まれ、B-0 の見出し順にも 9 段落が混ざる。見えない文を作っているのは AlertState の `antler-alert__sr`（AlertState.tsx:91-99）。
  | 基準: WCAG 4.1.3（状況メッセージ）・1.3.1・3.2.4（誤った情報）
  | 修正: プレビューの `li` 内の `.connect__preview-face` に `aria-hidden="true"` と `inert` を付け、読み上げは `connect__preview-label` だけにする。alert-ui 側に `preview`（ライブ領域を出さない）prop を足す案もあるが、凍結 API の変更になるので先に PWA 側で対処する。
- [DriveScreen.tsx:56-61] 「音が出ません」「位置情報なし」は、音の解除の結果が出てから後で現れるのに、ライブ領域ではない。スクリーンリーダーには告知されない。しかもこれは運転中の安全に関わる失敗通知。帯（`drive__band`）は正しく「常に置いて中身を入れ替える」形になっているのに、notes だけ `{cond && <ul>}` になっている。
  | 基準: WCAG 4.1.3
  | 修正: `ul` を常に置き、`role="status"` を付けた枠の中に `li` を出し入れする。`role="status"` を `ul` に直接付けると list の意味が消えるので、外側に `div role="status"` を置く。
- [connect.css:99-103, ConnectScreen.tsx:87-96] プレビューの面が `height: 120px; overflow: hidden` で固定。compact の AlertState は形 72 + 数値 44 + gap 16 + padding 8×2 + 枠 6×2 ≒ 160px を要するので、数値が下で切れるはず（要実機確認）。さらに 3 列の `flex: 1` で 1 列は 375px 幅で約 98px、200% 拡大（実効 187px）では 1 列約 40px になり、`min-width: 0` と `overflow: hidden` で数値・単位が横にも欠ける。
  | 基準: WCAG 1.4.4（200% でも情報が失われない）・1.4.10（リフロー、320 CSS px）・1.4.12
  | 修正: `height` を `min-height` にして `overflow: hidden` をやめる。狭いとき（`@media (max-width: 480px)` か `flex-wrap`）は 1 列にするか、プレビューを形だけの静的 SVG にする。
- [ConnectFlow.tsx:35-47, DriveScreen.tsx:46] 「出発」を押すと、フォーカスのあった button が DOM から消え、フォーカスが body に戻る。画面が切り替わったことをスクリーンリーダーに伝える手段も無い（帯は空のまま、`h1` も `main` も無い）。
  | 基準: WCAG 2.4.3（フォーカス順序）・4.1.3
  | 修正: 切替後に DriveScreen の外枠（`tabIndex={-1}`）へ `focus()` する。または DriveScreen を `main` にして `aria-label` に「走行中」を付ける。下の「`main` が無い」と一緒に対処できる。

## Warning（改善推奨）

- [index.html:2, ConnectScreen.tsx:38, DriveScreen.tsx:46] `<html lang="ja">` と `<title>` が固定で、en / zh / ko の端末でも日本語のまま。`main` と `div` にだけ `lang` を付けている。zh の `lang` は `"zh"` で、繁体字なら `zh-TW`（Lang 値 `zh` を属性に出すときに変換する）。`zh` のままだと、日本語フォントで繁体字が描画されたり、読み上げの声が簡体字・普通話側に寄ったりする。基準: WCAG 3.1.1（A）・3.1.2。修正: `resolveLang` 後に `document.documentElement.lang` と `document.title` を更新し、`lang` 属性は `zh` → `zh-TW` に変換する。
- [connect.css:11, tokens.json の `type.families.sans`] フォントが Noto Sans JP / Hiragino Sans のみ。ko のハングルは Noto Sans JP に無いので `system-ui` に落ち、zh の繁体字は日本の字形になる。`:lang(zh-TW)` と `:lang(ko)` で font-family を足す（Noto Sans TC / PingFang TC、Noto Sans KR / Apple SD Gothic Neo）。数値は mono なので影響なし。tokens.json を変えるなら原本側で。
- [DriveScreen.tsx:46-67] 走行画面に `main`（ランドマーク）も見出しも無い。スクリーンリーダーで探索すると何の画面か分からない。`div.drive` を `main` にする。基準: WCAG 1.3.1・2.4.1（ベストプラクティス）。
- [connect.css:158-170] 「音が出ません」「位置情報なし」が 12px の `ink-muted` で、帯の中の小さい一行。コントラストは足りる（`#B9C6BF` on `#141A17` で約 9:1）が、運転中に音が出ない失敗は最重要。見落とされるので、`label`（13px）以上にして `ink`、`clay` の文字版などで目立たせることを検討。色だけで区別せず、アイコン（インライン SVG）も付ける。
- [ConnectScreen.tsx:58, 62] 値が無いときの `--` が「ハイフン ハイフン」と読まれる、または何も読まれない。`dd` に見えない文字で「なし / none / 없음 / 無」を入れる（i18n にキーが 1 つ要る）。`dt` の `rateLabel`「msgs/s」「回/秒」は単位だけで意味が弱いので、`aria-label` でなく `dt` の語を「受信回数/秒」のようにする案もある。
- [ConnectScreen.tsx:45] 接続状況の `role="status"`。接続が再接続でばたつくと「接続しています ↔ 未接続」が続けて読まれ、走行前の確認の邪魔になる。`aria-live="polite"` のままデバウンス（例: 同じ状態が 2 秒続いたら更新）を検討。
- [ConnectScreen.tsx:107-109] 位置情報の許可状態は B-0 の間に変わる（`useLocationState`）のに、ライブ領域ではない。許可ダイアログで許可した後、画面上の文が変わっても告知されない。`role="status"` を付ける。
- [DriveScreen.tsx（+ alert-ui）] 200% 拡大時、danger の非 compact AlertState（形 200 + 矢印 72 + 数値 96 + 見出し 42×2 + 副文 2 行）は実効高さ約 330px に収まらず、`overflow-y: auto` のスクロールになる。数値（距離）が画面外に出ると、運転中には読めない。1.4.10 としてはスクロールで可だが、danger だけは 200% でも一画面に収まるようにしたい。形のサイズを `min(200px, 30vh)` のように可変にする案。要実機確認。この項目は alert-ui の責務なので alert-ui 側の報告にも書く。
- [connect.css:118-135] `.connect__depart` に `border: 0` と独自背景。`:focus-visible` のスタイルが無く、ブラウザ既定の輪郭に頼っている。強制カラーモード（Windows のハイコントラスト、iOS の「コントラストを上げる」）では背景が消えて境界が無くなる。`:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px }` と `@media (forced-colors: active) { .connect__depart { border: 2px solid ButtonText } }` を足す。基準: WCAG 2.4.7・1.4.11（既定の輪郭が残るので現状でも通る可能性は高い）。
- [ConnectScreen.tsx:112-116] `departNote`（「車載とつながっていなくても出発できます」）が button の説明として結びついていない。`aria-describedby` で button に付けると、フォーカス時に読まれる。
- [DriveScreen.tsx:48-55] 帯の「未接続」と接続画面の `status` の両方で同じ語。一貫性はよいが、走行画面では帯が「どの接続が」切れたのか分からない。`text.band` を「車載と未接続」にする案（i18n 4 言語）。

## Info（問題なし・確認できたこと）

- コントラスト（night テーマ、手計算）: ink-muted `#B9C6BF` on surface `#1A2420` は約 9:1、spruce `#3FA98C` on surface 約 5.5:1、on-spruce `#0E1512` on spruce 約 6.4:1、ink-muted on surface-sunken は約 9:1。いずれも 4.5:1 以上。
- タッチターゲット: 操作要素は出発ボタン 1 つで `min-height: 56px`、幅は全幅。44px 以上。
- 点滅: `useBlink` が 500ms ごとの切替で 1 Hz。白枠 14px のみで、WCAG 2.3.1 の閃光（3 回/秒）にも当たらない。`prefers-reduced-motion` で止まらない設計も理由が書いてあり、妥当。
- 見出しの階層（h1 → h2）、`section` の `aria-labelledby`、接続状況のアイコンは `aria-hidden` で隣に文言あり、形（チェック・点 3 つ・斜線）と色以外でも区別できる。
- viewport に `user-scalable=no` や `maximum-scale` が無く、ピンチ拡大を妨げない。
- aria-label が要るアイコンのみボタンは無い（操作要素が出発ボタン 1 つで、文言あり）。ch5 の「アイコンのみボタンに aria-label」は該当なし。
- 4 言語の `i18n.ts` はキーが揃っている。`locationDenied` は原因と直し方（設定で許可）を書いていて 3.3.3 の考え方に沿う。

## 自動チェックでは見えないもの（実機で確かめる）

1. iOS VoiceOver で B-0 を開いたとき、「前方に鹿」が読まれるか（Critical 1 の確認）。
2. 出発直後、フォーカスの行き先と読み上げ（Critical 4）。
3. 375px 幅と 200% 拡大で、プレビュー 3 列の数値の欠け（Critical 3）。
4. ko / zh の端末言語で、フォントの落ち方と日本語のままのタイトル。
5. 走行画面で danger が 200% 拡大時に距離を画面内で見せられるか。

## スコア: 62/100

- Critical 4 件: -30（誤警報の読み上げ、失敗通知がライブでない、プレビューの切れ、画面切替のフォーカス）
- Warning 10 件: -8（lang とフォント、ランドマーク、失敗通知の目立たなさほか）
- 加点側: 色・サイズ・点滅・見出し・形による区別はよくできている。
