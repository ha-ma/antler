# セキュリティ・プライバシー監査: dataset-synth（2026-11-07）

対象: `dataset/synth.py`、`dataset/synth_render.py`、`dataset/synth.toml`、`dataset/README.md` の「合成（S データ…）」節、`dataset/pyproject.toml` の差分。仕様は `docs/specs/dataset-synth/functional.md`。
方法: コードの読み取り、`git check-ignore`、`strings`（.blend の文字列だけ。画像は開いていない）、deer3d の `manifest.json` の読み取り。コードは変更していない。実行もしていない（Blender の挙動は Blender のソースの記憶と公開仕様による推定で、実機で確かめていない点は「未確認」と書いた）。

脅威モデル: 単一ユーザーのローカル実行。`dataset/private/` と `dataset/external/` に書ける人はすでにユーザーの権限でコードを実行できるので、「それらのファイルが改ざんされる」前提の指摘は防御の深さの話で、悪用の難しさは高い。一方で、背景は個人の映像（`distribution: not_allowed`）なので、**意図しない持ち出し・混入**（Git、別の場所への書き出し、メタデータ）は重く見た。

## 結論

- Critical: 0
- High: 0
- Medium: 4（L-1 を Medium に上げた。下の「脅威モデル」）
- Low: 6
- Info: 5

**脅威モデルの補足（重要）**: `external/deer3d/` は書ける人の問題ではなく、**OpenGameArt から取ってきた第三者の作ったファイル**（`deer1.blend`・`doe.blend` は Blender v276 形式）で、そもそも信頼できない入力。SHA-256 は「同じファイルか」を保つだけで、「安全か」は保証しない。したがって「.blend の読み込みでコードが走らない」ことは `--disable-autoexec` が `read_factory_settings` のあとも効くかに全面的に依存する主要な防御で、`check_locations` や `.gitignore` はこの種類の危険に何も効かない。この観点で L-1 を Medium に上げた（M-4）。
Day-0 の確認（`docs/reports/2026-11-07-dataset-synth-blend-check.md` 9 行）は `blender -b --factory-startup --disable-autoexec` で 4 体を開いているので、**過去に自動実行が許された状態で開いたことは無い**。残る危険は「`synth_render.py` の `read_factory_settings` のあと」と「将来ダウンロードし直したファイル」。

仕様が求める点のうち、次は**確認できて問題なし**。

- Blender の呼び出しは引数の配列でシェルを通さない。`--factory-startup --disable-autoexec` が付いている。`--` のあとは固定の値（モード名、`work` 下の絶対パス）だけで、ユーザー入力がオプションとして解釈される余地はない（`synth.py:1118-1131`）。
- run 名は `fullmatch` の正規表現（英小文字・数字・`-`、先頭は英数字）で、`..`・`/`・先頭 `.` を通さない（`synth.py:853`）。出力のファイル名は run 名と連番だけから作る。
- モデルの `file` は `/`・`\`・先頭 `.` を拒む。`id` は M01〜M04 の固定集合（`synth.py:233-241`）。
- `.gitignore` は `dataset/private/`（52 行）と `dataset/external/`（50 行）を無視する。`git check-ignore` で `dataset/private/self-synth/x/a.jpg`、`self-footage/a.jpg`、`external/deer3d/a.blend` が無視されることを確認した。`git ls-files dataset/private dataset/external` は空。`<run>-review/`・`.tmp-<run>/`・`.tmp-check-*`・`check.png` もすべて `dataset/private/self-synth/` の下。
- 出力の JPEG は `jpeg_metadata` で SOS より前の許可外マーカー（APP1 の EXIF・XMP・ICC・COM）があれば止める（`synth.py:920-922`）。Blender の PNG（メタデータを持ちうる）は `work` にだけ置き、バッチごとに消す。最終の成果物に入らない。
- 背景の `image` は `self_footage.py:777` が `frames/<clip.id>/<clip.id>_f<6 桁のフレーム番号>.jpg` の相対で書く。`group` は `self:<drive>`（走行の日付 id）。壁時計の時刻・絶対パスは無い。synth の manifest はこの 2 つをそのまま写す（`synth.py:359,362`）ので、入る形は相対・フレーム番号付きで確認済み（ただし M-1 のとおり、書式の検証は `synth.py` 側に無い）。
- M01・M02 の `.glb` に外部参照の `"uri"` は無い（`strings` で 0 件。自己完結の GLB）。
- manifest（`synth.py:974-1004`）に絶対パスは入らない。モデルは `m.path.name`（ファイル名だけ）、`blender` は版の文字列だけ。絶対パスを含む `payload.json` は `tmp/render/` に置き、バッチごとに消す。
- `distribution`・`blur_reviewed` は背景の manifest からそのまま引き継ぐ（`synth.py:981-982`）。`license: "self"`、`allowed_use: ["train"]` は固定。モデルの CC0 は manifest の `license` が `CC0` で始まらないと止める（`synth.py:401`）。
- 背景の `split` が `train` でないのに `synth_background` なら止める（`synth.py:351`）。
- 出力の書き出しは一時フォルダ → 名前変更で、失敗時は `BaseException` で一時フォルダを消す。`mkdir` の `FileExistsError` を同時実行の鍵にしている。

## Critical（即時対応）

なし。

## High（早期対応）

なし。

## Medium（計画的対応）

### M-1. 背景の manifest の `image` を検証せずに `footage / image` で開く（`..`・絶対パス・途中のリンク）

- 場所: `dataset/synth.py:359`（`str(entry["image"])` を型変換だけで受ける）、`dataset/synth.py:831-839`（`_background`）
- 内容: `footage_dir / b.image` で、`b.image` が `..` を含む、または絶対パスだと、`self-footage/` の外のファイルを開く。`Path` の結合は絶対パスで左側を捨てる。検査は `path.is_symlink()`（最後の 1 要素だけ）・`is_file()`・SHA-256 の一致だけ。SHA-256 は同じ manifest の `sha256` との照合なので、manifest が書き換えられていれば（攻撃者が `sha256` も合わせて書くので）防御にならない。`images/train/` のような途中のディレクトリがシンボリックリンクでも通る。`_background` は読むたびに呼ばれる（先頭の全件測定と、job ごと）。
- 影響: 改ざんされた（または別の場所から持ってきた）背景の manifest で、任意の場所の画像を「自分の映像の背景」として取り込み、合成の出力（`dataset/private/self-synth/`）に混ぜる。出所の記録（`background.image`）は嘘になる。`cv2.imread` は任意の画像をデコードするので、デコーダの脆弱性の入口にもなる。読むのは画像だけで、内容が外に出るのは出力の JPEG 経由。
- 修正: `load_footage` で `image` を検証する。`PurePosixPath(image)` が相対で `..` と空の要素を含まず、`images/` で始まること。`_background` で `(footage_dir / image).resolve()` が `footage_dir.resolve()` の下にあること（`root in real.parents`。`self_footage.verify_source` と同じ流儀）。あわせて途中のディレクトリのリンクも見る（resolve の比較で足りる）。`entry["sha256"]` は 64 桁の 16 進かを見る。
- CWE-22（パストラバーサル）、CWE-59（リンク解決）

### M-2. SHA-256 の照合から実際に読むまでの時間差（TOCTOU）が長い

- 場所: `dataset/synth.py:388-420`（`load_models`）と `dataset/synth.py:906-910`（Blender をバッチごとに呼ぶ）、`dataset/synth.py:831-839`（`_background`）
- 内容:
  - モデル: `.blend` / `.glb` は run の最初に 1 回だけハッシュを取り、Blender は **50 job ごとに子プロセスでそのファイルをもう一度開く**（1,300 枚なら約 26 回、数十分〜数時間後）。照合した内容と Blender が開く内容が同じである保証はない。`.blend` は改ざんされるとデコーダ（古い v276 形式の読み込みを含む）と、`--disable-autoexec` の効き方への依存が一気に露出するので、ハッシュで守っているものの価値が高い。
  - 背景: `sha256_file(path)` のあとに `io.read_image(path)`（`cv2.imread(path)`）が別にファイルを開く。
- 影響: 照合後に差し替えられたファイルがそのまま使われる。ローカルの単一ユーザーでは悪用が難しい（書ける人はすでに実行できる）ので Medium にとどめた。
- 修正: 背景は 1 回 `read_bytes()` してハッシュを取り、同じバイト列を `cv2.imdecode` に渡す（`IO.read_image` を bytes を受ける形にする）。モデルは run の開始時に `.tmp-<run>/models/` へコピーし（コピーしながらハッシュを取る）、Blender にはそのコピーを渡す。または少なくともバッチの直前にもう一度ハッシュを取る。
- CWE-367

### M-3. `.blend` から取り込む画像・外部参照のうち、SHA-256 で守っているのは `.blend` 本体だけ

- 場所: `dataset/synth_render.py:58-65`（`dst.objects = list(src.objects)`・`dst.actions`・`dst.images` を全部取り込む）、`dataset/synth.py:403-411`（`model.file` だけを照合）
- 内容: M03・M04 の `.blend`（Blender v276 形式）には `//deer-body.png`・`//deer-head.png`・`//deer-antlers.png`・`//doe-body.png`・`//doe-head.png` など、**.blend と同じ場所を指す相対パスの外部画像**の参照がある（`strings` で確認。ほかに作者の環境の絶対パス `…/Dokumenty/project/Kelgar/Models/…` も残っている）。deer3d の manifest が SHA-256 を持つのは `deer1.blend`・`doe.blend` と、M04 では `fbx_extracted/` の下のファイルまで。`M03/` の下には `.blend` のほかにテクスチャのファイルは無く、`M04/` の直下にも無い（`fbx_extracted/doe-body.png` はある）ので、実際にはパックされた画像か、外れたまま（README の「4.5 ではテクスチャが外れる」）のどちらか。仕組みとして、**`.blend` の隣に画像を置くと、SHA-256 の照合を通ったまま見た目が変わる**（外部画像は照合の対象外）。
- 影響: 完全性の保証に穴がある。改ざんされた PNG が鹿の質感として合成画像に入る。PNG のデコーダにも未検証の入力が入る。`link=False` で全ての `src.images` を読むので、参照先が絶対パスなら `/Users/…` 配下の任意の画像も `bpy.data.images` に入る（描画に使われるのは `textures` で名前を指定した画像だけなので、出力に出る可能性は材質に張った場合のみ）。
- 修正: (a) 実際の画像がパックされているか、外部ファイルかを一度確かめ、結果を `docs/reports/2026-11-07-dataset-synth-blend-check.md` に書く。(b) 外部ファイルなら deer3d の manifest にそのファイルの SHA-256 を足し、`load_models` で `textures` が指す実ファイルも照合する。(c) 取り込む画像は `textures` に名前のあるものだけにする（`dst.images = [n for n in src.images if n in wanted]`）。物・動作も同様に、骨格・メッシュ・動作だけに絞ると取り込む面積が減る。
- CWE-345（データの真正性の検証が不十分）

### M-4（旧 L-1）. `--disable-autoexec` が `read_factory_settings` のあとも効いている保証が、テストで確かめられていない

（本文は下の L-1 の節にある。第三者の .blend が前提なので Medium。）

## Low

### L-1（M-4 と同じ指摘）. `--disable-autoexec` が `read_factory_settings` のあとも効いている保証が、テストで確かめられていない

- 場所: `dataset/synth_render.py:308-310`（`bpy.ops.wm.read_factory_settings(use_empty=True)`）
- 内容: Blender のソースの記憶では、`--disable-autoexec` は `G_FLAG_SCRIPT_OVERRIDE_PREF` を立てて設定の読み込みに上書きされない作りだが、**実機で確かめていない（未確認）**。また、`bpy.ops.wm.read_factory_settings` の呼び出しで起きる再初期化と、旧形式の `.blend`（v276。Python のドライバ・Text ブロックの Register を持ちうる）の組み合わせは、仕様にも報告書にもテストが無い。`libraries.load` は Text ブロックを要求しないので、取り込むのは物・動作・画像だけだが、物に付いた Python ドライバ（式がスクリプト型）の評価はこの設定に依存する。
- 修正: `check` モードの一部として、カナリアを使う。一時フォルダに、Text ブロック（Register）と Python ドライバで「ファイルを 1 つ書く」だけの小さい `.blend` を `synth.py` が作り（または手で 1 回作って SHA-256 を固定し）、`read_factory_settings` のあとに同じ手順で取り込み、**ファイルが書かれていない**ことを確かめる。1 回だけの手動確認でもよいが、結果を報告書に書く。
- CWE-94

### L-2. Blender の子プロセスに時間切れ・環境の絞り込み・`--python-exit-code` が無い

- 場所: `dataset/synth.py:1118-1131`
- 内容: (a) `timeout` が無く、Blender が固まると永久に待つ（CWE-400）。(b) 環境変数をそのまま渡す（`BLENDER_USER_SCRIPTS`・`BLENDER_USER_CONFIG` などが効く。`--factory-startup` は設定ファイルを読まないが、ユーザーのスクリプトフォルダの `startup/*.py` を読まないかは**未確認**）。(c) `--python-exit-code 1` が無く、Blender は `--python` の中の例外で終了コード 0 のまま終わりうる。今は `render.json`・`check.json` が書かれていなければ止める作りと、バッチごとの `work` の掃除で補っているので、見逃しにはならない。
- 修正: `subprocess.run(..., timeout=…, env={最小限})`（`PATH`・`HOME` は必要なら）、`cwd=workdir`、引数に `--python-exit-code 1` と `-noaudio` を足す。`--factory-startup` のあとに `--python-use-system-env` を**付けない**まま（付けない現状が安全）。
- CWE-400、CWE-526（環境変数の継承）

### L-3. Blender の標準エラーの末尾 5 行をそのままエラーに出す

- 場所: `dataset/synth.py:1133-1134`
- 内容: Blender のエラーはモデルの絶対パスやホームのパスを含みうる。表示は端末だけで、ファイルには書かない（manifest にも入らない）が、報告書やチャットに貼られると、仕様の「絶対パスを書かない」に反する。`check_locations` のエラー（`synth.py:787`）はユーザーが渡したパスをそのまま出す（ユーザー自身の入力なので問題は小さい）。
- 修正: 表示する前に `str(Path.home())` と作業の親のパスを `~`・`<checkout>` に置換する。または、末尾の行を `docs/reports/` に書かず端末だけに出す旨を README に書く。
- CWE-209

### L-4. `check_locations` は末尾 3 要素の一致だけで、`--out` が Git の無視の外に行く余地がある

- 場所: `dataset/synth.py:782-787`
- 内容: `absolute.parts[-3:] == ("dataset", "private", "self-synth")` と `resolve()` の一致だけを見る。`..` は `resolve() != absolute` で止まり、リンクも止まる。ただし、`/任意の場所/dataset/private/self-synth`（`.gitignore` が無い別の Git リポジトリ、同期されるフォルダなど）は通る。`self_footage.check_locations` と同じ設計で、前回（dataset-footage）の監査で受け入れた範囲。`--footage`・`--models` が別の checkout を指すこともできる。
- 修正（任意）: ルートを `git rev-parse --show-toplevel` と比べて `HERE.parent` と一致させる。または README の「`<checkout>` のパスを渡す」の記述どおり、`--out` の祖先に `.gitignore` が `dataset/private/` を無視していることを `git check-ignore` で確かめてから書く。worktree から main の checkout の `private` を使う運用（README の手順）を残すなら、後者が合う。
- CWE-668

### L-5. `uses` を `in` で見ている（文字列でも通る）、`license` の判定が前方一致

- 場所: `dataset/synth.py:349`（`"synth_background" not in uses`）、`dataset/synth.py:401`（`startswith("CC0")`）
- 内容: `uses` が配列でなく文字列なら部分文字列で一致する。`license` は `CC0-but-…` のような値も通る。どちらも manifest が信頼できる前提では実害は小さい。
- 修正: `isinstance(uses, list)` を確かめる。`license` は `{"CC0", "CC0 1.0"}` など許す値の集合との完全一致にする。
- CWE-20

### L-6. 上限の無い数値（`--count`・`--seed` の負の値・`tries`・`samples`・`size`・`BATCH` 内の job の増加）

- 場所: `dataset/synth.py:506-507`（`order` が `count` まで伸びる）、`SCHEMA` の `int+`、`main` の引数
- 内容: 巨大な `--count`・`size`・`samples` で時間とメモリを使い切れる（自分で自分を止めるだけ）。負の `--seed` は `default_rng` が `ValueError` を出し、`main` は `SynthError`・`FootageError`・`ImportError` しか受けないので、トレースバック（絶対パス入り）が出る。Blender が返した PNG の大きさが背景と違うときも、numpy の `ValueError` がトレースバックになる。
- 修正: `--count` の上限（例: 100000）、`seed >= 0`、`load_rendered` で `rgba.shape[:2]` を背景と比べて `SynthError` にする、`main` で想定外の `ValueError` も `SynthError` に包む。
- CWE-400、CWE-209

### L-7. 実行名の衝突（`s1` と `s1-review`）で別の run のフォルダに確認用の画像が混ざる

- 場所: `dataset/synth.py:853`（`RUN_RE`）、`dataset/synth.py:1010-1011`（`review.mkdir(exist_ok=True)`）
- 内容: run 名 `s1-review` を先に作ると、あとで run `s1` の確認用の画像（`<out>/s1-review/`）が、`s1-review` の run のフォルダ（`images/`・`manifest.json` を持つ）に書き込まれる。逆の順では `final.exists()` で止まる。データの混入であって、権限の問題ではない。
- 修正: 確認用のフォルダ名を run 名の書式で作れない形にする（例: `<run>.review`。`.` は `RUN_RE` に入らない）か、`RUN_RE` が `-review` で終わる名前を拒む。確認用のフォルダの `mkdir` は `exist_ok=False` にする。
- CWE-706

## Info

- **日付の露出（プライバシー）**: manifest に `video: synth:20261106_night-1`・`sources.*.background`・`group: self:<日付>`（仕様どおり）が入る。**日単位の撮影日**は残るが、時刻と位置は入らない（仕様の「書かないもの」に合う）。`dataset/private/` の中だけで、Git には入らない。`synth.toml`（Git に入る）にも同じクリップ id と、2026-09-07 の朝のフレームの記述がある。これは前回の `self_footage.toml`（すでに追跡対象）と同じ粒度で新しい露出ではない。将来 `train_sources.toml` や外部のレポートに `synth:*` の id を載せるときは、日付を落とした id に変える判断を残す。リポジトリは `https://github.com/ha-ma/antler`（公開かどうかは未確認）。
- **確認用の画像の扱い**: `<run>-review/` の JPEG は manifest の外で、`distribution: not_allowed` の記録を持たない。`dataset/private/` の中なので Git には入らないが、人に見せる・共有するときは、出力本体と同じ扱いにする旨を README に 1 行足すとよい。同じ画像を `jpeg_metadata` で検査していない（OpenCV が書くので実害は無い）。
- **JPEG の検査の範囲**: `JPEG_ALLOWED` は APP0（JFIF）を許す。APP0 には JFXX の埋め込みサムネイルがありうるが、OpenCV の出力には付かない。`jpeg_metadata` は SOS より前だけを見る（SOS のあとのスキャンデータは検査の対象外で妥当）。
- **ライセンス**: 4 体とも deer3d の manifest で `CC0`（M01・M02 は `CC0 1.0`、M03・M04 は `CC0`）、OpenGameArt のページ・ライセンス本文を `evidence/` に持つ。`license: "self"` と `allowed_use: ["train"]` と `distribution`・`blur_reviewed` の引き継ぎは正しい（背景が最も厳しい側）。注意点が 1 つ: `doe.blend` の文字列に `Rothirsch_Kahlwild_Auge_070816_1.jpg`・`s_LC0266.jpg`・`deer-male.png` などの**写真らしいファイル名**が残っている。CC0 の表明は OpenGameArt の作者のものなので、配布前にこれらが使われているか（材質に張られているか）を確かめ、使われていれば出どころを `CREDITS.md` に書く。今は学習専用（`allowed_use: ["train"]`）で配らないので、緊急ではない。
- **テストが無い**: `dataset/tests/` に `synth` のテストが無いのに、`pyproject.toml` の `--cov=synth` と `--cov-fail-under=70` が足されている。CI で下限を割る可能性がある（仕様の AC-1 以降は未実装）。セキュリティの指摘（M-1、M-2、L-6、L-7）に対する回帰テストは、テストを書くときに入れる。
- **`.tmp-<run>/` の残り**: 強制終了（SIGKILL）の場合、`render/payload.json`（モデルの絶対パス）と途中の画像が `dataset/private/self-synth/.tmp-<run>/` に残る。Git の対象外で、手で消す運用（仕様どおり）。

## 優先順位

1. M-1（`image` の検証。数行で直る）
2. M-3 と M-2（完全性の穴。M-3 は先に実際の画像の所在を確かめる）
3. L-1（カナリアでの確認。1 回の手動確認でも可）、L-2
4. L-7、L-6、L-4、L-3、L-5

総合リスクレベル: **Medium**（Critical・High は無い。外部への持ち出しの経路と Git への混入は見つからなかった。Medium は 4 件で、うち 2 件（M-3、M-4）は第三者の .blend を信頼しない前提に由来し、M-4 は一度も実機で確かめていない主要な防御）。

推奨アクション: M-1 を直し、M-4 のカナリアを 1 回実行して結果を報告書に残す。そのあと M-3、M-2 の順。
