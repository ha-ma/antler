---
feature: edge-day0
target_paths:
  - edge/detector/src/detector/bench.py
  - edge/detector/scripts/export_yolo_world.py
  - edge/detector/pyproject.toml
  - edge/detector/tests/test_bench.py
  - edge/detector/tests/test_export_yolo_world.py
  - scripts/bench_l1.py
  - dataset/tests/test_bench_l1_entry.py
  - docs/runbooks/2026-11-04-mac-mini-day0.md
  - CREDITS.md
spec_confirmed_at: 4b05338
tier: 1
---

# 仕様: edge-day0（Mac mini の実機作業 Step 0 の道具と手順書）

**og-font（2026-11-06）での変更**: CLAUDE.md の MUST と CREDITS.md に、フォントは SIL OFL も可を足した（`docs/specs/og-font/functional.md`）。この feature の挙動は変わらない。

**dataset-train（2026-11-06）での変更**: CREDITS.md の Ultralytics の行に、学習スクリプトの元の重み（COCO の yolo26n.pt、v8.4.0）を足した。この feature の挙動は変わらない。ただし実データで、正方形の 640×640 で書き出したモデルを L0 が 640×480 から引き伸ばすと精度が大きく落ちた（`docs/reports/2026-11-06-dataset-train-run.md`）。`export_yolo_world.py` も 640×480 で書き出すかは次の cycle で見直す。

**YOLO の素材の取り込み（2026-11-06）での変更**: CREDITS.md に Commons の実写フレーム・Osaki さんの写真・外部の研究の検出器の重み（yolo26n-deer-20261105、AGPL-3.0）の行を足した（`docs/reports/2026-11-06-yolo-materials.md`）。この feature の挙動は変わらない。

## 概要

変更指示 `docs/changes/2026-11-03-b-l1-local-jev.md` §4 Step 0（人が Mac mini M1 / 16 GB / macOS 27 で実施）と Step 6 の入口に使う道具を作る。
開発用の Mac と車載の Mac mini は別の機械で、ユーザーが Mac mini で clone し、手順書のコマンドを順に打ち、出力をメインセッションに貼る。

作るもの: (1) `scripts/bench_l1.py`（L1 の p50/p95、YOLO と L1 の併走での L0 の fps 低下、`--compare` の入口）、
(2) YOLO-World → CoreML の書き出し `edge/detector/scripts/export_yolo_world.py`、(3) 手順書 `docs/runbooks/2026-11-04-mac-mini-day0.md`、
(4) extra `day0`（ultralytics・coremltools・mlx）と CREDITS.md。

要件: 変更指示 §3.2（`scripts/bench_l1.py`）・§4 Step 0・Step 6・§6（L1 の p50/p95、併走で L0 の fps 低下 20% 以内）。ch4-edge.md B1-1（`pmset`）。
既存: `docs/specs/edge-l0`（CoreML の読み方）・`edge-l1`（client）・`edge-l1-calibration`（`dataset/export_l1_labels.py`）。

**範囲外**: Mac mini 上の実測そのもの（ユーザーの作業。結果は `docs/reports/2026-11-0X-day0-mac-mini.md`）、`--compare` の fmev と NLI 以外の系の本実装、
鹿の画像での学習し直し（Day 5）、L2、L1 の `calibration.json` の学習（edge-l1-calibration 済み）。

**Tier 1 の根拠**: 開発者の手元で動く計測・書き出しの道具で、サービスの挙動を変えない。新しい待ち受けを作らず、外へ送る先は既存の L1 client と同じループバックの local-jev だけ（`remote_not_allowed` を継承）。
認可・永続化スキーマに触れない。並行性はスレッド 1 本（YOLO のループ）で、計測の中に閉じる。

## Example Map

Story: 人 B として、Mac mini の前で手順書を上から打つだけで、YOLO が ANE で何 fps 出るか、L1 が何 ms か、併走で L0 がどれだけ遅くなるかの数字を 1 つの JSON で得て、メインセッションに貼りたい。

Questions は全問、推奨で決定（メインセッションの指示。2026-11-04）。ch9 ④ は推奨（local-jev＋Qwen2.5-1.5B、L1 を赤の経路に入れない）を仮採用中。保留は下の Deferred。

- R1: 置き場所（推奨で決定）
  - 本体は `edge/detector/src/detector/bench.py`（ruff・pytest・カバレッジ 70% が効く場所）。`scripts/bench_l1.py`（指示書の位置）は薄い入口で、`--compare` の合成シナリオ（`dataset/export_l1_labels.py`）を渡すだけ
  - 書き出しは `edge/detector/scripts/export_yolo_world.py`（既存の `generate_models.py` と同じ場所）
- R2: L1 の計測（`--n 100`）
  - local-jev を `l1/client.py`（`make_client`）で呼ぶ。接続先は `--base-url` > 環境変数 `TYPESAFE_BASE_URL` > 設定 `l1.base_url`（既定 8766）。ループバック以外は拒否（exit 2）
  - 請求は `export_l1_labels` の合成の例（`build_request` 経由、実行時と同じ形と長さ）を巡回する。warmup（最初の成功まで最大 `--warmup` 回、既定 3）は**長いタイムアウト**（`--warmup-timeout-ms`、既定 120000。モデルのロードは 800 ms で終わらない）の別のクライアントで呼び、p50/p95 に入れず `warmup_ms` に残す。失敗は `warmup_failures` に理由を残す（spec-adversary W）
  - p50/p95/max/mean は**成功した呼び出しだけ**。失敗は `L1Unavailable.reason` ごとに数える。実際に答えたモデル（`L1Answer.model`）を数えて残す（`jev-latest` がどれに解決したかの証拠）
  - 間隔 `--interval-ms`（既定 400 = 実行時の 2.5 Hz。0 で連続＝最悪の場合）
  - 1 件も成功しなければ exit 3（JSON は出す）
- R3: YOLO との併走（`--model X.mlpackage`）
  - YOLO（`load_coreml_detector`、compute units は `--compute-units` > 設定 > 既定 `cpu_and_ne`）を別スレッドで回し続ける（CoreML の predict は同期。asyncio に混ぜると併走にならない）
  - 順序: L1 単独 → YOLO 単独の fps（`--yolo-seconds`） → YOLO を回したまま L1 を n 回。fps は同じループの区間の差で出す（立ち上がり 0.5 秒は測らない）。低下率 = (単独 − 併走) ÷ 単独。**20% 以内が合格**（§6）
  - フレームはシード付きの乱数画像 4 枚（640×480 BGR）。推論の例外は数えて続ける。YOLO は最初の 5 回（CoreML のコンパイル）が済んでから窓を開く（済まなければ `yolo_not_ready`）。例外の数は窓ごと
  - **判定が無効になる場合**（`verdict.valid=false`、`fps_drop_ok=false`、exit 3）: 併走の区間で L1 が答えた割合が 80% 未満（L1 が落ちると YOLO は負荷なしで回り、合格に見える。spec-adversary C）、YOLO が立ち上がらない
  - `l0_meets_target_fps`: 併走時の fps が `pipeline.target_fps`（10）以上か。§6 の 20% は処理能力の低下で、実運転の 10 fps を保てるかは別に出す（推奨で決定）
- R4: 出力
  - 1 つの JSON（`schema: antler.bench_l1/1`、`allow_nan=False`）: 環境（CPU 名・OS・Python・主要パッケージの版）、params、`l1_alone`、`l0_alone`、`l0_with_l1`、`l1_with_yolo`、`verdict`。続けて Markdown の要約の表。`--out` でファイルにも書く
  - 本文（状態・請求の内容）は出さない
- R5: `--compare`（Step 6 の入口）
  - 入力は `--labels`（`export_l1_labels.py` の JSONL）か、無ければ合成 `--scenarios`（既定 200）。系は「閾値ルールのみ（L0 の track だけから決める。正解ラベルを見ない）」と、`--systems` に挙げた local-jev のモデル名ごと（請求の `model` に入れる。1 つのサーバーで切り替える）
  - 各系で 4 問の正解率（答えた分）・失敗を不正解にした正解率（`accuracy_all`）・回答率（`coverage`）・ECE（10 bin）・p50/p95・失敗（落ちる系ほど難しい例が落ちて正解率が上がる偏りを、回答率で見えるようにする。spec-adversary C）。要求したモデルと別のモデルが答えた系、1 件も答えなかった系は `valid=false`（理由つき、exit 3）。noul は「はい」の確率で、0.5 以上を「はい」とする
  - fmev（macOS 27）は系として未実装（Deferred）
- R6: YOLO-World → CoreML（推奨で決定）
  - 重みは `yolov8s-worldv2.pt`（**v2 だけが CoreML に出せる**。Ultralytics 8.4.202 の exporter が v1 を拒否）。`set_classes(["deer"])`（CLIP の取得に git とネットワークが要る）→ `export(format="coreml", nms=True, imgsz=640, conf=0.25, iou=0.7)`
  - 出力の名前を **l0 に合わせる（l0 は変えない）**: NMS 付きの書き出しは `confidence` / `coordinates` / メタデータ `names`（`{0: 'deer'}`）になり、l0 の `CoreMLDetector`・`parse_names` の読み方と同じ。書き出した直後に l0 自身の `load_coreml_detector` で黒い 1 枚を推論し、読み方が合うことを確かめる。合わなければ exit 1（出力の名前・形を表示）。黒い画像は検出が 0 件で l0 は形を見ないため、出力の名前は**モデルの宣言**（`get_spec`）で確かめ、形は `--check-image`（鹿の写真）で検出を出して確かめる（`shape_verified`）。`names` が読めないときだけ coremltools で書き足す
  - `--conf` は `tracker.min_conf`（0.4）以下だけ許す（NMS が 0.4 未満の鹿を消さない。edge-l0 の Deferred）。`--classes` に deer が必須。`--imgsz` は 32 の倍数。同名があれば `--force` まで拒否
  - 置き場所は `edge/detector/models/`（`.gitignore` 済み）。どこから実行しても `models/` を cwd にして書き出す（重み `.pt` がリポジトリ直下に落ちない）。重みはリポジトリに入れない
- R7: 依存と CREDITS
  - extra `day0` = ultralytics 8.4.202、coremltools 9.0、mlx 0.32.4、numpy<=2.3.5（PyPI の実在と macOS arm64・Python 3.11〜3.13 の wheel を 2026-11-04 に確認）。本体の依存・`dev` に入れない。CI では入れない
  - CREDITS.md に Ultralytics と重み（AGPL-3.0）、CLIP（MIT）、coremltools（BSD-3-Clause）、mlx（MIT）
- R8: 手順書
  - clone → `sh scripts/setup.sh` → 専用の venv → `pip install -e "edge/detector[dev,l1,day0]"` → `sudo pmset -a sleep 0 disksleep 0`（B1-1）→ local-jev をコミット `64a0b31ff343dca32142496cf9edca5a0174a18d` で**別の venv に**入れて `--port 8766` で起動 → 書き出し → bench（YOLO なし・あり）→ 出力の貼り方
  - 各段に期待される出力・かかる時間の目安・うまくいかないときの確かめ方。パスワードが要る段（`xcode-select --install`、`sudo`）とネットワークが要る段を明記

## ユースケース

### UC-1: L1 の計測（R2・R4）

- **Given**: 偽の L1 または実物の SDK を MockTransport で → **When**: `run_bench` / CLI → **Then**: p50/p95・失敗の内訳・答えたモデル・warmup が JSON に出て、表が付く

### UC-2: 併走（R3）

- **Given**: 偽の検出器（L1 の最中だけ遅くなるもの） → **When**: `run_bench` → **Then**: fps の低下率が出て、20% を超えれば不合格

### UC-3: 比較（R5）

- **Given**: 正解付きの例 → **When**: `run_compare` → **Then**: ルールと各モデルの正解率・ECE・遅延が出る

### UC-4: 書き出し（R6）

- **Given**: 偽の YOLOWorld → **When**: `export` → **Then**: クラス・NMS・conf つきで書き出し、移動し、l0 の読み方で検証する

## 状態パターン

### S-1: L1 が起動していない

- 1 件も成功しない → exit 3、JSON には失敗の理由の内訳

### S-2: モデルが l0 の読み方と合わない

- names に deer が無い・出力の名前が違う・形が違う → `ExportError`（exit 1）

### S-3: 入力が不正

- `--n 0` など・壊れた JSONL・ループバックでない接続先 → exit 2

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（Mac mini 実機）/ 期日=2026-11-05 / 暫定挙動=bench と書き出しは偽物でだけテストした。実物の Ultralytics 8.4.202 + YOLO-World の CoreML 書き出しが成功するか、出力が `confidence`/`coordinates` か、ANE の fps は未計測。書き出しが l0 と合わなければスクリプトが exit 1 で理由を出す] 実機での書き出しと計測
- [Deferred: 担当=ユーザー / 期日=2026-11-05 / 暫定挙動=指示書は Qwen の重みを「約 1 GB・4bit」とするが、local-jev の README（@64a0b31）は `llm-qwen2.5-1.5b` を 3.09 GB（PyTorch で動かす。MLX ではない）とする。手順書は README の値を書く。mlx は extra に入れるが L1 では使われない] 指示書と local-jev の食い違い
- [Deferred: 担当=メインセッション（Step 6）/ 期日=2026-11-06 / 暫定挙動=`--compare` の系はルールと local-jev のモデル名のみ。fmev（macOS 27）と、NLI の ECE の読み比べは実機で `--systems` に名前を足して試す] 比較の系の拡張
- [Deferred: 担当=ユーザー / 期日=Day 5 前 / 暫定挙動=Ultralytics と重みは AGPL-3.0。CREDITS.md に書いたが、配布・ネットワーク提供時の扱いは ch9 に判断の行が無い] ライセンスの判断
- [Deferred: 担当=人 B / 期日=2026-11-05 / 暫定挙動=併走の fps は単独 → 併走の 1 回ずつ（20% の境界付近は揺らぐので手順書は 2 回打たせる）。入力は乱数画像で NMS が軽く楽観側に出る（鹿の写真を入力に使う案は実機の結果を見て決める）。ANE で動いた証拠は JSON に無い（`cpu_only` との fps の差を手順書で比べる）。併走の計測は L1 を背中合わせに近い間隔（既定 400 ms）で呼ぶ。実運転の GPU 競合（L1）と ANE（YOLO）以外の負荷（カメラ・WebSocket）は含まない] 計測の範囲

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] DAC-1: 偽の L1（実物の SDK ＋ MockTransport）と偽の検出器で CLI を回すと、JSON（schema・環境・params・l1_alone・併走・verdict）と表が出て `--out` に同じ JSON が書かれ、exit 0

UC-1 L1 の計測:

- [x] BEN-1a: p50/p95 は線形補間、空は None、JSON に NaN を出さない
- [x] BEN-1b: 失敗は理由ごとに数え、p50/p95 は成功分だけ。warmup は別に残し、呼び出しは warmup + n 回
- [x] BEN-1c: 答えたモデルを数える
- [x] BEN-1d: 1 件も成功しないと exit 3 と理由
- [x] BEN-1e: 環境の情報が JSON になる

UC-2 併走:

- [x] BEN-2a: L1 の最中だけ遅い検出器で fps の低下が 20% を超え、不合格になる
- [x] BEN-2b: 影響しない検出器では合格
- [x] BEN-2c: 検出器の例外は数えて続ける（型名だけ残す）
- [x] BEN-2d: `--model` と `--compute-units` が検出器の作成に渡る

UC-3 比較:

- [x] CMP-1a: ルールは track だけで決め、正解ラベルを見ない
- [x] CMP-1b: ルールと各モデルの正解率・ECE・遅延、請求の `model` にシステム名が入る
- [x] CMP-1c: 失敗は数え、正解率は None
- [x] CMP-1d: `--labels` の JSONL を読み、壊れた行・行が無い・必須キーが無いと exit 2
- [x] CMP-1e: ECE の計算（完全に正しい確信・完全に外れた確信・半々）
- [x] CMP-1f: [ADDED] `scripts/bench_l1.py` の合成シナリオが JudgeRequest に通り、同じシードで再現し、不正な引数で exit 2

UC-4 書き出し:

- [x] EXP-1a: `set_classes(["deer"])`、`nms=True`・`imgsz`・`conf`・`iou` で書き出し、`models/` に移す
- [x] EXP-1b: 同名があれば `--force` まで拒否。書き出し物が無ければ失敗
- [x] EXP-1c: l0 の読み方で検証: names・入力・出力の名前と形
- [x] EXP-1d: deer 無し・names 無し・クラス違い・出力の名前違い・形違いは `ExportError`
- [x] EXP-1e: `names` が読めないときだけ書き足し、読めるときは触らない。coremltools が無ければ分かる失敗
- [x] EXP-1f: `--conf` が min_conf を超える・`--classes` に deer が無い → exit 2。`--imgsz` が 32 の倍数でない → 引数エラー

S-3 入力が不正:

- [x] BEN-3a: 不正な数・ループバックでない接続先・存在しないファイル → exit 2

spec-adversary の指摘の反映（2026-11-04）:

- [x] ADV-1: [ADDED adversary C] 出力の名前は `get_spec` の宣言で確かめ、形は検出の出る画像で確かめる（`shape_verified`）
- [x] ADV-2: [ADDED adversary C] 併走の区間で L1 が落ちたら判定を無効にし exit 3。YOLO が立ち上がらなければ無効
- [x] ADV-3: [ADDED adversary C] 比較: 回答率と失敗を不正解にした正解率、別のモデルが答えた系・答えなかった系は無効
- [x] ADV-4: [ADDED adversary W] warmup は別のクライアント・最初の成功まで再試行・失敗の理由を残す
- [x] ADV-5: [ADDED adversary W] 書き出しは `models/` を cwd にする。`--compute-units` は一覧の外を引数エラーにする。検出器の読み込み失敗は exit 2
- [x] ADV-7: [ADDED edge-latency C] `p95_ms_failures_as_timeout` を並べ、L1 の回答率が 80% 未満・warmup が失敗し続けたなら exit 3。YOLO の窓に推論の例外があれば `yolo_errors` で無効
- [x] ADV-8: [ADDED code-reviewer] `--scenarios 0`・labels の 4 問のキー欠落・不正な請求は exit 2（入力の中身をエラーに出さない）。`--out` に書けなくても結果は先に出す。ultralytics の例外は `ExportError`。`--force` は検証に通るまで旧モデルを残す。`--check-image` で検出が出なければ exit 1
- [x] ADV-6: [ADDED adversary I] 例外の数は窓ごと。`yolo_seconds` を params に残す。`l0_meets_target_fps`
