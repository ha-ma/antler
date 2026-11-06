---
feature: dataset-train
target_paths:
  - dataset/train_l0.py
  - dataset/train_sources.toml
  - dataset/tests/test_train_l0.py
  - dataset/README.md
spec_confirmed_at:
tier: 1
---

# 仕様: dataset-train（L0 の鹿の検出器の学習スクリプト: 許可された素材 → 学習用データ → 再学習 → CoreML → 評価）

## 概要

ch10-plan.md の Day 5「学習スクリプト（A キャプチャ＋実写→再学習→CoreML）」。ゲートは「データループが 1 周回る」。
`dataset/train_l0.py` に 4 つの段を置く:

1. `build` — `dataset/train_sources.toml` に書いた素材（YOLO のラベル付き画像、Capture の保存フォルダ）から、学習用のフォルダ（`images/{train,val}`・`labels/{train,val}`・`dataset.yaml`・`manifest.json`）を作る。**使ってよい用途とライセンスを機械で確かめ、評価専用の素材を学習側に入れない**
2. `train` — Ultralytics で、元の重み（既定は COCO の `yolo26n.pt`）から鹿 1 クラスを学習し、新しい名前で `edge/detector/models/` に置く。学習の記録（model card）を同じ名前の JSON に書く
3. `export` — NMS 付きの CoreML（`.mlpackage`）に書き出し、L0 自身の読み込み（`load_coreml_detector`）で出力の形を確かめる
4. `evaluate` — 評価専用の素材と val に、L0 と同じ 640×480 のフレームで検出を通し、位置の一致（IoU 0.5・確信度 0.25）で TP / FN / FP を数えて JSON に書く

要件: ch10-plan.md Day 5、ch4-edge.md B2-2（YOLO・`deer` クラス）・B2-5（同意のある Capture だけを使う）、ch5-common.md（データ同意）、ch6-nfr.md（ライセンス: CC0 / CC-BY / 自作のみ。写真は許諾のあるもの）、ch7-data.md（Capture）。
既存: `docs/specs/edge-l0`（CoreML の出力の形・CU-2f の 80 の倍数の埋め）、`docs/specs/edge-capture`（Capture の保存・`xywh` は左上基準 `docs/changes/2026-11-04-capture-xywh-top-left.md`）、`dataset/README.md`・`dataset/PRIVATE-DATA.md`（素材の用途）。

**範囲外**（別 feature・別の判断）:

- Osaki さん・Yuki Fujita さんの写真の箱のラベル付け（いまラベルが無いので学習に入らない）。モデルの予測をそのまま正解にしない。予測を `by: model` の候補として人が直す道具（prelabel）は次の feature
- S データ（合成 600 枚）と生成鹿 8 種（ch9 ③「学習データ配布の可否確認」が未）。CC BY-SA の Commons（ch6 の判断待ち。いまは評価専用）
- 閾値の調整（Day 5 の同じ行。調査走行の記録が要る）
- Mac mini（M1）での学習・ANE の fps（edge-day0 の手順書、ユーザーの実機作業）
- 学習した重みの採用（L0 の `infer.model_path` を変えるかは、評価を見てユーザーが決める）

**Tier 1 の根拠**: 認可・永続化スキーマ（DB・API の形）・外部への送信・並行性を足さない。書くのは手元のファイル（`dataset/out/`・`edge/detector/models/`。どちらも gitignore 済み）だけ。元の重みは手で置く（スクリプトはダウンロードしない）。

## 依存

- 新しい依存は足さない。テストと `build`・評価の数え方は標準ライブラリ・`numpy`・`jsonschema`（edge/detector の dev 依存）だけで動く
- 学習・書き出し・画像の読み込み（`ultralytics`・`coremltools`・`opencv`）は extra `day0` の環境だけにある。これらを呼ぶ薄い関数は差し替えられるようにし、テストは偽物を渡す（実物はカバレッジから外す。`l0/coreml.py` の `_to_pil` と同じ）
- Capture の検証は `packages/schema/json/capture.schema.json`（凍結した schema）を `jsonschema` で読む

## Example Map

Story: B の開発者として、使ってよいと確かめた素材だけで鹿の検出器を学習し直し、L0 がそのまま読める CoreML にして、前のモデルと同じ数え方で比べたい。評価専用の素材や同意の無い Capture が学習に混ざる事故は、人の注意ではなく道具が止める。

- R1: 素材の一覧（`dataset/train_sources.toml`）
  - 1 素材 = `[[source]]` 1 つ。キーは `name`・`kind`（`yolo` / `capture`）・`path`（`dataset/` からの相対）・`license`（`CC0` / `CC-BY` / `CC-BY-SA` / `self` / `permission`）・`use`（`train` / `eval`）。知らないキー・値、重複した `name` → エラー（キー名つき）
  - `use = "train"` にできるのは `license` が `CC0`・`CC-BY`・`self`（自作。A のキャプチャ）・`permission`（撮影者の許諾。PRIVATE-DATA.md）だけ。**`CC-BY-SA` は `eval` だけ**（ch6 の許可リスト外）。違反 → エラーで何も書かない
  - 置き場所が無い素材 → エラー（黙って 0 件にしない）
- R2: YOLO のラベル付き画像（`kind = "yolo"`）
  - `images/<分割>/*.jpg` と `labels/<分割>/*.txt`（1 行 `0 cx cy w h`、中心基準の正規化）。ラベルの無い画像は鹿なし（負例）
  - `use = "train"` の素材は、元の分割（`train` / `val`）をそのまま使う。`test` などそれ以外の分割は評価側に回す
  - 同じグループ（ファイル名の最初の `_` より前。Commons は動画 ID）が train と val の両方にある → エラー（同じ動画の近いフレームを両側に入れない）
  - `use = "eval"` の素材は分割に関係なく全部を評価に使う
  - クラスが 0 でない行・座標が 0〜1 の外・列数違い → エラー（ファイル名と行番号つき）
- R3: Capture（`kind = "capture"`）
  - 2 つの置き方を読む: api の保存（`{key}.json` が `{capture, file, …}`、画像は `file`）と edge の保存（`{id}.json` が Capture そのもの、画像は `{id}.jpg`）。JSON が完成のしるしなので、JSON の無い画像は読まない
  - `capture.schema.json` に通らない・画像が無い → その Capture は使わず、理由ごとに数える（`skipped`）
  - **`consent` が `true` のものだけ**（B2-5・ch5）。`false` は数えて捨てる
  - **箱は `by = "user"` だけを正解にする**（`by = "model"` はモデルの予測で正解ではない）。user の箱が 1 つも無い Capture は使わない
  - `xywh` は左上基準 → YOLO の中心基準 `(x + w/2, y + h/2, w, h)` に直す。0〜1 に切り、幅か高さが 0 になった箱は捨てる
  - 分割: グループ = `source` と `createdAt` の日付（UTC の YYYY-MM-DD）。`sha256("{seed}:{グループ}")` の値で、既定 20% のグループを val に、残りを train にする（乱数を使わず、同じ seed で同じ分割）
- R4: 漏れの検査
  - 画像の SHA-256 が学習側（train・val）と評価側の両方にある → エラー
  - 学習側の鹿の箱が 0 個 → エラー（学習にならない）
- R5: 出力（`build`）
  - `dataset/out/train/<run>/` に `images/{train,val}/`・`labels/{train,val}/`（画像はコピー。名前は `<素材名>__<元の名前>`）、`dataset.yaml`（このフォルダの絶対パス・`names: {0: deer}`）、`manifest.json`
  - `manifest.json`: 素材ごとの件数（使った・捨てた理由ごと）、画像ごとの元の素材・分割・グループ・SHA-256・ライセンス、評価側の画像の一覧、seed、val の割合。Capture から持つのは `id`・`source`・`roadSegment`・`createdAt` の日付だけ（**緯度経度・端末の情報を書かない**。Capture にも無い）
  - `<run>` のフォルダが既にある → エラー（上書きしない）。`<run>` は英小文字・数字・`-` だけ
- R6: 学習（`train`）
  - 引数: `--run`（build の出力）、`--name`（重みの名前）、`--seed`（必須）、`--base`（既定 `edge/detector/models/yolo26n.pt`）、`--epochs`（既定 60）、`--imgsz`（640）、`--batch`（8）、`--device`（既定 `auto` = MPS が使えれば `mps`、なければ `cpu`）
  - `edge/detector/models/<name>.pt` が既にある → エラー（上書きしない）。元の重みが無い → エラー
  - 学習の記録 `<name>.json`（model card）: 元の重みの名前と SHA-256、`manifest.json` の SHA-256、素材とライセンスの一覧、seed・epochs・imgsz・batch・device、ultralytics の版、作った日時。`CC-BY-SA` を学習に入れていないことを書く
- R7: 書き出し（`export`）
  - NMS 付き CoreML（`imgsz` 640、`conf` 0.25、`iou` 0.7）。**`conf` が `[tracker] min_conf`（既定 0.4）より大きい → エラー**（トラッカーが追う 0.4 未満の鹿が NMS で消えるため。edge-day0 と同じ決まり）
  - 書き出した `.mlpackage` を `load_coreml_detector` で読み、黒い 640×480 で `detect` が例外なく返ることを確かめる。失敗 → exit 1（書いたものは消さず、失敗を表示）
  - `<name>.mlpackage` が既にある → エラー
- R8: 評価（`evaluate`）
  - 入力: 重み（`.pt` または `.mlpackage`）と build の出力。評価するのは「評価側の画像」と「val」で、別々に数える
  - 画像は 640×480 に縮めてから検出に渡す（B2-1。L0 と同じ入力）。`.mlpackage` は L0 の `load_coreml_detector` を通す
  - 数え方: 確信度 0.25 以上の鹿の予測を、確信度の高い順に、まだ使っていない正解のうち IoU が最大のもの（0.5 以上）に当てる。当たり = TP、当たらない正解 = FN、余った予測 = FP。鹿なし画像で予測が出た枚数も数える。素材ごとと合計
  - 結果を `dataset/out/eval/<重みの名前>.json` に書き、1 行の要約を表示する。速度は数えない（開発機の数字を Mac mini の値と混同しないため）

## ユースケース

### UC-1: 素材の一覧を読む（R1）

- **Given**: `train_sources.toml`
- **When**: `build`
- **Then**: 許可された用途とライセンスの素材だけが読まれ、違反・知らないキー・置き場所の無い素材はエラー

### UC-2: YOLO の画像を集める（R2）

- **Given**: 分割済みの YOLO の画像とラベル
- **When**: `build`
- **Then**: train / val は元の分割のまま、それ以外と評価専用は評価側。グループが両側にまたがればエラー

### UC-3: Capture を集める（R3）

- **Given**: api と edge の置き方の Capture（同意あり・なし、user と model の箱、壊れたもの）
- **When**: `build`
- **Then**: 同意があり user の箱がある Capture だけが中心基準のラベルになり、日付のグループで決まった分割に入る。捨てたものは理由ごとに数える

### UC-4: 漏れと出力（R4・R5）

- **Given**: 集めた画像
- **When**: 書き出す
- **Then**: 学習側と評価側の重なりや鹿 0 個はエラー。そうでなければ dataset.yaml と manifest.json ができ、既存の run は上書きしない

### UC-5: 学習（R6）

- **Given**: build の出力と元の重み
- **When**: `train`（偽の学習器）
- **Then**: seed・元の重み・データ・device が学習器に渡り、新しい名前の重みと model card ができる。既存の名前は上書きしない

### UC-6: 書き出し（R7）

- **Given**: 学習した重み
- **When**: `export`（偽の書き出し器）
- **Then**: NMS 付き・conf 0.25 で書き出され、L0 の読み込みで確かめられる。conf が min_conf を超える・確かめに失敗 → エラー

### UC-7: 評価（R8）

- **Given**: 正解のある評価側の画像と、決まった予測を返す偽の検出器
- **When**: `evaluate`
- **Then**: TP / FN / FP と鹿なし画像の誤報が素材ごとに数えられ、JSON に書かれる

## 状態パターン

### S-1: 素材が 1 つも使えない

- **Given**: 全部の Capture が同意なし、または箱が model だけ → **Then**: 学習側の鹿が 0 個のエラーで止まり、何も書かない

### S-2: 途中で失敗した

- **Given**: build の途中でエラー → **Then**: 作りかけの `<run>` フォルダを残さない（一時フォルダに作ってから名前を付ける）

## Questions（Deferred のみ残存可）

決着済み（2026-11-06、推奨で決定。PR にも書く）:

- 元の重み → COCO の `yolo26n.pt`（Ultralytics v8.4.0 の公式配布と SHA-256 一致を確かめて手で置く）。受け取った `yolo26n-deer-20261105.pt` は CC BY-SA を含む学習の派生なので既定にしない。`--base` で明示すれば使え、model card に残る
- 素材の用途の決め方 → 一覧ファイルに `license` と `use` を書き、道具が許可リストで止める（README の表を人が守るだけにしない）
- Capture の分割 → 日付のグループの seed 付きハッシュ（同じ走行・同じ日の連続したフレームを両側に入れない）
- 評価の数え方 → 外部の研究と同じ（確信度 0.25・IoU 0.5）で、前のモデルと比べられるようにする
- 学習の承認ゲート → CLAUDE.md の「推奨で決めて進める」に従う

- [Deferred: 担当=人 B（prelabel の feature、未起票）/ 期日=2026-11-07 / 暫定挙動=ラベルの無い写真（Osaki さん 47 枚・Yuki Fujita さん 8 枚）は一覧に書かない。学習に入らない] 写真の箱のラベル付け
- [Deferred: 担当=ユーザー（ch6 の CC BY-SA・ch9 ③ の判断）/ 期日=2026-11-07 / 暫定挙動=CC BY-SA は `eval` だけ、S データは一覧に書かない] 学習に使える素材を増やすかどうか
- [Deferred: 担当=人 B（調査走行のあと）/ 期日=2026-11-07 / 暫定挙動=評価は静止画のフレーム単位だけ。遭遇単位の見逃し・初めて検知した時刻・走行時間あたりの誤報は数えない] 動画・遭遇単位の評価

## Test List（Canon TDD Step 1）

外側ループ（受け入れ。Day 5「データループが 1 周」）:

- [ ] AC-1: 一時フォルダの素材（YOLO の train / val / test、評価専用の YOLO、api と edge の置き方の Capture）で `build` → 偽の学習器で `train` → 偽の書き出し器と偽の読み込みで `export` → 偽の検出器で `evaluate` を通すと、dataset.yaml・manifest.json・重み・model card・`.mlpackage`・評価の JSON ができ、評価専用の画像は学習側に 1 枚も無く、同意なし・model の箱は使われていない

UC-1 素材の一覧:

- [ ] SRC-1a: 一覧を読む。知らないキー・`kind`・`license`・`use`、重複した `name`、置き場所の無い素材 → エラー（キー名・素材名つき）
- [ ] SRC-1b: `use = "train"` で `CC-BY-SA` → エラー。`CC-BY-SA` の `use = "eval"` は通る。`CC0`・`CC-BY`・`self`・`permission` の train は通る

UC-2 YOLO:

- [ ] YOLO-1a: train / val は元の分割、test は評価側、ラベルの無い画像は鹿なし
- [ ] YOLO-1b: 同じグループが train と val にある → エラー。クラス違い・範囲外・列数違いの行 → エラー（ファイル名・行番号つき）

UC-3 Capture:

- [ ] CAP-1a: api の置き方（`{capture, file}`）と edge の置き方（Capture そのもの＋`{id}.jpg`）の両方を読む。JSON の無い画像は読まない
- [ ] CAP-1b: 同意なし・schema 違反・画像なし・user の箱が無い Capture は使わず、理由ごとに数える。model の箱は正解にしない
- [ ] CAP-1c: 左上基準 → 中心基準。0〜1 に切り、幅か高さが 0 の箱は捨てる
- [ ] CAP-1d: 分割は `source` と日付のグループごとで、同じ seed なら同じ。同じグループは同じ側

UC-4 漏れと出力:

- [ ] OUT-1a: 学習側と評価側に同じ SHA-256 の画像 → エラー。学習側の鹿 0 個 → エラー（S-1）
- [ ] OUT-1b: dataset.yaml（絶対パス・`names: {0: deer}`）と manifest.json（件数・画像ごとの素材・分割・SHA-256・ライセンス、Capture は `id`・`source`・`roadSegment`・日付だけ）
- [ ] OUT-1c: 既存の `<run>` は上書きしない。不正な `<run>` の名前 → エラー。途中のエラーで作りかけを残さない（S-2）

UC-5 学習:

- [ ] TR-1a: 学習器に seed・元の重み・dataset.yaml・epochs・imgsz・batch・device が渡り、`<name>.pt` と model card（元の重みの SHA-256・manifest の SHA-256・素材とライセンス・seed など）ができる
- [ ] TR-1b: 既存の `<name>.pt`・元の重みが無い・不正な名前 → エラー。`--device auto` は MPS が使えれば mps、なければ cpu

UC-6 書き出し:

- [ ] EXP-1a: 書き出し器に NMS・imgsz 640・conf 0.25・iou 0.7 が渡り、`load_coreml_detector` で確かめる
- [ ] EXP-1b: conf が `[tracker] min_conf` より大きい → エラー。確かめで例外 → exit 1。既存の `.mlpackage` → エラー

UC-7 評価:

- [ ] EV-1a: 確信度順・IoU 0.5 以上・正解は 1 回だけ使う当て方で TP / FN / FP、鹿なし画像の誤報の枚数。確信度 0.25 未満は数えない
- [ ] EV-1b: 評価側と val を別々に、素材ごとと合計で数え、`dataset/out/eval/<名前>.json` に書く。画像は 640×480 にしてから検出器に渡す

状態パターン:

- [ ] S-1: 使える素材が無い（OUT-1a と同じテストで確かめる）
- [ ] S-2: 途中の失敗で作りかけを残さない（OUT-1c と同じテストで確かめる）

## 非機能要件

- [ ] 決定性: 分割は seed 付きのハッシュで、乱数を使わない。同じ素材・同じ seed で同じ manifest（作った日時を除く）。学習の seed は必須の引数
- [ ] 個人情報: manifest・model card・評価の JSON に緯度経度・氏名・端末の情報を書かない。写真の画像そのものは `dataset/out/`（gitignore 済み）にだけ置く
- [ ] ruff と pytest のカバレッジ 70% 以上（`dataset/` 全体）。既存のテストが Green のまま

## 受け入れ基準

- [ ] 受け入れテスト AC-1 が Green
- [ ] 全 UC / 全状態パターンのテストが Green、既存テストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（ruff check・ruff format）
- [ ] code-reviewer の Critical 0
- [ ] 実データで 1 周（Commons の train / val・評価専用の BY-SA、開発用の Mac）を回し、結果を `docs/reports/2026-11-06-dataset-train-run.md` に残す（M2 での値で、Mac mini の値ではないと書く）
