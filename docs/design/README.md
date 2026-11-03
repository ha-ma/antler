> - デザインシステム（tokens.json・本 README・AlertState.md の出典）: https://claude.ai/artifact/Bhv9ssR8hr3i8DUkZTT7Qw
> - **UI キャンバス v2（画面の正）: https://claude.ai/artifact/92Ho3c3gpV3CdNwmLvUS5F**
> - 画面名 A-1〜A-7 / B-0〜B-3 は要件 ID（docs/requirements/ch3-sim.md・ch4-edge.md）と対応する。アートボード名は下の「対応表」。
> - 本文は Claude Design からの写し（2026-11-03）。パッケージ名 `@ezoroad/alert-ui` は本リポジトリでは `@antler/alert-ui`。

# EZO ROAD Design System

EZO ROAD は、北海道をレンタカーで旅する人が鹿との衝突で旅を失わないためのプロダクト群です。A（運転前の 3D シミュレーション）と B（運転中の車載検知アラート）が、同じ色・形・音で「鹿ゾーン」と「鹿」を伝えます。このデザインシステムは Claude Design キャンバス「北海道ドライブSim UI設計」v2 ページの画面から抽出したものです。

## 原則

1. **守る旅が主役、鹿は脅威。** 旅Sim の画面は生成り（`ground` trip）に深い緑（`spruce`）。鹿ゾーンに入ると画面は夜道の黒（`ground` night）に変わり、HUD だけが残る。モードの切替は配色の切替で分かる。
2. **3状態は色＋形＋明度。** 緑＝円、琥珀＝三角、赤＝八角。色だけで区別させない。赤は `alert-danger` 以外の用途に使わない（注意やリスクの金額は `clay`）。
3. **運転中は読まない。** B のスマホ画面は、巨大な数字（`num-hero`）、ピクトグラム、4 言語の一語。走行中に押すボタンは置かない。
4. **数字はモノスペース。** 距離・時刻・金額・スコアは `IBM Plex Mono`（`num-*`）。文章は `Noto Sans JP`。
5. **失うものを具体的に。** 喪失画面は取り消し線と実数（出典付き）で見せる。装飾のグラデーションや左ボーダーカードは使わない。

## 色

- 2 テーマ：`trip`（A-1, A-2, A-4, A-6 の一部, A-7）と `night`（A-5, A-6, B-0〜B-3）。A-3 の昼走行は 3D シーンが背景なので HUD は `rgba(27,42,36,0.88)` の暗帯に `ink` night を載せる。
- `spruce` は trip で #1E6F5C、night で #3FA98C に明度を上げる。文字コントラストはどちらも 4.5:1 以上。
- `alert-*` の 3 色はテーマで変えない。A の車内スマホと B の PWA で同一。
- 地図の鹿多発区間は `alert-zone` を不透明度 45%、幅 22px の帯でルートに重ねる。

## 文字

- 見出しは `display-*`（900 ウェイト）。短く、1〜2 行。
- 本文 `body` 14/24。補足 `caption` 12/18 は `ink-muted` 以上の濃さで。
- 数値は必ず `num-*`。単位は数値の 40% のサイズで後置（`58 m`、`38 km`）。

## コンポーネント

| 名前 | 使う場所 | 要点 |
| --- | --- | --- |
| AlertState | A 車内スマホ、B PWA | 3状態（safe / zone / danger）。全面色、形、数値、一語。`components/AlertState/` |
| ItineraryStrip | A-3〜A-5 の HUD 上部 | 旅のしおりの D1〜Dn をチップで。達成 ✓ は `spruce` 25%、現在は `spruce` 塗り、未達は 1px 枠 |
| PleasureCard | A-1 | 写真＋名称＋補足。選択で `spruce` 2px 枠と ✓、重さ 1〜5 の 5 段バー |
| ChoiceButton | A-4 | 左寄せ、太字タイトル＋ `clay-deep` の帯で「鹿ゾーンをいつ通るか」 |
| StatTile | A-6, A-7, B 結果 | `surface` + `line`、ラベル `caption` → 値 `num-l` |
| ZoneBadge | A-3, A-5 HUD 左上 | 状態色の丸/三角＋2 行テキスト |
| LossCard | A-6 | しおりに取り消し線、衝突地点を ✕ `alert-danger` で挿入、−1.5° 回転 |

コンポーネントの実装は React（`@ezoroad/alert-ui` パッケージ）。各コンポーネントは `tokens.css` の CSS 変数のみを参照し、色の直書きをしない。

## 音（トークン外だが共通資産）

- `chime.wav`：2 音、0.6 秒。ゾーン進入。
- `beep.wav`：1 kHz 系、0.12〜0.4 秒間隔で繰り返し。距離が近いほど速い。
- `tts_deer_ahead_{ja,en,zh,ko}.mp3`：「前方に鹿がいます」。

## 対応表（Claude Design キャンバス → 実装）

| アートボード | ルート/画面 | 主なコンポーネント |
| --- | --- | --- |
| A1_Plan | `/plan` | PleasureCard, ItineraryStrip（右パネル） |
| A2_Brief | `/brief` | ZoneMap, AlertToggle, AlertState（凡例） |
| A3_Drive / A3_L | `/drive` | HUD（ItineraryStrip, ZoneBadge, NextPleasureCard, Controls）, AlertState（車内スマホ） |
| A4_Stop / A4_L | `/drive`（モーダル） | EventModal, ChoiceButton |
| A5_Alert / A5_L | `/drive`（状態） | AlertBanner, AlertState(danger) |
| A6_Loss | `/loss/:id` | LossCard, StatTile, 統計カード |
| A7_Record | `/t/:id` | StatTile, しおり, B 導線 |
| B4_Connect | `/b/connect` | 接続ステップ, 3 表示プレビュー |
| B1_Safe / B2_Zone / B3_Alert | `/b/drive` | AlertState（全画面） |
