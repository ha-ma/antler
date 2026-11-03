# 変更指示 2026-11-03：B の判断を 3 層化（L0 YOLO / L1 ローカル jev 互換 / L2 任意）、Mac mini M1 前提

> **この指示で変わるのは B（edge/detector・apps/pwa・packages/schema）だけ。A（apps/sim・apps/api）と alert-ui の見た目は変更なし。**
> 進め方：このファイルを `docs/changes/` に置き、Claude Code に「`docs/changes/2026-11-03-b-l1-local-jev.md` を読んで、§4 の順に実施」と依頼する。

## 1. 何が変わったか（3 行）

1. 車載機は **Mac mini（M1, 2020）/ 16 GB / macOS 27 Golden Gate** に確定。YOLO は **Neural Engine**、判断モデルは **GPU（MLX）** に分ける。
2. 「jev」は TypeSafe のクラウド API ではなく、**jev 互換のローカルサーバー（local-jev ＋ Qwen2.5-1.5B 4bit）を Mac mini 上でオフライン実行**する。呼び出しは公式 `typesafe-sdk` で、`TYPESAFE_BASE_URL` だけで切替可能にする。
3. 判断は 3 層。**赤は L0（YOLO）だけで鳴らす**。L1 は非同期で「誤検知の降格」「路肩静止を琥珀に留める」を担当し、校正後 confidence ≥ 0.9 のときだけ L0 を上書きする。L2（Claude Vision）は回線があるときだけの任意。

## 2. 変更されていないもの（触らない）

- `@antler/alert-ui` の 3 状態・色・形・音。PWA の画面（B-0〜B-3）。
- `AlertFlag` の既存フィールド（追加のみ。§3.3）。
- 赤の遅延要件（L0 経路で 1,000 ms 未満、目標 500 ms）。
- A 側すべて。

## 3. 変更点の詳細

### 3.1 要件 ID の差分（docs/requirements/ch4-edge.md）

| ID                      | 変更               | 要点                                                                                          |
| ----------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| B1-1                    | 変更               | Mac mini M1 / 16 GB / macOS 27.x、`pmset` でスリープ無効                                      |
| B1-1a                   | **新規**           | OS 更新と Day 0 チェック（§4 Step 0）を開発前に                                               |
| B1-3                    | **新規**           | YOLO = `computeUnits = .cpuAndNeuralEngine`、L1 = GPU（MLX）。メモリ合計 4 GB 前後            |
| B2-2                    | 変更               | L0 でトラッカー・距離・横方向速度・**TTC を決定的コードで計算**                               |
| B2-3                    | 変更               | L0 即時ルール（≥0.8 が 2 フレームで赤、1.5 秒で解除）。**L1 を待たない**                      |
| B2-4                    | **新規**           | L1：2〜3 Hz、`POST /v1/systemone` に 4 問を 1 リクエスト、`typesafe-sdk`＋`TYPESAFE_BASE_URL` |
| B2-5                    | **新規**           | 上書きは校正後 confidence ≥ 0.9 のみ。0.5〜0.9 は L2 へ（回線時）、<0.5 はログ                |
| B2-6                    | **新規**           | 数値判断（距離・TTC）はモデルにさせない。L1 は意味の判断だけ                                  |
| B2-7                    | **新規**（SHOULD） | 質問ごとの温度スケーリング → `calibration.json`。A のシミュレーションログで学習               |
| B2-8                    | **新規**（MAY）    | L1 ≤150 ms が安定したら「L1 を待って赤」を設定で選べる（既定 OFF）                            |
| B2-9                    | 変更               | Capture に L1 の probabilities をソフトラベルとして保存                                       |
| 旧 B2-3（VLM 二次確認） | **削除**           | L2（任意）に置き換え                                                                          |

### 3.2 新規ファイル・ディレクトリ

```
edge/detector/
  l0/                     # 既存の YOLO 処理をここへ移す（中身は §3.4）
    tracker.py            # 新規：IoU トラッカー、距離・横速度・TTC
  l1/
    client.py             # 新規：typesafe-sdk で JudgeRequest を送る。タイムアウト 800 ms
    calibrate.py          # 新規：温度スケーリングの学習と適用
    questions.py          # 新規：4 問の定義（文言は §3.3 と同一）
  l2/
    vision.py             # 新規（任意）：回線があるときだけ Claude Vision
  fusion.py               # 新規：L0 の状態に L1 の上書きを適用し AlertFlag を作る
  config.yaml             # 追記（§3.5）
  calibration.json        # 生成物（最初は存在しなくてよい。無ければ上書き無効）
scripts/
  bench_l1.py             # 新規：Day 0 / Day 2 の計測（§4 Step 0, Step 6）
dataset/
  export_l1_labels.py     # 新規：A のシミュレーションログから L1 校正用ラベルを作る
```

### 3.3 スキーマの差分（packages/schema）

- **新規** `JudgeRequest`（TypeScript 型＋JSON Schema＋Python pydantic を生成）。形は要件定義書 第 7 章の例と同一：
  - `state`: `speedKmh, zone, light, headlight, track[{t, conf, distanceM, lateralMps, side, pos}], ttcSec, recentAlerts30s`
  - `questions`: `alert_level`（choice: none/zone/danger）、`on_roadway`（noul）、`static_shoulder`（noul）、`false_positive`（noul）。英文の質問文は要件定義書のとおり固定。
- **追加（任意フィールド）** `AlertFlag.l1 = { alert_level, conf, overrode: boolean, latencyMs }`。PWA は読まない（ログ用）。
- **追加（任意フィールド）** `Capture.l1Probs = { alert_level: {none,zone,danger}, on_roadway, static_shoulder, false_positive }`。
- 既存フィールドの名前・型は変えない。`alert-contract-guard` を通すこと。

### 3.4 既存コードの変更

- YOLO 推論：CoreML の compute units を `.cpuAndNeuralEngine` に固定（設定値で切替可能に）。
- 旧「確信度 0.4〜0.8 は VLM へ」の分岐を削除し、`fusion.py` の L0→L1→（L2）の流れに置き換える。
- 赤の送信（WebSocket）は L0 の状態変化だけで発火。**L1 の await を赤の経路に入れない。**
- L1 の結果到着時：`fusion.py` が「校正後 conf ≥ 0.9 かつ `calibration.json` が読めている」ときだけ状態を上書きし、変化があれば AlertFlag を再送（`l1.overrode = true`）。
- L1 サーバー停止・タイムアウト・例外 → L0 単独運転。検知ループを止めない。ログに `l1_unavailable`。

### 3.5 config.yaml 追記

```yaml
coreml:
  compute_units: cpu_and_ne # L0 は Neural Engine
l1:
  enabled: true
  base_url: http://127.0.0.1:8765 # TYPESAFE_BASE_URL より優先しない。環境変数があればそちら
  model: jev-latest # local-jev 側で llm-qwen2.5-1.5b を割り当て
  rate_hz: 2.5
  timeout_ms: 800
  override_conf: 0.9
  l2_route_conf: [0.5, 0.9]
  wait_for_l1_before_red: false # B2-8。Day 0 の実測で ≤150 ms が安定したときだけ true を検討
l2:
  enabled: auto # 回線があるときだけ
```

### 3.6 依存の追加（edge/detector）

`typesafe-sdk`、`local-jev`（リポジトリ amithgc/local-jev をコミット固定で）、`mlx`。モデル重みは Hugging Face（Qwen：Apache-2.0、DeBERTa：MIT）。`CREDITS.md` に追記。

## 4. 実施順（各 Step が 1 つの `/sfad cycle` または作業単位）

**Step 0（人が Mac mini で実施、30 分）**：macOS 27.x へ更新 → `xcode-select --install` → venv に `mlx coremltools ultralytics local-jev typesafe-sdk` → YOLO の ANE fps 計測 → `local-jev serve --model llm-qwen2.5-1.5b` → `python scripts/bench_l1.py --n 100`（YOLO 同時実行あり/なし）。結果を `docs/reports/2026-11-0X-day0-mac-mini.md` に。

**Step 1**：`/sfad cycle schema-judge` — §3.3。Tier 2。完了条件：型・JSON Schema・pydantic の 3 つが一致、`alert-contract-guard` Critical 0。

**Step 2**：`/sfad cycle edge-l0` — §3.4 の YOLO 設定とトラッカー（B2-2, B2-3）。既存テストを壊さない。L1 無しで赤が従来どおり鳴ることが受け入れテスト。

**Step 3**：`/sfad cycle edge-l1` — `l1/client.py`、`l1/questions.py`、`fusion.py`（B2-4, B2-5, B2-6）。受け入れテスト：(a) L1 停止時も赤が鳴る (b) `calibration.json` 無しでは上書きしない (c) 校正後 conf ≥ 0.9 の「false_positive」で赤→琥珀に降格し `l1.overrode=true` が送られる。

**Step 4**：`/sfad cycle edge-l1-calibration` — `dataset/export_l1_labels.py`（A のシミュレーションログ → 正解付き JudgeRequest）と `l1/calibrate.py`（B2-7）。1 問あたり 100〜300 件を目標。

**Step 5**（任意）：`/sfad cycle edge-l2` — 回線があるときだけの Claude Vision。

**Step 6**：`scripts/bench_l1.py --compare` で Day 2 比較実験：A で生成した正解付き 200 シナリオを「閾値ルールのみ / local-jev＋Qwen2.5-1.5B / local-jev＋NLI / （macOS 27 なら）fmev」に流し、正解率・ECE・p50/p95 を出す。`edge-latency-reviewer` を回し、結果を `docs/requirements/ch9-decisions.md` ④ の判断欄の下に貼る（判断はユーザー）。

## 5. 判断欄（docs/requirements/ch9-decisions.md ④）

空欄の間は **a（local-jev＋Qwen2.5-1.5B）と「L1 を赤の経路に入れない」** を仮採用し、PR 本文に「仮採用」と書く。

## 6. 受け入れ基準の差分（ch10）

- 赤の 1,000 ms 未満は **Mac mini M1 実機**で、L0 経路のログで証明。
- L1 の p50/p95、上書き件数と正誤がログに残る。
- YOLO と L1 の併走で L0 の fps 低下が 20% 以内。

## 7. 更新されたハーネス

- `.claude/agents/edge-latency-reviewer.md` を差し替え（L1 の検査と計測を追加）。antler-scaffold.zip の同名ファイルで上書きする。

---

## 取り込みの記録（2026-11-03、Claude Code）

- このファイルはユーザーが貼った変更指示の写し。要件の写し（`docs/requirements/ch4-edge.md`・`ch7-data.md`・`ch10-plan.md`）は原文のまま残す規約なので、**§3.1・§3.3・§6 の差分は、原本（Claude Docs）が直るまでこのファイルが正**。原本の更新と再エクスポートはユーザーの作業。
- `ch9-decisions.md` に ④ の行を足し、§5 のとおり仮採用にした。
- `docs/roadmap.md` の人 B の行と付録 A #2 を、L0 / L1 / L2 の Step に置き換えた。
- `.claude/agents/edge-latency-reviewer.md` を差し替えた（報告を `docs/reports/` に書くため、tools に Write を残した）。
- Step 0 は Mac mini の実機作業なのでユーザーが行う。Step 1 以降は Claude Code のセッションが行う。
