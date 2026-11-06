# アクセシビリティチェック結果: drive-tourism（T8・T13〜T15）

対象: ChatFeed.tsx / PhotoCaption.tsx / chat-feed.css、RecommendCard.tsx / recommend-text.ts / drive.css（.drive-recommend*）、DrivePage.tsx（配置）
基準: WCAG 2.1 AA、night テーマ（`<main data-theme="night">` を DrivePage.tsx:124,133 と DriveScreen.tsx:108 で確認）。コードは変更していない。

## 結果の件数

Critical 0 / Warning 3 / Info 6 / スコア 90/100

## コントラスト（night。tokens.json の値から計算。相対輝度の手計算で、小数第 1 位まで）

| 前景                      | 背景                                | 比       | 使う場所                         | 判定               |
| ------------------------- | ----------------------------------- | -------- | -------------------------------- | ------------------ |
| ink #F2F5F1               | surface #1A2420                     | 14.5:1   | 吹き出しの本文、カードの名前     | 合格               |
| ink-muted #B9C6BF         | surface #1A2420                     | 9.0:1    | 話し手、出典、一言、所要、到着地 | 合格               |
| spruce #3FA98C            | surface #1A2420                     | 5.5:1    | eyebrow（12px / 700）            | 合格（4.5:1 以上） |
| ink-muted を 60% 不透明で | surface を 60% で暗い景色に重ねた面 | 約 4.1:1 | 赤の間の吹き出し                 | 不足の可能性（W1） |

- 吹き出しの背景は surface 92% で、3D の景色が透ける。night の空・地面は暗いので上の値から大きくは動かない。明るいもの（対向車のライト、雪面）が背後に来たときの値は、画面で確かめられていない。
- 色はすべて CSS 変数（`--ink` `--ink-muted` `--spruce` `--line` `--surface` `--photo-placeholder`）で、直書きなし。`--eyebrow-*` と `--caption-*` は `packages/alert-ui/src/tokens/tokens.css` にある。

## Critical（WCAG 違反）

なし。

## Warning（改善推奨）

- **W1 [chat-feed.css:52-54 `.drive-chat[data-dimmed='true'] { opacity: 0.6 }`] 赤の間の減光で、12px の ink-muted（話し手・出典）が約 4.1:1 に下がる見込み** | 基準: WCAG 1.4.3（12px は通常サイズなので 4.5:1 が要る） | ink（本文）は約 5.8:1 で足りる。直し方: 減光を 0.6 から 0.75 に上げる（ink-muted で約 5.5:1 になる見込み）か、減光のあいだ `.drive-chat__speaker` と `.drive-chat__credit` の色を ink にする。実機の景色の上で比を測って確かめてほしい。赤は 1 Hz 点滅の最中で読ませる場面ではないが、減光後も「見える文字」として数えられる。
- **W2 [drive.css:257-267、chat-feed.css:7-29] 文字を拡大したときに、おすすめカードと音量の操作が列からはみ出す** | 基準: WCAG 1.4.4・1.4.10 | `.drive-recommend` は `flex: none`・`overflow: hidden`・高さの上限なし。列は固定の `bottom` で、会話（`flex: 0 1 auto; min-height: 0`）は縮むが 0 まで縮んだ後は、カードと音量の操作が列の下端を越えて画面の外に出る。200% 拡大（CSS 幅が半分になり、`--drive-chat-w: 360px` が画面の半分を占める）や文字だけの拡大で、長い note・長い撮影者名・4 言語で長い文のとき起きやすい。直し方: カードに `max-height` と、超えたら note を省くか `overflow-y: auto`（ただし操作要素・フォーカスは足さない方針なので省くほうを推奨）。T14 の「画面の高さ 760px 以下は写真を出さない」だけでは 200% 拡大の対策にならない（拡大すると CSS の高さが減るのでメディアクエリは効くが、文字の増えた分は別）。
- **W3 [ChatFeed.tsx:36-38] 区域に入った瞬間の会話の読み上げ（polite）と、AlertState の role=status（polite）が同じ時刻に出る** | 基準: WCAG 4.1.3 | 赤（danger）の間は advance-chat.ts:186-189 で会話の行を保留するので、`role=alert` とは重ならない（良い）。ただし `zone-enter` の反応の行（advance-chat.ts:177）は区域に入る同じフレームで出るため、AlertState の「鹿ゾーン走行中」の status とチャットの polite が別の領域で連続する。スクリーンリーダーによっては先の読み上げが途中で切られる。直し方: 区域の状態が変わったフレームでは、会話の aria-live への反映（`latest` の更新）だけ約 2 秒遅らせる。見えるログと音声の会話のタイミングは今のままでよい。

## Info

- **I1 フォーカス・操作要素**: 足していない。`<img alt="">` 以外に `button` `a` `tabindex` なし。PhotoCaption は `<span>` で、リンクにしていない（HUD の方針どおり）。`.drive-chat-column` `.drive-chat` `.drive-recommend` は `pointer-events: none`、音量の操作だけ `pointer-events: auto`（audio-controls.css:12）。DOM の順は 会話 → おすすめ → 音量の操作で、Tab 順はおすすめに影響されない。
- **I2 装飾画像**: 吹き出しの 64×48（`width`/`height` あり）とカードの写真はどちらも `alt=""`。名前と出典が隣の文字にあるので装飾でよい（WCAG 1.1.1）。写真が読めないときは `--photo-placeholder` の面が残る。
- **I3 lang と aria-label（4 言語）**: `.drive-chat` と `<aside>` に `htmlLang(lang)`（zh は zh-TW）。`role="log"` の aria-label は `FEED_LABEL`、`<aside>` の aria-label は `RECOMMEND_TEXT.title`、どちらも ja/en/zh/ko がそろっている。残りの改善: 撮影者名・ライセンス名は訳さない方針（PhotoCaption.tsx の注記）で、旅の言語の声で読まれる。「Yuki Fujita / CC BY 4.0」が ja の声で読まれるのは許容範囲。気になるなら著者名とライセンスの span に `lang="en"` を付けるが、日本語の撮影者名があると誤るので推奨はしない。
- **I4 重複した読み上げ**: `<aside aria-label="この先のおすすめ">` の直後に eyebrow `<p>` が同じ文言を持つので、見出し位置で二度読まれる。`aria-labelledby` で eyebrow の id を指せば文言の重複は避けられる（T14 は aria-label を指定しているので、今のままでも仕様どおり）。もう一つ、運転の音の会話（TTS）と読み上げが同時に聞こえる使い方では、スクリーンリーダー利用者には二重になる。会話の音がオンのときは live 側を空にする設定を、後で検討してほしい。
- **I5 点滅・モーション**: 点滅なし。動きは 0.2 秒の下からのフェード（会話の行 `drive-chat-in`、カード `drive-recommend-in`）と減光の opacity 遷移だけ。`prefers-reduced-motion: reduce` で 3 つとも止まる（chat-feed.css:138-144、drive.css:342-346）。1 Hz 超の点滅なし（2.3.1）。
- **I6 おすすめカードは読み上げの領域ではない**（T14 の仕様どおり。recommend.test.tsx:161 が `aria-live` なしを確かめている）。スクリーンリーダー利用者にはカードが出たことが伝わらない。仕様で選んだ（アラートの読み上げと重ねない）ので違反ではなく、運転中のスクリーンリーダー利用は想定が薄い。`<aside>` は `<main>` の中のランドマークとして探索すれば見つかる。見出しは `<h2>` で、RoutePanel の `<h2>` と同じ階層なので飛ばしなし。

## 自動で検出できないもの（実機で確認してほしい）

- VoiceOver / NVDA で、区域に入る瞬間と赤の直後の会話の再開が、アラートの読み上げを切らないか（W3）。
- 景色が明るい場所（雪・対向車のライト）で、吹き出し（surface 92%）の文字が 4.5:1 を保つか。
- 200% 拡大で、右の列がほかの HUD（左右の panel の `left: calc((100% - var(--drive-chat-w)) / 2)`）と重ならないか（W2）。

## スコア: 90/100

Critical 0。減点は W1（-4）、W2（-4）、W3（-2）。
