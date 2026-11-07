## アクセシビリティチェック結果（sticky-cta / A-1・A-2・A-6・A-7 の下に固定した主ボタンの帯）

対象: `apps/sim/src/shared/components/ActionBar.tsx`・`action-bar.css`、`PlanForm.tsx`・`BriefPage.tsx`・`LossPage.tsx`・`RecordContent.tsx`、各画面の CSS の下の余白。
やり方: accessibility-checker のエージェントはこのセッションから呼べないので、`.claude/agents/accessibility-checker.md` の観点（WCAG 2.1 AA ＋ ch8 規約 6）で自己レビューした。コントラストは tokens.json の値から計算した。Playwright（Chromium、`reducedMotion: 'reduce'`）で 390×844・844×390・1280×800 の各画面を、開いた直後・半分・最後までスクロールして撮り、主ボタンの位置と本文が帯に隠れないかを測った（PR の本文に結果）。

### Critical（WCAG 違反）

なし（0 件。下の 1 件は見つけた時点で直した）。

- 直した: [action-bar.css] night のテーマ（A-6）で、ホバー・処理中の面 `spruce-deep`（#1E6F5C）の上の `on-spruce`（#0E1512）が 3.07:1 で 4.5:1 に届かない（1.4.3。16px の太字は大きい文字に入らない）。面は `spruce` のまま下線で示すようにした。今までの A-6 の主ボタン（`.loss-button--primary:hover`）も同じ組み合わせだった
- 直した: [action-bar.css] 固定の帯の下に Tab で進んだ要素が隠れうる（2.4.11、WCAG 2.2 AA）。帯がある画面だけ `scroll-padding-bottom` に帯の高さを入れた（`:root:has(.action-bar)`）

### Warning（改善推奨）

1. [action-bar.css] 文字を 200% に拡大した低い画面（例: 844×390 を 2 倍 → 422×195 相当）では、帯（主ボタン 48px ＋余白）が画面の 3〜4 割を取る。1.4.10（リフロー）の違反ではない（内容は読めてスクロールできる）が窮屈。直すなら高さ 300px 以下で帯を `position: static` に戻す（主ボタンは本文の中に戻る）
2. [action-bar.css] 帯の高さの予約（`--action-bar-reserve`）は固定の値（88px・低い画面 72px・狭い画面で補足があるとき 152px）。実測は 87px・71px・113px で足りている。主ボタンの文言が 3 行に折れる言語・文字の拡大では足りない場合がある。`:has()` の無いブラウザ（Firefox 121 より前）では狭い画面の補足の分を足さない
3. [action-bar.css] 注意を引く動き（3px 浮いて戻るのを 2 回）は 5 秒以内に止まり、点滅ではないので 2.2.2 の対象外。動きを減らす設定では `animation: none`。好みの確認はユーザーに残した（functional.md の Deferred）

### Info

- 主ボタンは今までと同じ DOM の位置で帯に入れた（`position: fixed`）。Tab と読み上げの順は変わらない。同じボタンを 2 つ描いていない（テストで画面の中の同じ名前のボタン・リンクが 1 つだけであることを確かめた）
- A-1 は送信の失敗（`role="alert"`、「もう一度」）を帯の中、主ボタンの前に移した。Tab の順は「しおり → 失敗の知らせのもう一度 → 主ボタン → 注記」になる（前は主ボタンの後ろ）。押した場所の近くで分かるようにした
- A-1 の「直すところ」は `aria-describedby` で主ボタンにつなぎ、ライブリージョンにしていない（入力欄の下の `role="status"` が読む。二重に読ませない）。主ボタンは `disabled` にしない（押すと React Hook Form が最初の誤りの欄へフォーカスを移す）
- コントラスト: on-spruce / spruce は trip 6.03:1・night 6.40:1、trip のホバー（spruce-deep）9.4:1、補足の clay-deep / surface 5.23:1、フォーカスの輪（ink）/ surface 14.97:1（night 14.51:1）。主ボタンの面 / 帯の面は trip 6.03:1・night 5.52:1（1.4.11 の 3:1 を満たす）
- 主ボタンの高さは 56px（低い画面 48px）、横は狭い画面で画面いっぱい。ch8 規約 6 の 44px を満たす
- `alert-*` の色・16 進の色は使っていない（テスト BAR-2）
- 運転の画面（`/drive`）は変えていない。出発の案内の「出発」は 3 つの大きさで最初の画面に入っている（スクリーンショット）
