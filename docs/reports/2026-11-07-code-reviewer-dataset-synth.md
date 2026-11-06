# code-reviewer: dataset-synth（2026-11-07）

対象: `dataset/synth.py`、`dataset/synth_render.py`、`dataset/synth.toml`。
仕様: `docs/specs/dataset-synth/functional.md`（R1〜R9）。
読み取りだけでコードは変えていない。`tests/test_synth.py` は見ていない。

## 総評

- 合成の数式は仕様どおり。
  - `synth.py:667-675`: premultiply してからぼかし、床を足し、`premult + (1-α)·bg` で重ねる。この式は 2 つの凸結合なので、縁が鹿の内側と背景の両方より暗くなることはない（COMP-5a）。
  - `synth.py:710-712`: 採否の大きさは L0 の画素に直して比べている。`train_l0.py:58` は 640×480 に引き伸ばす（余白なし）ので、横 ×3・縦 ×2.25 で合っている。
- 射影も一致する。`project()`（`synth.py:426-439`）と `synth_render.py` のカメラを突き合わせた。
  - 回転 `Euler(90°−pitch, 0, 0)` の前方向は (0, cos p, −sin p)、上方向は (0, sin p, cos p) になる。`project()` の depth・up と同じ。
  - 焦点距離 `focal_px·36/幅`、`sensor_fit=HORIZONTAL`、`(1−ndc.y)·height` もそのまま対応する。
  - 最後に横からの並びで使う ORTHO カメラの `Euler(90°, 0, 90°)` は −X を向き、画面の右が +Y になる。置き方（y = 3i）と合っている。
- 一時フォルダの鍵、名前の付け替え直前の再確認、`except BaseException` での後始末は仕様どおり（`synth.py:858-870, 1006-1009`）。
- 決定性は良い。計画は 1 本の `default_rng(seed)`、合成は job ごとの `default_rng(job["seed"])`。バッチ分割の影響を受けない。
- manifest の絶対パスは `m.path.name` までに抑えられている。時刻・位置も入らない。

## Critical（修正必須）

なし。次の Warning は、実データの run の前に直す価値が高い順に並べた。

## Warning（推奨）

### W1. Blender の Python 例外が終了コード 0 になり、原因が捨てられる

- `synth.py:1118-1141`
- Blender は `--python-exit-code` を付けないと、`--python` のスクリプトで例外が出ても 0 で終わる。`fail()` の `SystemExit(1)` は別。
- 今は「`render.json` / `check.json` が最後に書かれる」ことで検出できる。ただし出るのは「render.json が書かれていない」だけで、`proc.stderr` の末尾は 0 のとき読まれない。
- 仕様 R5「0 以外で終わる → エラー」の意図も、診断が無いと満たしにくい。
- 修正案:

```python
cmd = [str(executable), "-b", "--factory-startup", "--disable-autoexec",
       "--python-exit-code", "1", "--python", str(RENDER_SCRIPT), "--", mode, str(payload), str(workdir)]
# ... render.json が無いときも tail（stderr の末尾）をメッセージに含める
```

- `subprocess.run` に `timeout=` が無い。Blender が固まると、止まった実行の鍵（`.tmp-<run>`）を残したまま永遠に待つ。バッチごとの上限（例: 30 分）を足す。
- 加えて、`render.json` の `jobs` が `len(batch)` と一致するかを確かめる（R5「終わりに render.json（job の数）」を使っていない）。

### W2. `<run>-review/` が `exist_ok=True` で、別の run のフォルダに混ざりうる

- `synth.py:1010-1011`
- run 名 `a-review`（`RUN_RE` に合う）を先に作ると `out/a-review/` は run のフォルダになる。その後 run `a` を作ると、レビュー画像が `a-review` の run の直下に書かれる。manifest の外に JPEG が混ざり、データの出所が曖昧になる。
- 以前の run を手で消して review だけ残っている場合も、古い画像と新しい画像が混ざる。
- 修正案:
  - `run()` の冒頭で `(out / f"{run_name}-review").exists()` もエラーにする。
  - または `review.mkdir()`（`exist_ok` なし）にして、名前の付け替えの前に確かめる。
  - run 名が `-review` で終わるものを `RUN_RE` で拒む手もある。

### W3. 名前の付け替えの後のレビュー画像の書き出しで失敗すると、完成した run を残したまま異常終了する

- `synth.py:1009-1016`
- `tmp.rename(final)` の後で `io.read_image` / `encode_jpeg` が失敗すると、run は完成して残る。`run()` の `except BaseException` が消すのは存在しない `tmp` だけ。利用者には失敗に見えるのに run は有効、という状態になる。
- 修正案: レビューを rename の前に `tmp` の中（例: `tmp/../` ではなく一時の `.tmp-<run>-review`）へ書いて、2 つを続けて rename する。または、レビューの失敗は警告にして終了コード 0 で続ける、と決めてコメントに書く。

### W4. 0 枚でも成功する

- `synth.py:906, 1012, 972-1025`
- 全部の鹿が `dark` などで捨てられると、`files=[]`・`blender=""` の manifest を書いて exit 0 になる。
- 計画の書ける割合は約 45% と仕様にあるので、背景やライトの設定を誤ると 0 枚もありうる。
- `counts["written"] == 0` はエラーにする（rename の前）。`blender` が空の manifest を残さない。

### W5. manifest の `models` に「肩の高さ（モデルの単位）」が無い（R8）

- `synth.py:985-994`
- 仕様の `models`（id → ファイル・SHA-256・license・作者・名前・**肩の高さ**）のうち、肩の高さが書かれていない。
- `render.json`（`synth_render.py:350-352`）に `shoulder_units` を載せ、`_blender` が読んで manifest に写す必要がある。
- 現状は Blender の版しか戻していない（`IO.blender` の戻り値が `str` 1 つ）。戻り値を小さな dataclass（版・肩の高さ）にするとよい。

### W6. 画像の連番が job の通し番号で、欠番がある（R7）

- `synth.py:561, 918`
- 仕様は「`<run>_<連番 5 桁>.jpg`」。コードは計画の位置 `n`（置けず・捨てた枚の分が欠番）を使う。
- 計画の位置は `files[]` を計画と突き合わせるのには便利だが、仕様とは違う。次のどちらかにする。
  - 書いた枚数で `len(files)` から連番にし、計画の位置は `files[].plan_index` に残す。
  - 仕様を実装に合わせる。
- 学習側の `images/` の列挙に欠番が影響することはないが、報告書の「600 枚」と名前の最大値が合わなくなる。

### W7. `load_rendered` の検査が足りず、不正な PNG で素の例外になる

- `synth.py:790-807, 665-675`
- `rgba` / `masks` の形が背景（H×W）と同じかを見ていない。違うと `ValueError`（ブロードキャスト）が `SynthError` にならず、終了コード 1 のトレースバックになる。後始末は走るが、利用者向けのメッセージが無い。
- `boxes` の各要素が 4 個か、`rgba.shape[2] == 4` かも見ていない（`rgba.ndim != 3` だけ）。
- 修正案:

```python
if rgba.shape != (height, width, 4) or any(m.shape != (height, width) for m in masks):
    raise _fail(f"描画 {jid} の大きさが背景と違う")
if any(len(b) != 4 for b in boxes): ...
```

### W8. `plan_jobs` で `project()` が `SynthError` を投げ、計画ごと止まる

- `synth.py:437-438, 541`
- 置き直しの対象にするべき「後ろ・真下に近い点」が例外になる。
- `distance_m` の最小を小さくした一覧（正の値なら検証を通る）や、大きな下向きの角で、1 枚の置き方のせいで run 全体が止まる。
- `rough_box` が `depth <= 0` のとき `None` を返し、`_fits` を偽にする。

### W9. ガウスのぼかしが非常に遅い（コピーの連発）

- `synth.py:641-642`
- `np.take(padded, range(k, k+n), axis=axis)` は毎回、配列の新しいコピー（1080p×3 の float64 で約 50 MB）を作る。
- σ=1.2（半径 4）で 9 タップ × 2 軸 × (RGB＋アルファ)。1,300 枚 × 捨てる枚も含めて回るので、実時間が数倍になる。
- スライスにする。

```python
sl = [slice(None)] * out.ndim
for k, w in enumerate(kernel):
    sl[axis] = slice(k, k + out.shape[axis])
    acc += w * padded[tuple(sl)]
```

- 余裕があれば float32。

### W10. `_run` が 150 行・ネスト 4 段で、責務が混ざる

- `synth.py:873-1025`
- 計画、バッチ描画、合成、JPEG の書き出し、manifest の組み立て、レビュー画像、明るさの集計を 1 関数で行う。`files[]` の辞書（934-967）も長い。
- テストしづらく、W3 や W4 の修正も入れにくい。
- 次の関数に分ける案:
  - `_file_record(...)`
  - `_build_manifest(...)`
  - `_write_review(...)`
  - `_collect_brightness(...)`
- `run()` が 8 個、`_run()` が 9 個の位置引数を取るのは、`RunPaths` / `RunArgs` の dataclass にまとめる。

### W11. `check` が肩の高さを検証していない（R3・R5・CHK-7a）

- `synth.py:1043-1065`
- `shoulder_units` は表示するだけ。`0`・NaN・負でも合格する。`place()` の `deer["shoulder_m"] / self.shoulder_units`（`synth_render.py:204`）でゼロ除算になり、Blender の中で落ちる。
- 事前の確かめで測った値（3.4 / 3.2 / 4.1 / 4.2）は、モデルを差し替えたときの検出に使える。
- 最低でも `math.isfinite` かつ `> 0`、できれば 1 m の高さの横並びで ±10% など。

## Info（参考）

### 仕様とのずれ・小さな不整合

- `synth.py:233, 255` `textures` は M03・M04 だけの規約だが、M01・M02 に書いても検証を通る。`synth_render.py:108-139` が GLB の材質を壊す。
- `synth.py:337` `clip["size"]` が数値でない（整数など）と `tuple()` が `TypeError` を投げる（try の外）。同じく 349 の `uses` が `None`。「形が違う」の `SynthError` にする。
- `synth.py:359` `entry["image"]` が `..` を含んでも、SHA-256 が合えば読む。`footage_dir` の下かを確かめるとよい（自分の manifest なので優先度は低い）。
- `synth.py:1079-1082` `check.png` を `out/check.png` に上書きコピーする。シンボリックリンクなら先を書く。

### 数式・照明

- `synth.py:671-673` `floor_percentile=2` は、暗い夜の背景（焼き込みの黒の矩形・黒つぶれ）で 0 になりうる。そのとき床が効かず、`dark` の足切りに任せることになる。run のログに床の値の分布を出して確かめると安心。
- `synth.py:729-731` ノイズを足してから `clip` するので、黒に近い画素の平均が持ち上がる（σ=4 で約 +1.6）。夜の背景では目立つ。ラウンド前に実際の背景のノイズの σ と比べるとよい（R6 の「画面全体に」は満たしている）。
- `synth.py:523-527` 空の明るさ `ambient` は露出の倍率（`exposure`）に連動しない。暗い背景で空だけ相対的に強くなる。意図なら `synth.toml` のコメントに書く。
- `synth_render.py:230-251` `film_transparent` の PNG は dither の既定が 1.0。`scene.render.dither_intensity = 0.0` にすると、縁の暗部にノイズが乗らない。

### Blender 側

- `synth_render.py:179, 209` 評価は視点用の depsgraph（`evaluated_depsgraph_get`）。サブディビジョンの描画レベルが視点と違うモデルでは、射影の箱が実際の描画より小さくなりうる。`synth.py:700` の `cut` は負側に丸められるので安全側だが、箱が小さくなるのはラベルではなく `cut` の分母だけ。
- `synth_render.py:196` 前脚の窓の中に頂点が無いと `max()` が `ValueError`。Blender は終了コード 0（W1）。
- `synth_render.py:203-210` 動作によっては骨が前へ進む（`Run`・`Gallop`）。z は合わせているが、x・y のずれは見ていない。manifest の `distance_m` / `lateral_m` が実際の位置とずれうる。`check` に水平のずれを測る項目を足すか、仕様にメモする。
- `synth_render.py:33-35` `fail()` の戻り値は `None` だが実際は戻らない。`NoReturn` にすると、`bone is None` 後の型が通る。
- `synth_render.py:332` フレームの決め方（`phase` → `frame`）は Blender の版で `frame_range` が変わると変わる。manifest の `frame` は実際の値が入る（`meta["frames"]`）ので追跡はできる。

### 可読性

- `synth.py:574-578` `band_of` の最後の行が読みにくい。`near` は `distance_m` の最小が 8 m 未満の一覧でだけ出る。帯が `BANDS` の定数で、一覧の `distance_m` とは独立。
- `synth.py:1161, 1164` `sorted()` が文字列順なので、`20-35` → `35-50` → `8-20` の順に出る。帯の順（`BANDS` の添字）で並べる。
- `synth.py:36-37, 1155-1157` `report(stream: object)` に `# type: ignore`。`TextIO` を使う。
- `synth.py:763` の `IO` と変数 `io` は標準ライブラリの `io` と紛らわしい。`Backend` / `Ports` など。
- マジックナンバー: マスクのしきい値 `0.5`（680, 698）、`+ 5.0`（`bright`）、`1e-4`（`pose_change`）、レビューの JPEG 品質 `90`、`2**31 - 1`。名前を付ける。
- `synth.py:72-75` `SCHEMA` の種類を文字列で表している。`_value` の分岐が増えると保守が難しくなる。今のところは許容範囲。
- `synth.py:969-971` `work.iterdir()` と `unlink` と `rmtree` が重複。最後の `rmtree` だけで足りる（バッチごとの掃除は `payload.json` を毎回書き直しているので意図あり）。
- `synth.toml:31` のコメントは `power_w = 300〜1200 W` の古い数字。いまは `[400, 1200]`。

### 再現性・個人情報

- `files[].video` と `background.image` は仕様どおりで、クリップの id にはドライブの日付（`20261106_...`）が含まれる。時刻ではなく日付。R8「撮影時刻を書かない」の範囲か、仕様で一度明記するとよい。
- 同じシードの結果は numpy の版に依存しうる（`Generator` のストリームは版をまたいで保証されない）。`numpy` の版は manifest にあるので追跡は可能。
- 良い点: `check_locations` が `resolve()` との比較でリンクを拒む（`self_footage.py:855-862` と同じ作り）。`jpeg_metadata` の再利用。背景の SHA-256 を計画の前に全件照合する順序。

## 良い点

- `Rendered` / `Outcome` / `IO` に分けた構造で、Blender・opencv 抜きのテストが書きやすい。
- 採否の第一理由だけを数え、1 頭でも落ちれば 1 枚を捨てる流れが仕様どおり（`synth.py:722-726`）。
- `exposure()` に `ROAD_FLOOR` を入れ、真っ黒な背景で強さが 0 にならない。
- `synth_render.py` はモデルごとに動作・材質・画像を `<id>/` で改名し、NLA の帯を毎回消し、骨を静止に戻す。事前の確かめで見つけた罠をコードに残している。
- Blender 側の `fail()` が stderr に書いて非 0 で止める。
