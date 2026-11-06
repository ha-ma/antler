# code-reviewer: dataset-train（`feat/dataset-train`、`git diff main...HEAD`）

対象: `dataset/train_l0.py`（1104 行）・`dataset/tests/test_train_l0.py`（822 行）・`dataset/train_sources.toml`・`dataset/pyproject.toml`・`dataset/README.md`・`CREDITS.md`。
仕様: `docs/specs/dataset-train/functional.md`（R1〜R8・Test List）、敵対レビュー: `docs/reports/2026-11-06-spec-adversary-dataset-train.md`。

確かめたこと: `cd dataset && ../.venv/bin/python -m pytest -q -p no:cacheprovider` は 71 passed、カバレッジ 94%（`train_l0.py` は 91%）。`ruff check`（dataset/ で実行）は通過。ultralytics 8.4.202 の該当箇所（`cfg/__init__.py` の `get_save_dir`、`utils/files.py` の `increment_path`、`data/dataset.py` の cache、`engine/exporter.py` の nms）を読んだ。`dataset/out/` は `ls` で見ただけで触っていない。

## レビュー結果

### Critical（修正必須）

なし（Critical 0）。

評価専用・同意なし・確かめていない素材が学習側に入る経路を、次の観点で順にたどったが、入る経路は見つからなかった。

- 一覧の `license` / `use`: `CC-BY-SA` かつ `use = "train"` は `load_sources` が止める。manifest の動画ごとのライセンスと一覧の値は `collect_yolo` で厳しい側に揃える。分類できない値（`CC BY-NC` など）はエラーになる。
- YOLO の分割: `use = "eval"` は全件 `eval`。`use = "train"` でも `train` / `val` 以外の分割名（`test`・分割フォルダ無し・`Train` の大文字小文字違い）は `eval` に倒れる。安全側に倒れている。
- Capture: `consent is not True`、`vehicle`、`reviewed` に無い id、`by = "model"` だけの箱は、すべて `_capture_reason` と `collect_captures` で落ちる。`capture.image` は使わず、名前の決まりと SHA で画像を決める。
- 漏れの検査: `check_leaks` が train / val / 評価側のグループの重なりと SHA の重なりを見る。Capture の `_unique` は、重複のうち後に読んだほうを捨てる。どちらが先でも、学習と評価の両側に残ればエラーになる。
- パス: `raw/`・`out/`・`dataset/` の外・絶対パス・シンボリックリンクは `_source_path` と `_no_links` が止める。同じ実体は `(st_dev, st_ino)` で見るので、大文字小文字の別名にも効く。
- 上書き: `os.mkdir`（run）、`open("xb")`（`.pt`）、`open("x")`（`.json`・評価の JSON）が排他。`.mlpackage` は書き出し前後の 2 回確かめる。
- manifest: `roadSegment`・緯度経度・絶対パスは入らない（`capture` は `id`・`source`・`date` だけ、`origin` は `dataset/` からの相対）。絶対パスは `dataset.yaml` だけ（仕様どおり）。

### Warning（推奨）

1. **[train_l0.py:668-681 `verify_run`] 同じ run で 2 回目の `train` が必ず止まる（Ultralytics の `.cache`）。**
   - 証拠: Ultralytics は `labels/train.cache`・`labels/val.cache` を書く（`ultralytics/data/dataset.py:306` の `Path(label_files[0]).parent.with_suffix(".cache")`）。`verify_run` は `labels/` 以下の全ファイルを `rglob` して manifest と突き合わせる。実際に `dataset/out/train/<run>/labels/` に `train.cache`・`val.cache` ができているのを `ls` で確かめた。
   - 影響: 同じ build に別の seed・別の名前で学習し直すと、「build の出力が manifest と違う（labels/train.cache）」で止まる。意図した検査（足し忘れ・差し替え）と区別が付かない。
   - 修正案:
     ```python
     have = {... for p in (run_dir / d).rglob("*") if p.is_file() and p.suffix != ".cache"}
     ```
     `.cache` はラベルの写しではなく Ultralytics の索引なので、除外して差し支えない。ただし画像の拡張子の許可（`.jpg` だけ）は別に確かめる。

2. **[train_l0.py:799 `_ultralytics_train`] `last.pt` の場所を推測している。**
   - 証拠: `args["exist_ok"] = False` なので、`<project>/train` が既にあると Ultralytics は `train-2` に書く（`get_save_dir` → `increment_path(exist_ok=False)`、sep は `-`）。コードは常に `<project>/train/weights/last.pt` を読む。
   - 影響: 1. が直ると、2 回目以降の学習で、1 回目（途中で落ちたものを含む）の `last.pt` を新しい名前で model card 付きの重みとして置く。seed・epochs の記録と中身が食い違う。
   - 修正案: `model = YOLO(...); model.train(**args)` のあと `last = Path(model.trainer.last)`（`trainer.save_dir / "weights" / "last.pt"`）を返す。`last.pt` が無ければ `TrainError`。
   - 補足: 実行前に `<project>/train` があればエラーにする手もある。

3. **[train_l0.py:1102-1104] Ctrl-C で終了コード 0 になる。**
   - `with contextlib.suppress(KeyboardInterrupt): sys.exit(main())` は、中断を握り潰して正常終了する。長い `train` を止めたのに、シェルからは成功に見える。`build` も `except BaseException` で run を消したあと再送出するが、ここで握り潰される。
   - 修正案: `try: sys.exit(main())  except KeyboardInterrupt: sys.exit(130)`。

4. **[train_l0.py:1057-1098 `main`、920-976 `evaluate`、819-837 `export`] `TrainError` / `VerifyError` 以外の例外がそのまま落ちる。**
   - `evaluate` は `manifest.json` が無い・壊れている場合に `FileNotFoundError` / `KeyError`、`.mlpackage` に deer が無い場合に `ConfigError`（`parse_names`）で、トレースバック付きの exit 1 になる。`VerifyError`（exit 1）と区別が付かない。
   - `_make_detector` の `.mlpackage` 側は `names=("deer",)` 固定なので、R8 の「`deer` の無いモデル → エラー」は `.pt` でしか効かない。`.mlpackage` は `load_coreml_detector` の `ConfigError` に頼っている。
   - `export` に存在しない `--weights` を渡すと `shutil.copyfile` が `FileNotFoundError` になる。
   - 修正案: `main` で `OSError`・`KeyError`・`ConfigError` を `TrainError` に包む。`evaluate` と `export` の入口で `model.exists()` / `weights.is_file()` を確かめる。

5. **[train_l0.py:242 `_source_path`] `reviewed` のファイルを調べるときに、そのフォルダ全体を歩く。**
   - `_no_links(given.parent, root, label)` は `os.walk(start)` で下のすべてを見る。`reviewed = "reviewed.txt"` のように `dataset/` 直下に置くと、`out/`（学習の写し）・`raw/`・`external/` まで歩き、1 つでもシンボリックリンクがあれば関係の無いエラーで止まる。大きなフォルダでは遅い。
   - 修正案: ファイルには「祖先の各段に symlink が無い」と「ファイル自身が symlink でない」だけを確かめる（下を歩くのはフォルダ素材だけ）。

6. **[train_l0.py:658 `verify_run`] `dataset.yaml` は `path:` の行しか確かめていない。**
   - `train:` / `val:` の行や追加のキー（`test:`、Ultralytics が解釈する `download:` など）は検査されない。build のあとで `train: ../../raw/...` に書き換えられても `train` は通る。
   - 修正案: build と同じ関数で期待する全文を作り、`yaml == expected` で比べる。

7. **[train_l0.py:921-946 `evaluate`] 評価側の画像が manifest と同じか確かめない。**
   - `entry["origin"]`（build 後に変わりうる元の場所）を読み、manifest の SHA-256 と突き合わせない。val は検証済みの写し（`run_dir/images/val/`）が手元にあるのに元の場所を読む。素材を差し替えると、報告書の数字が黙ってずれる。
   - `train` / `evaluate` の `--run` は `NAME` で確かめていない（`--run ../../x` が通る）。`build` と揃える。
   - 修正案: 読んだ画像の SHA-256 を `entry["sha256"]` と比べ、違えば `TrainError`。val は写しを読む。

8. **[train_l0.py:481、test_train_l0.py:475-510] 仕様の CAP-1e「画像がシンボリックリンク → `bad_path`」と実装・テストが食い違う。**
   - 実際は `_no_links` が素材の読み込みの時点で `TrainError` にする（テストも `match="リンク"` を期待している）。build 全体が止まるので安全側ではあるが、仕様の文言どおりではない。
   - `_capture_reason` の `image.resolve().parent != src.path` は、同じフォルダの中を指すシンボリックリンクを通す（`collect_captures` を直接呼べば素通り）。実際には到達できないコードで、仕様の防御が効いていると誤読させる。
   - 修正案: 仕様を「素材の中にシンボリックリンクがあれば build 全体がエラー」に合わせて直すか、`_capture_reason` に `image.is_symlink()` を足して `bad_path` にする。どちらかに揃える。

9. **テストが Test List の項目を確かめきれていない所。**
   - EV-1a: 「同じ確信度なら出てきた順」「IoU が同じなら先の正解」を確かめるはずの 2 件（`same` と `gts` の対）は、どちらの当て方でも (TP, FN, FP) の数が変わらない。tie-break を逆にしても通る。当て先を返す関数に分けて検証するか、順序で TP の数が変わる入力にする。
   - SRC-1c: 「別の素材と同じ実体」は、`external/C` が存在するとき（APFS の大文字小文字を区別しない FS）だけ検査され、Linux では何も確かめず通る（`if ... exists()`）。同じ `path` を 2 つの素材に書く入力なら、どの FS でも同じ inode になる。
   - EXP-1b: 「確かめで例外 → exit 1」は `VerifyError` が出るところまでで、`main` が 1 を返すところは確かめていない。`main` の `train` / `export` / `evaluate` の枝（1064-1098 行）はカバレッジ未達で、`VerifyError` → 1 の枝も同じ。
   - TR-1a: `exist_ok` と `name` が学習器に渡ることは確かめていない（上の 2. の不具合を拾えなかった理由の一つ）。`FakeTrainer` が `train` 固定のパスに書くので、再実行の挙動は検査できない。
   - TR-1c: BY-SA の元の重みのとき、model card に「元の重みに CC BY-SA の学習を含む」と書く（R6）のうち、`by_sa` の真偽だけを見ている。文言は `origin` の中に含まれるだけ。

10. **[train_l0.py:749-780 `train`] 学習のあとの書き込みが途中で落ちると、半端なファイルが残る。**
    - `.pt` のコピー中・`.json` の書き込み中に失敗すると、`.pt` だけが残り、次の `train` は「`.pt` は既にある」で止まる。手で消すしかない。
    - 修正案: `.pt` を一時名に書いてから `os.link` / `os.rename`（排他）で確定する。`.json` が失敗したら `.pt` も消す。

### Info（参考）

- [train_l0.py:642] `dataset.yaml` の `path:` を引用符なしで書いている。`#` や `: ` を含むフォルダ名（`~/Documents/my #proj/...`）では YAML が壊れる。`json.dumps(str(run_dir))` で引用すると安全（`verify_run` の比較も同じ関数で作る）。
- [train_l0.py:236] 素材どうしの入れ子（`private/caps` と `private/caps/edge` のように、片方がもう片方の下）は検査していない。AC-1 のテストはこれを前提にしている。YOLO は manifest 照合があるので実害は小さいが、意図して許すなら仕様に書く。
- [train_l0.py:812] `export` の `min_conf` は `TrackerConfig()` の既定値で、利用者の設定ファイルの `[tracker] min_conf` は読まない。仕様は既定 0.4 と書いているので食い違いではないが、設定を変えた場合は効かない。
- [train_l0.py:1037] `--val-ratio` に範囲の確認が無い（負・1 以上でも通る。`val_groups` が `n-1` で丸めるので壊れはしない）。
- [train_l0.py:255] `license_class` の `^CC0\b` は `CC0-NC` のような文字列も `CC0` と分類する。manifest の書き方が決まっているなら問題ないが、`^CC0(?:[ -][0-9.]+)?\b` のように閉じておくと安全。
- [train_l0.py:297] `entries = {e["image"]: e ...}` は manifest の `image` の重複を黙って 1 つにする。画像の実体と 1 対 1 に照合するなら、重複はエラーにするのがよい。
- [CREDITS.md] ライブラリ表の再整形（列幅）で差分が大きく見える。内容の変更は Ultralytics の行へ `yolo26n.pt` を足した 1 行だけ。
- [train_l0.py:790-846] ultralytics 8.4.202 の API の使い方に、明らかな誤りは見つからなかった。`YOLO_OFFLINE` は import 前に設定している（`utils/__init__.py:1128` で import 時に読まれる）。`SETTINGS.update({"sync": False})` と、`export(format="coreml", nms=True, imgsz, conf, iou)` の引数名（`exporter.py:198` の対応引数、nms のとき `end2end` を切る処理 731-735 行）も合っている。`predict(..., rect=False)` も既定のキー。`result.boxes.xywhn` は引き伸ばした 640×640 の画像に対する正規化なので、評価の正解（正規化）とそのまま比べられる。`_read_image` は BGR のままで、`CoreMLDetector` 側が BGR → RGB を行うので整合する。

### 良い点

- 評価専用・同意なしの素材を、人の注意ではなく名前と SHA とパスの照合で止める設計になっている。偽の素材を使ったテスト（AC-1、CAP-1b、CAP-1e）も、実際の拒否理由まで確かめている。
- 薄い差し替え関数（`trainer` / `exporter` / `verify` / `factory` / `reader`）に実物を閉じ込め、`# pragma: no cover` は 5 つの関数に限っている。day0 でしか動かない部分が小さい。
- 決定性（ハッシュ順の分割、`created` 以外の manifest 一致）をテストで確かめている（OUT-1b）。
- 例外の分け方（`TrainError` = 2、`VerifyError` = 1）は仕様どおり。上の 4. と 3. を直せば、終了コードが信頼できる。

## 仕様 R1〜R8 との対応（要約）

| 項目              | 実装                                       | テスト     | 所見                                                                     |
| ----------------- | ------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| R1 一覧・パス     | 一致                                       | SRC-1a〜c  | 別名の検査が FS 依存（9.）。入れ子は未検査（Info）                       |
| R2 YOLO           | 一致                                       | YOLO-1a〜c | 問題なし                                                                 |
| R3 Capture        | 一致（CAP-1e の symlink のみ 8.）          | CAP-1a〜e  | 問題なし                                                                 |
| R4 漏れ           | 一致                                       | OUT-1a     | 問題なし                                                                 |
| R5 出力・manifest | 一致                                       | OUT-1b・c  | `dataset.yaml` の引用符（Info）                                          |
| R6 学習           | `.cache`（1.）と `last.pt`（2.）を除き一致 | TR-1a〜c   | 1.・2. は本物の Ultralytics でだけ起きる（テストの偽の学習器では出ない） |
| R7 書き出し       | 一致                                       | EXP-1a・b  | `main` の exit 1 が未検証（9.）                                          |
| R8 評価           | 一致（SHA の確認が無い、7.）               | EV-1a・b   | tie-break の検証が弱い（9.）                                             |
