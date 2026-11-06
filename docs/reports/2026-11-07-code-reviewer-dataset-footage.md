# code-reviewer: dataset-footage（コミット 3c6b549）

対象: `dataset/self_footage.py`・`dataset/tests/test_self_footage.py`・`dataset/self_footage.toml`・`dataset/pyproject.toml`。
仕様: `docs/specs/dataset-footage/functional.md`。

確かめ方の限界: このレビューでは Bash を使えないため、pytest・ruff は回していない。コードと仕様の読み合わせだけで書いた。
`dataset/raw/`・`dataset/private/` は開いていない。numpy は `edge/detector` の依存に入っているので、「新しい依存を足さない」は守られている（`edge/detector/pyproject.toml` 12 行）。

## レビュー結果

### Critical（修正必須）

なし。

匿名化の前のフレームがディスクに出る経路は見つからなかった。

- 検出器に渡すのは塗りつぶし後の画像（`anonymize`、447〜449 行）。
- 書き込みは一時フォルダの中だけ。例外は `BaseException` で受けて消してから再送出する（857〜859 行）。
- manifest のキーは仕様の許可リストの範囲に収まっている。

### Warning（推奨）

**W-1 [self_footage.py:860-878] フレームの差し替えと manifest の書き込みが別々で、その間に失敗すると食い違う（特に `--redo`）**

- 稀な落ち方だけの話ではない。`_write_json`（878 行）は 854〜859 行の `try` の外にあるので、ディスクフルなどの `OSError` という普通の失敗でも、フレームは差し替え済み・manifest は古いまま、になる。
- Critical にしない理由: まだ実データを入れる前で、食い違いが黙って残るのは `--redo` を一覧の設定の変更なしで回したときだけ。新規のクリップは次の実行がエラーにする。
- 順序は `rmtree(final)`、`tmp.rename(final)`、manifest の更新と `_write_json` の順。
- 新規のクリップなら、間で落ちても次の実行が「manifest に無いフレームのフォルダ」でエラーにするので気づける（仕様 W4(b)）。
- `--redo` で、一覧の設定が変わっていない場合（検出器だけ入れ直した、など）は気づけない。
  - 新しい JPEG が置かれたのに manifest は古い `files[].sha256` のまま残る。
  - 次の実行では `fixed` と `redo` が一致するので「済み」で飛ばされ、黙って食い違ったまま学習に入る。
- 改善案（どちらか）:
  - 古い `final` を `.old-<id>` に改名し、新しい `final` を置き、manifest を書いてから `.old` を消す。落ちたら次の開始時に `.old` があれば戻す。
  - 簡単に済ませるなら、済みのクリップの `files[]` の先頭と末尾の数枚の SHA-256 を毎回照合する。
- 少なくとも、`rmtree` をやめて改名にするだけでも、manifest 書き込み失敗時に元に戻せる。

**W-2 [self_footage.py:849-853] 残った一時フォルダを消すのは「今回処理するクリップ」の分だけ**

- 仕様 R5 は「前の実行が残した一時フォルダは、始める前に消す」。
- 一覧から外したクリップや「済み」で飛ばすクリップの `frames/.tmp-<id>/` は、匿名化済みとはいえ永久に残る。
- テスト（`test_add_6a_orphan_frames_folder`、862〜870 行）は、たまたま処理対象になるクリップの `.tmp-` を置いているので、この漏れを見逃す。
- 改善案: `_ingest` の先頭で `for stale in (out / "frames").glob(".tmp-*"): shutil.rmtree(stale)` を 1 回やる。テストは処理対象でないクリップ名の `.tmp-` でも確かめる。

**W-3 [self_footage.py:566-590] `redo_part` が、出力を変える定数を含んでいない**

- 入っていないもの: `BLUR_GROW`・`BLOCK_MIN`・JPEG 品質（95、`_encode_jpeg`）・`OVERLAY_*` の閾値・`JPEG_ALLOWED`。
- これらを直しても既存のクリップは「済み」のままで、古いモザイクの強さのフレームが残る。匿名化の強さを変えたのに気づけないのは、この feature の目的と逆。
- 改善案: `"anonymize": {"grow": BLUR_GROW, "block_min": BLOCK_MIN, "jpeg_quality": JPEG_QUALITY}` と `"overlay": {...閾値}` を足す。品質は `_encode_jpeg` の直書きを定数に出す。
- 足すと既存の manifest は全部「作り方が違う」になるが、まだ実データの 1 回目の前なので今が安い。

**W-4 [self_footage.py:1001-1009] 検出器の重みの読み込みが `ingest` の検証より前に走る。CLI の失敗の出方も粗い**

- `_CocoDetector(args.weights)` は `ingest(...)` の引数として評価される。そのため `check_locations`・鍵の取得・`--redo` の検証より前に、SHA-256 の計算と YOLO の読み込み（秒単位）が走る。
- `--out` の指定ミスのような安く直せる誤りでも、先に重い読み込みを待たされる。
- opencv・ultralytics が入っていない環境の `ImportError` は `FootageError` ではないので、スタックトレースで落ちる（exit 1）。仕様は誤りを exit 2 で返す設計。
- `OSError`（ディスクフルなど）も同じ。
- 改善案: 検出器と動画の生成を `Callable` にして `ingest` へ渡し、`_ingest` の中で検証の後に作る。`main` に ImportError の捕捉を足す（「`pip install -e "edge/detector[day0]"` が要る」と出す）。
- 副産物としてテスト容易性も上がる。今の `main` は `ingest` を `pragma: no cover` で外しているので、`--redo` の引数の渡し方や、`ingest` の誤りが exit 2 になる経路が一切テストされない。

**W-5 [self_footage.py:471-473, 500-501] 焼き込みの確かめの「明るい縁」が、塗りつぶした矩形の縁自体を縁として数える**

- 勾配は `np.diff(..., prepend=...)` で `g[x] - g[x-1]`（右・下方向の差）。
- 矩形の右隣・下隣の画素は、背景が明るい（> 180）と、黒との差が大きいので必ず「明るい縁」になる。矩形に接する帯（near）で偽陽性になる。
- 今の `dashcam-a` は矩形が右端・下端まで（1540+380 = 1920、960+120 = 1080）なので、右隣・下隣がなく顕在化しない。
- 2 台目のカメラで矩形が画面の端に接しない場合、昼に空・雪・白線が矩形の右・下に来るだけで、`near_after` がエラーになる。
- 改善案: 矩形の外側 1 画素を勾配の計算から除く（`band` から矩形に接する 1 画素を引く）か、勾配を塗りつぶす前のフレームで取る。
- 今のうちに `toml` のコメントへ「矩形は画面の右端・下端に接する前提」と書いておくだけでもよい。

**W-6 [self_footage.py:757-760 と day0 の `_CvVideo`] `CAP_PROP_FRAME_COUNT` は推定値で、実際より多いと実データの 1 回目が止まる**

- 仕様どおり、読めなければエラー（I3）。
- `missing` は書き出すフレーム（`picked`）だけを見る。`count` が実際の本数を超えているとき、落ちるのは「末尾の区間で間隔おきに選ばれたフレームの番号が、実際の本数以上になったとき」だけ。
- つまり 1〜2 フレームのずれなら通るクリップが多く、クリップによって（フレーム数と間隔の組み合わせ次第で）たまに落ちる、再現しにくい失敗になる。
- ドラレコの mp4 では推定が 1〜2 フレームずれることは珍しくない。落ちたときの復旧手段が一覧にも CLI にもない。
- 改善案（どちらか）:
  - `_CvVideo.__post_init__` で、末尾付近（`count - 1` から後ろ）だけ `CAP_PROP_POS_FRAMES` で確かめ、実際の本数に切り詰める。
  - `process_clip` で、読めなかったフレームが全部「最後の鹿なしの区間の末尾 N 枚以内」なら、その分だけ落として警告にし、manifest の `frame_count` に実際の数を書く。
- 実データ（約 3 分・27.5 fps）で 1 回回して様子を見てから決めてもよい。ただし、決めるまで `missing` のメッセージに「`frame_count` の推定がずれている可能性」を足しておくと原因がすぐ分かる。

**W-7 [self_footage.py:322 とテスト 462〜469 行] 「raw の外」の検査は到達不能で、テストは名前と中身が食い違う**

- `folder`・`path` が `is_symlink()` でない以上、`real = path.resolve()` が `root` の外へ出る経路は、`raw` 自身を経由するものしかない。その場合は `root = raw.resolve()` も同じ場所を指すので外れない。`file` の `..` と `/` は設定で止まっている（222 行）。
- `test_src_2a_outside_raw_through_parent_link` は、名前は「raw の外」だが、中身は「`raw` がシンボリックリンクでも通る」ことを確かめているだけ。エラー側は 322 行に届かない。Test List の SRC-2a「`<raw>` の外 → エラー」は未確認のまま。
- 改善案: 到達できる場合を考える（`folder` の祖先に当たる `raw/<clip.id>` が実フォルダで、`file` が実ファイルでも、ハードリンクは対象外）。無ければ 321〜322 行を消して「`file` と `id` を設定で縛っているので不要」とコメントに書く。防御として残すなら、`monkeypatch` で `Path.resolve` を差し替えて 1 回は通すテストにする。

**W-8 [self_footage.py:345-346, 361-362] 秒からフレームへの切り上げが、整数の fps でしかテストされていない**

- `_frame_at` は `ceil(t * fps - 1e-9)`。テストの `FPS = 5.0` では `t * fps` が常に整数に近く、「切り上げ」と `1e-9` の補正の両方が確かめられていない（`start = 6.1` → 31 のような例がない）。
- 実機は 27.5 fps。仕様 SEG-3a は「27.5 fps で 6 フレーム・28 フレームおき」と書くが、テストは `every` の値だけで、`segments` と `select_frames` を 27.5 fps で回していない。
- 改善案: `segments([DeerSpan(38.0, None)], 27.5, 4950, 5.0)` が `(0, 908, F), (1045, 4950, T)`（除外の開始は (38 - 5) x 27.5 = 907.5 の切り上げで 908）になる、`DeerSpan(161.0)` の開始が 4428、小数の開始 `6.1`（5 fps）が 31、をテストに足す。期待値は実装者が手で計算し直して確かめる。toml の実データの `start = 38.0` / `161.0` を使うと、その実データでの境界の確かめにもなる。

**W-9 [self_footage.py:607-616, 619-628, 638] manifest の形が壊れていると `KeyError`**

- `load_manifest` は JSON と version を確かめるだけ。`{"version": 1}` のように `clips`・`drives`・`files`・`sources` が欠けていると、`check_splits` や `plan` で素の `KeyError`（スタックトレース）になり、exit 2 の `FootageError` にならない。
- 手で編集した manifest（公開前にぼかしの確認済みを書き換える運用が想定される）では起こりうる。
- 改善案: `load_manifest` で `for key in ("drives", "clips", "sources", "files")` が `dict`・`list` の型か確かめる。壊れた manifest のテスト（`test_add_6b_broken_manifest`）に `{"version": 1}` を足す。

**W-10 [テスト] Test List に対して確かめが薄い項目**

- AC-1「人と車の箱がモザイク」: 書き出した JPEG（偽）の画素ではなく、`blur_boxes` のメタデータしか見ていない。モザイクの画素は ANON-4b の単体だけ。AC-1 でも、1 枚の `blur_boxes` の範囲が元の画素と変わっていることを 1 回確かめる。
- 非機能要件「決定性」: テストがない。AC-1 の 2 回目の実行は「済み」で飛ばすだけで、決定性ではない。別の `out` に 2 回回して `manifest.json` が（作成日時を除いて）同じになることを確かめる。
- ADD-6a: 孤立したフレームのフォルダ + `--redo` で作り直せる経路（652 行 `clip.id not in redo` の分岐、`old is None` かつ `redo` あり）がテストされていない。エラー側だけ。
- UC-2「違えばエラーで、元のファイルは変わらない」: 変わらないことは成功の経路（AC-1）でしか確かめていない。SHA-256 が違う経路で、中身と mtime が変わらないことも確かめると仕様どおり。
- `test_add_6a_redo_cannot_move_clip_to_another_drive` の中ほど（810〜818 行）は、走行を `2026-11-07` に移すと日付の検証（`load_config`）で落ちるので、`plan` の `fixed` の検査には届かない。意図は 3 つ目（`2026-11-06-b`、819〜826 行）が果たしているので、中ほどは設定の検証のテストとして名前を分けるか消す。
- `_number` が `nan` / `inf` を拒否する（TOML は `inf`・`nan` を受ける）分岐（152 行）のテストがない。

### Info（参考）

- **[self_footage.py:40-44]** `$` は末尾の改行にも一致する。TOML の基本文字列は `"\n"` を書けるので、`id`・`sha256`・`camera` の末尾に改行が入っても書式の検査を通る（`sha256` は後の照合で落ちる。`id` はフォルダ名に改行が入る）。`re.fullmatch` か `\Z` にするのが安全。
- **[self_footage.py:180, 273, 283]** 「型が違うときは `[0]` を渡して `int ではない` と言わせる」書き方が 3 か所ある。動くが、読む人には意図が見えない（メッセージも `overlay_masks[0]` と出る）。`_list(value, label)` を 1 つ作って「配列ではない」と言うほうが DRY で、メッセージも正確。
- **[self_footage.py:496-497]** 製品コードの `assert`（`# noqa: S101`）は `python -O` で消える。`if self.counts is None: raise` にしたほうが素直。`near` が `persistent()` を「呼ぶだけ」で副作用の検査にしているのも、`self.frames` の確かめを別メソッド（`_require_frames`）に出すと読みやすい。
- **[self_footage.py:1026]** 「2026-11-07 の分で 1 本以上を test にする」の日付が表示に直書き。11-07 を過ぎても出る文言。文言を「次の撮影分」にするか、仕様の期限として残すなら意図をコメントにする。
- **[self_footage.py:960-964]** `settings.update({"sync": False})` は Ultralytics のユーザー設定ファイルへ書く、実行環境をまたぐ副作用。`YOLO_OFFLINE` が使っている ultralytics の版で効くかは未確認（day0 の実機で、ネットワークを切って 1 回回して確かめるのが確実）。
- **[self_footage.py:969-970]** `wanted`（クラス番号）はフレームごとに作り直している。`__post_init__` で 1 回だけ作る。
- **[self_footage.py:507-524]** `jpeg_metadata` は JPEG 規格が許すフィルバイト（`0xFF 0xFF`）を不許可のマーカーとして数える。opencv は出さないので実害はないが、別のエンコーダに差し替えたときに引っかかる。
- **[self_footage.py:944]** `bytes(buf)` は動くが、`buf.tobytes()` のほうが意図が明確。`cv2.imencode` の JFIF（APP0）以外のマーカーは、書き込む前に `jpeg_metadata` が通るので実機の JPEG でも確かめられる。クロマサブサンプリングは既定の 4:2:0。
- **[self_footage.py:807 `check_locations`]** `dataset/raw/` と `dataset/private/` を「パスのどこかに連続して出る」で判定するため、`/tmp/dataset/private/x` も通る。リポジトリの `dataset/` かどうかは見ていない。テストが `tmp_path/dataset/...` を使うので、この形にしたのは理解できる。実際の防御は `.gitignore` と CLI の既定値に頼っている。
- **[self_footage.py:996 の既定値]** `--out` の既定が `HERE / "private/self-footage"` なので、worktree の中で引数なしで回すと worktree の掃除で消える場所に書く（仕様は絶対パスで渡す想定）。引数を必須にするか、README の注意のままにする。
- **[ゼロ枚]** 全フレームが除外される入力はありえないが、`frames` が 0 でも `done` になる。`files` が空のクリップを許すか、エラーにするかは決めておくとよい（`process_clip` の末尾）。
- **[トレーサビリティ]** 仕様の Test List・受け入れ基準のチェックボックスは全部 `[ ]` のまま。完了の条件（`sfad-done`）の前に付ける。
- **[self_footage.toml]** `deer = [{ start = 38.0 }]` と `161.0` は終わりを映像の終わりにしているので、`deer: true`・`uses: ["label"]` のフレームが多数（0.2 秒おきで数百枚）になる。仕様の決定どおり。ラベル付けの前に終わりを入れ直す想定なら、変えたときは `--redo` が要る点を README に書いてある（69 行）ので問題ない。
- **[dataset/pyproject.toml]** `--cov=self_footage` と `known-first-party` への追加は、既存の 2 本（`export_l1_labels`・`train_l0`）と同じ書き方で整合している。

## 良い点

- **失敗時の後片付けが一貫している**: 一時フォルダ → 検査 → 改名 → manifest、と並べ、クリップ単位で commit する。`BaseException` を握らずに再送出している。鍵は `mkdir` の原子性を使い、自分が取った鍵だけを消す（`lock.mkdir()` が失敗した場合は `try` の外なので、他の実行の鍵を消さない。テストあり）。
- **`fixed` と `redo` の分離**: 分割に関わる変更は `--redo` でも通さない、という C2 の設計が `plan` の 1 か所に集まっていて、読みやすく、テストも 3 つ目のケースで確かめている。
- **`jpeg_metadata` は許可リスト方式**で、壊れた JPEG（SOS がない、マーカーの途中で切れる）も止める。
- **`every` の丸め**を `floor(x + 0.5)` にして、Python の `round` の偶数丸めを避けたことが、テスト（`every(0.5, 5.0) == 3`）つきで確かめられている。
- **`segments` は NumPy の真偽配列で 1 回走査**する作りで、余白・隣接する区間・先頭の 0 切りを個別の分岐で書かずに済んでいる。`test_seg_3a_boundaries` が I2 の 3 つを押さえている。
- **日付・時刻を残さない検査**（`TIME_LIKE`）と、`area` を列挙だけにする設計が、位置の漏れを構造で止めている。
- **day0 の実物が薄く閉じている**: `_CvVideo.frames` は先頭から `grab()` で順に読み、`retrieve()` は欲しいフレームだけ。`_CocoDetector` は重みの SHA-256 を照合し、オフラインの環境変数を `ultralytics` の import の前に立てている。cv2 は BGR で、ultralytics に ndarray を渡すときも BGR として扱われるので、チャンネル順の誤りはない。
- **テスト**: 偽物の `FakeVideo` のフレームが、持続する格子（焼き込み）と毎フレーム変わる桁（GPS の下の桁）を分けて作ってあり、C1 の「続く画素だけを数えると見逃す」を実際に再現して確かめている。
- **ruff 規則**: print なし（`sys.stderr.write` / `stream.write`）、広い except なし、`Any` なし。仕様どおり。
