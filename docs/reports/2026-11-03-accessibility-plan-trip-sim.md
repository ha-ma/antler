# アクセシビリティチェック結果: A-1「旅をつくる」(/plan) と仮の /trip/:id/brief

- 対象: `apps/sim/src/features/plan-trip/components/*.tsx`、`plan-trip.css`、関連して `apps/sim/index.html`、`apps/sim/src/app/routes.tsx`
- 基準: WCAG 2.1 AA ＋ プロジェクト基準（4.5:1、タップ領域 44px、aria-label、キーボード、色だけで区別しない）
- 方法: ソースの読み取りのみ（ブラウザ・スクリーンリーダーでの実機確認はしていない。ソースは編集していない）
- 色はトークンの 16 進値（trip テーマ）から相対輝度で計算した。

## コントラスト実測（trip テーマ）

| 前景 / 背景                           | 比            | 使用箇所                          | 判定                 |
| ------------------------------------- | ------------- | --------------------------------- | -------------------- |
| ink #1B2A24 / ground #FBF8F1          | 約 14.1:1     | 本文                              | OK                   |
| ink-muted #4A5A53 / ground            | 約 6.9:1      | 補足・ラベル                      | OK                   |
| ink-muted / photo-placeholder #CFDCD4 | 約 5.2:1      | 写真プレースホルダ文字            | OK                   |
| **ink-faint #6B7A73 / ground**        | **約 4.25:1** | 未到達のステップ（13px）          | **NG**               |
| ink-faint / surface #FFFFFF           | 約 4.51:1     | 入力枠（非テキスト 3:1 は満たす） | OK（ぎりぎり）       |
| on-spruce #FFF / spruce #1E6F5C       | 約 6.0:1      | 主ボタン・現在のステップ          | OK                   |
| #FFF / spruce-deep #164F43            | 約 9.4:1      | ボタン hover・disabled            | OK                   |
| spruce / ground                       | 約 5.7:1      | D1〜Dn の番号                     | OK                   |
| spruce / surface                      | 約 6.0:1      | 再試行・戻るリンク                | OK                   |
| clay-deep #B34E14 / ground            | 約 4.9:1      | リスク語・エラー・skipped         | OK                   |
| clay-deep / surface                   | 約 5.2:1      | 入力エラー                        | OK                   |
| surface / ink（選択中タブ）           | 約 15:1       | タブ                              | OK                   |
| line #E6DFD0 / surface                | 約 1.33:1     | 重さの「オフ」段                  | NG（非テキスト 3:1） |
| line / ground                         | 約 1.25:1     | 未選択タブの枠、リスク帯の軌道    | 下記 Warning/Info    |
| clay #D86A2B / ground                 | 約 3.3:1      | リスク帯の塗り                    | OK（3:1。語が併記）  |
| spruce / photo-placeholder            | 約 4.3:1      | 選択バッジの円                    | OK（3:1）            |

## Critical（WCAG 違反・プロジェクト基準違反）

- [plan-trip.css:79-86] 未到達のステップ（2〜4）の文字が `--ink-faint` で、ground 上 約 4.25:1。13px の通常文字なので 4.5:1 未満 | 基準: WCAG 1.4.3 | 修正: `.plan-step` の color を `var(--ink-muted)`（約 6.9:1）にする。現在地は背景の塗りと `aria-current` で区別できているので、ink-muted でも区別は保てる。なお tokens.json の ink-faint は「12px 以上の出典・免責」用と書かれているが ground 上では 4.5:1 に届かない。トークン側の説明（surface 上でのみ可）を直すか、ink-faint を ground 上の文字に使わない規約にする（原本の Claude Design 側で直す）。
- [plan-trip.css:286 と :29-33、:296] カードの `overflow: hidden` が、カード全面を占めるトグルボタン（`.plan-card__toggle`）のフォーカスリング（outline 3px、offset 2px）を切り落とす。ボタンの縁がカードの内縁と一致するので、上・左・右はリングが見えず、キーボード利用者が「いまどのカードか」分からなくなる | 基準: WCAG 2.4.7 | 修正: `.plan-card__toggle:focus-visible { outline-offset: -3px; }` として内側に描く（photo-placeholder 上でも spruce は約 4.3:1 で 3:1 以上）。または `.plan-card:has(.plan-card__toggle:focus-visible)` に outline を付け、overflow の外側で描く。
- [plan-trip.css:389-397（幅は :392 の `width: 26px`）] 重さの段ボタンの押せる範囲が 幅 26px × 高さ 44px。コメントは「押せる範囲は 44px」とあるが、幅は満たさない。プロジェクト基準（44px 以上）に違反（WCAG 2.1 では 2.5.5 の AAA 相当）。隣の段との間隔もなく、誤タップしやすい | 基準: プロジェクト基準 44px（WCAG 2.5.5 AAA 参考） | 修正: 5 段が 44px 幅だと 220px になり、現在のカード最小幅 180px（`.plan-grid` の `minmax(180px, 1fr)`、plan-trip.css:279）に入らない。次のどちらか。(a) グリッドを `minmax(250px, 1fr)` に上げ、段を 44×44 にする（5×44＋padding 24＋枠 2＝246px）。(b) 重さを「− 値 ＋」のステッパー（44×44 のボタン 2 つ）にする。(b) は Tab 停止も減るので、下の Warning と合わせて (b) か `input type="radio"` のグループを推奨。
- [plan-trip.css:399-408] 重さの「オフ」段の色が `--line`（#E6DFD0）で、surface 上 約 1.33:1。操作部品の境界・状態が見分けられない | 基準: WCAG 1.4.11（非テキストのコントラスト 3:1） | 修正: オフ段は `border: 1px solid var(--ink-faint)`（surface 上 約 4.5:1）に透明の塗り、オン段は `spruce` の塗りにする。形（塗りあり/枠のみ）でも区別できるので、色だけに頼らなくなる。
- [apps/sim/index.html:6、apps/sim/src/app/routes.tsx:5-10] `<title>` が全ルートで「EZO ROAD」固定。`/plan` から `/trip/:id/brief` に SPA 遷移しても、タイトルも読み上げも変わらず、スクリーンリーダー利用者は画面が変わったと分からない。遷移後のフォーカスも先頭（またはボタン）に残る | 基準: WCAG 2.4.2（ページタイトル）、4.1.3 の趣旨 | 修正: 各ページで `document.title` を言語別に設定する（例: 「旅をつくる - EZO ROAD」「しおりの準備中 - EZO ROAD」。`PLAN_TEXT.heading` / `briefPending` を再利用）。`TripBriefPlaceholder` は遷移後に `<h1>` へ `tabIndex={-1}` でフォーカスを移す。言語切替でもタイトルを更新する。

## Warning（改善推奨）

- [WeightPicker.tsx:13-27、PleasureCard.tsx:38] 選択したカード 1 枚につき 5 つの Tab 停止が増える（10 件選ぶと最大 60 以上の停止）。さらに見た目は「1〜n 段がオン」なのに、`aria-pressed` は選んだ段 1 つだけが true で、見た目と読み上げが食い違う（3 を選ぶと 1〜3 が塗られるが「重さ 3」だけ押下） | 修正: `<fieldset>`＋`input type="radio"`（`<legend>` に weightOf）にすると Tab 1 停止・矢印キーで移動でき、状態も正しく伝わる。radio を visually-hidden にして段の見た目を `label` に付ける。
- [plan-trip.css:226-228、:602-604] `.plan-inputs__status`（`role="status"`）と `.plan-status`（`role="alert"`）が `:empty` のとき `display: none`。`role="status"` を display:none から表示に切り替えると、読み上げされない場合がある（ライブリージョンはアクセシビリティツリーに在る状態で中身が変わる必要がある）。`role="alert"` は表示時に読まれる実装が多いが保証されない | 修正: `display: none` をやめ、空のときは高さ 0 にする（`.plan-visually-hidden` 相当、または `min-height: 0; margin: 0`）。グリッド行の空きが気になる場合は `:empty { margin: 0; }` だけにする。
- [PleasurePicker.tsx:31-35] 上限到達のメッセージが `role="status"` ごと条件付きで描画される（出現と同時に中身がある）。読み上げられないことがある | 修正: `role="status"` の `<p>` は常に描画し、中身だけを条件で入れる。またはすでに `aria-live="polite"` のカウンター（:25）の中に入れる。
- [PleasureCard.tsx:28、plan-trip.css:309] 上限到達時の未選択カードは `disabled` で、Tab で止まらず、スクリーンリーダーの利用者はカードの存在に気づきにくく理由も分からない | 修正: `aria-disabled="true"` にして `onClick` で何もしない（フォーカスは残す）。理由は `aria-describedby` で limitReached メッセージの id に結ぶ。disabled の見た目（opacity 0.55）は残してよい。
- [PlanForm.tsx:58-66、ItineraryPanel.tsx:19] `<aside aria-labelledby="plan-itinerary-heading">` と、その中の `<section aria-labelledby="plan-itinerary-heading">` が同じ見出しを参照している。complementary と region が同名で重複し、ランドマーク一覧に「旅のしおり」が 2 回出る。主ボタンも complementary の中にあり、主操作が補足領域に入る形になっている | 修正: `aside` の `aria-labelledby` を外して `<div>`（または aside に別名）にし、ランドマークは ItineraryPanel の `section` の 1 つにする。主ボタンは `section` の外のままでよい。
- [PlanHeader.tsx:26-38] 「ステップ」を `<nav>` にしているが、リンクではなく現在地の表示。ナビゲーションのランドマークとして読み上げられ、誤解を生む | 修正: `<nav>` をやめて `<ol aria-label="…">`（`li` に `aria-current="step"` は維持）。
- [ItineraryPanel.tsx（全体）、AllocationBar.tsx、RiskBand.tsx] 入力や楽しみの選択でしおり・リスク語・タイトル・予算が変わるが、変更が読み上げられない | 基準: WCAG 4.1.3（ステータスメッセージ） | 修正: 画面外に `role="status"` を 1 つ置き、変更後の要約（「2泊3日、リスク: 注意」程度）を入れる。入力のたびに全文を読ませないよう、`aria-atomic` とデバウンスを使う。
- [AllocationBar.tsx:31-37、plan-trip.css:479-481] 入りきらない楽しみを凡例で `line-through` だけで示している。取り消し線は読み上げられず、見た目だけの情報 | 基準: WCAG 1.3.1 / 1.4.1 | 修正: 末尾に visually-hidden の「（入りきらない）」を足す。または `<s>` を使い、さらに文言を足す。下の「入りきらない」リストと重複するので、凡例側は文言で足りる。
- [PlanForm.tsx:60-66] 送信中に主ボタンが `disabled` になり、文言が「しおりを仕上げています…」に変わる。フォーカス中のボタンを disabled にするとフォーカスが失われる/読み上げられないことがある。送信開始のアナウンスも無い | 修正: `disabled` の代わりに `aria-disabled="true"`＋`aria-busy`（`onClick`/`onSubmit` 側で二重送信を止める。すでに `createTrip.isPending` で止めている）。送信中の文言は `role="status"` 側にも入れる。
- [LangSelect.tsx:28] 言語 `select` の `onChange` で画面全体の言語が即切り替わる。一部のブラウザでは矢印キーで選択肢を動かすたびに `change` が発火し、画面が次々と変わる | 基準: WCAG 3.2.2（入力時） | 修正: 切替の動作が起きることを `label` 付近に書くか、`Enter`/`blur` で確定する。キーボード操作で意図しない切替が起きないかを実機で確認する。
- [PleasureCard.tsx:24-37] トグルのアクセシブルネームが「名前＋メモ（note）」の連結で長くなる（例: メモが 2 文だとカードごとに読み上げが長い）。写真プレースホルダ（「写真: ○○」）は aria-hidden で読まれないのは妥当 | 修正: メモを `aria-describedby` に回し、ネームは楽しみの名前だけにする。
- [plan-trip.css:318-326] 写真エリアが `height: 104px` 固定で、`overflow: hidden` のカードの中にある。テキストだけ 200% に拡大すると、プレースホルダ文字（キャプション 12px→24px、複数行）が枠をはみ出して名前に重なる可能性がある | 基準: WCAG 1.4.4 | 修正: `height` を `min-height: 104px` にする。
- [TripInputFields.tsx:28-43] 必須の表示（`required` / 「必須」）がない。8 欄とも必須だが、利用者に伝わらない | 基準: WCAG 3.3.2 | 修正: 全欄が必須なら、リードに「すべて必須」と書く。または各 input に `required`（`noValidate` なのでブラウザの検証は出ない）。
- [TripInputFields.tsx:36-40] 入力エラーは `aria-describedby` で結ばれていて良いが、エラー `<p>` はライブでない。入力の途中で出現しても読み上げられない。送信時に最初のエラー欄へフォーカスが移ることを確かめること（RHF の `shouldFocusError` は resolver のエラーに対して働くが、`problems` は `useTripPreview` 由来で別経路のため、一致するかは未確認） | 修正: 送信失敗時の動作を実機で確認する。必要なら `setFocus` で最初の `aria-invalid` 欄に移す。

## Info（自動チェックで見えにくいもの・補足）

- [plan-trip.css:245-256] 未選択タブの枠が `--line`（ground 上 約 1.25:1）。タブ名の文字は十分なコントラストで、選択中は塗りで区別できるので違反とは言い切れないが、境界が分かりにくい。枠を `--ink-faint` にすると改善する。
- [plan-trip.css:549-554、:463-466] リスク帯の塗り（clay）と軌道（line）の差は 約 2.75:1、配分バーの後ろの段は opacity 0.35 まで薄くなる。いずれも `aria-hidden` で、語・凡例に同じ情報があるので OK。装飾として扱う判断を保つこと。
- [AreaTabs.tsx:18-27] 矢印キー移動は実装済み（roving tabindex、`aria-selected`、`aria-controls`）。Home/End は未対応。ARIA Authoring Practices では任意だが入れると親切。
- [PleasureCard.tsx:31-33、SelectBadge.tsx] 選択状態は `aria-pressed`、枠の色、バッジの形（＋ / チェック）の 3 つで伝わり、色だけに頼っていない。良い。
- [PlanPage.tsx:24、LangSelect.tsx:33、TripBriefPlaceholder.tsx:26] `lang` の切替（zh は zh-Hant、選択肢ごとの `lang`）は適切。`<html lang="ja">` 固定のまま内側で上書きする形で、読み上げの音声切替には有効。
- [ItineraryPanel.tsx:37-40] 「D1」を aria-hidden にして「1日目」を visually-hidden で読ませているのは良い。`→`、`・`、`／` は読み上げで「矢印」「中黒」などと読まれる実装があるので、気になる場合は区切りをリスト構造（`ul`）にする。
- [TripBriefPlaceholder.tsx] `<main>`、`<h1>`、リンクは問題なし（リンクは 44px、文字は spruce / surface で約 6.0:1）。`id` の値の表示は ink-muted 12px で OK。
- フォーカス: `.plan :focus-visible` の spruce 3px outline は ground 上で約 5.7:1 あり、カード以外では見える。`prefers-reduced-motion` に関わるアニメーションは無い（点滅・自動更新も無し）。
- 時間制限・タイムアウトは無い。リフロー（320px）は `.plan-aside` の `min-width` が 640px 以下で 0 になり、横スクロールは出ない見込み（実機未確認）。
- 実機確認が必要: VoiceOver で、タブ切替時のカウンター読み上げ、重さ変更、送信失敗のアラート、言語切替後の読み上げ。

## スコア: 68/100

内訳: 構造（ラベル、fieldset、tablist、aria-pressed、lang）は良好。減点は、コントラスト 1 件、フォーカス表示 1 件、タップ領域と非テキストコントラストの重さ段 2 件、ページタイトル 1 件、動的更新の通知不足。
