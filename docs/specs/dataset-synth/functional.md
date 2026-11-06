---
feature: dataset-synth
target_paths:
  - dataset/synth.py
  - dataset/synth_render.py
  - dataset/synth.toml
  - dataset/tests/test_synth.py
spec_confirmed_at: PENDING
tier: 1
---

# 仕様: dataset-synth（3D の鹿 M01〜M04 を自分で撮った夜の背景に合成し、見えているマスクから YOLO の枠を作る）

## 概要

外部の研究の引継ぎメモ 0 節の順 3（`docs/roadmap.md` の「S データ」）。順 2 の `dataset-footage`（PR ha-ma/antler#59）が作った匿名化済みのフレームのうち、**合成の背景に使ってよいもの**（`uses` に `synth_background` がある＝`train` の走行の鹿なしの区間）に、CC0 の 3D の鹿（`dataset/external/deer3d/` の M01〜M04）を Blender で描いて重ね、鹿の見えている画素から YOLO の箱を作る。

`dataset/synth.py run` が、次の順で 1 回分（run）を作る:

1. **計画**（純 Python、シード付き）: 背景・鹿のモデル・動作とそのフレーム・距離・横の位置・向き・大きさ・カメラの下向きの角・ヘッドライトの強さを決め、`jobs.json` にする
2. **描画**: `blender -b --factory-startup --disable-autoexec --python dataset/synth_render.py -- render <jobs.json> <出力>` を子プロセスで回す。Blender 側は bpy と標準ライブラリだけを使い、鹿だけを透明の背景に描いた RGBA と、鹿ごとの「見えている」マスク（ほかの鹿を holdout にした描画のアルファ）と、鹿ごとの射影の箱（画面で切らない）を書く
3. **合成**（純 Python ＋ numpy）: 鹿の層を premultiply してぼかし、黒の床（背景の暗部の明るさ）を足して背景に重ね、焼き込みの矩形を黒で塗り直し、画面全体にノイズを足し、マスクから箱を作り、条件に合わない鹿の入った画像を捨て、JPEG（メタデータなし）と YOLO のラベルと manifest を書く

要件: ch4-edge.md B2（L0 = YOLO、`deer` 1 クラス）、ch6-nfr.md「ライセンス」（CC0・自作は可）、ch9 ③ 鹿モデル = b＋d・学習データ配布の可否（CC0 の 3D 鹿と自分で撮った背景の合成画像は学習・配布してよい。背景の他人の顔・ナンバーは ch6 に従う）、CLAUDE.md「乱数はシード付き」。
既存: `docs/specs/dataset-footage`（背景の manifest の形・`uses`・`group`・`distribution`）、`docs/specs/dataset-train`（YOLO の素材の形 `images/`・`labels/`・`manifest.json` の `files[]`・`sources[video].license`、L0 の入力 `FRAME = (640, 480)`）、`docs/reports/2026-11-06-sdata-research.md`（前回の 2D の S データの結果と、この feature への引継ぎ）。

**今回の背景はすべて夜**: `train` の走行は 2026-11-06 の夜だけで、昼の鹿なしのフレーム（2026-09-07 の朝）は `val`（`fp_eval`）なので合成に使わない。夜の鹿は L0 が 0 検出の弱点なので、夜から始めるのは目的に合う。

**範囲外**（別 feature・別の判断）:

- `train_sources.toml` への登録と、`train_l0.py` が `license = "self"` の YOLO の素材を受けるようにする変更（`dataset-train` の更新）。「実写のみ」と「実写＋S データ」の比較もそこ
- 鹿のモデルの造形の作り直し（角の形をエゾシカに寄せるなど）。今回は大きさの調整と、M03・M04 の材質の張り直し（R3）まで
- 目の反射（タペタム）。向きに関係なく光らせると後ろ向きの鹿にも光る点が付く（敵対レビュー W4）ので、今回は描かない（下の Deferred）
- 影（地面に落ちる影・接地の陰り）。EEVEE には影だけを受ける地面（shadow catcher）が無い。ヘッドライトはカメラの側から当たるので影はほぼ鹿の後ろに隠れる（下の Deferred）
- 合成画像の公開・配布（背景のぼかしを人が確かめるまでしない。`distribution: "not_allowed"` を引き継ぐ）

**Tier 1 の根拠**: 認可・永続化スキーマ（DB・API）・外部への送信・並行性を足さない。書くのは gitignore 済みの `dataset/private/self-synth/` だけ。背景・モデルは読むだけ。Blender は手元に置いたものを子プロセスで呼ぶだけで、ダウンロードしない。

## 依存

- 新しい Python の依存は足さない。計画・射影・合成・箱・manifest は標準ライブラリと `numpy` だけで動く（CI は `edge/detector[dev]` だけで、opencv・Blender が無い）
- 画像の読み書き（opencv）と Blender の子プロセスは、差し替えられる薄い関数にし、テストは偽物を渡す（`self_footage.py` と同じ。実物はカバレッジから外す）。`synth_render.py` は Blender の中でしか動かないので pytest から import しない（ruff だけ当てる）
- Blender は 4.5 LTS（`--blender` で実行ファイルを渡す。版を manifest に書く）。開発の Mac では blender.org の arm64 版（4.5.15、配布元の SHA-256 と照合済み）を `~/work/tools/` に置いた。Homebrew の cask は Intel 版で、Apple Silicon では Rosetta で遅い
- 実データ（背景・モデル）は main の checkout にだけある（worktree には無い）。実データの run は main の checkout のパスで回す（`dataset-footage` と同じ）

## 事前の確かめ（2026-11-07、`docs/reports/2026-11-07-dataset-synth-blend-check.md`）

Blender 4.5.15 で 4 体を開き、骨格・動作・画像・大きさを確かめた（引継ぎの「最初に .blend の動作が再生できるかを確かめる」）:

- M01・M02（GLB）: 読み込める。骨 38・46 本。13 種の動作が骨の姿勢を変える（接頭辞 `AnimalArmature|` 付きの重複あり）。テクスチャなしの単色の低ポリ。`Icosphere`（鹿でない補助の形）を描かない。**glTF の読み込みは全動作を NLA の帯に積み、後から読んだ GLB（骨格の名前が同じ）の帯も前の骨格に積む** → 動作を選ぶたびに NLA の帯を消す
- M03・M04（.blend）: 開ける。骨 31 本。`Idle.000`・`Idle.001`・`LookAround.000`・`LookAround.001`・`Eat.001`・`Run`・`Die.*` が骨の姿勢を変える（`Stand` は 1 フレーム、`Idle` は全部を並べた長い帯）。画像は .blend に埋め込まれていて読める（物だけを取り込むと画像は付いてこないので、画像も取り込む）。**材質は Blender Internal の形式で、4.5 ではテクスチャが外れて単色になる** → `UVMap` の UV で毛皮の画像を張り直すと写実寄りに描ける（`Projection*` の UV は合わない）。同梱のテキストはメモとライセンス（CC0）だけで、スクリプトは無い（念のため `--disable-autoexec` で開く）
- 4 体で動作・材質・画像の名前がぶつかる（Blender が `.001` を付ける）→ 読み込んだ直後に `<id>/<元の名前>` に改名し、元の名前で引く
- 動作はすべての骨にキーを持たない → 動作を変えるたびに骨を静止の姿勢に戻す（戻さないと前の動作の脚の形が残る。実際に起きた）
- 肩の高さ（R3 の測り方、モデルの単位）: M01 3.405・M02 3.246・M03 4.108・M04 4.169。肩 1 m にそろえて横から並べた描画で、4 体とも背の上端が 1 m の線に合うことを目で確かめた

## Example Map

Story: B の開発者として、夜の道に立つ・横切る・草を食べるエゾシカの画像を、ラベル付きで数百枚、手で付けずに作りたい。合成した鹿が見えないのに箱だけある画像・合成の跡（暗い縁・鹿だけ違うノイズ）・評価の走行の背景が学習に入る事故・焼き込みの場所に鹿が描かれる事故は、人の注意ではなく道具が止める。

- R1: 一覧（`dataset/synth.toml`。Git に入る）
  - `[render]`: `samples`（EEVEE のサンプル数。正の整数）
  - `[background]`: `clips`（背景に使うクリップの id の配列。1 つ以上。背景の manifest の `clips` にあること）
  - `[camera]`: `size`（[幅, 高さ]。背景のクリップの `size` と同じでなければエラー）・`focal_px`・`height_m`・`pitch_deg`（[最小, 最大]。下向きが正。1 枚ごとに選ぶ）
  - `[headlight]`: `power_w`（[最小, 最大]。路面の帯の明るさが `road_ref` の背景での強さ）・`road_ref`（8 bit の明るさ。正）・`height_m`・`spacing_m`・`forward_m`・`spot_deg`・`blend`・`tilt_deg`・`ambient`（[最小, 最大]。空の明るさ）
  - `[[model]]`: `id`（`M01`〜`M04`）・`file`（`external/deer3d/<id>/` の中のファイル名）・`weight`（正）・`shoulder_m`・`rest_action`・`actions`（1 つ以上）・`textures`（M03・M04 だけ。材質の名前 → 画像の名前）
  - `[placement]`: `distance_m`・`lateral_m`（[最小, 最大]）・`shoulder_jitter`（0 以上 0.5 未満）・`max_deer`（1〜3）・`extra_deer_p`（0〜1）・`min_gap_m`・`tries`（正の整数）
  - `[composite]`: `blur_px`・`noise`（[最小, 最大]）・`floor_percentile`（0〜100）・`jpeg_quality`（1〜100）
  - `[accept]`（大きさは **L0 の入力 640×480 の画素**で書く。合成は 1920×1080 なので、横 ×3・縦 ×2.25 に直して比べる）: `l0_size`（[640, 480]）・`min_box_h`・`min_visible`（面積）・`min_contrast`（8 bit）・`max_cut`（0〜1）・`max_bright_ratio`
  - 知らないキー・欠けたキー・範囲の逆転（最小 > 最大）・負の値・`nan`・`inf`・真偽値・知らないモデル・重複・`actions` が空・範囲の外 → エラー（キー名つき）。違反があれば何も書かない
- R2: 背景を選ぶ
  - 背景の manifest は `dataset/private/self-footage/manifest.json`（`--footage`）。`version`・`files[]`・`clips`・`distribution`・`blur_reviewed` が読めない・形が違う → エラー
  - 使うのは `uses` に `synth_background` があり、`video` が `[background] clips` にある `files[]` だけ。0 枚ならエラー。`clips` に背景の manifest に無いクリップ → エラー
  - `synth_background` の背景の `split` が `train` でない → エラー（背景の manifest の破損。評価の走行の背景を学習に入れない）
  - 選んだ背景は、計画の前に全部を読んで SHA-256 を manifest と照合し（違えば・リンクならエラー。何も書かない）、路面の帯（画面の下 1/4 の中央 1/3）の明るさの中央値を測る（R4 の照明に使う）
  - 背景のクリップの `overlay_masks`（焼き込みの矩形）と、フレームの `blur_boxes`（ぼかした人・車の箱）を読む。`distribution`・`blur_reviewed` はそのまま引き継ぐ
- R3: 鹿のモデル
  - 実体は `dataset/external/deer3d/<id>/<file>`。`external/deer3d/manifest.json` の `models[]` の `id` の `files[]` から `path` が `file` のものを探し、SHA-256 を照合する（照合するのは使うファイルだけ。M04 の 7z・FBX は使わないので見ない）。無い・違う・リンク・manifest に無い → エラー。モデルの `license` が `CC0` で始まらない → エラー
  - M03・M04 は `textures` の材質に、Principled BSDF ＋ 画像（UV は `UVMap`）を張り直す
  - 鹿でない物（ライト・カメラ・地面の `Plane*`・`Icosphere`）は描かない
  - 大きさ: `rest_action` の 0 フレームで、前脚の付け根の骨（`FrontUpperLeg.L` / `Frontleg_L`）の前後位置（体長の ±6%）の胴（M03・M04 は頭・角・目のメッシュを除く）の上端 − 足の最も低い点を肩の高さとし、`shoulder_m × 倍率` になるように拡大する
  - 足を路面に置く: 選んだ姿勢で、鹿の頂点の最も低い点を路面（z = 0）に合わせる
- R4: 計画（`jobs.json`。シード付き・決定的）
  - 1 枚ごとに: 背景を 1 つ（背景は順に使い切ってから繰り返す。並びはシードで混ぜる）、鹿の数（1 頭、確率 `extra_deer_p` ごとに 1 頭ずつ足して `max_deer` まで）、鹿ごとに モデル（重み付き。同じ 1 枚に同じモデルは 1 回まで）・動作・その中のフレーム（整数）・距離・横の位置・向き（0〜360°）・肩の倍率、カメラの下向きの角・ヘッドライトの強さ・空の明るさ・ぼかし・ノイズ・合成のシード
  - ヘッドライトの強さ = `power_w` から選んだ値 × (max(その背景の路面の帯の明るさ, 2) / `road_ref`)^2.2（ドラレコの露出に照明を合わせる。描いた明るさは強さの 1/2.2 乗に比例するので、鹿と路面の明るさの比が背景によらず保たれる）
  - 置く前の射影の確かめ（ピンホール。R1 の `[camera]` とその枚の下向きの角）: 鹿の大まかな箱（中心の左右に肩の高さ ×1.0、足から上に肩の高さ ×1.7）が画面の中（端から 2% の内側）にあり、焼き込みの矩形と重ならないこと。鹿どうしの足元の距離が `min_gap_m` 以上。満たさなければ同じ乱数の流れで置き直す（`tries` 回まで。超えたらその鹿を置かない。1 頭も置けなければその枚を捨てて数える）
  - 同じシード・同じ一覧・同じ背景の manifest → 同じ `jobs.json`
- R5: 描画（Blender。`synth_render.py`）
  - カメラ: センサー幅 36 mm・`sensor_fit = HORIZONTAL`・焦点距離 `focal_px × 36 / 幅`、位置 (0, 0, `height_m`)、+Y を向いて その枚の `pitch_deg` だけ下向き
  - ヘッドライト: スポットライト 2 つ（左右 `spacing_m`、高さ `height_m`、カメラより `forward_m` 前、`tilt_deg` 下向き。EEVEE の打ち切り距離は 200 m に広げる）。空は一様な暗い色（`ambient`）
  - 透明の背景（film transparent）、色の変換は `Standard`。EEVEE、サンプル数は `[render] samples`
  - 書くもの: `<job>.png`（鹿だけの RGBA、straight alpha）、鹿が 2 頭以上なら鹿ごとの `<job>_m<k>.png`（ほかの鹿を holdout にして描いたアルファ）、`<job>.json`（鹿ごとの射影の箱 [x0, y0, x1, y1]。画面で切らない、評価した頂点から）。終わりに `render.json`（Blender の版・job の数）
  - Blender が 0 以外で終わる・ファイルが欠ける → エラー（何も書かない）。スクリプトの例外でも 0 で終わらないよう `--python-exit-code 1` を付ける
  - `check`: 4 体の読み込み・`actions` の各動作が骨の姿勢を変えること・材質の張り直し・肩の高さと、Python の射影との突き合わせ（決めた 5 点を Blender のカメラで射影した画素を書く）
- R6: 合成と採否（1 枚ごと。合成のシードで決定的）
  - 鹿の層: RGB をアルファで premultiply してから、RGB とアルファを同じ `blur_px` の σ でぼかす（縁に暗い跡を作らない）。鹿の RGB に背景の暗部の床（背景の明るさの `floor_percentile` 百分位）を足す（照らされない部分が真っ黒のシルエットにならないように）
  - 重ねる: `合成 = 鹿（premultiply 済み）＋（1 − アルファ）× 背景`。焼き込みの矩形を黒（0）で塗り直す
  - **ノイズは画面全体に**同じ σ（`noise`）で足し、焼き込みの矩形はもう一度黒に塗る（鹿の範囲だけノイズの性質が違う跡を作らない）
  - 鹿ごとの見えているマスク = マスクのアルファ ≥ 0.5 かつ焼き込みの矩形の外かつ画面の中。箱はその画素の外接矩形
  - 採否（鹿ごと。大きさは L0 の画素に直して比べる）:
    - `small`: 箱の高さ < `min_box_h`
    - `few`: 見えている画素 < `min_visible`
    - `dark`: 見えている画素での「ノイズを足す前の合成」と背景の明るさの差の絶対値の平均 < `min_contrast`（ノイズだけで閾値を超えることはない）
    - `bright`: (見えている画素の合成の明るさの中央値 + 5) / (箱の中の背景の明るさの 90 百分位 + 5) > `max_bright_ratio`（真っ暗な背景に明るい鹿だけが浮く画像を作らない。照明を背景に結び付ける）
    - `cut`: 1 − 見えている箱の面積 / 射影の箱の面積 > `max_cut`（画面の端と焼き込みの矩形で切れた鹿・ほかの鹿に大きく隠れた鹿）
    - `blurbox`: 箱が背景の `blur_boxes`（人・車）と重なる
  - 1 頭でも採らない鹿があれば**その 1 枚を捨てる**（箱の無い鹿が写った画像を作らない）。捨てた数を理由ごとに数える
- R7: 書き出し
  - 背景の manifest の `image` が絶対パス・`..`・`\` を含む → エラー（self-footage の外を開かない）
  - 置き場所: `--out` はちょうど `dataset/private/self-synth`、`--footage` はちょうど `dataset/private/self-footage`、`--models` はちょうど `dataset/external/deer3d`（リンクを通した別名もエラー）。違えば何も作らない（終了コード 2）
  - run は `<out>/<run>/`。`run` は `^[a-z0-9][a-z0-9-]{0,31}$` で、`-review` で終わらない（目で見る一覧のフォルダとぶつかる）。既にあればエラー（作り直すときは手で消す。前の run を上書きしない）
  - 一時フォルダ `<out>/.tmp-<run>/` を `mkdir` で作る（既にあればエラー＝同時の実行の鍵。止まった実行の残りは手で消す）。描画・合成をそこに書き、最後に `<out>/<run>/` が無いことをもう一度確かめてから名前を変える。途中のエラーでは一時フォルダを消す
  - `images/train/<run>_<連番 5 桁>.jpg`（品質 `jpeg_quality`、メタデータなし。`self_footage.jpeg_metadata` で SOS より前が APP0・DQT・SOF・DHT・DRI だけであることを確かめる）と `labels/train/<同名>.txt`（`0 cx cy w h`、中心基準の正規化、小数 6 桁、鹿ごとに 1 行）。中間の PNG・JSON と `jobs.json` は消す（中身は manifest に残る）
  - 目で見る一覧: シード付きで最大 40 枚を選び、箱を描いた縮小画像を `<out>/<run>-review/` に書く（manifest の外。`dataset/private/` の中だけ）
- R8: manifest（`<out>/<run>/manifest.json`）
  - 全体: `version: 1`・`kind: "synth"`・`run`・`seed`・`license: "self"`（背景 self ＋ 鹿 CC0。厳しい側）・`allowed_use: ["train"]`・`distribution`・`blur_reviewed`（背景の manifest から引き継ぐ）・`footage_manifest_sha256`・`deer3d_manifest_sha256`・`models`（id → ファイル・SHA-256・`license`・作者・名前。肩の高さ（モデルの単位）は `check` の表示と事前の確かめの報告書に残す）・`blender`（版）・`numpy`（版）・`config`（一覧の中身）・`counts`（計画・書いた・捨てた理由ごと、距離の帯（8〜20・20〜35・35〜50 m）× 頭数ごとの計画と書いた数）・`sources`・`files`
  - `sources`: `synth:<背景のクリップ>` → `{license: "self", background: <クリップ>, time_of_day}`（`dataset-train` の `sources[video].license` に合わせる）
  - `files[]`: `image`・`label`・`sha256`・`video`（`synth:<クリップ>`）・`group`（背景の `group`。`self:<drive>`）・`split: "train"`・`background`（背景の `image` と `sha256`）・`camera`（その枚の `pitch_deg`）・`deer`（鹿ごとに `model`・`action`・`frame`・`distance_m`・`lateral_m`・`yaw_deg`・`shoulder_m`・`box`（画素の [x, y, w, h]）・`visible_px`・`contrast`・`bright_ratio`）・`light`（ヘッドライト・空・背景の路面の帯の明るさ・ぼかし・ノイズの値）
  - **学習と評価を分ける単位は `files[].group`（背景の走行）**。今の `collect_yolo` は `yolo:<video>` を group にするので、`dataset-train` の登録のときに `files[].group` を読むように直す（下の Deferred）
  - **書かないもの**: 絶対パス・背景の撮影時刻・位置
- R9: CLI と表示
  - `python dataset/synth.py run --run <name> --count <N> --seed <S> --blender <path>`（`--footage`・`--out`・`--models` は既定値が上の置き場所）。`python dataset/synth.py check --blender <path>` は R3・R5 の確かめを回し、射影のずれが 2 px を超える・動作が姿勢を変えない・テクスチャが張れない → 終了コード 1
  - 終わりに、書いた枚数・捨てた数（理由ごと）・距離の帯 × 頭数ごとの計画と書いた数・距離の帯ごとの鹿の明るさの中央値と背景の路面の帯（画面の下 1/4 の中央 1/3）の明るさの中央値を表示する（画像・ファイル名の中身は出さない）

## ユースケース

### UC-1: 一覧を読む（R1）

- **Given**: `synth.toml`
- **When**: `run`
- **Then**: 値が検証され、違反はキー名つきでエラー、何も書かない

### UC-2: 背景を選ぶ（R2）

- **Given**: 背景の manifest
- **When**: 背景を選ぶ
- **Then**: 一覧のクリップの `synth_background` のフレームだけが選ばれ、SHA-256 が合わなければエラー

### UC-3: モデルを確かめる（R3）

- **Given**: deer3d の manifest とモデル
- **When**: `run` / `check`
- **Then**: SHA-256・ライセンスが合うモデルだけを使う

### UC-4: 計画する（R4）

- **Given**: 一覧・背景・シード
- **When**: 計画する
- **Then**: 決定的な `jobs.json` ができ、大まかな箱が画面の中・焼き込みの外、鹿どうしが離れている

### UC-5: 合成して採否を決める（R6）

- **Given**: 偽の描画（鹿の RGBA・マスク・射影の箱）と偽の背景
- **When**: 合成する
- **Then**: 焼き込みの矩形が黒のまま、縁に暗い跡が無く、箱が見えている画素の外接矩形、小さい・暗い・明るすぎる・切れた・人や車と重なる鹿の入った 1 枚は捨てられる

### UC-6: 書き出しと manifest（R7・R8）

- **Given**: 合成した画像
- **When**: 書き出す
- **Then**: JPEG にメタデータが無く、YOLO のラベルと manifest が `dataset-train` の YOLO の素材の形で書かれ、絶対パスが無い

### UC-7: 射影の突き合わせ（R5 の check）

- **Given**: Blender のカメラで射影した 5 点（check の結果）
- **When**: Python の射影と比べる
- **Then**: ずれが 2 px 以内なら通り、超えれば失敗

## 状態パターン

### S-1: 途中で失敗した

- **Given**: 描画の子プロセスが失敗 / 合成の途中でエラー → **Then**: 一時フォルダが消え、`<out>/<run>/` はできない

### S-2: 同じ run 名

- **Given**: `<out>/<run>/` がある → **Then**: エラーで、前の run は変わらない

## Questions

決着済み（2026-11-07、推奨で決定。PR にも書く）:

- 背景 → `synth_background` のフレームのうち、**ユーザーが鹿なしと言った 2 本（`20261106_night-1`・`20261106_night-2`、354 枚）だけ**。鹿ありの 2 本の鹿なしの区間（289 枚）は、人が鹿の有無を見ていない時間がある（説明に無かった群れが見つかった実例もある）ので、確かめるまで使わない（敵対レビュー C4。下の Deferred）。Mapillary（CC BY-SA）・朝の `val`・鹿ありの区間は使わない
- モデルの重み → M03・M04（写実寄りのテクスチャ）を 0.35 ずつ、M01・M02（単色の低ポリ）を 0.15 ずつ。M01・M02 も形の多様さのために少し混ぜる
- 動作 → 立つ・見回す・食べる・歩く・走る（M01・M02: `Idle`・`Idle_2`・`Idle_Headlow`・`Eating`・`Walk`・`Gallop`。M03・M04: `Idle.000`・`Idle.001`・`LookAround.000`・`LookAround.001`・`Eat.001`・`Run`）。倒れる・攻撃・跳ぶは路上の鹿として不自然なので使わない
- 肩の高さ → 雄（M01・M03）1.0 m、雌（M02・M04）0.85 m、±10%（エゾシカの肩高 約 1 m。引継ぎの数字）
- カメラ → ドラレコ `dashcam-a` の推定: `focal_px = 1400`（水平の画角 約 69°）・`height_m = 1.35`。2026-09-07 の朝のフレーム（`val`）の車線の破線（5 m・5 m の繰り返しとして）と車線幅（約 3 m）から目で測った（朝は地平線が y ≈ 467、下向き 約 3°）。**幾何を測るためだけに見た**（背景には使わない）。画角はドラレコとしては狭いが、破線と車線幅の 2 つの測り方が合っている。レンズの歪みは無視する
  - **夜の 2 本は取り付けが違った**（敵対レビュー C3 のとおり）: 朝の値で試しに 20 枚を作ると、鹿が道より上（空）に浮いた。夜の明るいフレーム（街灯・対向車のある区間）を明るくして見ると、道の消失点は y ≈ 880〜940（ボンネットが映らない）。焦点距離が同じなら上向き 約 13.7〜15.9° → `pitch_deg = [-16, -13.5]`（下向きが正）で 1 枚ごとに乱す。路面は画面の下 約 1/5 にしか映らないので、近い鹿（約 10 m より近い）は足が画面の外に出て R4 で置き直しになる
- 置く範囲 → 距離 8〜50 m、横 −6〜+6 m（道と路肩）。50 m より遠い鹿はヘッドライトで照らされないので置かない
- 鹿の数 → 1 頭、`extra_deer_p = 0.25` で 2 頭目・3 頭目（エゾシカは群れでいることが多い）
- 合成の跡（敵対レビュー C1）→ premultiply してぼかす。ノイズは画面全体に足す（背景も少し変わるが、背景はもともと JPEG の再圧縮で変わる）
- 採否の値（敵対レビュー C2。L0 の入力 640×480 の画素）→ `min_box_h = 8`（1080p で 18 px）・`min_visible = 40`（1080p で 270 px）・`min_contrast = 10`（ノイズの前に測る）・`max_cut = 0.3`・`max_bright_ratio = 3.0`
  - `min_contrast` は最初 8 にしたが、試しの run の切り抜きを 2 倍に明るくして見ると、8〜10 の鹿（30〜45 m の黒いシルエット）は目でもほとんど見えなかった。12〜14 の鹿は見えた → 10
- 夜の見え方 → ヘッドライト 2 つの物理的な減衰に任せ、強さ・空・ぼかし・ノイズを範囲で乱し、`bright`・`dark` で背景に結び付かない鹿を落とす。実データの run の**合格の線**: 近い帯（8〜20 m）の鹿の明るさの中央値が、背景の路面の帯の中央値の 0.5〜2 倍。外れたら一覧の範囲（`power_w`）を直して新しい run 名で作り直す（コードは変えない）
  - **試しの run で分かったこと（2026-11-07）**: 夜の 354 枚の路面の帯の明るさは 4〜36（10・50・90 百分位で 4・10・28）と 9 倍ばらつき、強さを固定すると暗い背景で鹿だけが明るく浮き、明るい背景では沈んだ（同じ強さで路面 22 の背景は比 約 1.4、路面 10 の背景は 約 3.2）→ 強さを背景の路面の帯の明るさで決める（R4）。`power_w = [400, 1200]`・`road_ref = 20`
  - EEVEE はライトの強さから決めた距離（800 W で 20 m 台）で光を打ち切り、20 m より遠い鹿が急に真っ黒になった → 打ち切り距離を 200 m に広げた（R5）。広げた後の明るさの中央値は、鹿 40・16・10（8〜20・20〜35・35〜50 m）
  - 暗い背景（路面の帯が 8 未満。全体の約 1/3）では鹿も暗く描かれ `dark` で捨てられる（見えない鹿に箱を付けない）。書ける割合は計画の 約 45%。`--count` は計画の枚数なので、書く枚数を 600 前後にするには計画を 1,300 にする
- 目で見る確かめ（敵対レビュー C2）→ run ごとに最大 40 枚の箱付きの一覧を `dataset/private/self-synth/<run>-review/` に作り、「見えない鹿に箱」「箱の無い鹿」「浮いた鹿」「暗い縁」の枚数を報告書に書く。0 でなければ原因を直して作り直す
- 枚数 → 1 回目は書く枚数 600 前後（前回の 2D の S データと同じ枚数。比べやすい）。計画 1,300（`--count 1300`）、シード 7
- 置き場所 → `dataset/private/self-synth/<run>/`（背景が `not_allowed` なので `private/`）
- ラベルの付け方 → 見えているマスクの外接矩形（隠れた部分・焼き込みの下を含めない）。採らない鹿が 1 頭でもある画像は捨てる。捨てたことで距離・頭数の割合がずれるので、計画と書いた数を並べて残す（敵対レビュー W2）
- 決定性（敵対レビュー I3）→ 計画（`jobs.json`）と合成はシードで決まる。描画は同じ機械・同じ Blender の版・同じサンプル数で同じになる前提（GPU が違えば画素が少し変わりうる）。Blender と numpy の版を manifest に書く
- 予算（ch9 ③「予算」は空欄・推奨なし）→ この feature はお金を使わない（Blender・CC0 のモデル・手元の映像だけ）。判断を待たずに進める
- 承認ゲート → CLAUDE.md の「推奨で決めて進める」に従う
- 敵対レビュー（`docs/reports/2026-11-07-spec-adversary-dataset-synth.md`）の取り込み: C1 → premultiply と画面全体のノイズ（COMP-5a）。C2 → 採否の値を L0 の画素で決め、`dark` をノイズの前に測り、目で見る一覧と明るさの合格の線を足した（COMP-5c）。C3 → 下向きの角を乱し、`bright` で照明を背景に結び付けた。影は Deferred。C4 → 背景を鹿なしの 2 本に絞った（`[background] clips`）。W1 → 計画で大まかな箱が焼き込みと重なる置き方を置き直し、合成で焼き込みに隠れた分も `cut` に数える。W2 → 計画と書いた数を距離の帯 × 頭数で並べる。W3 → `check` で Python と Blender の射影を突き合わせる（UC-7）、`sensor_fit = HORIZONTAL`。W4 → 目の反射は今回描かない。W5 → R8 と Deferred に `files[].group` を明記。I1 → `[render]`。I2 → 依存に書いた。I3 → 上の決定性。I4 → 名前を変える直前の確かめと、使うファイルだけを照合（R3）
- 実装後のレビュー（2026-11-07）の取り込み: code-reviewer（`docs/reports/2026-11-07-code-reviewer-dataset-synth.md`）Critical 0。W1（Blender の `--python-exit-code 1`）・W2（`-review` で終わる run 名を拒む）を直した。W5 は R8 を「肩の高さは `check` と報告書に残す」に直した。ほかの Warning（タイムアウト・0 枚で成功・連番の欠番・PNG の大きさの検査・ぼかしの速さ・`_run` の長さ・`check` の肩の高さの検証など）は報告書に残して次に回す。security-auditor（`docs/reports/2026-11-07-security-auditor-dataset-synth.md`）Critical・High 0。M-1（背景の `image` が self-footage の外を指す）を直した。M-2〜M-4（照合から読むまでの間・.blend の外部の画像参照・`--disable-autoexec` の効き目の実機確認）は報告書に残す（入力はユーザーの手元のファイルだけ）

- [Deferred: 担当=人 B（`dataset-train` の更新）/ 期日=2026-11-08 / 暫定挙動=`train_sources.toml` に書かない。合成画像は学習に入らない] `train_sources.toml` への登録（`license = "self"` の YOLO の素材を `train_l0.py` が受ける変更、漏れの検査を `collect_yolo` の `yolo:<video>` ではなく `files[].group`（背景の走行）で行う変更、登録の時点で `footage_manifest_sha256` が今の背景の manifest と同じで背景がまだ `synth_background` かを確かめる変更）と、「実写のみ」と「実写＋S データ」の比較（評価は実写の鹿だけ）
- [Deferred: 担当=人 B（ラベル付けの feature）/ 期日=2026-11-08 / 暫定挙動=鹿ありの 2 本の鹿なしの区間は背景に使わない（`[background] clips` に入れない）] 鹿ありのクリップの鹿なしの区間に鹿・目の反射が映っていないかの確かめ。確かめたら `clips` に足して新しい run を作る
- [Deferred: 担当=ユーザー / 期日=公開・配布の前 / 暫定挙動=`distribution: "not_allowed"`・`blur_reviewed: false` を引き継ぎ、合成画像を公開の場所に出さない] 背景のぼかしの人の確かめ（`dataset-footage` と同じ）
- [Deferred: 担当=人 B / 期日=昼の `train` の走行が入ったとき / 暫定挙動=夜の背景だけで作る] 昼の S データ（背景の manifest に昼の `train` の走行が入れば `clips` に足す。昼の照明の範囲は時間帯ごとに一覧を分ける変更が要る）
- [Deferred: 担当=人 B / 期日=dataset-train の比較の後 / 暫定挙動=目の反射・影を描かない] 目の反射（頭がカメラを向くときだけ光らせる）と影（Cycles の shadow catcher か、地面の陰りの近似）。比較の結果、夜の S データが効かなければ最初に足す候補

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: 一時フォルダの偽の背景の manifest（一覧のクリップの train の鹿なし 3 枚、一覧に無いクリップの train の鹿なし 1 枚、val 1 枚、鹿あり 1 枚）・偽のモデルの manifest・偽の描画・偽の画像の読み書きで `run` を回すと、`<out>/<run>/` に画像・ラベル・manifest ができ、背景は一覧のクリップの train の鹿なしだけ、焼き込みの矩形が黒、ラベルが見えている画素の外接矩形、manifest に絶対パスが無い。同じシードで 2 回目（別の run 名）を回すと同じ jobs と同じラベル

UC-1 一覧:

- [x] CFG-1a: 正しい一覧（リポジトリの `dataset/synth.toml`）を読む
- [x] CFG-1b: 知らないキー・欠けたキー・範囲の逆転・負の値・`nan`・`inf`・真偽値・知らないモデル・重複・`actions` が空・`max_deer` が 1〜3 の外・`clips` が空 → エラー（キー名つき）

UC-2 背景:

- [x] BG-2a: 一覧のクリップの `synth_background` のフレームだけを選ぶ（`fp_eval`・`label`・`negative` だけ・一覧に無いクリップは選ばない）。0 枚 → エラー。一覧のクリップが背景の manifest に無い → エラー。`size` が違う → エラー
- [x] BG-2b: 背景の SHA-256 が違う → エラー。`synth_background` なのに `split` が `train` でない → エラー。manifest の形が違う → エラー

UC-3 モデル:

- [x] MDL-3a: deer3d の manifest と SHA-256 が合うモデルだけを通す。違う・無い・リンク・manifest に無い・ライセンスが CC0 でない → エラー。使わないファイル（7z）は見ない

UC-4 計画:

- [x] PLAN-4a: 同じシードで同じ jobs、違うシードで違う jobs。背景は使い切ってから繰り返す。鹿の数が 1〜`max_deer`、同じ 1 枚に同じモデルが 2 回出ない、値が一覧の範囲の中
- [x] PLAN-4b: 射影: 地平線の y・遠いほど小さく地平線に寄る・左右の向き。大まかな箱が焼き込みの矩形と重なる・画面の外・鹿どうしが近すぎる置き方は置き直す。置けなければ鹿を減らし、1 頭も置けなければ捨てて数える
- [x] PLAN-4c: ヘッドライトの強さが背景の路面の帯の明るさで決まる（路面が `road_ref` なら `power_w` の範囲、2 倍明るければ 2^2.2 倍、真っ黒でも 0 にならない）。路面の帯は画面の下 1/4 の中央 1/3 の中央値

UC-5 合成と採否:

- [x] COMP-5a: premultiply で重ね、縁の画素が鹿の内側と背景の両方より暗くならない。焼き込みの矩形が黒のまま。ノイズは画面全体に（σ 0 なら鹿の無い画素は背景のまま）。黒の床が足される
- [x] COMP-5b: 箱は見えているマスク（≥ 0.5、焼き込みの外）の外接矩形。2 頭で手前の鹿に隠れた部分は奥の鹿の箱に入らない
- [x] COMP-5c: `small`・`few`・`dark`（ノイズを大きくしても暗い鹿は捨てる）・`bright`・`cut`（画面の端・焼き込み）・`blurbox` の鹿があれば、その 1 枚を捨て、理由を数える。大きさは L0 の画素に直して比べる
- [x] COMP-5d: 同じ合成のシードで同じ画素

UC-6 書き出しと manifest:

- [x] OUT-6a: YOLO のラベルの形（`0 cx cy w h`、小数 6 桁、鹿ごとに 1 行）と画像の対応。JPEG に許していないマーカーがあればエラー
- [x] OUT-6b: manifest の全体・`sources`・`files[]`（`group` が背景の group、`split: train`、`video: synth:<clip>`、`deer`・`light`・`camera`・`background`）、`counts`（理由ごと・距離の帯 × 頭数）、`distribution`・`blur_reviewed` の引き継ぎ。絶対パスが無い。目で見る一覧が `<run>-review/` にできる
- [x] OUT-6c: `--out`・`--footage`・`--models` がちょうどの置き場所でない・リンクを通した別名 → エラーで何も作らない（終了コード 2）。`run` の名前の書式違い → エラー
- [x] OUT-6d: 描画の失敗（子プロセスの失敗・ファイルの欠け）で一時フォルダが消え、run ができない（S-1）。鍵（一時フォルダ）があればエラーで消さない。同じ run 名 → エラー（S-2）

UC-7 射影の突き合わせ:

- [x] CHK-7a: Blender の射影の 5 点と Python の射影のずれが 2 px 以内なら通る、超えれば失敗。動作が姿勢を変えない・テクスチャが張れていないモデルがあれば失敗

状態パターン:

- [x] S-1: 途中の失敗（OUT-6d と同じテストで確かめる）
- [x] S-2: 同じ run 名（OUT-6d と同じテストで確かめる）

## 非機能要件

- [x] 個人情報: manifest・表示・報告書に絶対パス・撮影時刻・位置を書かない。合成画像は `dataset/private/`（gitignore 済み）にだけ置く
- [x] 決定性: 同じシード・同じ一覧・同じ背景の manifest で同じ `jobs.json`（＝manifest の `deer`・`light`・`camera`）。合成は job ごとのシードで決定的
- [x] ruff と pytest のカバレッジ 70% 以上（`dataset/` 全体）。既存のテストが Green のまま

## 受け入れ基準

- [x] 受け入れテスト AC-1 が Green
- [x] 全 UC / 全状態パターンのテストが Green、既存テストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（ruff check・ruff format）
- [x] code-reviewer・security-auditor の Critical 0
- [x] 実データで `check`（終了コード 0）と `run`（書く枚数 600 前後＝計画 1,300、シード 7。結果は書いた 469 枚・近い帯の比 1.56・目で見る失敗 0。600 に届かなかった理由と扱いは報告書）を回し、件数・捨てた数・距離の帯ごとの明るさ（合格の線）・目で見る一覧の失敗の枚数だけを `docs/reports/2026-11-07-dataset-synth-run.md` に残す（画像・ファイル名の中身を書かない）
