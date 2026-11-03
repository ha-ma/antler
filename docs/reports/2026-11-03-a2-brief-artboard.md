# A-2 出発前ブリーフィング アートボード記述

出典: UI キャンバス v2（artifact 92Ho3c3gpV3CdNwmLvUS5F）の `project/A2_Brief.dc.html`。
canvas.json の board: `A2_Brief.dc.html`、x=1520 y=0 w=1440 h=900、`expand: "fill"`（PAGE。固定幅ではなく流体）、page=v2。
タイトル: 「A-2 出発前ブリーフィング（鹿ゾーン・アラート設定）」。`$preview` 1440x900。

注意: 実装前提の差異（先に読む）

- 凡例の赤の八角は `#E2492C`（旧色）で描かれている。tokens.json の正は `#D83B1E`（alert-danger）。実装は必ず token を使う。
- 色は全て hex 直書き（アートボードの都合）。実装では tokens.json から生成した CSS 変数に置き換える。
- 「日没バンド」「タイムライン」という独立コンポーネントは無い。日没・薄暮は (1) 見出し下の説明文、(2) 地図左下の凡例チップ、の 2 か所だけ。
- 地図は静的 SVG（実地図ではない）。ルートの形は仮。
- 4 言語切替の UI は無い（ヘッダに「日本語」の文字のみ）。

## 1. 全体レイアウト

ページ全体: `min-height:100vh`、背景 `#FBF8F1`（ground trip）、文字 `#1B2A24`（ink）、`Noto Sans JP`、縦 flex（ヘッダ + main）。

- ヘッダ: flex wrap、gap 24px、padding 14px 40px、下線 1px `#E6DFD0`（line）
- main: flex wrap、gap 40px、padding 36px 40px、max-width 1360px、中央寄せ
  - 左カラム `section`: `flex: 999 1 600px`（min-width 0）、縦 flex gap 16px。見出し + 地図
  - 右カラム `aside`: `flex: 1 1 360px`、max-width 420px、縦 flex gap 16px。3 カード/ボタン
- 1440 幅では左約 880px / 右 420px 程度。右カラムが 360px 未満になる幅（約 1000px 以下）で wrap して縦積み。

## 2. ヘッダ（ステッパー）

- 左: ロゴ SVG 28x28（三角 stroke `#1E6F5C` 2.5 + 内側の三角 stroke `#D86A2B` 2.5）+ 「EZO ROAD」（700、18px、letter-spacing .04em）
- 中央（margin 0 auto の `ol`、13px、gap 6px）。各 li は padding 6px 12px、番号は IBM Plex Mono:
  1. 「✓ 旅をつくる」 完了。色 `#1E6F5C` 700、背景なし
  2. 「2 出発前チェック」 現在。pill（999px）背景 `#1E6F5C`、文字 `#FFFFFF`、700
  3. 「3 ドライブ」 未到達。色 `#6B7A73`（ink-faint）
  4. 「4 旅の記録」 未到達。色 `#6B7A73`
- 右: 「日本語」 13px `#6B7A73`

## 3. 左カラム

### 見出し部（縦 gap 6px）

- h1: 「今日のルートと、鹿の多い区間」 28px / 900 / line-height 1.3
- 説明: 「DAY 2 ・ 釧路 → 鶴居 → 阿寒湖　142 km ・ 日没 16:38。実際の事故データから、鹿が出やすい区間を琥珀色で示しています。」 14px、`#4A5A53`（ink-muted）、line-height 1.7

### 地図エリア

- コンテナ: `position:relative; flex:1; min-height:440px; border-radius:18px(radius-xl); background:#EEF0EA(surface-sunken/map-land); border 1px #E6DFD0; overflow:hidden`
- 中身は絶対配置の SVG: `viewBox="0 0 820 480" preserveAspectRatio="xMidYMid slice"`、幅高さ 100%、`role="img"`
  - aria-label: 「釧路から阿寒湖までのルート地図。阿寒横断道路の区間が鹿多発ゾーンとして琥珀色で強調されている」
- SVG レイヤ（下から）:
  1. 背景 rect `#EEF0EA`
  2. 海: `M0 400 Q150 360 300 410 T820 390 L820 480 L0 480 Z` fill `#D5E3F2`（token map-water は `#CFE0F2`。近似値）
  3. 陸の塊 2 つ（ellipse cx520 cy130 rx150 ry90 / cx700 cy220 rx90 ry60）fill `#DCE4D9`
  4. 道路の白縁: `M90 420 L250 300 L380 250 L500 230 L640 150` stroke `#FFFFFF` 7、round
  5. 鹿ゾーン帯: `M380 250 L500 230 L640 150` stroke `#E8A64A`（alert-zone）幅 22、opacity 0.45、round（token 規約の「多発区間の帯は不透明度 45%」と一致）
  6. ルート（ゾーン外）: `M90 420 L250 300 L380 250` stroke `#1E6F5C` 幅 5、実線
  7. ルート（ゾーン内）: `M380 250 L500 230 L640 150` stroke `#1E6F5C` 幅 5、`stroke-dasharray="10 9"`（破線。色だけに頼らない区別）
  8. 出発点: circle (90,420) r9 白塗り stroke `#1B2A24` 3 + 文字「釧路　10:00 出発」(x108 y426、14px、700)
  9. 経由点: circle (250,300) r8 fill `#1E6F5C` + 文字「鶴居村　タンチョウ」(x266 y296、13px)
  10. 到着点: circle (640,150) r9 白塗り stroke `#1B2A24` 3 + 文字「阿寒湖温泉　宿」(x560 y132、14px、700)
  11. ゾーンラベル: `translate(500 290)` の rect x-96 y-18 w192 h36 rx18 fill `#B34E14`（clay-deep）+ 白文字 13px 700 中央「鹿ゾーン 38 km ・ 薄暮に通過」
  12. 到着予定: `translate(560 320)` の rect x-64 w128 h26 rx13 fill `#FFFFFF` stroke `#E6DFD0` + 文字 12px `#4A5A53`「到着予定 16:50」
- SVG 内の文字は `font-family: Noto Sans JP`。
- 凡例チップ（地図左下、`left:16 bottom:16`、flex gap 8 wrap）。各チップ: 白背景、1px `#E6DFD0`、radius 8px、padding 6px 10px、12px:
  - 緑の 10x10 角丸 2px 四角 `#1E6F5C` +「ルート」
  - 琥珀の 10x10 四角 `#E8A64A` +「鹿多発ゾーン（道警 事故データ）」
  - 「日没 16:38 ・ 薄暮 16:20–17:10」（アイコン無し。これが日没/薄暮の帯の実体）

## 4. 右カラム（aside、max-width 420px）

### 4-1 鹿アラートカード（暗色）

- 背景 `#1B2A24`（ink を面に流用）、文字 `#F2F5F1`、radius 18px、padding 22px、縦 gap 16px
- 上段（flex space-between、gap 12px）:
  - h2 「鹿アラート（ダッシュボードのスマホ）」 17px / 700
  - 補足 12px `#B9C6BF` line-height 1.6: 「車内のスマホが、カメラで前方の鹿を検知して鳴ります。実車用システムと同じ表示です。」
  - トグル `<button role="switch" aria-checked="true" aria-label="鹿アラート">` 64x36px、radius 18px、ON 背景 `#3FA98C`、つまみ 28px 白丸（right 4px top 4px）。ON 状態の描画
- 中段（flex gap 10px、align center）:
  - ミニスマホ 92x170px、radius 14px、背景 `#0E1512`、border 3px `#2C3C34`、中央揃え縦 gap 8px:
    - 緑の円 40x40 `#3FA98C`
    - 「3.2」IBM Plex Mono 14px 600 + 単位「 km」9px
    - 「ゾーンまで」9px `#B9C6BF`
  - 3 状態凡例 `ul`（12px、line-height 1.5、gap 8px）:
    - 緑の円 12px `#3FA98C` 「**緑**　ゾーン外。距離だけ表示」
    - 琥珀の三角（border 7/7/12）`#E8A64A` 「**琥珀**　鹿ゾーン内。チャイム1回、減速」
    - 赤の八角（clip-path polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)）12px、色 `#E2492C`（旧色。正は `#D83B1E`）「**赤**　鹿を検知。画面フラッシュ＋ビープ＋「前方に鹿」」
- 下段注記 11px `#B9C6BF` line-height 1.6: 「OFFにすると、自分の目だけで走ります。1回目はOFFで走ってみるのもおすすめです。」

### 4-2 今日の条件カード（白）

- 背景 `#FFFFFF`、border 1px `#E6DFD0`、radius 18px、padding 18px 22px、縦 gap 10px
- 見出し h2 「今日の条件」 13px / 700 / letter-spacing .1em / `#6B7A73`
- `dl` 2 列グリッド（gap 8px 16px、13px）。dt `#6B7A73`、dd 700。各行は左右 space-between:
  - 運転: 「あなた → 友人に交代可」
  - 車: 「コンパクトSUV 4WD」
  - 天候: 「小雪・圧雪」
  - 車内: 「4人・窓の曇り 中」
- 操作ヘルプのチップ列（gap 6px wrap、margin-top 4px）。各 padding 4px 10px、pill、背景 `#FBF8F1`、border 1px `#E6DFD0`、12px:
  - 「操作：W A S D」
  - 「ブレーキ：Space」
  - 「鹿を見つけたら：クリック」

### 4-3 開始ボタン

- `<a href="A3_Drive.dc.html">` 高さ 58px、radius 14px（radius-l）、背景 `#1E6F5C`、白文字 16px 700、中央揃え、下線なし
- 文言: 「エンジンをかける →」
- 押し込み影（shadow-press）は付いていない（プロトタイプでは未使用）

## 5. 使用色（hex と token 対応）

| hex                   | token                                        |
| --------------------- | -------------------------------------------- |
| `#FBF8F1`             | ground（trip）                               |
| `#EEF0EA`             | surface-sunken / map-land                    |
| `#FFFFFF`             | surface / on-spruce                          |
| `#1B2A24`             | ink（暗色カードの面にも使用）                |
| `#4A5A53` / `#6B7A73` | ink-muted / ink-faint                        |
| `#E6DFD0`             | line                                         |
| `#1E6F5C`             | spruce（ルート線、現在ステップ、開始ボタン） |
| `#3FA98C`             | alert-safe（緑の円、トグル ON）              |
| `#E8A64A`             | alert-zone（多発区間の帯 45%、三角）         |
| `#E2492C`             | 旧 alert-danger（要置換 → `#D83B1E`）        |
| `#B34E14`             | clay-deep（ゾーンラベル）                    |
| `#D86A2B`             | clay（ロゴ内側のみ）                         |
| `#0E1512`             | night ground（ミニスマホ画面）               |
| `#2C3C34`             | night line（ミニスマホ枠）                   |
| `#F2F5F1` / `#B9C6BF` | night ink / ink-muted（暗色カード内の文字）  |
| `#D5E3F2` / `#DCE4D9` | 地図の海・陸（token 外の近似値）             |

## 6. フォント

- 日本語本文: Noto Sans JP（400/500/700/900）。数値: IBM Plex Mono（500/600）。Google Fonts の css2 link を helmet に置く。
- サイズ: h1 28/900、ヘッダ ロゴ 18/700、h2 17/700（アラート）、13/700（今日の条件）、本文 14、補足 12、注記 11、ミニスマホ内 9、数値 14（mono）、開始ボタン 16/700、チップ 12、ステッパー 13。
- 注意: 9px・11px は tokens.json の最小（caption 12px）より小さい。ミニスマホの 9px は AlertState `compact`（文字 9px）の規約どおり。11px の注記は実装時に 12px へ上げるかを要判断。

## 7. モバイル（スマホ幅）の扱い

- A-2 のスマホ専用アートボードは存在しない（canvas.json にスマホ版 A-2 なし）。
- 流体レイアウトの挙動のみ指定: main が flex-wrap で、左カラム basis 600px / 右カラム basis 360px。約 1000px 以下で右カラムが下に回る（地図 → アラートカード → 条件 → 開始ボタンの順）。
- 地図は `min-height:440px`、SVG は `slice` なので幅が狭いと左右が切れる。ヘッダのステッパーは wrap。
- スマホ版で必要な再設計（地図の高さ、44px タッチターゲット、固定の開始ボタン）はアートボードに無い。実装側で決める（推奨案で決定して PR に記載）。

## 8. 要件 ID との対応・アクセシビリティ上の観察

- A-2 の要素: 地図＋鹿ゾーン帯、日没/薄暮情報、アラート ON/OFF トグル（3 状態凡例つき）、条件、操作ヘルプ、開始ボタン。
- トグルは `role="switch"` + `aria-checked` + `aria-label`。ただし 64x36px（高さ 44px 未満）。
- 色だけに頼らない区別: ルートは実線と破線、3 状態は円/三角/八角。
- 地図 SVG に `role="img"` と aria-label あり。装飾 SVG（ロゴ）は `aria-hidden`。
- 条件カードの文言（運転交代・車種・天候・窓の曇り・人数）は A-1 の入力結果を表示する想定。値はモックの固定文字列。
- 数値（142 km / 38 km / 16:38 / 3.2 km）はモックの固定値。実装では stats.json / TripPlan / ゾーン計算から出す（実数をコードに埋めない）。

## 9. 地図オーバーレイの構造（抜粋）

```html
<div
  style="position:relative;flex:1;min-height:440px;border-radius:18px;background:#EEF0EA;border:1px solid #E6DFD0;overflow:hidden"
>
  <svg
    viewBox="0 0 820 480"
    preserveAspectRatio="xMidYMid slice"
    style="position:absolute;inset:0;width:100%;height:100%"
    role="img"
    aria-label="..."
  >
    <rect width="820" height="480" fill="#EEF0EA" />
    <path d="M0 400 Q150 360 300 410 T820 390 L820 480 L0 480 Z" fill="#D5E3F2" />
    <!-- 海 -->
    <g fill="#DCE4D9">
      <ellipse ... />
      <ellipse ... />
    </g>
    <!-- 陸 -->
    <g stroke="#FFFFFF" stroke-width="7" fill="none" stroke-linecap="round">
      <path d="M90 420 L250 300 L380 250 L500 230 L640 150" />
    </g>
    <path
      d="M380 250 L500 230 L640 150"
      stroke="#E8A64A"
      stroke-width="22"
      fill="none"
      opacity="0.45"
    />
    <!-- ゾーン帯 -->
    <path d="M90 420 L250 300 L380 250" stroke="#1E6F5C" stroke-width="5" fill="none" />
    <!-- ゾーン外 -->
    <path
      d="M380 250 L500 230 L640 150"
      stroke="#1E6F5C"
      stroke-width="5"
      fill="none"
      stroke-dasharray="10 9"
    />
    <!-- ゾーン内 -->
    <!-- 地点: circle + text ×3、ゾーンラベル(g translate(500 290) rect rx18 #B34E14 + 白文字)、到着予定ピル(g translate(560 320)) -->
  </svg>
  <div style="position:absolute;left:16px;bottom:16px;display:flex;gap:8px;flex-wrap:wrap">
    <!-- 凡例チップ 3 つ -->
  </div>
</div>
```
