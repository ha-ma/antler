---
feature: dataset-train
target_paths:
  - dataset/train_l0.py
  - dataset/train_sources.toml
  - dataset/tests/test_train_l0.py
  - dataset/README.md
  - dataset/self_labels.py
  - dataset/self_labels.toml
  - dataset/compare_l0.py
  - dataset/tests/test_self_labels.py
  - dataset/tests/test_train_l0_sdata.py
  - dataset/tests/test_compare_l0.py
spec_confirmed_at: f6c0103
tier: 1
---

> **2026-11-07 更新（sdata 比較、引き継ぎメモ 0 節の順 4）**: 自分で撮った映像（`kind = "self"`、R9）・S データ（`kind = "synth"`、R10）・鹿のいない画像（`kind = "negatives"`、R11）を一覧に足し、実写の鹿の箱を台帳（`dataset/self_labels.toml`、R12）に付け、漏れの検査を走行（`group`）単位で素材をまたいで効かせる（R4 の追記）。評価に後処理（l0-fp-filter）あり / なしと、鹿のいない連続したフレームでの 1 分あたりの連続した誤報を足し（R13）、「実写のみ」と「実写＋S データ」を同じ条件で比べる `dataset/compare_l0.py`（R14）を置く。Deferred の「S データは一覧に書かない」と「動画・遭遇単位の評価」の一部を解消した。

> 2026-11-07 dataset-synth（`docs/specs/dataset-synth/functional.md`）が `dataset/README.md` に合成画像の置き場所（`private/self-synth/`）・回し方・使う Blender を足した。`train_sources.toml` と `train_l0.py` は変えていない。合成画像の登録（`files[].group` での漏れの検査を含む）は dataset-synth の Deferred のとおり、この feature の次の cycle で行う。

> 2026-11-06 sdata-materials（`docs/reports/2026-11-06-sdata-research.md`）が `dataset/README.md` に Mapillary の画像（評価専用・ラベルなし）と 3D の鹿 M01〜M04 の置き場所と取得方法を足した。`train_sources.toml` と `train_l0.py` は変えていない。Mapillary の画像の登録（「鹿のいない画像」の `kind`）と「S データは一覧に書かない」Deferred の解消は、この feature の次の cycle で行う。

# 仕様: dataset-train（L0 の鹿の検出器の学習スクリプト: 許可された素材 → 学習用データ → 再学習 → CoreML → 評価）

## 概要

ch10-plan.md の Day 5「学習スクリプト（A キャプチャ＋実写→再学習→CoreML）」。ゲートは「データループが 1 周回る」。
`dataset/train_l0.py` に 4 つの段を置く:

1. `build` — `dataset/train_sources.toml` に書いた素材（YOLO のラベル付き画像、Capture の保存フォルダ）から、学習用のフォルダ（`images/{train,val}`・`labels/{train,val}`・`dataset.yaml`・`manifest.json`）を作る。**使ってよい用途とライセンスを、一覧の自己申告ではなく素材の manifest と実体のパスで確かめ、評価専用・同意なし・確かめていない素材を学習側に入れない**
2. `train` — build の出力が manifest どおりであることを確かめてから、Ultralytics で元の重み（既定は COCO の `yolo26n.pt`）から鹿 1 クラスを学習し、最終 epoch の重みを新しい名前で `edge/detector/models/` に置く。学習の記録（model card）を同じ名前の JSON に書く
3. `export` — NMS 付きの CoreML（`.mlpackage`）に書き出し、L0 自身の読み込み（`load_coreml_detector`）で出力の形を確かめる
4. `evaluate` — 評価側の画像と val に、L0 と同じ入力（640×480 に縮め、モデルの入力へ引き伸ばす）で検出を通し、位置の一致（IoU 0.5）で TP / FN / FP を数えて JSON に書く

> 2026-11-07 dataset-footage（`docs/specs/dataset-footage/functional.md`）で `dataset/README.md` に自分で撮った映像の行（置き場所・取得方法・分け方）を足した。`train_l0.py` の挙動は変わらない（`self` の YOLO の素材はまだ受けない。登録はこの feature の更新で行う）。

**いまの素材で回る 1 周は Commons（CC0 / CC BY）の 29 枚だけ**（Capture は 0 枚: A の「見つけた」はまだ無く、edge の Capture の箱は必ず `by: model` で、vehicle の Capture はユーザーの判断待ち）。Capture を読む仕組みは作って偽の Capture で確かめ、実物が来たら一覧に足すだけで入る。

要件: ch10-plan.md Day 5、ch4-edge.md B2-1・B2-2（YOLO・`deer` クラス）・B2-5（同意のある Capture だけ）、ch5-common.md（データ同意）、ch6-nfr.md（ライセンス: CC0 / CC-BY / 自作のみ。写真は許諾のあるもの）、ch7-data.md（Capture）。
既存: `docs/specs/edge-l0`（CoreML の出力の形・CU-2f の 80 の倍数の埋め）、`docs/specs/edge-capture`（Capture の保存・`xywh` は左上基準 `docs/changes/2026-11-04-capture-xywh-top-left.md`）、`dataset/README.md`・`dataset/PRIVATE-DATA.md`（素材の用途）。
敵対レビュー: `docs/reports/2026-11-06-spec-adversary-dataset-train.md`（C1〜C4・W1〜W8・I1〜I6 を取り込んだ。取り込み方は Questions の決着済みに書く）。

**範囲外**（別 feature・別の判断）:

- Osaki さん・Yuki Fujita さんの写真の箱のラベル付け（いまラベルが無いので学習に入らない）。モデルの予測をそのまま正解にしない。予測を `by: model` の候補として人が直す道具（prelabel）は次の feature
- 研究の S データ（2D の生成鹿の合成 600 枚）と生成鹿 8 種（AI 生成。ch9 ③ の b＋d の対象外）。CC BY-SA の Commons と Mapillary（ch6 の許可リスト外。評価専用）
- 重みを外に配ること（AGPL の Ultralytics と、配布不可（`distribution = "not_allowed"`）の private の素材で学習した重み。配るならユーザーに聞く。model card に配布不可と書く）
- 2026-11-07 の夜に届く鹿の映像の匿名化（dataset-footage の手順。テスト専用の走行は `self_footage.toml` で `split = "test"` にする）
- **vehicle の Capture（実際の道路の画像）を `dataset/out` に入れること**（edge-capture の Deferred「実写の画像を dataset/ に入れない」。担当=ユーザー）。読んでも `skipped: vehicle_pending` に数えて使わない
- 本番の api（Blob・Turso）から Capture を手元のフォルダへ持ってくる手順。この feature が読むのは手元のフォルダ（api のファイルの保存と、止めた edge からコピーしたフォルダ）だけ
- 閾値の調整（Day 5 の同じ行。調査走行の記録が要る）
- Mac mini（M1）での学習・ANE の fps（edge-day0 の手順書、ユーザーの実機作業）
- 学習した重みの採用（L0 の `infer.model_path` を変えるかは、評価を見てユーザーが決める）

**Tier 1 の根拠**: 認可・永続化スキーマ（DB・API の形）・外部への送信・並行性を足さない。書くのは gitignore 済みの手元のフォルダ（`dataset/out/`・`edge/detector/models/`）だけ。元の重みは手で置き、スクリプトはダウンロードしない。Ultralytics の利用状況の送信・自動インストール・ダウンロードは止める（R6）。第三者が投稿した Capture は、人が確かめた id の一覧にあるものだけを使う（R3）。

## 依存

- 新しい依存は足さない。テストと `build`・照合・評価の数え方は標準ライブラリ・`numpy`・`jsonschema`（edge/detector の dev 依存）だけで動く
- 学習・書き出し・画像の読み込み（`ultralytics`・`coremltools`・`opencv`）は extra `day0` の環境だけにある。これらを呼ぶ薄い関数は差し替えられるようにし、テストは偽物を渡す（実物はカバレッジから外す。`l0/coreml.py` の `_to_pil` と同じ）
- Capture の検証は `packages/schema/json/capture.schema.json`（凍結した schema）を `jsonschema` で読む

## Example Map

Story: B の開発者として、使ってよいと確かめた素材だけで鹿の検出器を学習し直し、L0 がそのまま読める CoreML にして、前のモデルと同じ数え方で比べたい。評価専用・同意なし・確かめていない素材が学習に混ざる事故は、人の注意ではなく道具が止める。

- R1: 素材の一覧（`dataset/train_sources.toml`）
  - 1 素材 = `[[source]]` 1 つ。キーは `name`（`^[a-z0-9][a-z0-9-]*$`）・`kind`（`yolo` / `capture` / `self` / `synth` / `negatives`）・`path`・`license`・`use`（`train` / `eval`）と、capture だけの `reviewed`（人が確かめた id の一覧のファイル）、self だけの `labels`・`negative_every`（R9）、synth だけの `footage`（R10）。知らないキー・値、`name` の重複、その kind に無いキー → エラー（キー名・素材名つき）
  - `license` は `CC0` / `CC-BY` / `CC-BY-SA` / `self`（自作）/ `permission`（撮影者の許諾）。`use = "train"` にできるのは `CC-BY-SA` 以外。**`CC-BY-SA` は `eval` だけ**（ch6 の許可リスト外）
  - `path` は `dataset/` からの相対。**実体のパス（realpath）が `dataset/` の中で、`raw/`・`out/` の外**であること。絶対パス・`..` で外へ出る・別の素材と同じ実体（大文字小文字だけ違う別名を含む）→ エラー。素材の中のシンボリックリンク（ファイルもフォルダも）→ エラー
  - 違反があれば何も書かない
- R2: YOLO のラベル付き画像（`kind = "yolo"`）
  - 置き方: `images/<分割>/*.jpg`・`labels/<分割>/*.txt`・`manifest.json`。**manifest の `files[]`（`image`・`label`・`video`・`sha256`）と `sources[video].license` を正にする**: manifest に無い画像・画像の無い manifest の行・SHA-256 の違い → エラー
  - ライセンスの照合: `files[]` の動画のライセンスを `CC0` / `CC-BY` / `CC-BY-SA` に分類し（「CC0 …」「CC BY <版>」「CC BY-SA <版>」。それ以外は分類できずエラー）、**一覧の `license` が最も厳しいものと同じ**であること（`CC0` ＜ `CC-BY` ＜ `CC-BY-SA`）。違えばエラー（eval-by-sa を `CC-BY` と書いても止まる）。`self`・`permission` の YOLO の素材は、manifest の書き方を決める feature まで受けない（エラー）
  - ラベル: 1 行 `0 cx cy w h`。クラスが 0 でない・座標が 0〜1 の外・幅か高さが 0 以下・列数違い → エラー（ファイル名と行番号つき）。**負例は空のラベルファイルがある画像**。ラベルファイルの無い画像、画像の無いラベル、`.jpg` 以外の画像 → エラー
  - グループ = manifest の `video`。`use = "train"` の素材は、元の分割の `train` / `val` をそのまま使い、それ以外（`test` など）は評価側。`use = "eval"` の素材は全部を評価側
- R3: Capture（`kind = "capture"`）
  - 2 つの置き方を読む。JSON が完成のしるしなので、JSON の無い画像は読まない
    - api: `{key}.json` が `{capture, file, …}`。`{key}` が `^cap_[a-z0-9]+$` で `capture.id` を小文字にしたものと同じ、`file` が `^cap_[a-z0-9]+-[0-9a-f]{12}\.(?:jpg|png)$` で `{key}-` で始まり、画像の SHA-256 の先頭 12 桁がファイル名と同じ
    - edge: `{id}.json` が Capture そのもの。`{id}` が `^cap_[0-9a-f]{12}$` で JSON の `id` と同じ、画像は `{id}.jpg`
  - **`capture.image` はパスに使わない**（schema が絶対パスを通すため）。画像の実体がそのフォルダの中であること。外れたら `skipped: bad_path`。シンボリックリンクは R1 で素材全体のエラーになる（1 枚だけ捨てるより強く止める）
  - 使わないもの（理由ごとに `skipped` に数える）: schema 違反（`invalid`）、画像が無い（`no_image`）、**`consent` が `true` でない（`no_consent`）**、`source = "vehicle"`（`vehicle_pending`。範囲外）、`reviewed` の一覧に無い id（`not_reviewed`。api は認証が無く、`source`・`consent`・`by` を送る側が書けるため）、user の箱が無い（`no_user_box`）、同じ id か同じ画像の SHA-256 が既に入っている（`duplicate`。edge と api の両方にある同じ Capture など）
  - **箱は `by = "user"` だけを正解にする**（`by = "model"` は予測で正解ではない）
  - 箱の変換: 左上基準 `[x, y, w, h]` の角 `(x, y, x + w, y + h)` を 0〜1 に切ってから、中心基準 `(cx, cy, w, h)` に直す。幅か高さが 0 になった箱は捨てる
  - グループ = `source` と `createdAt` の**日本時間（Asia/Tokyo）**の日付。`use = "train"` のとき: グループを `sha256("{seed}:{グループ}")` の順に並べ、グループが 2 つ以上なら先頭の `k = max(1, round(val_ratio × n))` 個（既定 `val_ratio` 0.2、train に 1 つ以上残す）を val、残りを train にする。1 つだけなら全部 train にして「Capture の val なし」と manifest と表示に書く。`use = "eval"` のときは全部を評価側（同意・確かめの決まりは同じ）
  - `license` は `self`（A のキャプチャ）か `permission`。`vehicle` は使わないので、第三者の提供物を `self` と呼ぶ場面は無い
- R4: 漏れの検査（素材をまたいで 1 つの名前空間で見る。グループ名は `<素材の kind>:<グループ>`、YOLO の動画 ID は素材をまたいで同じものとして扱う）
  - 同じグループが train と val の両方 → エラー。**学習側（train・val）と評価側の両方に同じグループ** → エラー
  - 画像の SHA-256 が学習側と評価側の両方 → エラー
  - 学習側の鹿の箱が 0 個・val の画像が 0 枚 → エラー（学習にならない）
- R5: 出力（`build`）
  - `dataset/out/train/<run>/`（`<run>` は `^[a-z0-9][a-z0-9-]*$`）に `images/{train,val}/`・`labels/{train,val}/`（画像はコピー。名前は `<素材名>__<元の名前>`。大文字小文字を区別しない比較で衝突 → エラー）、`dataset.yaml`（このフォルダの絶対パス・`names: {0: deer}`）、`manifest.json`
  - `manifest.json`: 素材ごとの件数（使った・`skipped` の理由ごと）と train / val / 評価側に入った枚数、画像ごとの素材・分割・グループ・元の名前・SHA-256・ライセンス、評価側の画像の一覧、素材の `labels_note`、seed、`val_ratio`。Capture から持つのは `id`・`source`・日付だけ（**`roadSegment`・緯度経度・端末の情報を書かない**）。決定性の約束はこの manifest について（作った日時を除き、同じ素材・同じ seed で同じ内容）
  - `<run>` は `os.mkdir` で作る（既にある → エラー。上書きしない）。途中のエラーではそのフォルダを消してから止める
- R6: 学習（`train`）
  - 引数: `--run`、`--name`（`^[a-z0-9][a-z0-9-]*$`）、`--seed`（必須）、`--base`（既定 `edge/detector/models/yolo26n.pt`）、`--epochs`（60）、`--imgsz`（640）、`--batch`（8）、`--device`（`auto` = MPS が使えれば `mps`、なければ `cpu`）
  - 学習の前に、`images/{train,val}`・`labels/{train,val}` のファイルの集まりが manifest と同じ（余分も欠けも無く、画像の SHA-256 も同じ）で、`dataset.yaml` の `path` がそのフォルダであることを確かめる。違えばエラー（build のあとの足し忘れ・差し替え・別の機械へのコピーは build し直す）。Ultralytics がラベルの読み込みで書く `*.cache` は数えない（2 回目の学習を止めないため。code-reviewer W1）
  - `edge/detector/models/` に `<name>.pt`・`<name>.json`・`<name>.mlpackage` のどれかが既にある → エラー。元の重みが無い → エラー
  - 元の重みは SHA-256 で見分ける: COCO の `yolo26n.pt`（Ultralytics v8.4.0 の配布物）なら「BY-SA を含まない」。`yolo26n-deer-20261105.pt` なら `--allow-by-sa-base` が無いとエラーで、あれば model card に「元の重みに CC BY-SA の学習を含む」と書く。知らない SHA → エラー（出所の分からない重みから学習しない）
  - Ultralytics には `project = dataset/out/train/<run>/ultralytics`・`seed`・`deterministic`・`plots = False` を渡し、学習の前に利用状況の送信（`sync`）を切り、オフライン（`YOLO_OFFLINE`）にする。**最終 epoch の `last.pt` を使う**（val で選んだ best.pt は使わない。外部の研究と同じ）。場所は Ultralytics の `trainer.last` から取る（推測しない）。`<name>.pt` へは既にあれば失敗する書き方でコピーし、コピーの途中で失敗したら半端なファイルを消す
  - model card `<name>.json`: 元の重みの名前・SHA-256・出所の判定、manifest の SHA-256、素材とライセンス（CC BY の帰属表示は CREDITS.md の行を指す）、seed・epochs・imgsz・batch・device、ultralytics の版、作った日時。パスは `dataset/` からの相対。MPS では同じ seed でも学習が完全には一致しないことを書く
- R7: 書き出し（`export`）
  - NMS 付き CoreML（入力は **L0 のフレームと同じ 640×480**（`imgsz` [480, 640]）、`conf` 0.25、`iou` 0.7）。正方形の 640×640 で書き出すと、L0 が 640×480 を余白なしで引き伸ばすため縦横比が崩れ、実データの val で前のモデルの TP が 5/13 → 1/13 に落ちた（`docs/reports/2026-11-06-dataset-train-run.md`。edge-l0 の Deferred「精度が落ちるなら 640×480 の入力でエクスポートし直す」を実施）。**`conf` が `[tracker] min_conf`（既定 0.4）より大きい → エラー**（トラッカーが追う 0.4 未満の鹿が NMS で消えるため。edge-day0 と同じ決まり）
  - `<name>.mlpackage` が既にある → 書き出しの前にエラー（Ultralytics は重みの隣に黙って上書きするので、一時フォルダで書き出してから名前を付ける）
  - 書き出したものを `load_coreml_detector` で読み、黒い 640×480 で `detect` が例外なく返ることを確かめる。失敗 → exit 1（書いたものは残し、失敗を表示）
- R8: 評価（`evaluate`）
  - 入力: 重み（`.pt` または `.mlpackage`）と build の出力。「評価側」と「val」を別々に、素材ごと・グループ（動画）ごと・合計で数える（前のモデルの学習に入っていたグループを読み手が分けられるように）
  - 前処理は L0 と同じ: 640×480 に縮め、`.mlpackage` は `load_coreml_detector` に渡す（モデルの入力が 640×640 なら L0 が引き伸ばす）。`.pt` は export と同じ 640×480 の入力で Ultralytics に渡す。評価の前に、画像の SHA-256 を manifest と照合する（違えばエラー）。クラスは `names` の `deer` を使い、無ければエラー。JSON に前処理の名前を書く
  - 数え方: 確信度が閾値**以上**の鹿の予測を、確信度の高い順（同じなら出てきた順）に、まだ使っていない正解のうち IoU が最大のもの（同じなら先の正解）に当て、IoU が 0.5 以上なら TP。当たらない正解 = FN、余った予測 = FP。鹿なし画像で予測が出た枚数は FP と別の項目（`negative_images_with_detection`）。閾値は 0.25（外部の研究と比べる）と 0.4（トラッカーが追う下限）の 2 つ。再現率・適合率は分母が 0 なら `null`
  - 結果を `dataset/out/eval/<重みの名前>.<pt|mlpackage>.<run>.json` に書く（既にある → エラー）。素材の `labels_note`（「AI による目視の概算ラベル」など）を写し、1 行の要約を表示する。速度は数えない（開発機の数字を Mac mini の値と混同しないため）
- R9: 自分で撮った映像（`kind = "self"`。dataset-footage の `private/self-footage/`）
  - 一覧のキーは R1 に加えて `labels`（R12 の台帳。**一覧のファイルと同じフォルダからの相対**で、その中の実体であること。`--root` を main の checkout の `dataset/` にしても Git の台帳を読むため）と `negative_every`（鹿なしのフレームを何枚おきに使うか。1 以上の整数、既定 1）。`license` は `self` だけ
  - 素材の manifest の `license` が `self`、`allowed_use` に一覧の `use` が入っていること。`drives`（走行 → 分割）と各行の `group`（`self:<drive>`）・`split` が食い違わないこと。違えばエラー。画像の実体・SHA-256 は R2 と同じに確かめる（manifest に無い画像・無い行・SHA の違い → エラー）
  - 分割は**走行の分割**（`drives`）をそのまま使う: `train` → train、`val` → val、`test` → 評価側。`use = "eval"` の素材は全部を評価側。グループは manifest の `group`（走行）。クリップの単位では分けない
  - 鹿ありのフレーム（`deer = true`）は台帳の状態で決める: `box` → 箱つきで使う、`empty`（鹿が見えないと確かめた）→ 鹿なしとして使う、`ignore` → 使わない（`skipped: ignore`）。**台帳に無い鹿ありのフレーム → エラー**（付け忘れを黙って負例にしない）
  - 鹿なしのフレーム（`deer = false`）は、動画ごとにフレーム番号の順で `negative_every` 枚おき（先頭から）を使い、残りは `skipped: thinned`。評価側（`test`・`val`）の鹿なしのフレームは間引かない（連続した誤報の分母にするため）。台帳で `ignore` にしたものは使わない
  - manifest から持つのは `video`・`frame`・`t`・`drive` と、間隔（`every_frames` と `fps`）だけ。`area`・撮影の時刻・機種は run の manifest に写さない
- R10: S データ（`kind = "synth"`。dataset-synth の `private/self-synth/<run>/`）
  - **`use = "train"` だけ**（合成で測った精度は根拠にしない）。`eval` → エラー。一覧のキー `footage`（同じ一覧の `kind = "self"` の素材名）が要る。無い・その素材が一覧に無い → エラー
  - 素材の manifest の `kind = "synth"`・`license = "self"`・`allowed_use` に `train` があること。画像と YOLO のラベルは R2 と同じに確かめる（manifest の `files[]` の `image`・`label`・`sha256`）
  - **グループは manifest の自己申告を使わない**: 各行の `background.sha256` を `footage` の素材の manifest で引き、その行の `image` が `background.image` と同じで、その走行の `group` を付ける。引けない・画像が違う・manifest の `group` と違う → エラー。**背景の走行の分割が `train` でない → エラー**（S データの背景の走行を val・テストに使わない）。背景の行の `uses` に `synth_background` が無い・背景が台帳で `ignore`（目で見て鹿がいた・判断できない）→ エラー（写っている実鹿に箱の無い合成を学習に入れない。adversary W2）
  - 全部を train に入れる（val は実写だけ）。`footage_manifest_sha256` が今の footage の manifest と違うのは、2 回目の取り込みで行が増えたときに起きるのでエラーにせず、manifest の `notes` に書く（上の引き当てで背景ごとに確かめるため）
- R11: 鹿のいない画像（`kind = "negatives"`。sdata-materials の `private/mapillary-doto/`）
  - **`use = "eval"` だけ**。ラベルは無く、全部を鹿なしとして評価側に入れる。manifest の `files[]` の `image`・`sha256` を R2 と同じに確かめる。`license` は manifest の `license` を R2 の分類で照合する
  - グループは撮影者（manifest の `split_rule`）。`creator_username` は run の manifest に名前で書かず、`negatives:<素材名>:c-<SHA-256 の先頭 10 桁>` にする。**run の manifest に写すのは許可リストだけ**（R5 の共通の項目＝元のパス・名前・SHA-256・ライセンスと、撮影者のハッシュ）。`area_rough`（経度緯度）・`region`・`source_page_url`・`attribution`・`sequence`・`month`・`camera_type` は写さない。元のパス（`<image_id>.jpg`）は評価で画像を読むのに要るので残す（run の manifest は private の manifest と同じ機械の gitignore 済みの `dataset/out/` にあり、private の manifest が既に全部を持つ。salt の無いハッシュは戻せうるので匿名化とは呼ばない。adversary W6）
- R4 の追記（走行単位の漏れ。adversary C1）
  - **`self` と `synth` のグループは kind の接頭辞を付けず、走行の `self:<drive>` をそのまま使う**（synth は R10 で引き当てた背景の走行）。ほかの kind は従来どおり `<kind>:<グループ>`。こうして同じ走行が素材をまたいで同じ名前になり、R4 の「train と val」「学習側と評価側」の検査が、同じ走行のフレームが学習とテストに混ざること（2 つの self の素材に分かれていても）、S データの背景の走行が評価側に入ること（`use = "eval"` の self の素材の train の走行を背景にした場合も）を止める
- R12: 実写の鹿の箱の台帳（`dataset/self_labels.toml`。Git に入れる。画像は入れない）
  - `[meta]`: `labeler`（付けた人）・`method`（付け方）・`date`・`negatives_checked`（必須。欠け → エラー）。`[[track]]`（1 頭の 1 区間）: `video`・`id`（同じ動画の中で一意。重複 → エラー）・`keys = [[frame, x1, y1, x2, y2], …]`（**匿名化した後のフレームの画素座標**で左上と右下。「画面の中」は manifest のその動画の `size`（いまは 1920×1080）で判定する）・`note`。`note`・`reason` に地名・路線名・距離標を書かない。`[[mark]]`: `video`・`frames`（フレーム番号の列）か `range = [始め, 終わり]`（両端を含む。その間の manifest のフレーム全部）のどちらか 1 つ・`status`（`empty` / `ignore`）・`reason`。知らないキー・`reason` の無い mark → エラー
  - 箱は track の隣り合うキーの間をフレーム番号で線形補間する（キーの外には伸ばさない）。キーのフレームは manifest にあり `deer = true` であること、キーはフレーム番号の昇順で重複なし、`x1 < x2`・`y1 < y2`・画面の中。`frames` のフレームが manifest に無い・`range` に manifest のフレームが 1 つも無い → エラー（打ち間違いを黙って通さない）
  - **`ignore` は track より優先**（そのフレームを丸ごと使わない。迷ったフレームを書き足すだけで外せるように）。`empty` と track が同じフレームに当たる → エラー（鹿がいる・いないの矛盾）。同じフレームに `empty` と `ignore` → `ignore`
  - 台帳のどの行も、`labels` を持つ素材の manifest に解決すること: track・mark の `video` が manifest に無い → エラー。**track のキーの間の manifest のフレームに `deer = false` がある → エラー**（鹿の区間をまたいで補間しない。adversary W1）
  - **ぼかしの箱（manifest の `blur_boxes`）と重なる箱があるフレームは機械的に `ignore`**（鹿が匿名化のモザイクで潰れているため。手で選ばない。`skipped: blurred`）。**`empty` のフレームに `blur_boxes` があるときも `blurred`**（鹿が全部モザイクの下にいると目では「見えない」になるため。adversary W2）
  - 鹿なしのフレーム（`deer = false`）にも `mark` で `ignore`（目で見て鹿がいた・判断できない）を付けられる。`[meta] negatives_checked` に、鹿なしを目で確かめた範囲を書く
  - 箱を YOLO の中心基準（0〜1）に直すときは manifest の動画の `size` で割る
- R13: 評価の追記（R8）
  - **後処理あり / なしの両方**: なし（`raw`）は R8 のまま。あり（`fp_filter`）は edge の `detector.l0.fp_filter.BoxFilter` を `L0FilterConfig()` の既定で使う。**検出器の出力（確信度 0.25 以上の全部）に 1 回だけ流し、その後で各閾値を当てる**（`region_scaled` で下げた確信度に閾値を当てる。edge と同じ順）。時刻は自分の映像ならフレームの `t` を渡し、動画ごとに `t` の順に流して、動画が変わったら作り直す。静止画（YOLO・negatives）は 1 枚ごとに作り直す（「続き」を持ち越さない）。使った設定の値を JSON に書く（既定の `ignore_regions` は空なので、効くのは規則 a の大きすぎる枠だけ。adversary W3）
  - 閾値は 0.25・0.4 に加えて **0.8**（`[judge] threshold`、赤の下限）
  - **連続した誤報**: 自分の映像の、評価側と val の鹿なしのフレーム（`deer = false` で台帳の `ignore` でないもの。`empty`（鹿の区間の 0.2 秒おき）は入れない）を動画ごとにフレーム番号の順に並べる。**閾値以上の鹿の予測が 1 つ以上あるサンプルが、隣り合って（フレーム番号の差が `every_frames.no_deer` 以下）2 枚以上続く塊を 1 回**と数える（judge の「2 フレーム連続で ON」に合わせる。サンプルは約 1 秒おきなので、実機の 10 fps より粗い近似と JSON に書く）。分母の時間は動画ごとに `枚数 × every_frames.no_deer ÷ fps` 秒を足す。1 分あたり = 回数 ÷ 時間（分）。予測の出たサンプルの枚数と 1 分あたりも出す
  - negatives（静止画）は連続を数えず、予測の出た画像の枚数と割合を出す
  - 結果の JSON は R8 の形に `fp_filter`（後処理ありの同じ形）と `fp_runs`（側・素材・後処理・閾値ごとの連続した誤報）を足す
- R14: 比較（`dataset/compare_l0.py`）
  - `build`: 同じ一覧・同じ seed から 2 つの run を作る。`<prefix>-real`（`kind = "synth"` の素材を除く）と `<prefix>-mix`（全部）。2 つの val と評価側の画像の集まり（SHA-256）と、synth 以外の train が同じであることを確かめる。違えばエラー（その 2 つの run を消す）
  - 学習・評価は train_l0 の `train`・`evaluate` を arm × seed ごとに回す（1 回ずつ鍵を取れるように 1 コマンド 1 学習）。重みの名前は `<prefix>-<arm>-s<seed>`
  - `summarize`: 2 つの arm × 2 つ以上の seed の model card と評価の JSON を読み、**条件がそろっていること**を確かめ、違えばエラー: 学習側（元の重みの SHA・epochs・imgsz・batch・device・ultralytics の版が同じ、seed の集まりが arm で同じ、seed が 2 つ以上）と評価側（評価の JSON の run が arm の run、重みは全部 `.pt`、評価の JSON の重みの SHA-256 が model card の SHA-256 と同じ、閾値・前処理・後処理の設定が同じ）。**元の重みが CC BY-SA を含む（`by_sa`）→ エラー**（評価側の BY-SA の鹿が元の重みの学習に入っているため。adversary W4）。model card に `<name>.pt` の SHA-256 を書く（train の追記）。評価側と val を後処理あり / なし・閾値ごとに、arm × seed の表で JSON（`dataset/out/compare/<prefix>.json`、既にある → エラー）と Markdown の表に書く
  - 表に出すのは**実写の鹿だけ**（synth は評価側に無い。素材ごとの行と、`kind = "self"` / `"yolo"` の合計）と、連続した誤報・negatives の誤報。arm ごとの train の枚数と 1 epoch のステップ数の比（mix は画像が多く、同じ epochs でもステップが多い）を書く
  - **評価側に `kind = "self"` の鹿の箱が 1 つも無いとき**（テストの走行が無い、または `ignore`・`blurred` で箱が 0）、表の先頭に「**暫定（テスト専用の走行の実写の鹿なし）**」と書く（adversary W5）
  - **差の書き方**: 主な数（評価側の実写の鹿の再現率と FP・連続した誤報の 1 分あたり、後処理あり / なし、閾値ごと）について、arm ごとの seed の最小〜最大を出し、範囲が重ならないときだけ `separated = true`。重なるときは表と報告に「seed のばらつきの中」と書き、「良くなった」と書かない
  - 報告に、テストの走行が学習の走行（S データの背景を含む）と同じ道路を含むかを 1 行書く（道具では判定しない）

## ユースケース

### UC-1: 素材の一覧を読む（R1）

- **Given**: `train_sources.toml`
- **When**: `build`
- **Then**: 許可された用途とライセンスの、`dataset/` の中の実体の素材だけが読まれ、違反・知らないキー・外を指すパス・リンクはエラー

### UC-2: YOLO の画像を集める（R2）

- **Given**: 分割済みの YOLO の画像とラベルと manifest
- **When**: `build`
- **Then**: manifest と SHA・ライセンスが合う画像だけが、train / val は元の分割のまま、それ以外と評価専用は評価側に入る

### UC-3: Capture を集める（R3）

- **Given**: api と edge の置き方の Capture（同意あり・なし、user と model の箱、確かめた・確かめていない id、壊れたもの、外を指すもの）
- **When**: `build`
- **Then**: 同意があり、確かめた id で、user の箱がある sim の Capture だけが中心基準のラベルになり、日付のグループで決まった分割に入る。捨てたものは理由ごとに数える

### UC-4: 漏れと出力（R4・R5）

- **Given**: 集めた画像
- **When**: 書き出す
- **Then**: グループや画像の重なり・鹿 0 個・val 0 枚はエラー。そうでなければ dataset.yaml と manifest.json ができ、既存の run は上書きしない

### UC-5: 学習（R6）

- **Given**: build の出力と元の重み
- **When**: `train`（偽の学習器）
- **Then**: 出力が manifest どおりなら、seed・元の重み・データ・device・出力先が学習器に渡り、最終 epoch の重みと model card ができる。出所の分からない重み・既存の名前・改変された出力はエラー

### UC-6: 書き出し（R7）

- **Given**: 学習した重み
- **When**: `export`（偽の書き出し器）
- **Then**: NMS 付き・conf 0.25 で一時フォルダに書き出され、名前を付けて L0 の読み込みで確かめられる。conf が min_conf を超える・既存の名前・確かめに失敗 → エラー

### UC-7: 評価（R8）

- **Given**: 正解のある評価側の画像と、決まった予測を返す偽の検出器
- **When**: `evaluate`
- **Then**: 2 つの閾値で TP / FN / FP と鹿なし画像の誤報が、素材・グループごとに数えられ、JSON に書かれる

### UC-8: 自分の映像・S データ・鹿のいない画像を集める（R9〜R12・R4 の追記）

- **Given**: 走行の分割つきの自分の映像（鹿ありは台帳の箱・empty・ignore、ぼかしと重なる箱）、その背景から作った S データ、撮影者つきの鹿のいない画像
- **When**: `build`
- **Then**: 自分の映像は走行の分割どおり、S データは背景の走行のグループで train だけ、鹿のいない画像は評価側に入る。同じ走行が学習と評価側の両方・S データの背景の走行が train でない・台帳に無い鹿ありのフレーム → エラー

### UC-9: 後処理と連続した誤報（R13）

- **Given**: 鹿なしの連続したフレームと、決まった予測を返す偽の検出器
- **When**: `evaluate`
- **Then**: 後処理あり / なし・3 つの閾値で数え、2 つ以上続いた予測の塊を 1 分あたりの連続した誤報として書く

### UC-10: 比較（R14）

- **Given**: 同じ一覧
- **When**: `compare_l0.py build` → arm × seed で `train`・`evaluate`（偽物）→ `summarize`
- **Then**: real と mix の val・評価側が同じで、条件がそろっていれば比較の表ができる。条件が違う・seed が 1 つ → エラー。テストの走行が無ければ「暫定」と書く

## 状態パターン

### S-1: 素材が 1 つも使えない

- **Given**: 全部の Capture が同意なし、または箱が model だけで、YOLO の素材も無い → **Then**: 学習側の鹿が 0 個のエラーで止まり、何も書かない

### S-2: 途中で失敗した

- **Given**: build の途中でエラー → **Then**: 作りかけの `<run>` フォルダを残さない

## Questions（Deferred のみ残存可）

決着済み（2026-11-06、推奨で決定。PR にも書く）:

- 元の重み → COCO の `yolo26n.pt`（Ultralytics v8.4.0 の公式配布と SHA-256 一致を確かめて手で置く）。受け取った `yolo26n-deer-20261105.pt` は CC BY-SA を含む学習の派生なので既定にしない。`--allow-by-sa-base` で明示すれば使え、model card にそう書く（C4）
- 素材の用途とライセンス → 一覧の自己申告ではなく、実体のパスと素材の manifest（SHA・動画ごとのライセンス）で確かめる（C1）
- Capture の画像のパス → `capture.image` は使わず、置き方ごとの名前の決まりと SHA で確かめる（C2）
- Capture の出所 → vehicle は使わない（edge-capture の Deferred）。sim は人が確かめた id の一覧（`reviewed`）にあるものだけ（C3）
- 学習の入口 → train の前に build の出力を manifest と照合する（C4）
- 分割 → 日本時間の日付のグループ、ハッシュの順に `max(1, round(0.2n))` 個を val。素材をまたいでグループを見る（W1・W2）
- 比べ方 → 最終 epoch の重み、L0 と同じ引き伸ばし、グループごとの数、0.25 と 0.4 の 2 つの閾値（W3・W4）
- 上書き → `.pt`・`.json`・`.mlpackage`・評価の JSON のどれも既にあればエラー、コピーは排他（W5）
- 負例 → 空のラベルファイルがある画像だけ（W6）
- Ultralytics の副作用 → 出力先を `dataset/out/train/<run>/ultralytics`、送信・オフライン・図を切る（W7）
- 学習の承認ゲート → CLAUDE.md の「推奨で決めて進める」に従う

- [Deferred: 担当=人 B（prelabel の feature、未起票）/ 期日=2026-11-07 / 暫定挙動=ラベルの無い写真（Osaki さん 47 枚・Yuki Fujita さん 8 枚）は一覧に書かない。学習に入らない] 写真の箱のラベル付け
- [Deferred: 担当=ユーザー（ch6 の CC BY-SA・edge-capture の vehicle の Capture）/ 期日=2026-11-07 / 暫定挙動=CC BY-SA（Commons・Mapillary）は `eval` だけ、vehicle の Capture は `vehicle_pending` で使わない] 学習に使える素材を増やすかどうか（S データは 2026-11-06 の ch9 ③ b＋d の確定で解消し、`kind = "synth"` で `train` だけに載せた）
- [Deferred: 担当=ユーザー（W8）/ 期日=2026-11-07 / 暫定挙動=`dataset/out/train/<run>/` の写しは run のフォルダごと手で消す。コミットする報告書には素材ごとの件数と評価の数だけを書き、画像・Capture の id・ファイル名・`roadSegment` を書かない] 学習用の写しの保持期間と消すきっかけ
- [Deferred: 担当=人 B（調査走行のあと）/ 期日=2026-11-08 / 暫定挙動=評価はフレーム単位と、鹿なしの連続したフレーム（約 1 秒おきのサンプル）での 1 分あたりの連続した誤報（R13）まで。遭遇単位の見逃し・初めて検知した時刻は数えない] 遭遇単位の評価
- [Deferred: 担当=ユーザー（2026-11-07 の夜の鹿の映像）/ 期日=2026-11-08 / 暫定挙動=自分の鹿は全部 2026-11-06 の走行（train、S データの背景と同じ走行）にあるので評価側に置けない。実写の鹿の評価は Commons の BY-SA（夜の V001 を含む）だけ、連続した誤報は val の朝の走行だけで「暫定（テスト専用の走行なし）」と書く。夜の 2 本（night-1/2）は S データの背景で train の走行なので、誤報の評価に使わない（R4 の検査と矛盾するため。報告に理由を書く）] テスト専用の走行での本当の比較
- 決着済み（2026-11-07、敵対レビュー `docs/reports/2026-11-07-spec-adversary-dataset-train-sdata.md` の取り込み）: C1 → self・synth のグループは接頭辞なし（R4 の追記）。W1・W2 → 台帳の解決の検査と `empty` のぼかし、S データの背景の `uses`・台帳の確認（R10・R12）。W3 → 後処理は 1 回流してから閾値、連続した誤報の定義と分母（R13）。W4 → 評価側の条件・重みの SHA・BY-SA の元の重みを拒む・`separated`（R14）。W5 → 「暫定」は評価側の self の鹿の箱の有無で決める、道路の重なりは報告に 1 行。W6 → negatives は許可リストで写す（R11）。I1 → SRC-2a・PRIV-1a・LBL-1c・CMP-1c
- 決着済み（2026-11-07、推奨で決定）: ラベルは Claude が匿名化した後のフレームを拡大して目で付ける（キーフレーム＋線形補間、補間した全フレームを重ね描きで確かめる）。COCO に鹿のクラスが無く、今の L0 は夜に 0 検出なので候補は出さない。比較は「同じ epochs」（タスクの指定）で、mix のステップ数が多いことを表に書く（研究の反復で枚数を合わせる方式は採らない）。重みの比較は `.pt`（export と同じ 640×480 の入力）で行い、CoreML への書き出しは比較に含めない（前回、`.pt` と `.mlpackage` の数は同じか 1 個違い）

## Test List（Canon TDD Step 1）

外側ループ（受け入れ。Day 5「データループが 1 周」）:

- [x] AC-1: 一時フォルダの素材（manifest 付きの YOLO の train / val / test、評価専用の YOLO、api と edge の置き方の sim の Capture）で `build` → 偽の学習器で `train` → 偽の書き出し器と偽の読み込みで `export` → 偽の検出器で `evaluate` を通すと、dataset.yaml・manifest.json・重み・model card・`.mlpackage`・評価の JSON ができ、評価専用の画像は学習側に 1 枚も無く、同意なし・確かめていない・model の箱・vehicle は使われていない

UC-1 素材の一覧:

- [x] SRC-1a: 一覧を読む。知らないキー・`kind`・`license`・`use`、不正・重複した `name`、capture の `reviewed` の欠け → エラー（キー名・素材名つき）
- [x] SRC-1b: `use = "train"` で `CC-BY-SA` → エラー。`CC-BY-SA` の `use = "eval"` は通る
- [x] SRC-1c: [ADDED adversary C1] `path` が絶対パス・`..` で外・`raw/`・`out/`・置き場所が無い・別の素材と同じ実体（大文字小文字だけ違う別名）→ エラー。素材の中のシンボリックリンク（ファイル・フォルダ）→ エラー

UC-2 YOLO:

- [x] YOLO-1a: train / val は元の分割、test は評価側、`use = "eval"` は全部評価側、空のラベルファイルの画像は鹿なし
- [x] YOLO-1b: クラス違い・範囲外・幅か高さが 0・列数違いの行 → エラー（ファイル名・行番号つき）。ラベルファイルの無い画像・画像の無いラベル・`.jpg` 以外 → エラー
- [x] YOLO-1c: [ADDED adversary C1] manifest に無い画像・manifest にあって無い画像・SHA-256 の違い → エラー。動画のライセンスの最も厳しいものと一覧の `license` が違う（BY-SA の素材を `CC-BY` と書く）→ エラー。分類できないライセンス・`self` / `permission` の YOLO → エラー

UC-3 Capture:

- [x] CAP-1a: api の置き方と edge の置き方の両方を読む。JSON の無い画像は読まない。`capture.image` が絶対パスでも使わない
- [x] CAP-1b: 同意なし・schema 違反・画像なし・vehicle・確かめていない id・user の箱が無い・重複を、それぞれの理由で数えて使わない。model の箱は正解にしない
- [x] CAP-1c: [ADDED adversary W4] 角を 0〜1 に切ってから中心基準に直す。幅か高さが 0 の箱は捨てる
- [x] CAP-1d: [ADDED adversary W1] 日本時間の日付のグループ（JST 8:55 と 9:05 は同じ日）。グループ 1 つ → 全部 train で「val なし」、2 つ → 1 つずつ、5 つ → val 1 つ。同じ seed なら同じ分割
- [x] CAP-1e: [ADDED adversary C2] api の `{key}` と `capture.id` の違い・`file` の名前違い（`..`・`/`・別の key）・SHA の先頭 12 桁の違い、edge の `{id}` と JSON の `id` の違い、画像がシンボリックリンク → `bad_path` で使わない

UC-4 漏れと出力:

- [x] OUT-1a: 学習側と評価側に同じ SHA-256 の画像・同じグループ → エラー。train と val に同じグループ → エラー。学習側の鹿 0 個・val 0 枚 → エラー（S-1）
- [x] OUT-1b: dataset.yaml（絶対パス・`names: {0: deer}`）と manifest.json（件数・train / val / 評価側の枚数・画像ごとの素材・分割・グループ・SHA-256・ライセンス・`labels_note`。Capture は `id`・`source`・日付だけで `roadSegment` が無い）。同じ素材・同じ seed で同じ内容
- [x] OUT-1c: 既存の `<run>` は上書きしない。不正な `<run>` → エラー。途中のエラーで作りかけを残さない（S-2）。出力の名前の衝突（大文字小文字を区別しない）→ エラー

UC-5 学習:

- [x] TR-1a: 学習器に seed・元の重み・dataset.yaml・epochs・imgsz・batch・device・`project`（`dataset/out/train/<run>/ultralytics`）・`plots = False` が渡り、`last.pt` が `<name>.pt` になり、model card（元の重みの SHA と出所・manifest の SHA・素材とライセンス・seed など、パスは相対）ができる
- [x] TR-1b: `<name>` の `.pt`・`.json`・`.mlpackage` のどれかがある・元の重みが無い・不正な名前 → エラー。`--device auto` は MPS が使えれば mps、なければ cpu
- [x] TR-1c: [ADDED adversary C4] build のあとに画像を足す・差し替える・`dataset.yaml` の path が違う → エラー。元の重みが deer-20261105 なら `--allow-by-sa-base` が要り、card に BY-SA を含むと書く。知らない SHA → エラー

UC-6 書き出し:

- [x] EXP-1a: 書き出し器に NMS・imgsz [480, 640]・conf 0.25・iou 0.7 が渡り、一時フォルダの出力が `<name>.mlpackage` になり、`load_coreml_detector` で確かめる
- [x] EXP-1b: conf が `[tracker] min_conf` より大きい → エラー。既存の `.mlpackage` → 書き出しの前にエラー。確かめで例外 → exit 1

UC-7 評価:

- [x] EV-1a: 確信度順（同じなら出てきた順）・IoU 0.5 以上・正解は 1 回だけ・IoU が同じなら先の正解、の当て方で TP / FN / FP。閾値ちょうどの予測は数える。鹿なし画像の誤報の枚数は別の項目。分母 0 は `null`
- [x] EV-1b: 評価側と val を別々に、素材・グループごとと合計、閾値 0.25 と 0.4 で数え、`dataset/out/eval/<名前>.<pt|mlpackage>.<run>.json`（既にあればエラー）に `labels_note` と前処理の名前つきで書く。画像は L0 と同じ引き伸ばしで検出器に渡す。`deer` の無いモデル → エラー

- [x] REV-1: [ADDED code-reviewer] 学習で書かれる `*.cache` は照合で数えない（TR-1c で確かめる）。評価の画像の SHA が manifest と違う → エラー（EV-1b）。IoU・確信度が同じときの当て方の順を逆にすると結果が変わる例で固定する（EV-1a）。確かめの失敗は CLI が exit 1、素材の誤りは exit 2

UC-8 自分の映像・S データ・鹿のいない画像（2026-11-07 更新）:

- [x] SELF-1a: 走行の分割どおり（train / val / test → 評価側）。`use = "eval"` は全部評価側。台帳の `box` は中心基準の箱、`empty` は鹿なし、`ignore` は `skipped: ignore`。台帳に無い鹿ありのフレーム → エラー
- [x] SELF-1b: 鹿なしは train では `negative_every` 枚おき（残りは `thinned`）、評価側と val は間引かない。manifest の license・allowed_use・drives と行の group・split の食い違い・SHA の違い → エラー。`labels` は一覧のフォルダから読む
- [x] SYN-1a: S データは全部 train、グループは背景の SHA で引いた footage の走行。`use = "eval"`・`footage` が無い / 一覧に無い・背景が引けない / 画像が違う / group の自己申告が違う・背景の走行が train でない → エラー。`footage_manifest_sha256` の違いは notes
- [x] NEG-1a: negatives は全部評価側の鹿なし。`use = "train"` → エラー。グループは撮影者のハッシュで、撮影者名・経度緯度・地域は run の manifest に無い
- [x] LEAK-1a: [ADDED adversary C1] self と synth のグループは接頭辞なしの `self:<drive>`。同じ走行が 2 つの self の素材に分かれて train と評価側に → エラー。`use = "eval"` の self の train の走行を背景にした S データ（R10 は通る）→ R4 でエラー
- [x] SRC-2a: [ADDED adversary I1] 別の kind に `labels`・`negative_every`・`footage` → エラー。`negative_every` の 0・負・小数・真偽値、self・synth の `license` が self 以外、`labels` が一覧のフォルダの外・リンク → エラー。negatives を `CC-BY` と書く → エラー
- [x] PRIV-1a: [ADDED adversary W6] run の manifest に self の `area`・時刻、negatives の撮影者名・経度緯度・地域・`attribution`・`sequence` が無い
- [x] LBL-1c: [ADDED adversary W1・W2] track・mark の `video` が manifest に無い・キーの間に鹿なしのフレーム・同じ動画で track の `id` の重複・`[meta]` の `negatives_checked` の欠け → エラー。`empty` のフレームに `blur_boxes` → `blurred`。S データの背景の `uses` に `synth_background` が無い・背景が台帳で `ignore` → エラー
- [x] LBL-1a: 台帳の補間（キーの間だけ、端は伸ばさない）、画素 → 中心基準。キーのフレームが manifest に無い・鹿なし・昇順でない・箱が画面の外・`empty` と track の重なり・`frames` の打ち間違い・空の `range` → エラー。`ignore` は track より優先、`range` は両端を含む
- [x] LBL-1b: ぼかしの箱と重なる箱があるフレームは `ignore`（`blurred`）

UC-9 後処理と連続した誤報:

- [x] EV-2a: 後処理あり / なしの両方を書く。動画は `t` の順に流して「続き」が効き、静止画は 1 枚ごと。閾値 0.25・0.4・0.8
- [x] EV-2b: 連続した誤報: 予測のあるサンプルが隣り合って 2 枚以上続いた塊を 1 回、1 枚だけは数えない、間が空いたら別の塊。1 分あたり = 回数 ÷（動画ごとの 枚数 × 間隔 秒 の合計 ÷ 60）。`ignore`・`empty` は入れない。negatives は画像の枚数と割合だけ
- [x] EV-2c: [ADDED adversary W3] 後処理は検出器の出力に 1 回流してから閾値（`region_scaled` で下げた確信度が 0.4 を下回れば 0.4 で数えない）。後処理の設定値と評価した重みの SHA-256 を JSON に書く

UC-10 比較:

- [x] CMP-1a: real と mix を作り、val・評価側・synth 以外の train が同じ。違えば 2 つの run を消してエラー
- [x] CMP-1b: `summarize` は条件（元の重み・epochs・imgsz・batch・device・版・seed）がそろわない・seed が 1 つ → エラー。表は実写の鹿だけと誤報、arm の train の枚数とステップの比。評価側に self の鹿の箱が無ければ「暫定」
- [x] CMP-1c: [ADDED adversary W4・W5] 評価の run が arm の run でない・`.pt` でない・評価の重みの SHA が card と違う・後処理の設定が違う・元の重みが BY-SA → エラー。compare の JSON が既にある → エラー。seed の範囲が重ならないときだけ `separated`、train の model card に重みの SHA-256
- [x] AC-2: [受け入れ] 一時フォルダの self（train・val・test の走行）・synth・negatives・yolo で `compare_l0.py build` → 偽の学習器で 2 arm × 2 seed の `train` → 偽の検出器で `evaluate` → `summarize` を通すと、比較の JSON と表ができ、synth は評価側に無く、test の走行のフレームは学習側に無い

状態パターン:

- [x] S-1: 使える素材が無い（OUT-1a と同じテストで確かめる）
- [x] S-2: 途中の失敗で作りかけを残さない（OUT-1c と同じテストで確かめる）

## 非機能要件

- [x] 決定性: 分割は seed 付きのハッシュで、乱数を使わない。同じ素材・同じ seed で同じ manifest（作った日時を除く）。学習の seed は必須の引数（MPS では学習そのものは完全には一致しない。model card に書く）
- [x] 個人情報: manifest・model card・評価の JSON に緯度経度・`roadSegment`・氏名・端末の情報・絶対パス（dataset.yaml を除く）を書かない。写真と Capture の画像の写しは `dataset/out/`（gitignore 済み）にだけ置く
- [x] ruff と pytest のカバレッジ 70% 以上（`dataset/` 全体）。既存のテストが Green のまま

## 受け入れ基準

- [x] 受け入れテスト AC-1 が Green
- [x] 全 UC / 全状態パターンのテストが Green、既存テストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（ruff check・ruff format）
- [x] code-reviewer の Critical 0（`docs/reports/2026-11-06-code-reviewer-dataset-train.md`。Warning は REV-1 と R6〜R8 の追記で対応）
- [x] 実データで 1 周（Commons の train / val・評価専用の BY-SA、開発用の Mac）を回し、件数と評価の数だけを `docs/reports/2026-11-06-dataset-train-run.md` に残す（M2 での値で、Mac mini の値ではないと書く。評価側の V006 は前のモデルの学習に入っていたと書く）
- [ ] （2026-11-07）今ある素材で real / mix × 2 seed を 1 回回し、件数と評価の数だけを `docs/reports/2026-11-07-dataset-train-sdata-run.md` に「暫定（テスト専用の走行なし）」と書いて残す。画像・ファイル名・撮影者名を書かない
