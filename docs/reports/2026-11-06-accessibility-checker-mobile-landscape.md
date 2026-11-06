# アクセシビリティチェック結果: mobile-landscape（apps/sim/src/features/drive/）

日付: 2026-11-06 / 基準: WCAG 2.1 AA、ch8 規約 6 / テーマ: night
対象: RotateGuide.tsx、hud/TouchControls.tsx、mobile-text.ts、StartOverlay.tsx、hud/BottomBar.tsx、hooks/use-touch-drive.ts、hooks/use-mobile-drive.ts、drive.css（追加分）、chat-feed.css・audio-controls.css（@media と min-height のみ確認）
画像: docs/reports/img/mobile-landscape/ の drive-844x390-touch.png、drive-start-844x390-touch.png、drive-start-390x844-touch.png を目視
制約: Bash が使えず `git diff` は見ていない。chat-feed.css・audio-controls.css は grep で寸法・色の宣言だけ確認した。実機の VoiceOver / TalkBack は未検証（コードと画像からの評価）。

## 先に結論（ch8 規約 6 の 3 点）

| 項目                              | 結果                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| タップ領域 44px 以上              | 合格。左の円 120px、右の円 88px、つまみ 48px、音トグル・再生速度ボタン・季節チップ・戻るリンクは min-height 44px。小さい画面の詰めでも `min-width/min-height: 44px` は残る |
| アイコンだけのボタンに aria-label | 合格。右の円は `aria-label="ブレーキ"`（見える文字と一致。2.5.3 OK）、左の円の見える文字「ハンドル」は aria の先頭と一致。SVG は `aria-hidden`                             |
| 4.5:1                             | 概ね合格。ただし左右の円の半透明の面（surface 72%）の上の文字は、明るい背景の場面で 4.5:1 を割る可能性がある（W1）                                                         |
| 点滅 1 Hz 以下                    | 新規の点滅・アニメーションなし（つまみは transform の追従のみ）。既存の danger の 1 Hz は変更なし                                                                          |

## Critical（WCAG 違反）

- [hooks/use-mobile-drive.ts:55-64、spec R4] ジャイロ（端末の動き）で視線を操作する機能に、無効にする手段がなく、ジャイロが効いている間は画面上の代替（ドラッグ）も効かない | 基準: WCAG 2.5.4 Motion Actuation（A） | 修正: 視線の入力元を切り替えるボタン（「視線: スマホの向き ON/OFF」、button + aria-pressed、44px）を出発の案内に置く。OFF のときはドラッグの視線（既存の `useSceneLook`）だけを使う。OFF の状態は端末側の許可（iOS の denied）に頼らず、アプリ内で保持する。視線は運転の本質ではないので「essential」の例外にはならない
- [components/DrivePage.tsx:189-197、RotateGuide.tsx:11] 縦画面の案内は `position:absolute` で上に重ねているだけで、下の出発の案内（「出発」ボタン・季節チップ・戻るリンク）・HUD・運転画面が DOM に残り、Tab とスクリーンリーダーの swipe で到達できる。外付けキーボードで Tab すると、見えない「出発」にフォーカスが入り、Enter で縦のまま走り出せる | 基準: WCAG 2.4.3 Focus Order、2.4.7 Focus Visible（フォーカスが隠れた要素に入る）、1.3.2 Meaningful Sequence | 修正: `mobile.portrait` のとき、案内以外（`.drive__scene`、`.drive-hud`、`StartOverlay`）に `inert` を付ける（セマンティック HTML 側の解決。ARIA の `aria-hidden` だけでは Tab を止められない）。案内に `role="alert"` を残すなら、案内自体は inert にしない

## Warning（改善推奨）

- W1 [drive.css:290-291・326-333（`.drive-touch`、`.drive-touch__label`）] 円の面は `color-mix(surface 72%, transparent)` で、下の 3D の場面が透ける。ラベル（caption 12px、ink-muted #B9C6BF）の対比を、最悪の背景（白）で試算すると約 3.6:1（面が #5A615E 前後になる）。夏・晴れの空・雪面で 4.5:1 を割りうる。見本の冬の夕方（撮った画像）では読めている | 基準: WCAG 1.4.3 | 修正: 円の面を他の HUD と同じ 88%（`.drive-hud__route` と同じ）以上にする。または文字を `--ink`（#F2F5F1）にする（対比が約 5.4:1 から 8:1 に上がる）
- W2 [drive.css:290,315（円・つまみの枠 `--line`）] 円の枠線は `--line`（#2C3C34）で、暗い場面に対して 3:1 を満たさない（画像の左右の円は、面の半透明で辛うじて見える程度）。円は中の文字・アイコンで識別できるので 1.4.11 の「識別できる」例外にほぼ当たるが、触れる範囲（円の外周）が見えにくい | 基準: WCAG 1.4.11 Non-text Contrast | 修正: 枠を `--ink-muted` か `--spruce` にする。仕様 R3 の「色は surface・line・spruce」の範囲内では、spruce を枠にするのが最小
- W3 [TouchControls.tsx:54-61、hooks/use-touch-drive.ts:94-106] 右の円は `<button>` だが、反応するのは pointer イベントだけ（onClick・onKeyDown なし）。フォーカスして Enter を押す、VoiceOver / TalkBack で二度タップして有効化する（click が合成される）と、何も起きない。「ボタン」と読み上げられるのに動かない | 基準: WCAG 2.1.1 Keyboard、4.1.2 Name, Role, Value | 修正: `onKeyDown/onKeyUp`（Space・Enter）で押している間のブレーキを入れる。または少なくとも `onClick` で短いブレーキ（300 ms 程度）を入れる。Space は window のキー入力（`useKeyboardDrive`）で既に効くので、ボタンにフォーカスがある状態で二重に入らないこと（`InputMixer` の OR なので害はない）を確認する
- W4 [TouchControls.tsx:21-27、spec R3] 左の円は `role="group"` の `div` で、フォーカスもキー操作もない。スクリーンリーダーには「ハンドルとアクセル（ドラッグ）、グループ」と読まれるが、中に操作できるものがない。スクリーンリーダーの探索タッチ（VoiceOver ではドラッグがスクリーンリーダーのジェスチャーに奪われる）では操作できない | 基準: WCAG 2.5.1 Pointer Gestures（経路のあるジェスチャーに単一ポインタの代替）、2.1.1 | 修正: 運転のアナログ入力は本質的なのでドラッグは残してよい。ただし (1) aria の説明に「キー・外付けキーボードでも運転できます」への案内を足す、(2) 出発の案内の操作の説明に、W・A・S・D・Space が使えることを 1 行足す（指で操る端末のキーボード付きの iPad を含む）、(3) 将来、タップで押している間の加減速・左右の 4 ボタン版を設定で選べるようにする
- W5 [RotateGuide.tsx、spec R2] 縦画面で運転（/drive）を使えなくしている | 基準: WCAG 1.3.4 Orientation（AA、2.1 で追加）。「特定の向きが本質的」でない限り、向きを制限してはいけない | 修正: 仕様に「3D の運転画面は横長の視野が本質的（essential）」という根拠を 1 行残す。案内文は「使えません」ではなく「横にすると運転できます」の書き方のまま。`/plan`・A-2・A-6・A-7 は縦でも読めるので出さない（仕様どおりで良い）
- W6 [drive.css:34-43（`.drive__scene` の `touch-action: none`）、index.html:5] 運転中は場面（と円）でピンチ拡大ができない。viewport に `user-scalable=no` は無い（良い）が、運転中の HUD の文字（caption 12px・label 13px）を拡大して読む手段がなくなる | 基準: WCAG 1.4.4 Resize Text、1.4.10 Reflow（運転中の HUD は 3D 操作と一体なので限定的） | 修正: 少なくとも、出発の案内（`touch-action` が `.drive__scene` の外なので拡大できる。OK）と終了の帯が拡大できることを手動で確認する。HUD の文字を指で操る端末で 14px（body）以上にする設定を検討
- W7 [use-mobile-drive.ts:59-64、spec R4] ジャイロの許可が denied・届かない・1 秒途切れのとき、使えないことも、代わりにドラッグで視線を動かせることも利用者に伝わらない（出発は止めない設計のため）。スクリーンリーダーの利用者は、視線の操作がなくなったことに気づけない | 基準: WCAG 4.1.3 Status Messages（AA、2.1）、3.3.2 Labels or Instructions | 修正: 状態を `role="status"`（`aria-live="polite"`）の短い文（「スマホの向きは使えません。画面をドラッグすると見回せます」、4 言語）で 1 回通知する。C1 の切り替えボタンの状態と合わせると 1 か所で済む
- W8 [RotateGuide.tsx:11] 縦にするたび 1 回読む（role="alert"）。読み上げが 4 言語をまとめて読む（主文＋注記＋副文 3 行）ので長い。さらに、ページを最初から縦で開いたときは、ページ読み込み時にすでにある alert は読み上げられない（支援技術による）。出発の案内の h1 が下で先に読まれる可能性もある（C2 を直せば解消） | 基準: WCAG 4.1.3 | 修正: alert の中身は主文（title）だけにして、注記と副文は alert の外の `aria-live` なしのテキストにする。または `role="alert"` をやめて、`role="dialog"` ＋ `aria-modal="true"` ＋ `aria-labelledby` ＋ 初期フォーカスにする（案内に操作要素が無いのでフォーカスは案内自体に置き `tabindex="-1"`）

## Info（任意）

- I1 [RotateGuide.tsx:30,33] 見出しが `<p>` の「横にしてください」。縦の間は案内の下の h1 が inert になるので、案内側に `<h1>` を置くと見出しナビゲーションで見つかる（`.drive-rotate__title` は `<h1>` にしても CSS は変わらない）
- I2 [RotateGuide.tsx:30-41] `lang="zh"` は文面が繁体字（「請將手機橫放」）。`zh-Hant`（または台湾向けなら `zh-TW`）にすると、スクリーンリーダーの音声と字形が合う。`Lang` の値は schema 側の `zh` のまま、表示側で変換する
- I3 [StartOverlay.tsx:55-61、mobile-text.ts hints] 指向けの説明の「左の円」「右の円」「スマホの向き」を `<kbd>` で包んでいる。`kbd` はキーボード入力の意味で、指のジェスチャーの意味ではない。見た目をそろえるだけなら `<kbd>` ではなく `<span class="...">` にする（スクリーンリーダーへの影響は小さい）
- I4 [TouchControls.tsx:58] `aria-pressed` は「押している間だけ」の瞬間的な状態で、押すたびに「押されている」「押されていない」が読み上げられうる。ブレーキの瞬間操作では、`aria-pressed` を外して見た目（spruce の塗り）だけにしたほうが読み上げが静か。色だけの状態表示ではないので 1.4.1 は問題なし（形は変わらないが aria-pressed がある）
- I5 [drive.css:313,320] つまみ（48px）の枠 `--line` と面 `--surface-sunken`（#141A17）の対比は 1.1:1 程度だが、中のアイコン（`--ink`）が識別を担う。ドラッグ中は spruce に変わり、on-spruce（#0E1512）のアイコンは #3FA98C 上で約 6.6:1。OK
- I6 [chat-feed.css 155-170、audio-controls.css 58-70] 小さい画面で音量スライダーが `min-width: 64px`。操作の高さは 44px を確保しているが、64px の幅では細かい調整が難しい。実機で確認する
- I7 [drive.css:252-256、354-357] フォーカスインジケータ（`outline: 3px solid var(--ink)`）は新しい右の円にも付いている（良い）。左の円は非対話なので不要
- I8 [範囲外] 740×360 など 844×390 未満は対応外。ボタンが画面外に出ないことだけ手動で確認する（仕様どおり）
- I9 良い点: 円・つまみ・案内のアイコンはすべてインライン SVG（stroke、aria-hidden）で絵文字なし。副文に `lang` を付けて 4 言語を併記している。新規コンポーネントに点滅・自動の動きなし。色は night トークンの変数のみで直書きなし

## 自動で検出できないもの（手動で確認してほしい）

1. 実機 VoiceOver（iOS Safari）で、縦の案内が 1 回だけ読まれ、横に戻したあと案内が消えて最初のフォーカスが論理的な位置に戻ること（C2 の修正後）
2. TalkBack で右の円が有効化できること（W3）
3. 夏・晴れ（7 月）の場面で、右の円・左の円のラベルが読めること（W1）。撮影済みの画像は冬の夕方だけ
4. 外付けキーボード付きの iPad（`any-pointer: coarse` と `pointer: fine` が混在）で、円とキーの説明の両方が出る状態の整理（円は出るがキーの説明が出ない/出る）が一貫していること

## スコア: 66/100

内訳: 基準の充足（タップ領域・aria-label・対比・点滅）は良い。減点は、モーション操作を止められない（C1、Level A）と、縦画面の案内の下に操作が残る（C2）、ブレーキのキー・支援技術での操作（W3）、状態通知の不足（W7）。C1・C2 と W3 を直せば 80 点台。
