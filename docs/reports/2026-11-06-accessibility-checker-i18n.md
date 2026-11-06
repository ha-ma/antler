# アクセシビリティチェック: i18n（e4b3d4a）

対象: docs/specs/i18n/functional.md R5〜R7 と非機能要件「`lang` 属性は表示の言語と同じ（zh は `zh-Hant`）」。
方法: コードの読解のみ（ブラウザ・スクリーンリーダーでは未確認）。コードは直していない。
パスはすべて `apps/sim/src/features/drive/` からの相対（特記を除く）。

## Critical（WCAG 違反）

### C-1: 運転画面の本体（HUD・出発の案内・WebGL 非対応）に `lang` が無い。HUD を 4 言語にした効果がスクリーンリーダーと字形に届かない

- `components/DrivePage.tsx:124`（WebGL 非対応）と `:133`（本体の `<main className="drive">`）に `lang` が無い。`apps/sim/index.html:2` は `<html lang="ja">` 固定で、`document.documentElement.lang` を書き換えるコードは `apps` 配下に無い（grep で 0 件）。
- 影響する範囲: StartOverlay、ZoneStatusPanel、RoutePanel、TopBar、BottomBar、StageBanner、EndBanner、DangerOverlay。en・zh・ko の旅では、これらすべてが ja の声で読まれる。
  - `ChatFeed`・`RecommendCard`・`AudioControls`・`PhoneScreen` だけが自分で `lang` を持つ。
  - 同じ画面の中で `lang` が持ち主ごとに違う状態になっている。
- zh では字形も壊れる。`lang` が無いと、漢字が日本の字形（Noto Sans JP / Hiragino Sans）で描かれる。繁体字の文が日本字形になる。
- 基準: WCAG 3.1.1（ページの言語）、3.1.2（一部分の言語）。仕様の非機能要件「`lang` は表示の言語と同じ」にも反する。
- 直し方:
  - `DrivePage` の 2 つの `<main>` に `lang={htmlLang(snapshot.lang)}` を付ける。
  - `htmlLang` は 1 か所に集める（下の W-1）。
  - `DriveScreen.test.tsx:170` は `TripMessage` の `main` しか見ていない。`DrivePage` の `main` が `lang` を持つテストを足す。zh で `zh-Hant`、ko・en でそのまま、を確かめる。

## Warning（改善推奨）

### W-1: `htmlLang` が 5 か所に写してあり、値が 2 通りある。zh が `zh-TW` のものは仕様（`zh-Hant`）と違う

- `zh-Hant`: `apps/sim/src/app/AppErrorBoundary.tsx:8`、`apps/pwa/src/app/AppErrorBoundary.tsx:7`、`features/loss/components/LossPage.tsx:29`、`features/record/.../RecordContent.tsx:20`、`RecordPage.tsx:14`、`BriefPage.tsx:20`、`stop-events/utils/format.ts:32`、`plan-trip/utils/lang.ts:4`
- `zh-TW`: `chat/ChatFeed.tsx:23`、`audio/AudioControls.tsx:78`（インラインで `lang === 'zh' ? 'zh-TW' : lang`）。`DriveScreen.tsx:6` の `TripMessage` と `RecommendCard.tsx:4` は ChatFeed の `htmlLang` を借りているので `zh-TW`。
- 同じ画面に `zh-TW` と `zh-Hant` が混ざる。テストで固定された値を足並みそろえて変える必要がある。
- 直し方: `@antler/schema` か `@antler/trip` に `htmlLang(lang)` を 1 つ置いて全部そこから使う。または `shared/utils/` に置く。値は `zh-Hant`。feature 間の import は barrel 経由なので、置き場所は shared が早い。

### W-2: `<html lang>` が `ja` 固定。ページの `<title>` も ja の声で読まれる

- `apps/sim/index.html:2`、`apps/pwa/index.html:2`。ルートごとの `lang` は `<main>` や `<div>` に付けているだけ。
- A-6 の `<title>`（`LossPage.tsx:45,80,113`）は `<head>` に移るので、中身が en・zh・ko でも ja として読まれる。`document.title` は `lang` を持てない。
- 直し方: 旅の言語が決まった時点で `document.documentElement.lang` を `htmlLang(lang)` に揃える。
  - ref のコールバックか、ルートのレイアウトで行う。
  - `useEffect` は規約上避ける。
- この commit だけの問題ではない（既存）。ただ、spec が「`lang` は表示の言語と同じ」と言っているので記録する。

### W-3: `TripMessage` が `aria-busy` と `role=status` を同じ領域に置いている。読み込み中が読まれないことがある

- `DriveScreen.tsx:124-126`: `<section aria-busy={busy}>` の中に `<p role="status">`。
- `aria-busy="true"` の領域の更新は、スクリーンリーダーが読み上げを保留する。読み込み中の文そのものが読まれないことがある。
- 直し方: `aria-busy` を外す（文が出ているので不要）。

### W-4: 読み込み中（`status`）から失敗（`alert`）に切り替わるとき、同じ `<p>` の `role` と文が同時に変わる

- `DriveScreen.tsx:125`: `role={busy ? 'status' : 'alert'}`。`TripMessage` は同じ位置のまま props が変わるので、React は同じ DOM を使い回す。
- 既存の要素の `role` を後から変えても、`alert` として通知されないスクリーンリーダーが多い。失敗が無言になりうる。
- 直し方: `key={busy ? 'busy' : 'error'}` を付けて要素ごと作り直す。または `status` の領域は残して、文だけ入れ替える。
- A-6 の読み込み前（`LossPage.tsx:46`）は、読み込み中の `<p role="status">` が最初の描画のときから DOM にある。後から文が入る形ではないので、一部のスクリーンリーダーは読まない。失敗側は `<h1>` に `focus()`（`LossStatus`）で補えている。読み込み中は Info 扱い。

### W-5: 切り替えボタンの名前が状態で変わるのに `aria-pressed` も付いている

- `hud/BottomBar.tsx:34,40`: 「音 ON / 音 OFF」＋ `aria-pressed={soundOn}`。「Sound OFF, toggle button, pressed」と読まれ、押されているのか OFF なのか分からない。
- `hud/TopBar.tsx:51,57`: 「一時停止 / 再開」＋ `aria-pressed={paused}`。「Resume, pressed」と読まれる。
- 4 言語では逆の取り違えが増える（ko「소리 ON」＋ pressed）。
- 直し方（どちらか 1 つ）:
  - 名前を固定して `aria-pressed` で状態を出す。表に `sound.label` はすでにあるが、どこからも使われていない（`hud-text.ts:15`）。
  - または `aria-pressed` を外して、ラベルの切り替えだけにする。
- 4 言語の表を足す機会なので、この commit で直すのが安い。

### W-6: HUD の幅の持ち方は CSS の持ち主へ（指摘のみ。直さない）

- 文言の長さ: ko・zh は en より短いか同じ。最長は en。
  - `alertOn`（en）で約 90 字。`.drive-start` は 560px の枠で折り返すので問題なし。
  - ボタンの文言（`go`・`retry`・`pause`・`resume`・`sound.on/off`）は短い。
- タップ領域: `.drive-hud__button`（`drive.css:174-176`）と `.drive-start__link`（`:412`）と季節のリンク（`:431`）は `min-height: 44px`。`.drive-hud__primary` は 48px。ko・zh でも崩れない。
- 気になる点（配置）:
  - `drive.css:112` と `:368` の `white-space: nowrap`（`.drive-hud__stage` 系と `.drive-hud__banner`）。狭い画面で、危険のバナー（`ALERT_TEXT.danger.headline` ＋ 左右 ＋ 距離 ＋ action）が画面の外にはみ出す恐れがある。ko は「왼쪽/오른쪽」が長め。
  - `.drive-hud__playback`（`:149-159`）は `flex-wrap` が無い。6 ボタン＋「一時停止」＋ `locked` の注（en で `1× only inside deer zones`）が横一列で、狭い画面で溢れる。
- 直し方（CSS 担当へ）: `flex-wrap: wrap` と `max-width: calc(100% - …)`、バナーは `white-space: normal` ＋ `text-wrap: balance`。
- 12px（`caption`）の ko・zh のハングル・繁体字は、フォントが Noto Sans JP の指定だけで、ハングルは OS の代替フォントになる（tokens.json の `sans`）。読みやすさは 13px（`label`）以上が無難だが、tokens の範囲なので推奨のみ。

## OK（確認できたもの）

- **エラー画面（R6、sim・pwa）**: `role="alert"` の `<div>` の中に 4 言語の `<p lang=…>`。`htmlLang` で zh は `zh-Hant`。主の行はブラウザの言語（sim は `browserLang`、pwa は `resolveLang`）。残りは ja・en・zh・ko の順。仕様どおり。
- **TripMessage の `lang`**: `DriveScreen.tsx:123` の `<main>` に付く。値は `zh-TW`（W-1）。読み込み前はブラウザの言語、読めたら旅の言語（`:70`）で、切り替わる。
- **LossPage（R5・LOSS-1）**: 読み込み前・失敗の `<main>` はすべて `lang={htmlLang(fallback または lang)}`（`:44,79,112`）。zh は `zh-Hant`。`plan.lang` が分かった後の `unreadable` は `plan.lang`（`:61`）。
- **TopBar の `aria-label`（R7）**: 再生速度のグループは `p.label`、条件の一覧は `hud.conditions`（`:31,65`）。どちらも `snapshot.lang` で切り替わる。4 言語とも空でない。zh は「路況條件」。
- **DangerOverlay**: `aria-hidden` で、読み上げは車内スマホの AlertState に任せる。二重に読まれない。

## Info

- I-1: エラー画面は `<main>`・見出しが無い。ルートごと置き換わるので、ランドマークも見出しも無い。`role="alert"` の 4 行が順に読まれるのは意図どおり。余裕があれば `<main>` で包む。再読み込みのボタンは無い（「読み込み直してください」とだけ）。ブラウザの操作に頼る形。
- I-2: 文言に内部の画面 ID が出る（`旅をつくる（A-1）へ`、`喪失の画面（A-6）`、`旅の記録（A-7）`。`hud-text.ts:34,82-84`）。利用者には意味が無い。4 言語に増えたので、利用者向けの文からは外すのが自然。
- I-3: `playback.locked` のときの `disabled` のボタン（`TopBar.tsx:38-39`）に `aria-describedby` を付けているが、`disabled` はキーボードで届かないので、説明は届かない。注は画面にも出ているので許容。
- I-4: `formatJstDate` は「M/D」（`domain/clock.ts:16`）。言語に依存しないので 4 言語で矛盾はしない。
- I-5: 変更は ko・zh のネイティブ確認待ち（Deferred。`2026-11-06-i18n-native-check.md`）。読み上げ（AlertState）の文は今回の範囲外。

## スコア: 72/100

- 文言の表・エラー画面・LossPage・TripMessage の `lang` と TopBar の `aria-label` は仕様どおり。
- 減点は C-1（本体の `lang` 欠落）、W-1（`zh-TW` と `zh-Hant`）、W-2〜W-5。
