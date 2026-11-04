# 手順書: Mac mini の Day 0（変更指示 §4 Step 0）

Mac mini（M1 / 16 GB / macOS 27）の前で、上から順に打つ。**開発用の Mac ではなく、車載の Mac mini** で行う。
終わったら、最後の「9. 貼るもの」をメインセッションに貼る。全体で 60〜90 分（ほとんどはダウンロードの待ち）。

- ターミナルは 2 つ使う。**A** = 作業用、**B** = local-jev のサーバー（起動したままにする）
- 「パスワード」= Mac のログインパスワード。ネットワーク = インターネットに出られること
- 各段の「確かめる」が期待どおりでなければ、次へ進まず「うまくいかないとき」を見る
- 仕様: `docs/specs/edge-day0/functional.md`。指示書: `docs/changes/2026-11-03-b-l1-local-jev.md`

## 1. 前提の確認（1 分）

**ターミナル A**

```sh
sw_vers
uname -m
python3 --version
```

確かめる

- `ProductVersion` が 27 台（以降に上がっていてもよい）、`uname -m` が `arm64`
- `python3 --version` が **3.11〜3.13**（ultralytics の CoreML 書き出しは 3.13 まで）。3.14 や 3.10 以下なら、手順 3 の `python3` を `uv` に置き換える（下の「Python が合わないとき」）

OS の更新が残っていれば、先に「システム設定 → 一般 → ソフトウェアアップデート」で macOS 27.x に上げる（B1-1a。再起動を含む。パスワードが要る）。

## 2. Xcode のコマンドラインツール（初回のみ。5〜15 分。ネットワーク・パスワード）

```sh
xcode-select -p || xcode-select --install
```

確かめる: `xcode-select -p` が `/Library/Developer/CommandLineTools` などのパスを出す。`--install` を打った場合は、出たダイアログで「インストール」を押し、終わってから `git --version` が通ることを確かめる。

## 3. clone と専用の venv（3〜10 分。ネットワーク）

```sh
mkdir -p ~/work && cd ~/work
git clone https://github.com/ha-ma/antler.git
cd antler
git checkout main   # PR #27 は 2026-11-04 に main にマージ済み
git pull
```

GitHub の認証を聞かれたら、ユーザー名と Personal Access Token（パスワードではない）を入れる。入力はこの端末で人が行う。

```sh
python3 -m venv edge/detector/.venv
source edge/detector/.venv/bin/activate
python -m pip install -U pip
sh scripts/setup.sh
```

`setup.sh` は中で `python` を呼ぶので、**venv を有効にしてから** 打つ（macOS には `python` コマンドが無いため）。

確かめる: `which python` が `.../antler/edge/detector/.venv/bin/python`。`setup.sh` の最後に「セットアップが終わりました」が出る。

## 4. 依存の導入（10〜25 分。ネットワーク。torch が約 1 GB）

```sh
pip install -e "edge/detector[dev,l1,day0]"
pip install "git+https://github.com/ultralytics/CLIP.git"
```

2 行目は YOLO-World の `set_classes` が使う CLIP（書き出しのときだけ）。無くても Ultralytics が自動で入れるが、ここで入れておくと失敗の原因が分けやすい。

確かめる

```sh
python -c "import ultralytics, coremltools, mlx.core, typesafe_sdk, numpy; print(ultralytics.__version__, coremltools.__version__, numpy.__version__)"
python -m pytest -q edge/detector 2>&1 | tail -2
```

- 1 行目が `8.4.202 9.0 2.3.x` のように、ultralytics・coremltools・numpy の版を出す（numpy は 2.3.5 以下）
- 2 行目が `... passed`（約 30 秒。失敗があれば貼る）

## 5. 電源とスリープ（B1-1。パスワード）

```sh
sudo pmset -a sleep 0 disksleep 0
pmset -g | grep -E "^ *(sleep|disksleep)"
```

確かめる: `sleep 0`、`disksleep 0`（ディスプレイのスリープは別でよい）。`sudo` はパスワードを聞く。

## 6. local-jev（別の venv。10〜30 分。ネットワーク。重みが約 3 GB）

local-jev は torch と Qwen の重みを使う別プロセス。**detector の venv とは分ける**（コミットは固定）。

**ターミナル B**（新しいタブ）

```sh
cd ~/work
git clone https://github.com/amithgc/local-jev.git
cd local-jev
git checkout 64a0b31ff343dca32142496cf9edca5a0174a18d
python3 -m venv .venv
.venv/bin/python -m pip install -U pip
.venv/bin/pip install -e .
.venv/bin/local-jev models
```

確かめる: `local-jev models` の一覧に `llm-qwen2.5-1.5b` がある（`weights download on first use` と出てよい）。

```sh
.venv/bin/local-jev serve --model llm-qwen2.5-1.5b --port 8766
```

- **`--model` を必ず付ける**。付けないと、手元に重みが無いとき小さい NLI モデル（0.87 GB）を落として、それが既定になる
- 初回は Qwen2.5-1.5B の重み（local-jev の README では **3.09 GB**。指示書の「約 1 GB」より大きい）を Hugging Face から取る。5〜20 分
- `127.0.0.1:8766` で待ち受けたまま、このタブは閉じない。`LOCAL_JEV_API_KEY` は設定しない

**ターミナル A**で確かめる

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8766/healthz
curl -s http://127.0.0.1:8766/v1/models | head -c 400
```

`healthz` が `200` を返し、`/v1/models` に `llm-qwen2.5-1.5b` が出る。モデルは最初のリクエストで読み込まれる（次の手順の warmup が吸収する）。

## 7. 鹿用の YOLO（YOLO-World → CoreML。5〜15 分。ネットワーク）

鹿の写真を 1 枚、`~/work/deer.jpg` に置く（検索で見つけた写真でよい。**リポジトリには入れない**）。書き出したモデルの出力の形を、検出が出る画像で確かめるために使う。

**ターミナル A**（venv が有効なまま）

```sh
python edge/detector/scripts/export_yolo_world.py --check-image ~/work/deer.jpg
```

- 重み `yolov8s-worldv2.pt` と CLIP の重み（数百 MB）を取り、CoreML に書き出す。結果は `edge/detector/models/yolov8s-worldv2-deer.mlpackage`（`.gitignore` 済み）
- v1 の `yolov8s-world.pt` は CoreML に出せない。スクリプトは v2 を使う

確かめる: 最後に JSON が出て、次のようになっている。

- `"names": ["deer"]`、`"outputs_declared": ["confidence", "coordinates", ...]`
- `"check_image_detections"` が 1 以上、`"shape_verified": true`（0 のときは鹿がはっきり写った別の写真で `--force` を付けて再実行）
- `"names_patched"` が `true` でも失敗ではない（`names` を l0 の読み方で書き足した印）

```sh
ls -d edge/detector/models/*.mlpackage
git status --short
```

`git status` が何も出さない（重みやモデルがコミット対象になっていない）ことを確かめる。

## 8. 計測（YOLO なし → あり）

出力先を作る: `mkdir -p ~/day0`

**8a. L1 だけ（約 3〜5 分。初回は warmup でモデルを読み込む）**

```sh
python scripts/bench_l1.py --n 100 --out ~/day0/bench-no-yolo.json
```

**8b. YOLO と L1 の併走（Neural Engine。約 3〜5 分）**

```sh
python scripts/bench_l1.py --n 100 --model edge/detector/models/yolov8s-worldv2-deer.mlpackage --out ~/day0/bench-yolo-ane.json
```

実行中に**別のタブ**でメモリを見る（B1-3。合計 4 GB 前後が目安）: `memory_pressure | tail -3`。

**8c. ANE が効いているかの確認（約 1 分）**

```sh
python scripts/bench_l1.py --n 20 --model edge/detector/models/yolov8s-worldv2-deer.mlpackage --compute-units cpu_only --out ~/day0/bench-yolo-cpu.json
```

`l0_alone.fps`（CPU のみ）が 8b の `l0_alone.fps`（ANE）の **半分以下**なら、ANE が効いている目安。8b とほぼ同じ（0.8 倍〜1.2 倍）なら、ANE に載っていない疑い（演算が対応していない）。どちらもそのまま貼る（判断はメインセッション）。

期待される出力（8b。数字は例）

- 先頭に JSON、続いて表。`"schema": "antler.bench_l1/1"`
- `l1_alone` と `l1_with_yolo` の `p50_ms` / `p95_ms`。`warmup_ms`（初回のモデル読み込み。数秒〜数十秒でよい）
- `verdict.valid` が `true`、`fps_drop_ok`（低下 20% 以内で `true`）、`l0_meets_target_fps`（目標 10 fps）
- `l1_alone.answered_ratio` が 0.8 以上。`p95_ms_failures_as_timeout` は、落ちた呼び出しを 800 ms として混ぜた p95（成功分だけの `p95_ms` は、遅くて落ちた呼び出しが除かれて低く見えるので、**両方を貼る**）
- fps の読み方: `fps_drop_pct` は YOLO を休みなく回したときの**処理能力**の低下（§6 の 20%）。実運転は 10 fps に抑えるので、`l0_meets_target_fps` が真なら 10 fps は保てる。判定が 20% の境界（15〜25%）なら 8b をもう一度打って、2 回とも貼る
- 併走の入力は乱数画像で、鹿が写っていない分だけ後処理（NMS）が軽く、fps は実運転より楽観側に出る

終了コード: `0` = 正常、`2` = 引数・ファイル・モデルの読み込みの誤り、`3` = 結果が信用できない（L1 が 1 件も答えない、併走中に L1 が落ちた、など。JSON は出る）。

## 9. 貼るもの

次をまとめてメインセッションに貼る（`~/day0/` の JSON は全文）。

```sh
{ sw_vers; system_profiler SPHardwareDataType | grep -E "Chip|Memory"; python --version; pip list 2>/dev/null | grep -Ei "^(ultralytics|coremltools|mlx|typesafe-sdk|torch|numpy) "; pmset -g | grep -E "^ *(sleep|disksleep)"; ls -la edge/detector/models/; } 2>&1
cat ~/day0/bench-no-yolo.json
cat ~/day0/bench-yolo-ane.json
cat ~/day0/bench-yolo-cpu.json
```

結果は `docs/reports/2026-11-0X-day0-mac-mini.md` にメインセッションがまとめる。

## うまくいかないとき

| 症状                                                                    | 確かめること                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `python3` が 3.14 / 3.10 以下                                           | 下の「Python が合わないとき」                                                                                               |
| `pip install` が `numpy` で衝突                                         | `pip install "numpy<=2.3.5"`。Ultralytics の CoreML 書き出しは numpy 2.3.5 までを要る                                       |
| `export_yolo_world.py` が `ultralytics が無い`                          | venv が有効か（`which python`）。`pip install -e "edge/detector[day0]"`                                                     |
| 書き出しの途中で CLIP の取得に失敗                                      | ネットワークと `git --version`。手順 4 の 2 行目をもう一度。企業のプロキシ内なら `git` の設定                               |
| `YOLOWorld (original version) export is not supported`                  | 重みが v1。既定の `yolov8s-worldv2.pt` を使う（`--weights` を変えていないか）                                               |
| `l0 の読み方で読めない` / `出力の名前が l0 の読み方と合わない`          | スクリプトの出力をそのまま貼る（合わせ方はスクリプト側で直す。l0 は変えない）                                               |
| `shape_verified: false`                                                 | `--check-image` の写真に鹿が写っていない。別の写真で `--force` を付けて再実行                                               |
| bench が exit 3、`L1 の回答率が低い` / `warmup が 1 度も成功していない` | 800 ms を超える呼び出しが多い。`failures`・`warmup_failures` と `p95_ms_failures_as_timeout` を貼る                         |
| bench が exit 3、`L1 から 1 件も答えが来ない`                           | ターミナル B が動いているか。`curl -s http://127.0.0.1:8766/healthz`。`failures`（`connect` / `timeout` / `http`）を貼る    |
| `warmup_failures` が出る                                                | 初回のモデル読み込みが長い。`--warmup-timeout-ms 300000` で再実行。繰り返すなら B のログを貼る                              |
| `p95_ms` が 800 を超える                                                | 800 ms は実行時のタイムアウト（超えると L1 は無視される）。数字をそのまま貼る（判断は後）                                   |
| `local-jev serve` が `model_unavailable`                                | 重みの取得中か失敗。B のログ。`~/.cache/huggingface` の空き容量（`df -h ~`）                                                |
| 併走の判定が無効（`yolo_errors` / `yolo_not_ready`）                    | YOLO の推論が例外を出した、または立ち上がらなかった。`l0_alone.last_error` を貼る（モデルのパス・compute units を確かめる） |
| 併走の判定が無効（`l1_failed_during_overlap`）                          | 併走中に local-jev が落ちた（メモリ不足の疑い）。B のログと `memory_pressure` を貼る                                        |
| bench が `ConfigError: ... names`                                       | モデルが鹿を持たない。手順 7 をやり直す（`--force`）                                                                        |

### Python が合わないとき

`uv`（Python の版を指定して venv を作る道具。ネットワーク）を使う。

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
exec $SHELL -l
cd ~/work/antler
uv venv --python 3.12 edge/detector/.venv
source edge/detector/.venv/bin/activate
uv pip install -U pip
```

以降は手順 3 の `sh scripts/setup.sh` から続け、`pip` は `uv pip` に読み替えてよい。local-jev も同様に `uv venv --python 3.12 .venv` で作る。

## 付録: Step 6 の比較実験（後日。サーバー 1 台で複数モデル）

`--systems` のモデルは local-jev が要求ごとに読み込む。`nli-deberta-large`（0.87 GB）は初回に取得される。

```sh
python scripts/bench_l1.py --compare --scenarios 200 --systems llm-qwen2.5-1.5b nli-deberta-large --out ~/day0/compare.json
```

- ルール（L0 の track だけ）と、モデルごとの正解率・ECE・p50/p95 が出る
- 要求したモデルと違うモデルが答えた系は `valid: false` になり、exit 3（別のモデルの数字を載せない）
- fmev（macOS 27）は未実装。結果を `docs/requirements/ch9-decisions.md` ④ の判断欄の下に貼る（判断はユーザー）
