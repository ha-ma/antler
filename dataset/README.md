# dataset/ — 学習・評価のデータの置き場所

B の鹿の検出（L0 = YOLO）の学習・評価に使う画像と、L1 の校正スクリプトを置く。
**画像・動画・重みは Git に入れない**（大きいので。`.gitignore` 済み）。Git に入るのは、この README・`PRIVATE-DATA.md`・スクリプト・テストだけ。
画像を使う機械（開発の Mac・Mac mini）ごとに、下の「取得方法」で手で置く。

出典とライセンスは `CREDITS.md`、配れないデータの決まりは `PRIVATE-DATA.md` に書く。ライセンスを確かめていない素材はここに入れない（CLAUDE.md の MUST）。

## 置き場所

| パス                                            | 中身                                                                                                          | 使ってよい用途                                                                              | Git                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| `external/antler-yolo/commons/`                 | Commons の実写フレーム 29 枚と YOLO ラベル（V002・V003・V009。CC0 / CC BY）、`dataset.yaml`、`manifest.json`  | 学習・評価・ベンチ                                                                          | 入れない（`dataset/external/`） |
| `private/antler-yolo/eval-by-sa/`               | Commons の実写フレーム 100 枚と YOLO ラベル（V001・V005〜V008。CC BY-SA）                                     | **評価だけ**（ch6 の許可リスト外のため学習に使わない）                                      | 入れない（`dataset/private/`）  |
| `private/osaki-2026-11/`                        | Kazuhiko Osaki さんのエゾシカの写真 47 枚（EXIF 削除済み、ラベルなし）、`manifest.json`                       | **学習・評価**。公開・二次利用は不可                                                        | 入れない                        |
| `private/reference-photos/yuki-fujita-2026-11/` | Yuki Fujita さんのエゾシカの写真 8 枚                                                                         | **学習・評価**・3D の参考。公開・二次利用は不可                                             | 入れない                        |
| `private/mapillary-doto/`                       | Mapillary の道東の画像 1,500 枚（CC BY-SA 4.0、撮影者 39 人、メタデータ削除済み）、`manifest.json`            | **評価だけ**。鹿のいない画像・ラベルなし                                                    | 入れない                        |
| `external/deer3d/<ID>/`                         | 3D の鹿 M01〜M04（CC0、GLB・.blend・FBX）とライセンスの証拠、`manifest.json`                                  | 合成（S データ）の鹿（ch9 ③ b＋d）                                                          | 入れない（`dataset/external/`） |
| `private/self-footage/`                         | ユーザーが撮ったドラレコの映像の匿名化したフレーム（焼き込みを塗りつぶし・人と車をモザイク）、`manifest.json` | **学習・評価**（走行単位の分割と用途は manifest）。ぼかしを人が確かめるまで公開・配布しない | 入れない                        |
| `raw/`                                          | 同意・匿名化の前の生データ                                                                                    | —                                                                                           | 入れない                        |
| `out/`                                          | `export_l1_labels.py` の出力                                                                                  | —                                                                                           | 入れない                        |

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
6. 入れないもの: S データ（合成画像 600 枚）・生成鹿 8 種（AI 生成で、ch9 ③ の b＋d と配布の可否の対象外）、元動画、研究スクリプト、Commons のメタデータ（撮影地点の座標を含む）、`handoff/`
7. JPEG に EXIF・XMP・ICC があれば消す（この版のフレームには無い。エンコーダ名のコメントだけある）

コピー後の一覧と SHA-256 は各フォルダの `manifest.json`。元の研究の結果と限界は `docs/reports/2026-11-06-yolo-materials.md`。

### Kazuhiko Osaki さんの写真（2026-11-06 受け取り）

1. ユーザーから `kazuhiko-osaki-deer-photos.zip`（84,009,952 bytes、SHA-256 `4b5e133a119364b58d7d01695f2c4fd2e9da72df56c25ef24e740c501c2c505a`）を受け取って展開する
2. 1 枚ずつ、向きを画素に焼き込み、長辺を 1920 px に縮め、**EXIF・XMP・ICC を付けずに** JPEG（quality 95）で `private/osaki-2026-11/images/` に書く。iPhone の写真には GPS が入っているので、元のファイルをそのままコピーしない
3. ファイル名の空白は `_` にし、拡張子は `.jpg` にそろえる
4. `manifest.json` に元のファイル名・元と出力の SHA-256・撮影日（セッション）を書く。GPS と機種は書かない
5. 書いた後に、全ファイルで EXIF と GPS が 0 であることを確かめる

### 自分で撮った映像（docs/specs/dataset-footage、2026-11-06 に 1 回目の 5 本）

1. ユーザーが `raw/self/<撮影日>_<短い名前>/` に映像（時刻を含まない名前に改名したもの）・`<名前>.sha256`・`info.txt` を置く。元のファイルは変更しない
2. `self_footage.toml` に `[[drive]]`（撮影日の走行と split）と `[[clip]]`（SHA-256・カメラ・時間帯・地域・鹿の区間）を足す。走行の split は一度 manifest に入ったら変えない
3. day0 の環境で回す（opencv・ultralytics。重みは COCO の `edge/detector/models/yolo26n.pt`）。worktree からでも、置き場所は main の checkout の絶対パスを渡す:

   ```bash
   python -I dataset/self_footage.py ingest --raw <checkout>/dataset/raw/self \
       --out <checkout>/dataset/private/self-footage --weights <checkout>/edge/detector/models/yolo26n.pt
   ```

4. 済みのクリップは飛ばす。区間や矩形を直したら `--redo <clip.id>`。走行・split を変えるときは `private/self-footage/` を消して全部作り直す
5. 焼き込み（右下の日時・速度・GPS）は黒で塗りつぶし、塗った後に残りが無いことを数値で確かめる。音声・メタデータは書き出さない（JPEG のフレームだけ）。確かめの画像は匿名化した後のものだけを見る

### Yuki Fujita さんの写真（2026-11-04 受け取り、2026-11-06 に条件を更新）

`PRIVATE-DATA.md` を参照。

### Mapillary の道東の画像（S データ研究の引継ぎ、2026-11-06 取り込み）

外部の研究の写し `~/work/antler-yolo-mac`（タグ `handoff-to-antler-2026-11-06`）から取り込んだ。研究の写しは読むだけで、Python で読むときは研究のフォルダの外のスクリプトから `python -I` で、パスを引数で渡す。

1. 台帳 `data/mapillary/acquisition.json`（SHA-256 `b8a77c49c9990ce679e8c4866bc69b556b55973e3faf2aca3b717ad2ff88e252`）を照合する
2. 画像 `data/raw/mapillary/<sequence>/<image_id>.jpg`（1,500 枚、長辺 2048 px）を 1 枚ずつ台帳の `sha256` と照合する
3. JPEG の APP0（JFIF）と APP14（Adobe）以外の APPn（EXIF・XMP・ICC・IPTC）と COM を落として `private/mapillary-doto/images/<image_id>.jpg` に書く。再圧縮しない（復号した画素が元と同じことを確かめる）。この版では EXIF が 17 枚（`ImageDescription`・`Artist` だけ、GPS は 0）、APP13（IPTC）が全枚にあった。ICC は無かった
4. 書いた後に、全ファイルで EXIF・XMP・ICC・IPTC が 0 であることを確かめる
5. `manifest.json` に、台帳の `image_id`・`creator_username`・`attribution`・`source_page_url`・`region`・`area_rough`（約 10 km の区画）・`camera_type`・`sequence`・月と、元と出力の SHA-256 を書く。**正確な緯度経度・撮影時刻・機種・creator_id は書かない**
6. Mapillary の規約: 顔・ナンバーのぼかしを外さない（§12）、車の自動制御に使わない（§5。運転者への警告は対象外）、画像を見せる場所では撮影者・Mapillary・元のページへのリンクを出す、合成画像などを外に出すときは CC BY-SA 4.0
7. API のトークン（`~/.config/antler/mapillary_token`）はどこにも写さない。この検索 API は空かエラー 500 を返すので、追加で取るときは公式の公開タイルを読む方式で書き直す

- **評価だけに使う**（CC BY-SA は ch6 の許可リスト外）。**学習用の合成の背景にも使わない**（合成画像も CC BY-SA になる）。合成の試作の見た目の確認には使ってよいが、その合成画像は学習に使わない
- ラベルは無い（鹿のいない前提の画像）。誤検出の評価に使う。約 4 分の 1 は車から道路を見た画像ではないので、評価の前に選別する。写真の間隔が数秒あくので、連続フレームの警報ルールの評価には使えない
- `train_sources.toml` にはまだ載せていない（`kind = "yolo"` はラベル付きの素材用）。dataset-train の次の cycle で「鹿のいない画像」の `kind`（例 `negatives`、`use = "eval"`）を足して登録する
- 撮影時刻は投稿者によってずれていて当てにならない。昼・夜は目で見て分ける

### 3D の鹿 M01〜M04（S データ研究の引継ぎ、2026-11-06 取り込み）

ch9 ③ 鹿モデル = b＋d（2026-11-06 ユーザー判断）による。

1. 台帳 `data/deer3d/acquisition.json`（SHA-256 `36d00d62be97fe5fae858ac2580735bf1c95926bae7c3a51209714aaaf5b1293`）を照合する
2. 各ファイルを台帳の SHA-256・大きさと照合して `external/deer3d/<ID>/` にコピーする（M04 の FBX は 7z と展開済みの `fbx_extracted/` の両方）
3. ライセンスの証拠（配布ページの HTML、M04 の `License.txt`）を `external/deer3d/<ID>/evidence/` に置く
4. `external/deer3d/manifest.json` に、作者・配布元・ライセンス・ファイルごとの SHA-256・骨格と動作を書く

| ID  | モデル                     | 作者・配布元             | 形式        | 動作                                   |
| --- | -------------------------- | ------------------------ | ----------- | -------------------------------------- |
| M01 | Stag（角あり）             | Quaternius（Poly Pizza） | GLB         | 歩く・走る・食べる・倒れるなど 13 種   |
| M02 | Deer（角なし、雌の代わり） | Quaternius（Poly Pizza） | GLB         | M01 と同じ 13 種                       |
| M03 | Old Deer Male（角あり）    | CDmir（OpenGameArt）     | .blend      | Run・Idle・Stand・Eat・LookAround・Die |
| M04 | Deer Female                | CDmir（OpenGameArt）     | .blend・FBX | M03 と同じ 6 種                        |

- .blend の骨格と動作はファイルの中の名前を読んで確かめただけ。Blender で開いて再生できるかを dataset-synth の最初に確かめる
- どれもエゾシカではない一般的な鹿で、写実的ではない。肩高 約 1 m・角の形に合わせ、質感に手を入れる前提
- 色・斑点・臀の白斑・姿勢の参考に `private/` の Osaki さん・Yuki Fujita さんの写真を使ってよい（`PRIVATE-DATA.md` の範囲で。写真そのものをテクスチャに貼って配らない）
- Sketchfab の CC BY の写実寄りのモデルは取り込んでいない（ログインが必要）。CC0 の 4 体で見た目が足りなければユーザーに聞く
- YouTube の素材、前回の S データ 600 枚と生成鹿 8 種（AI 生成）は入れない（ch9 ③）

研究の結果（R16: Mapillary の画像での L0 の誤検出）は `docs/reports/2026-11-06-sdata-research.md`。

## 学習・評価の分け方

- Commons のフレームは元の研究の分割を引き継ぐ（動画単位: V002・V009 = train、V003 = val）。同じ動画のフレームを学習と評価の両側に入れない
- BY-SA のフレームは評価専用。V001 は唯一の夜間の鹿（5 物体）
- Osaki さんの写真は撮影日（`session`）単位で分ける。連写を学習と評価の両側に入れない
- 自分で撮った映像は走行（撮影日）単位で分ける（`self_footage.toml` の `[[drive]]`、manifest の `files[].group`）。合成の背景（`synth_background`）は train の走行からだけ。2026-11-07 の鹿の走行の少なくとも 1 本は test 専用
- Mapillary の画像は評価だけ。評価をさらに分けるときは撮影者（`creator_username`）の単位で分ける（上位 3 人が約 150 枚ずつ）

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
