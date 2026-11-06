## アクセシビリティチェック結果（plan-trip-photos / A-1 /plan）

対象: PleasureCard.tsx・PhotoCredit.tsx・AllocationBar.tsx・PleasurePicker.tsx・plan-trip.css・text.ts（apps/sim/src/features/plan-trip/）
撮影: docs/reports/img/2026-11-06-plan-trip-photos-doto.png を確認（-doo.png は未確認）。コントラストは tokens.json の値から計算した。

### Critical（WCAG 違反）

なし（0 件）。

### Warning（改善推奨）

1. [plan-trip.css:407-414 / PhotoCredit.tsx] 引用リンクの押せる面が 24px。ch8 規約 6（タッチターゲット 44px 以上）に届かない。WCAG 2.1 AA 自体には対象サイズの基準が無い（2.5.5 は AAA、2.2 の 2.5.8 は 24px で満たす）ので違反ではなく、リポジトリ規約との差。2 つのリンクが " / " だけで並び、上のメモ文・カード縁とも近いので、タッチでは誤タップが起きやすい。
   修正: `@media (pointer: coarse) { .plan-card__credit a { min-height: 44px; display: inline-flex; align-items: center; } }` を足す。マウス向けの 24px は例外として functional.md R7 と ch8 の例外に 1 行書く（「写真の出典の補助リンクはポインタが細かいとき 24px」）。
2. [plan-trip.css:304-306・28-31] フォーカスリングが spruce の 3px で、カード内側（offset -3px）に写真の上へ描かれる。写真の色（釧路湿原の緑、湖の青など）と非テキストのコントラスト 3:1（1.4.11）を満たさない場所がある。選択中のカードは枠が spruce 2px なので、リングと枠が溶けて「選択」と「フォーカス」の見分けがつかない。
   修正: リングを二重にする（`outline: 3px solid var(--spruce); box-shadow: inset 0 0 0 5px var(--surface)` など、白い内側＋spruce）。または写真の下（名前の帯）にフォーカス表示を出す。
3. [PhotoCredit.tsx:16-37] 「新しいタブで開く」は aria-label でだけ伝えている。目で見る人とボイスコントロール利用者には伝わらない。ラベルは可視テキストを含んでいる（撮影者名・ライセンス名が含まれる）ので 2.5.3 は満たす。
   修正: 必須ではない。したい場合は撮影者・ライセンスの後ろに小さな外部リンクのアイコン（インライン SVG、aria-hidden）を付ける。
4. [Tab 順] 写真のあるカードごとに停止点が 3 つ（トグル＋リンク 2）。道東 10 件程度で 30 近くになり、右側のしおりへ行くまでキーボード利用者は全部を通る。見出し（h2）でのジャンプは使えるが、スキップの手段が無い。
   修正: 引用を一覧の後ろにまとめる案は R7 の「カードの下」に反するので、推奨は「楽しみ一覧をとばしてしおりへ」のスキップリンク（2.4.1 を確実に満たす）。

### Info

- 判断の確認: 写真を `alt=""`＋親 span の `aria-hidden` にした判断は適切。ボタンの名前は `plan-card__name` から付き、写真は内容を足さない装飾。aria-hidden は alt="" だけでは隠れない代替テキスト（placeholder の文・SelectBadge）も含むので必要。選択状態は `aria-pressed` が担う。直さなくてよい。
- 引用はボタンの外（トグルの兄弟）にあり、リンクがボタンの中に入る入れ子の対話要素（ARIA 違反）を避けている。良い。
- コントラスト（trip テーマ、surface #FFFFFF）: ink-faint #6B7A73 は約 4.51:1（12px の通常テキストで 4.5:1 を僅かに超える。余裕は無い）。リンクの ink-muted #4A5A53 は約 7.5:1。リンクと周りの文字の差は 3:1 に届かないが、下線があるので 1.4.1（色だけに頼らない）は満たす。「Public domain」は下線なしの span で、リンクと見分けがつく。
- night テーマ（#7A8C84 on #1A2420）は約 4.49:1 で 4.5:1 を僅かに割る。/plan は trip テーマなので今回は無関係だが、night の surface で 12px の ink-faint を使う画面を作るときは tokens.json 側の調整が要る。
- リンクの読み上げ名: 「流氷ウォーク の写真「…」の出典（撮影者、Wikimedia Commons。新しいタブで開きます）」「…のライセンス CC BY 4.0（新しいタブで開きます）」。どのカードの何のリンクか、行き先、新しいタブが分かる。良い。作品名・撮影者は訳さない方針のため、日本語ページの中で言語が混ざる。`lang` 属性は任意（3.1.2 は AA だが固有名は例外にできる）。
- 重さの操作を外した影響: AllocationBar は帯が `aria-hidden`、情報は凡例の `ul` で読める。入りきらない項目は取り消し線＋visually-hidden の文で伝えており、色や線だけに頼っていない。良い。
- 12px の引用は `overflow-wrap: anywhere` で 200% 拡大でも折り返す（1.4.4）。
- トグル（44px 以上の面積）、`aria-disabled` ＋ describedby（上限の理由を読み上げ）、`role="status"` の上限メッセージは問題なし。

### スコア: 90/100

内訳: Critical 0。Warning 4 件（ターゲットサイズの規約差、フォーカスリングの視認性、スキップの手段、新しいタブの可視の伝達）で減点。
