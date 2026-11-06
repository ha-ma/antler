# dataset/ — 学習・評価のデータの置き場所

B の鹿の検出（L0 = YOLO）の学習・評価に使う画像と、L1 の校正スクリプトを置く。
**画像・動画・重みは Git に入れない**（大きいので。`.gitignore` 済み）。Git に入るのは、この README・`PRIVATE-DATA.md`・スクリプト・テストだけ。
画像を使う機械（開発の Mac・Mac mini）ごとに、下の「取得方法」で手で置く。

出典とライセンスは `CREDITS.md`、配れないデータの決まりは `PRIVATE-DATA.md` に書く。ライセンスを確かめていない素材はここに入れない（CLAUDE.md の MUST）。

## 置き場所

| パス                                            | 中身                                                                                                         | 使ってよい用途                                         | Git                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------- |
| `external/antler-yolo/commons/`                 | Commons の実写フレーム 29 枚と YOLO ラベル（V002・V003・V009。CC0 / CC BY）、`dataset.yaml`、`manifest.json` | 学習・評価・ベンチ                                     | 入れない（`dataset/external/`） |
| `private/antler-yolo/eval-by-sa/`               | Commons の実写フレーム 100 枚と YOLO ラベル（V001・V005〜V008。CC BY-SA）                                    | **評価だけ**（ch6 の許可リスト外のため学習に使わない） | 入れない（`dataset/private/`）  |
| `private/osaki-2026-11/`                        | Kazuhiko Osaki さんのエゾシカの写真 47 枚（EXIF 削除済み、ラベルなし）、`manifest.json`                      | **学習・評価**。公開・二次利用は不可                   | 入れない                        |
| `private/reference-photos/yuki-fujita-2026-11/` | Yuki Fujita さんのエゾシカの写真 8 枚                                                                        | **学習・評価**・3D の参考。公開・二次利用は不可        | 入れない                        |
| `raw/`                                          | 同意・匿名化の前の生データ                                                                                   | —                                                      | 入れない                        |
| `out/`                                          | `export_l1_labels.py` の出力                                                                                 | —                                                      | 入れない                        |

重みは `edge/detector/models/` に置く（`.gitignore` 済み）:

| ファイル                             | 中身                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `yolo26n-deer-20261105.pt`           | YOLO26n を鹿 1 クラス（`0: deer`）で学習した検出器（外部の研究。CC BY-SA を含む学習）。640 px。L0 の形・速度の確認用                 |
| `yolo26n-deer-20261105.onnx`         | 同じ重みの ONNX（FP32、出力 `[1, 5, 8400]`）。CPU での比較用                                                                         |
| `yolo26n-deer-20261105.mlpackage`    | 同じ重みの CoreML（NMS 付き、ultralytics 8.4.202・coremltools 9.0、conf 0.25・iou 0.7、FP16）。`confidence` は N×80（edge-l0 CU-2f） |
| `yolo26n.pt`                         | COCO の YOLO26n（Ultralytics v8.4.0 の配布物、SHA-256 `9b09cc8b…`）。`train_l0.py` の元の重み。鹿のクラスは無い                      |
| `<name>.pt` / `.json` / `.mlpackage` | `train_l0.py` で学習した重み・学習の記録（model card）・CoreML                                                                       |

YOLO のラベルはすべて 1 クラス `0: deer`、座標は中心基準の正規化 xywh。Capture の箱（左上基準）とは基準が違う（`docs/changes/2026-11-04-capture-xywh-top-left.md`）。

## 取得方法

### antler-yolo（外部の研究の引継ぎ、2026-11-06 受け取り）

1. ユーザーから `ANTLER_YOLO_missing_materials_2026-11-06.zip`（865,752,200 bytes、SHA-256 `4dd08d6ab6874a279300c1ed20e2195e3df706b767c45597260c4e616d95df00`）を受け取って展開する。中の `ADDITIONAL_HANDOFF_MANIFEST.json` の SHA-256 は `ccf9090f0553bef9618e837d87d40b78f7dedaaa6cb1f06ae8860b78f7afad59`
2. 展開したフォルダの中のスクリプトは実行しない。読み取りだけで扱い、Python を使うときは別の場所のスクリプトから `python -I` で、パスを引数で渡して読む
3. 各ファイルの SHA-256 を `ADDITIONAL_HANDOFF_MANIFEST.json` と照合してからコピーする
4. コピーするもの:
   - `artifacts/yolo_deer_detector.pt` / `.onnx` → `edge/detector/models/yolo26n-deer-20261105.pt` / `.onnx`
   - `data/yolo/dataset/{images,labels}/{train,val,test}/` のうち、ファイル名が `V002_`・`V003_`・`V009_` のもの → `external/antler-yolo/commons/` の同じ構成
   - 同じく `V001_`・`V005_`〜`V008_` のもの → `private/antler-yolo/eval-by-sa/` の同じ構成
5. **`V004_` は入れない**（全フレームに GPS 座標・速度・日時が焼き込まれている）
6. 入れないもの: S データ（合成画像 600 枚）・生成鹿 8 種（ch9 ③「学習データ配布の可否確認」が未）、元動画、研究スクリプト、Commons のメタデータ（撮影地点の座標を含む）、`handoff/`
7. JPEG に EXIF・XMP・ICC があれば消す（この版のフレームには無い。エンコーダ名のコメントだけある）

コピー後の一覧と SHA-256 は各フォルダの `manifest.json`。元の研究の結果と限界は `docs/reports/2026-11-06-yolo-materials.md`。

### Kazuhiko Osaki さんの写真（2026-11-06 受け取り）

1. ユーザーから `kazuhiko-osaki-deer-photos.zip`（84,009,952 bytes、SHA-256 `4b5e133a119364b58d7d01695f2c4fd2e9da72df56c25ef24e740c501c2c505a`）を受け取って展開する
2. 1 枚ずつ、向きを画素に焼き込み、長辺を 1920 px に縮め、**EXIF・XMP・ICC を付けずに** JPEG（quality 95）で `private/osaki-2026-11/images/` に書く。iPhone の写真には GPS が入っているので、元のファイルをそのままコピーしない
3. ファイル名の空白は `_` にし、拡張子は `.jpg` にそろえる
4. `manifest.json` に元のファイル名・元と出力の SHA-256・撮影日（セッション）を書く。GPS と機種は書かない
5. 書いた後に、全ファイルで EXIF と GPS が 0 であることを確かめる

### Yuki Fujita さんの写真（2026-11-04 受け取り、2026-11-06 に条件を更新）

`PRIVATE-DATA.md` を参照。

## 学習・評価の分け方

- Commons のフレームは元の研究の分割を引き継ぐ（動画単位: V002・V009 = train、V003 = val）。同じ動画のフレームを学習と評価の両側に入れない
- BY-SA のフレームは評価専用。V001 は唯一の夜間の鹿（5 物体）
- Osaki さんの写真は撮影日（`session`）単位で分ける。連写を学習と評価の両側に入れない

## 学習スクリプト（`train_l0.py`、docs/specs/dataset-train）

素材は `train_sources.toml` に書く。用途とライセンスは、一覧の値ではなく、実体のパスと素材の `manifest.json`（SHA-256・動画ごとのライセンス）で確かめる。CC BY-SA は評価だけ。
Ultralytics・coremltools・opencv は extra `day0` の環境（`pip install -e "edge/detector[day0,dev]"`）で回す。

```bash
python dataset/train_l0.py build --run r1 --seed 7            # dataset/out/train/r1/（dataset.yaml・manifest.json）
python dataset/train_l0.py train --run r1 --name yolo26n-deer-r1 --seed 7   # 最終 epoch の重みと model card
python dataset/train_l0.py export --weights edge/detector/models/yolo26n-deer-r1.pt
python dataset/train_l0.py evaluate --run r1 --model edge/detector/models/yolo26n-deer-r1.mlpackage
```

- `build` の出力（`dataset/out/train/<run>/`）は絶対パスの `dataset.yaml` を持つ。別の機械では `build` し直す（`train` は manifest との照合で止まる）
- Capture は `kind = "capture"` で、置き方は api の保存（`{key}.json` ＋ `{key}-{sha12}.jpg`）か、**止めた edge からコピーした**フォルダ（`{id}.json` ＋ `{id}.jpg`。動いている edge は 24 時間で消すため）。`consent: true`・`source: sim`・`reviewed` の一覧にある id・`by: user` の箱だけを使う。vehicle の Capture は ch9 ③・edge-capture の判断まで使わない
- 写しは run のフォルダごと手で消す。コミットする報告書には件数と評価の数だけを書き、画像・Capture の id・ファイル名・`roadSegment` を書かない
