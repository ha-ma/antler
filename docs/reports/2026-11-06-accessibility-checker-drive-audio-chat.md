# アクセシビリティチェック結果: drive-audio-chat（R13 ChatFeed / R14 AudioControls）

対象（コミット 0cc1a61）: `apps/sim/src/features/drive/chat/{ChatFeed.tsx,chat-feed.css,chat-text.ts}`、`apps/sim/src/features/drive/audio/{AudioControls.tsx,audio-controls.css,audio-text.ts}`
仕様: `docs/specs/drive-audio-chat/functional.md` R13・R14。基準は WCAG 2.1 AA。コードは直していない。
運転画面（night テーマ）への組み込みは別 PR のため、位置・背景・重なり順が絡む項目は「組み込み時に確認」と書いた。コントラストの数値は CSS 変数の値からの手計算で、背景（3D シーン）は推定を含む。

## Critical（WCAG 違反）

- [C1] 矢印キーでスライダーを操作できない（組み込み時に発生）
  - 場所: `apps/sim/src/features/drive/hooks/use-keyboard-drive.ts:26-31`（既存コード。R14 の部品と合わさって問題になる）
  - 内容: window の keydown が `ArrowUp/Down/Left/Right` を運転入力にして `e.preventDefault()` する。例外は「Space で target がボタン」だけ。キーボードで Tab してスライダー（`input type=range`）に来ても、矢印は運転に取られて音量が変わらない。`AudioControls.tsx:61` のコメント「そのあとの矢印キーをハンドルにする」は、マウス操作後に blur する前提だが、キーボード利用者の導線が残っていない。
  - 基準: WCAG 2.1.1 キーボード
  - 修正: `apply` の先頭で `e.target instanceof HTMLInputElement`（type=range）のときは矢印を素通しにする。そうすると、キーボードでスライダーにいる間は矢印で車が動かない。Tab で外せば戻ることを HUD のキー表に書く。または音量用に別のキー（例: `[` `]`）を足す。どちらにしても組み込み PR の前に決めること。

- [C2] 読み上げの言語が付いていない（旅の言語が html の `lang="ja"` と違うと別の声で読まれる）
  - 場所: `ChatFeed.tsx:22,25,32-34`、`AudioControls.tsx:70,90`（`apps/sim/index.html:2` は `lang="ja"`）
  - 内容: 一言の見える側（`.drive-chat__text`）だけに `lang` がある。読み上げの本命である見えない `aria-live` の `<p>`、話し手の名前、`role=log` の `aria-label`、AudioControls の `aria-label` 群には `lang` が無い。en/zh/ko の旅では、日本語の声で英語・繁体字・韓国語を読んでしまう。AlertState は読み上げの `<p>` に `lang={lang}` を付けており（`AlertState.tsx:91,94`）、それと揃っていない。
  - 基準: WCAG 3.1.2 部分の言語
  - 修正: `.drive-chat` のルートの `<div>` と `.drive-audio` の `<div>` に `lang={lang === 'zh' ? 'zh-TW' : lang}` を付ける（子はすべて継承する）。個別の `lang` は不要になる。変換は `ChatFeed` 内の関数に 1 つにまとめ、AudioControls と共有する。

## Warning（改善推奨）

- [W1] `ol` に `role="log"`（`ChatFeed.tsx:22`）
  - HTML の仕様上 `ol` に `log` は付けられない（`aria-allowed-role`）。`li` が list の中でなくなり、スクリーンリーダーは「リスト n 件」を失う（axe の `listitem` にも当たる）。
  - 修正: `<div role="log" aria-live="off" aria-label=...>` の中に `<ol>` を置く。`aria-live="polite"` の領域は今のまま別にする。

- [W2] 赤の間の減光（不透明度 60%）で 4.5:1 を割る可能性（`chat-feed.css:13-15`）
  - 通常時は十分（night の `ink` on `surface` 約 14:1、`ink-muted` on `surface` 約 9:1）。60% にすると文字も面も背景（3D シーン、赤の `DangerOverlay`）と混ざる。赤い背景の上で `ink-muted` の話し手の名前（12px）は約 4.4:1 で境界、雪の白い景色の上では 2:1 台まで落ちうる（推定）。仕様は「減光は装飾で、赤の間は新しい行を出さない」だが、すでに出ている行は読める必要がある。
  - 修正: 不透明度ではなく、背景の `surface` の濃さ（アルファ）を落として文字は不透明のままにする。または減光を 80% 程度にして、組み込み後に赤・白い景色の両方で測る。

- [W3] 「押されている」が色だけ（ラジオのボタン、`audio-controls.css:33-37`）
  - 消音のボタンはアイコンが変わる（斜線）が、ラジオは押下時に背景色が変わるだけ。`aria-pressed` はスクリーンリーダー向けで、見える側に色以外の手がかりが無い。
  - 基準: WCAG 1.4.1 色の使用（境界。明度差は大きく 1.4.11 は満たす）
  - 修正: 押下時にチェックのインライン SVG を足す、または OFF のとき斜線を重ねる。

- [W4] 200% 拡大での配置（`chat-feed.css:8`）
  - 幅は `min(320px, 32vw)`。1280px 幅で 200% にすると約 205px になり、4 行が折り返して縦に伸びる。`overflow` の指定が無く、組み込み側が高さを固定すると切れる。
  - 基準: WCAG 1.4.4 / 1.4.10
  - 修正: 組み込み時に 200% 拡大で 4 行が画面内に収まることを確認する。`max-height` を決めるなら `overflow: hidden` で古い行を切る（新しい行を残す）。

- [W5] 同じ内容が続くと読み上げられない可能性（`ChatFeed.tsx:33`）
  - 反応の表は 2 行を交互に使うので通常は起きないが、`aria-atomic` の文字列が前と同じなら再読み上げされない。`restart` では `latest` が null → 新しい行となり読まれる。
  - 修正: 必要になったら行の `key` を `<p>` の `key` にして作り直す。今は Info 相当。

## Info

- 良い点（変更不要）: 点滅なし（1 Hz の規約に該当する動きは無い）。登場の動きは 0.2 秒の一度きりで、`prefers-reduced-motion` で `animation` と `transition` が止まる。ChatFeed にフォーカス可能な要素が無く、`pointer-events: none`。`aria-live="polite"` は常時マウントされ、AlertState の `role="alert"`（assertive）に割り込まない。絵文字なし。アイコンは `aria-hidden` のインライン SVG。
- 44px: ボタンは `min-width/min-height: 44px`、スライダーは高さ 44px・幅 112px。OK。
- コントラスト（night）: `on-spruce` on `spruce` 約 6.4:1、フォーカスの輪郭 `spruce` on `surface` 約 5.5:1。OK。無効時のスライダーは WCAG の対象外。
- スライダー: `aria-label`、`aria-valuetext`（「50%」）、`min/max/step`、消音時 `disabled`。OK。消音中は Tab で止まらなくなるので、音量が見えるのは目だけになる点は了解しておく。
- 消音ボタンはラベルが固定で `aria-pressed` が状態を持つ。この形で正しい（ラベルを「解除」に切り替えないこと）。
- 4 言語: zh は繁体字で統一されている（簡体字の混入なし）。話し手・グループ名・スライダー名とも 4 言語がそろっている。
- アイコンのみの消音ボタンには見える文字・`title` が無い。視覚の利用者向けにツールチップを検討（必須ではない）。
- マウスで押したあとの blur は意図どおり（`releaseFocusAfterPointer` はキーボード操作時 `detail===0` で残る）。スクリーンリーダーの「クリック」は `detail>0` で来ることがあり、フォーカスが外れる場合がある。実機（VoiceOver / NVDA）で確認。
- 読み上げ文字列の `: `（半角コロン）は、日本語・中国語・韓国語の一部の読み上げで「コロン」と読まれる。言語ごとに句読点を変えるか、話し手を別の要素にして区切る。
- `chat-text.ts` の「前をよく見ていこう」「Eyes on the road」は、ヘッダの「運転の指図をしない」にやや近い。内容は a11y の範囲外なので判断は任せる。
- 自動検査で見えないもの: 読み上げの順序（組み込み後に、赤の警告の直後に会話が読まれないか）、VoiceOver / TalkBack の実機確認。

### スコア: 78/100

（C1 が組み込みの前に直ればほぼ 90 台。C2 は 1 行ずつで直る）
