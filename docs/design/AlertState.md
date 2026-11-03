# AlertState

3状態（ゾーン外・鹿ゾーン内・鹿検知）を全画面で伝えるコンポーネント。A の 3D 車内に置かれたスマホと、B のドライバーのスマホ PWA で同じものを使う。

## 状態

| state | 背景 | 形 | 主数値 | 一語（4 言語） | 音 |
| --- | --- | --- | --- | --- | --- |
| `safe` | `alert-safe` | 円＋チェック | 鹿ゾーンまでの km | 鹿ゾーンまで / Deer zone ahead | なし |
| `zone` | `alert-zone` | 三角＋鹿ピクト | ゾーン終了までの km | 鹿ゾーン走行中 / DEER ZONE | チャイム 1 回 |
| `danger` | `alert-danger` | 八角＋鹿ピクト | 距離 m ＋ 方向矢印 | 前方に鹿 / DEER AHEAD | ビープ連続＋読み上げ |

## Props

- `state`: `"safe" | "zone" | "danger"`
- `distance`: number（safe/zone は km、danger は m）
- `side`: `"L" | "R" | undefined`（danger のみ矢印）
- `lang`: `"ja" | "en" | "zh" | "ko"`（主文の言語。副文は残り 3 言語を常に併記）
- `compact`: boolean（A の車内スマホ用。数値と形だけ、文字は 9px）
- `muted`: boolean（音を鳴らさない。A でアラート OFF のときはそもそも描画しない）

## 規約

- 文字は背景色上で 4.5:1 以上（safe/zone は `#0E1512`、danger は `#FFFFFF`）。
- `danger` は 14px の白枠を 1 Hz で点滅させる。点滅は 1 Hz を超えない。
- 操作要素を置かない。タップで消えない。
- 数値は `num-hero`（96px）、単位はその 1/3。
- 消費側が用意するもの：GPS 由来のゾーン判定、WebSocket のフラグ、音声ファイル。
