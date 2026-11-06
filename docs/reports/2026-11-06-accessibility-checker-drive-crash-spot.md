# アクセシビリティチェック結果: drive-crash-spot

対象: `apps/sim/src/features/drive/` の CrashOverlay / SpotCount / `.drive-phone` / use-deer-tap / DeerPicker、`features/loss` と `features/record` の鹿の発見の 1 行。
方法: コードの読み取りのみ（実機・スクリーンリーダー・目視は未実施）。テーマは drive・loss が night、record が trip。

## Critical（WCAG 違反）

なし。

次の W1 は、2.1.1 を厳密に読むと違反になる。ただし運転そのものはキーボードで操作でき、鹿の発見は補助的な集計なので Warning にした。Critical に上げるかは判断が要る。

## Warning（改善推奨）

- **W1** [hooks/use-deer-tap.ts:21-37, scene/DeerPicker.tsx:20] 鹿の発見がポインタ（pointerdown / pointerup）だけで、キーボードの代替が無い | 基準: WCAG 2.1.1 キーボード（厳密に読むと該当）
  - 運転は W/S/A/D・矢印・Space（`use-keyboard-drive.ts`）で操作できるが、「発見」の件数（A-6・A-7 に出る指標）は、キーボードだけの利用者とスクリーンリーダー利用者には 0 のまま。
  - 必須の機能ではなく、運転の完走や衝突の判定には影響しない。そのため、操作の代替を作らないことも許容できる。
  - 許容する場合は、A-6・A-7 の「0 / n 頭」が「見つけられなかった」と誤読されないよう、キーボードでは数えない旨を `docs/specs` に書く。
  - 代替を作る場合の推奨案:
    - キー 1 つ（例: `F`）で、正面の視野にいる見えていて未発見の鹿のうち、いちばん近いものを `onSpot(id)` に渡す。`use-keyboard-drive.ts` の Space はブレーキなので避ける。
    - 凡例（`keys` のヒント）に追記する。
    - 数えたら `role="status"`（polite）で「鹿を発見 n / m 頭」を 1 回読む。
  - タップの設計自体は良い。`pointerup` で確定するので 2.5.2 を満たす。ドラッグ（視線）と区別する 8 px の閾値がある。複雑なジェスチャーは使っていない（2.5.1 OK）。マルチタッチも pointerId ごとに処理している。
- **W2** [domain/spot.ts:15-16, 108] 遠くの鹿の当たりが、スマホ横画面で 44px を下回る | 基準: プロジェクト規約（44px）。WCAG 2.5.5 は AAA なので違反ではない
  - 半径は max(1.2 m, 距離 × 0.02) なので、遠くでは視角でほぼ一定（直径約 0.04 rad）になる。
  - 縦の視野角を約 60° と仮定すると、1080p で約 41px、高さ 390px の横画面スマホで約 15px。
  - 近くは大きい（10 m で半径 0.12 rad）。
  - 遠い鹿ほど「事前に発見」の価値が高いので、そこが当てにくいのは設計と逆。
  - 画面ピクセルで最低 22px 半径（直径 44px）を保証する方式にする。レイと球の距離をピクセルに直して比べるか、`SPOT_HIT_PER_M` を画面の高さに応じて上げる。
- **W3** [hud/CrashOverlay.tsx:15 と packages/alert-ui AlertState.tsx:91-96, DrivePage.tsx:183-188] 衝突の `role="alert"` が、車内スマホの AlertState の `role="alert"`（danger の読み上げ）と同時に鳴る可能性がある | 基準: 4.1.3 ステータスメッセージ
  - 衝突の瞬間のアラート状態は danger のままの可能性が高い。AlertState は `alert` と `status` の領域を常に置いて中身を入れ替える。
  - 「前方に鹿 n m」と「鹿と衝突しました」の 2 つの assertive が重なると、後者が割り込んで読み飛ばされる、または前者に潰される SR がある。
  - 衝突の文を先に確実に聞かせたい。対応案:
    - 衝突後（`outcome !== 'driving'`）は `PhoneScreen` を `aria-hidden` にする。
    - AlertState に読み上げを止める prop を渡す。alert-ui は凍結 API なので、新しい prop を足すなら PR に「推奨で決定」と書く。
  - 目視ではなく、NVDA か VoiceOver での確認を勧める。
- **W4** [DrivePage.tsx:223-230, hud/EndBanner.tsx:21-33] 衝突から終わりの帯までの 3.5 秒の間、HUD のボタン・リンクが Tab で届くまま残り、画面は暗転して見えなくなる | 基準: 2.4.7 フォーカスの可視
  - 一時停止・倍速・音のトグルは `pointer-events: auto` で、`inert` が付いていない。暗転の終盤にはフォーカスリングが ground に隠れる。
  - 旅の場面は A-6 へ移るのでフォーカスは h1 に移る（良い）。旅でない場面（`briefHref` なし）では、EndBanner が出てもフォーカスは移らない。
  - 衝突が決まったら、HUD の操作部（`.drive-hud` の中の EndBanner 以外）に `inert` を付ける。
  - EndBanner が出たら、その「もう一度」ボタン、または h2 にフォーカスを移す。旅でない場面は、この移動が無いとキーボード・SR 利用者が帯に気づけない。
- **W5** [drive.css:731-757] 車内スマホは 180×360 の箱を 0.42〜0.6 倍に縮めているので、compact の単位（19px 指定）は見た目で約 8〜11px になる | 基準: 1.4.4 リサイズ（ブラウザの文字拡大の対象外になる）。コントラストは問題なし
  - AlertState.md の compact は「文字は 9px」と書いてあるので仕様どおり。
  - 視覚の内容は `aria-hidden`（AlertState.tsx:101）で、同じ情報は `DangerOverlay`（赤の縁・バナー）と SR の領域にもある。単独の情報源ではないので違反ではない。
  - 数値（`num`）は大きく、形と色（円・三角・八角）で状態が分かる。1.4.1（色だけに頼らない）は満たす。
  - 拡大した利用者が読めない小ささであることは認識しておく。
- **W6** [drive.css:737-750, 762-764] `.drive-phone` が他の HUD と重なる可能性がある（未確認）
  - 幅 844×高さ 390 では、スマホは x 約 295〜379、y 約 171〜330 に入る。
  - 同じ高さの帯にステージの帯（`--drive-banner-top: 176px`）と赤のバナーがある。DOM の順は電話が先なので、帯が上に重なって電話を隠す。
  - 電話は補助の表示なので害は小さいが、重なって文字が読めなくなる組み合わせ（赤のバナーが電話の数値に被る）が無いか、実機の画面で確認を勧める。

## Info（問題なし・補足）

- **I1** [hud/CrashOverlay.tsx:12-18, drive.css:788-794] 光は 1 回だけ（300ms で 0.85 → 0、`forwards`）。3 回 / 秒の閾値（WCAG 2.3.1）を大きく下回り、1 Hz の規約も守っている。暗転はなだらかな 3.2 秒で、点滅ではない。光の色は `ink`（night で #F2F5F1）、暗転は `ground`。`alert-danger` は使っていない（規約どおり）。
- **I2** [drive.css:846-854] `prefers-reduced-motion` でフラッシュ（`display: none`）とぼかし（`animation: none`）を止めている。カメラの揺れも `DriverCamera.tsx:26-36` で reduced を渡している。暗転のなだらかな変化だけ残るのは妥当。
- **I3** [hud/CrashOverlay.tsx:15, drive.css:802-810] 読み上げ用の `<p role="alert">` は、描画と同時に中身を持って挿入されるので、多くの SR で読まれる。テキストは `hudText(lang).end.collided` で、親の `<main lang>` を継承する。視覚的な非表示は標準的な `clip` 方式で、フォーカスを受けない。操作要素が無く `pointer-events: none` で、下の鹿のタップを奪わない。
- **I4** [drive.css:781, 796-800] 強制カラー（forced-colors）では `box-shadow` のビネットが消えるので、暗転が起きない（情報は失われない。読み上げと EndBanner が代わりに伝える）。
- **I5** [hud/SpotCount.tsx:12, spot-text.ts:7-13] 件数は `<p>` で、ライブ領域にしていない。コメントのとおり意図的（走行中の割り込みを避ける）。ただし W1 と合わせて、SR 利用者は走行中に件数を知る手段が無い。色は `--ink` を継承し、night の `surface`（#1A2420、88%）上で十分な比。ラベルは 13px（`label`）で最小サイズ 12px 以上を満たす。絵文字・色だけの伝達は無い。
- **I6** [loss/spot-text.ts:9-12, drive/components/spot-text.ts:9-12] 「n / m 頭」の斜線表記は、SR だと「n スラッシュ m」と読まれる。「m 頭中 n 頭」「n of m」の形にすると聞き取りやすい。4 言語とも文言は揃っている。
- **I7** [loss/components/LossPage.tsx:124-129, record/components/RecordContent.tsx:52-57] 追加の 1 行は意味のある `<p>` で、見出し構造（h1 / h2）を壊さない。色は `loss-fact` と `record-lead` が `--ink-muted`（night #B9C6BF、trip #4A5A53。どちらも 4.5:1 以上）。`h1` へのフォーカス移動（`focusOnMount`）は変更なし。見えた鹿が 0 のときは行を出さないので、「0 / 0」の空の行は出ない。
- **I8** [DrivePage.tsx:150-158, 168] 縦向きの間は `inert` で下の画面を隠す、WebGL 非対応のメッセージは `role="alert"`。既存の良い実装で、今回の変更で退行していない。

## スコア: 82/100

減点の内訳: キーボードの代替なし -8、当たりの大きさ -3、アラートの競合 -3、HUD の `inert` とフォーカスの移動 -3、スマホの文字の小ささ -1。
