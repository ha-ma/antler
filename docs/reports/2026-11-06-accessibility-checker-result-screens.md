# アクセシビリティチェック結果: result-screens（A-1 文言 / A-6 落下 / A-7 クリア）

対象: 未コミットの変更。LossPage.tsx・loss.css・drop.ts・StoryPanel/LossCard/StatTile、ClearBanner.tsx・record.css・RecordContent.tsx・useCelebration.ts・record/text.ts、plan-trip/text.ts。
基準: WCAG 2.1 AA。コントラストは tokens.css の値から相対輝度で手計算（概算）。実機の読み上げ・ブラウザでの動作は未確認（コードからの判断）。

件数: Critical 1 / Warning 5 / Info 6。スコア: 82/100

## Critical（WCAG 違反・実害大）

### C-1. `.loss-drop:focus-within { animation: none }` が、フォーカスが外れた瞬間にアニメーションを最初から再生し直す

- [apps/sim/src/features/loss/components/loss.css:419-423] | 基準: WCAG 2.4.7 / 3.2.1 の趣旨（フォーカスの出入りで内容が一時的に見えなくなる）。厳密な条項への当てはめは弱いが、キーボード・マウスの操作で読んでいる内容が消えて落ち直す実害がある
- 仕組み: フォーカス中は `animation-name` が `none` になり、フォーカスが外れると `loss-drop`（または `loss-fade`）に戻る。CSS では `none` → 名前付きへの切り替えでアニメーションが 0% から再開する。要素は 0%（不透明度 0・画面上 −70vh）に戻り、`animation-delay`（番号 × 150 ms）のあいだ消えたまま、そのあと落ちてくる
- 再現（描画が終わって 2 秒後でも起きる）:
  - 「もう一度」ボタン（StoryPanel）を押す → 別の場所を押す／Tab で次へ進む → 文の欄ごと消えて落ち直す
  - 導線（nav）のリンクに Tab で入って出る → 主ボタンごと 0.75 秒消えて現れ直す
  - Tab で最初に入った時点が落下の途中なら、その場で止まって（ジャンプして）見える
- 影響: 弱視・拡大・スクリーンリーダー併用のキーボード利用者が、読んでいる最中の文の欄や押そうとしているボタンを見失う。`prefers-reduced-motion` でも `.loss-drop:focus-within`（詳細度 0,2,0）が media 内の `.loss-drop`（0,1,0）に勝つので、消えて現れ直す動きは reduced-motion でも起きる
- 修正案: 「落ち終わったら静止」を状態として持つ。
  - `onAnimationEnd` と `onFocus`（キャプチャ）で `data-settled="true"` を付け、CSS は `.loss-drop[data-settled='true'] { animation: none; opacity: 1; }` とする（`:focus-within` の規則は消す）。静止の見た目は基本の `transform: rotate(var(--loss-tilt))` と同じなので跳ねない
  - フォーカスが先に入った場合は `onFocus` で即 settled にする（再生し直さない）
  - 別案: Tab 順の最初の操作要素に入る前に全カードを即表示にする。ただし settled 方式のほうが小さい
- DROP-5 のテストは「フォーカス中に動きが止まる」だけを見ているので、「フォーカスが外れても再生し直さない」を足す（jsdom では CSS が動かないので、`data-settled` の付与を見る形になる）

## Warning（改善推奨）

### W-1. 「クリア」のフォーカス先が名前も役割もない `<p tabIndex=-1>`で、説明文が一緒に読まれない

- [apps/sim/src/features/record/components/ClearBanner.tsx:62-65] | 修正: フォーカスを受ける要素の読み上げが「クリア」だけになる（`<p>` は role を持たず、スクリーンリーダーによってはフォーカス移動で何も言わない／「クリア」だけ言う）。次の「D1 を、鹿にぶつからずに走りきりました。」は矢印キーで読み進めないと聞こえない
  - 案 A: `.record-clear__text` の `<div>` に `tabIndex={-1}`・`role="group"`・`aria-labelledby`（クリアの id）・`aria-describedby`（説明文の id）を付け、フォーカスをそこへ移す。読み上げは「クリア、グループ、D1 を〜」になる
  - 案 B: `<p>` に `aria-describedby`（説明文の id）だけを付ける（最小）
  - どちらも、見出しにしない（h1 の順を崩さない）という仕様 R3 と両立する

### W-2. 紙吹雪の `translate` が行き先で横にはみ出し、狭い画面で横スクロールが出る恐れ

- [apps/sim/src/features/record/components/ClearBanner.tsx:13-20、record.css:648-657・727-730] | 基準: WCAG 1.4.10 リフロー（320 CSS px で 2 方向スクロールなし）
- `left` は 0〜約 97%、`drift` は ±40 px、要素は 8〜9 px 幅。288 px 幅の帯では右端の片が最大 約 30 px 帯の外に出る。`.record-col` の外側の余白は 16 px しかないので、視口を約 15 px 超える
- `animation-fill-mode: both` で最終フレーム（不透明度 0・translate 済み）が残る。`opacity: 0` でも transform 済みの要素はスクロール可能領域に入るので、紙吹雪が終わったあとも横スクロールバーが残る可能性がある
- 修正案: `.record-clear__confetti` を `inset: 0; overflow: clip`（縦は下に落とすので `overflow-x: clip` か、帯の高さ＋余白の矩形に `clip-path`）にする。または `left` を 4〜92% に収め、`drift` を内側向きにする。実機（320 px 幅・Chrome DevTools）で `document.documentElement.scrollWidth` を確かめる

### W-3. 落ちる途中のカードが、まだ読んでいる別のカードや見出しの上を通る

- [apps/sim/src/features/loss/components/loss.css:401-411・425-462] | 基準: WCAG 1.4.12 の趣旨 / 認知負荷（WCAG の条項違反ではない）
- 画面上 −70vh から落ちる間、見出し・事実の 1 文・先に着地した文の欄に重なる。`z-index` が番号順で後のカードが前に出る。全体 2 秒前後で自動で終わる（2.2.2 の 5 秒未満）
- 動きの設定が「減らす」でないが前庭の過敏な人には強い動き（大移動＋回転）。reduced-motion の対応は正しく入っている
- 提案: 見出し・事実の 1 文を着地位置の下（`z-index` を最上位）に置くか、`translateY` を −70vh から −40vh 程度にして重なる時間を減らす。ユーザーの好み確認（仕様の Deferred）と合わせて決める

### W-4. 送信ボタン末尾の「→」が読み上げられる

- [apps/sim/src/features/plan-trip/text.ts:175-180、PlanForm.tsx:41] | 修正: 文言に含まれる `→` が「右矢印」と読まれる（既存の言い回しでもあるので優先度は低い）
- アクセシブルネームは見えている文字と一致しており（2.5.3 Label in Name は満たす）、文言の中身（何が起きるか）は WCAG 2.4.6 の観点でも改善している
- 修正案: 文言から `→` を外し、CSS の `::after` で足す（装飾なので読まれない）。または `<span aria-hidden="true">→</span>` にする（文言が文字列なので `text.ts` の形を変えない `::after` のほうが小さい）

### W-5. 送信中にボタンの文字を入れ替える（`aria-busy` と文言の変更）

- [apps/sim/src/features/plan-trip/components/PlanForm.tsx:38-41] | 修正: ボタンの名前が「…確かめる →」から「しおりを仕上げています…」に変わる。`aria-disabled` なのでフォーカスは残るが、読み上げでは変更が通知されないことが多い。`CreateTripStatus` に `pending` を渡している（status の領域があるかは未確認。変更箇所外）。領域があって `role="status"` なら問題なし。変更差分の外なので、確認だけお願いしたい

## Info

- I-1. コントラスト（概算）。問題なし:
  - A-6（night）: clay #F0A26B on ground #0E1512 約 8.8:1、ink-muted #B9C6BF on surface #1A2420 約 9:1、on-spruce #0E1512 on spruce #3FA98C 約 6.3:1
  - A-6 のしおり（trip の紙）: alert-danger #D83B1E on #FBF8F1 は約 4.3:1 で 4.5:1 に届かないが、`.loss-row--collision` は 20px・太字（大きい文字・3:1 で足りる）。コメントの理由どおりで OK。✓ の spruce は約 5.5:1
  - A-7（trip）: spruce #1E6F5C on surface #FFF 約 5.8:1・on ground 約 5.5:1（「クリア」40px・32px どちらも十分）、clay-deep #B34E14 は約 4.9〜5.2:1
  - チェック on-alert-safe #0E1512 on alert-safe #3FA98C 約 6.3:1
- I-2. 円のリング（alert-safe #3FA98C on surface #FFF 約 2.9:1）は 3:1 に僅かに届かないが、`aria-hidden` の装飾で、「クリア」の文字が情報を担うので 1.4.11 の対象外
- I-3. `.loss-button--secondary` の枠は `--line`（night #2C3C34 on #0E1512 約 1.5:1）。ボタンは文字で識別できるため 1.4.11 の違反ではない。A-7 の `record-url` は `--ink-faint` を使っていて対応済み。揃えるなら secondary も `--ink-faint` を使うと、枠で操作要素と分かる
- I-4. reduced-motion の実装は仕様どおりで良好:
  - A-6: transform を使わず不透明度のみ（240 ms・80 ms 刻み）、傾きは静止。ただし C-1 の再生し直しは reduced でも起きる
  - A-7: 円・チェックは描き終わった形、紙吹雪は `display: none`、「クリア」と説明は残す
- I-5. 点滅: 1 Hz を超える明滅なし（紙吹雪は 1 片ずつ 1 回だけ、全体も 3 回/秒を超えない）。2.3.1 OK。動きは 2.6 秒以内で終わり 2.2.2 OK
- I-6. 読み上げ・Tab の順は DOM の順＝見た目の順（左列: 文の欄 → 4 指標 → 導線、右列: しおり → 統計）で OK。h1 → h2 の見出しの順も保たれている。`<dl>` 内の `div` ＋ `dt`/`dd` は有効。取り消し線の「取り消し」の補足、✓/✕ の SVG は `aria-hidden`、チェックの意味は visually-hidden の「（完了）」で補っている。`StoryPanel` の `aria-live="polite"` は初回描画で領域が存在するので、文が届いたとき通知される。A-7 は祝いを出さないとき h1 にフォーカスが残り、衝突のあとは成功の表現が一切出ない（仕様 R4 どおり）
- 見出しにフォーカスを移したときの枠の抑止（`:focus:not(:focus-visible)`）は、キーボード操作のとき枠を残すので OK。ただし record.css:19-22 の `h1:focus, h1:focus-visible { outline: none }` は常に枠を消す。h1 は Tab で到達できない（`tabindex=-1`）のでキーボード到達の 2.4.7 には当たらないが、`:focus-visible` まで消す必要はない（ClearBanner 側と同じ書き方に揃えると良い）

## スコア: 82/100

- 減点: C-1（-10）、W-1（-3）、W-2（-3）、W-3 / W-4 / W-5（各 -1 前後）
- 仕様の非機能要件（装飾 aria-hidden、reduced-motion、点滅なし、トークンの色）は概ね満たしている。C-1 を直すのが最優先
