# code-reviewer: dataset-train sdata（claude/dataset-train-sdata の未コミットの変更）

対象: `dataset/self_labels.py`・`self_labels.toml`・`train_l0.py`・`compare_l0.py`・`train_sources.toml`・`README.md`・`pyproject.toml`・3 つのテスト。
仕様: `docs/specs/dataset-train/functional.md` R4 追記・R9〜R14。読み取りのみ（コードは直していない、テストは走らせていない）。

## レビュー結果

### Critical（修正必須）

- [C1] `dataset/compare_l0.py:105-111`（`_cards`）・`263-276`（`_check_card`）・`189-204`（`summarize`）: **R14 の必須の検査「seed の集まりが arm で同じ」が、ファイル名の `-s<N>` しか見ていない。model card の `seed` を読まない。**
  - 1 つ目（仕様の列挙の中の穴。運用者が何も消さなくても起きる）: `_cards` は seed を `c1-real-s<N>.json` のファイル名の正規表現だけで取る。model card には実際の `seed`（`train_l0.py:1101`）が書かれているが、`_check_card` は `SAME`（epochs・imgsz・batch・device・ultralytics）と `base` と `run` しか比べない。`train --name c1-real-s2 --seed 1`（名前と `--seed` は別々の引数で、README の例も手で 2 つそろえる書き方、`README.md:188`）と打ち間違えると、`c1-real-s2` は seed 1 で学習されたまま、`c1-mix-s2`（seed 2）と並んで「同じ seed の 2 つ目」として表に載る。seed の集まりが同じ・seed が 2 つ以上、の検査は通る。`separated` の seed 範囲も誤った前提で作られる。
  - 2 つ目（run を手で消して作り直した場合）: card の `manifest_sha256`（`train_l0.py:1095`）も読まない。`c1-real` を消して同じ名前で build し直し（`build` は上書きを拒むので手で消す必要がある）、重みと評価の JSON を残すと、`run` の末尾の名前・重みの SHA・閾値・後処理の設定のすべてが通り、表には新しい run の枚数（`manifests[arm]["counts"]`）と古い run の評価が並ぶ。
  - 3 つ目: `check_same`（real と mix の val・評価側が同じ）は `build` の中でしか呼ばれない（`compare_l0.py:86`）。summarize の時点の 2 つの manifest は再検査されない。評価の JSON にも評価側の manifest の SHA が無い。
  - 修正案（`_check_card` に引数を足す）:
    ```python
    # summarize の中、_check_card の前
    compare_l0.check_same(runs["real"], runs["mix"])  # 手で消して作り直した run を拾う
    want = sha256_file(runs[arm] / "manifest.json")
    ...
    def _check_card(card, first, run_dir, name, seed, manifest_sha):
        if card.get("seed") != seed:
            raise TrainError(f"{name}: card の seed {card.get('seed')} が名前の s{seed} と違う")
        if card.get("manifest_sha256") != manifest_sha:
            raise TrainError(f"{name}: card の manifest が今の {run_dir.name} と違う（build し直した）")
    ```
    評価の JSON 側にも `manifest_sha256` を足し（`train_l0.evaluate` の `report`）、`_check_report` で card と同じことを確かめる。テストは「card の seed を書き換える」「run の manifest を書き換える」の 2 つを CMP-1c に足す。

### Warning（推奨）

- [W1] `dataset/compare_l0.py:293`: `report.get("model_sha256") != card.get("sha256")` は、両方が欠けているとき（`None != None` は False）通る。`evaluate` は `.mlpackage`（ディレクトリ）だと `model_sha256 = None` を書く（`train_l0.py:1396`）。`.pt` の検査が先にあるので今は届かないが、古い card・古い評価の JSON を混ぜると素通りする。`if not card.get("sha256") or report.get("model_sha256") != card["sha256"]:` にする。
- [W2] `dataset/compare_l0.py:252-255`: JSON を書いてから `.md` を `"x"` で開く。`.md` だけ残っているとき、JSON を書いた後で `FileExistsError`（`TrainError` でない → exit 2 にならず Traceback）になり、次の summarize は JSON が既にあるので止まって、片方だけの出力が残る。`target` と `.md` の両方の存在を先に確かめる（または一時ファイルに書いて `os.replace`）。
- [W3] `dataset/compare_l0.py:158-174`（`separated`）: 値が `None` の key は黙って落とす（`break`）。「比べられなかった」と「重なっていた」が表で区別できない。`out[key] = {"separated": None, "reason": "値なし"}` のように残すか、markdown に「比べられない数」を 1 行書く。向き（どちらの arm が良いか）も書かない。重ならない数の行に `real` と `mix` の範囲があるので読めるが、再現率（高いほど良い）と誤報（低いほど良い）が同じ見出しに並ぶ。
- [W4] `dataset/train_l0.py:1075-1081`: `private = any(s.get("distribution") == "not_allowed" ...)` は、manifest に `distribution` が無いと `"ask_user"` になる（`collect_self` は `manifest.get("distribution")` をそのまま写す、`train_l0.py:529`）。self / synth は仕様上いつも配布不可。欠けたときに開く側へ倒れるので、`kind in ("self", "synth")` の素材が 1 つでも学習側にあれば `not_allowed` にする（欠けは `load_footage` / `collect_synth` で `TrainError` にしてもよい）。
- [W5] `dataset/train_l0.py:487-505`（`load_footage`）・`563`: manifest の形の検査が一部だけ。`row["deer"]`・`row["frame"]`・`row["t"]`・`row["video"]`・`clip["every_frames"]["no_deer"]`・`clip["size"]`・`clip["fps"]`（0 だと `fp_runs` で ZeroDivisionError、`train_l0.py:1345`）は、欠けると `KeyError` / `TypeError` の Traceback になり、`main` の `except TrainError`（`train_l0.py:1554`）で拾えない。`SELF_FIELDS` の集合を決めて `load_footage` の最初のループで `TrainError`（素材名・画像名つき）にする。`(video, frame)` の重複も同じ場所で止める（`self_labels._Video.by_frame` は黙って後勝ちになる、`self_labels.py:90`）。
- [W6] `dataset/self_labels.py:126-150`・`164-187`・`198`・`212`: 台帳の**型の検査が足りない**。`frame` が文字列・`x1` が文字列、`frames = [[1]]`（unhashable）、`range = ["a", "b"]`、`track = {}` / `mark = "x"`（表でなく `raw.get` が AttributeError）、`frame = true`（`True == 1` で manifest のフレーム 1 に当たる）は `LabelError` でなく素の例外になる。仕様は「打ち間違いを黙って通さない」。キーの先頭で `type(frame) is int` と `isinstance(v, (int, float)) and not isinstance(v, bool)` を確かめ、`ledger.get("track", [])` が list of dict であることを `load_ledger` で確かめる。
- [W7] `dataset/self_labels.py:231-237`: `ignore` があるフレームに `empty` と track が両方当たっているとき、`ignore` が勝って矛盾（R12「empty と track が同じフレームに当たる → エラー」）が見えなくなる。優先は仕様どおりだが、矛盾の検査を `ignore` の判定の前に出す（`status` に `empty` があり `key in boxes` ならまずエラー）。ledger を見直すとき、迷って `ignore` を足したフレームに別の矛盾が隠れていると気づけない。
- [W8] `dataset/train_l0.py:1317-1355`（`fp_runs`）・`compare_l0.py:118-146`（`metrics`）: ネストが 4〜5 段（for post → for t → for videos → for samples → if / for source → for post → for thr → for source → if）。観点「3 段以上は要リファクタ」。`fp_runs` は動画 1 本 × 後処理 1 つ × 閾値 1 つの数え方を関数にする:
  ```python
  def _count_video(samples, post, t) -> dict:  # 1 本の動画の frames / seconds / hits / runs
      tally, length, prev = _run_tally(), 0, None
      for seq, preds in samples:
          hit = any(c >= t for c, _ in preds[post])
          ...
      return tally
  ```
  こうすると「間が空く」「2 枚ちょうど」「動画の終わりで閉じる」を、偽の検出器なしで直接テストできる（下の W10）。`metrics` も `_side_metrics(report_part, runs_part, kinds)` に分ける。
- [W9] `dataset/train_l0.py` が 1565 行で、素材の一覧・YOLO・Capture・self / synth / negatives・build・train・export・evaluate・後処理・連続した誤報が 1 ファイルにある（観点: 単一責務）。今回 +500 行ほど増えた。次の cycle で `sources.py`（一覧と collect_*）と `evaluate.py`（match / fp_runs / evaluate）に分けるのを推奨（import の依存方向は `train_l0 → sources / evaluate` の一方向にできる）。今回の PR で分ける必要は無い。
- [W10] テストが振る舞いを確かめきれていない所:
  - `test_compare_l0.py:69-74, 94-123`（AC-2）・`298-313`: 偽の検出器が**画像名だけで予測を決める**（`factory_by_name`）ので、全部の seed・arm で結果が同じ。`separated` は「全部が同じ点 → 重ならない」の 0 / 1 の 2 通りしか動かない。範囲が実際に重なる場合（real [0.0, 0.5]・mix [0.4, 1.0] → False）、端がちょうど接する場合（`r[1] == x[0]` → False。`<` が厳密なこと）、片方の arm だけ幅がある場合を、`separated(results)` に手書きの辞書を渡して直接確かめる（純関数なので偽の学習も要らない）。
  - `test_train_l0_sdata.py:591-613`（EV-2b）: 数えるのは `raw` の 0.25 と 0.8 だけで、**`fp_filter` 側の連続した誤報**（`fp_runs[...]["fp_filter"]`）、**ちょうど 2 枚続く**（`length >= 2` の境界）、**2 つの塊が別々に数えられる**（回数 2）、**ignore で間が空いて隣り合わない**（フレーム番号の差 > step で、間にサンプルが無い）、**動画が替わると塊が切れる**を確かめていない。`eval` の例は「0 と 30」で、間に 10（予測なし）があるので、間隔の判定（`near`）でなく予測の有無で切れている。W8 で関数に分けたあと、`_count_video` に 5 つの並びを直接渡すのが楽。
  - `test_train_l0_sdata.py:580-587`（EV-2c）: `region_scaled` は確かめている。一方、動画が変わったとき「続き」を持ち越さない（R13）の対のテストが無い（動画 A の最後の枠が 3 秒以内に動画 B の最初の枠の「続き」にならないこと）。
  - `test_compare_l0.py` に、`check_same` が **train（synth 以外）の違い**で止まるテストが無い（val・synth の外だけ）。`summarize` が card の seed・manifest を確かめるテスト（C1）も無い。
  - `test_self_labels.py:201-205`（`test_repo_ledger_parses`）は `track` が空でないことだけ。Git の台帳そのものの整合（キーの昇順・x1 < x2 など manifest に依らない形の検査）を `_track_boxes` から manifest 抜きで確かめる関数に切り出すと、実データの手元の manifest が無い CI でも台帳の打ち間違いが止まる（今は手元で build したときだけ分かる）。
- [W11] `dataset/compare_l0.py:122-145`: `separated` に載る key は `SEPARATE` の末尾 5 つだけ（`deer_recall`・`deer_fp`・`neg_rate`・`runs_per_min`・`fp_frames_per_min`）。`val/*` と `eval/*`、`raw` / `fp_filter`、3 つの閾値で 5 × 12 = 60 通りを見る。seed 2 つ・範囲が重ならないこと「だけ」を条件にしているので、60 通りのどれか 1 つが偶然に重ならないだけで「差あり」の行が出る（多重比較）。仕様どおりなので変えなくてよいが、報告に「60 通りのうちいくつ」と分母を書く一文を `markdown` に足すと、読み手が誤読しにくい（`len(summary["separated"])` と重ならなかった数）。

- [W12] `dataset/README.md:93`・`143`・`190`: 文書が今回の変更に追い付いていない。
  - 93 行（Mapillary）「`train_sources.toml` にはまだ載せていない … 次の cycle で `negatives` を足して登録する」と、143 行（合成）「`train_sources.toml` にはまだ載せていない …」は、今回の `train_sources.toml` で `mapillary-doto`（`kind = "negatives"`）と `synth-s1`（`kind = "synth"`）が登録済みなので古い。「登録済み（`train_sources.toml` の `mapillary-doto` / `synth-s1`、`use = eval` / `train` だけ）」に直す。読み手が「まだ学習の一覧に無い」と思って二重に足すおそれがある。
  - 190 行 `compare_l0.py summarize --prefix sd1` は `--root` / `--models` を省いている。171 行の注意（worktree では `--root <main>/dataset`、`--models <main>/edge/detector/models`）の通りに `train` で置いた重みは、既定の `train_l0.MODELS`（この worktree の `edge/detector/models`）にしか見に行かないので、`summarize` にも同じ `--models` と `--root` を付けないと「seed が 2 つ以上要る」で止まる。docstring（`compare_l0.py:11`）は `--root`・`--models` を書いているので、README の例もそろえる。
  - 比較の手順（186-191 行）に、`train` の `--name` の `-s<N>` と `--seed` を同じ数にする注意が無い（C1 の 1 つ目）。コードで止める修正を入れたら、その旨を 1 行足す。
  - 186-191 行の手順の順（`build` → `train` → `evaluate` → `summarize`）は docstring と合っている。ただし例の `train`（188 行）に `--models` が無く、171 行の注意を読み飛ばすと既定の置き場に書く。例に `--models` と `--root` を入れるか、「worktree では 171 行のとおり」と 1 行足す。
  - なお `README.md:150`・`168-171` と `train_sources.toml` の説明、`self_labels.toml` の手順は、コードと食い違いが無いことを確かめた。

### Info（参考）

- 良い点:
  - **走行単位の漏れの検査**（R4 追記）: self / synth のグループを `self:<drive>` にそろえ、既存の `check_leaks`（`train_l0.py:791-815`）をそのまま使っている。新しい検査の分岐を増やさず、LEAK-1a の 2 つの経路（2 つの self の素材・eval の素材の train の走行を背景にした S データ）をテストが確かめている。
  - **S データの背景を SHA で引き当て、manifest の自己申告を信じない**（`collect_synth`、`train_l0.py:586-603`）。`uses` の `synth_background`・台帳の `ignore`・走行の分割の 3 つを背景 1 枚ずつ確かめている。footage の manifest では鹿ありの行の `uses` は `["label"]` だけなので（`self_footage.py:559`）、実鹿が写る背景は `synth_background` で止まる。
  - `resolve` の検査（キーの間に鹿なし → エラー、`ignore` 優先、`empty` のぼかし）は仕様の W1・W2 に 1 対 1 で対応し、`test_self_labels.py` のパラメータ化が境界（辺が接するだけは重ならない、`range` の両端を含む）まで確かめている。
  - `compare_l0.build` が mix の失敗で real も消す（`compare_l0.py:83-90`）、`summarize` が結果を上書きしない（`"x"` で開く）、`FILTER` を差し替えて `region_scaled` の確信度の順序をテストしている（EV-2c）。
  - 連続した誤報の数え方（`train_l0.py:1334-1346`）は、`hit and near and length` の分岐で「予測なし → 長さ 0」「近くない予測 → 新しい長さ 1」を正しく扱い、動画の終わりで閉じている。分母も `枚数 × step ÷ fps` で R13 と一致。`empty`（`no_deer` False）と台帳の `ignore`（そもそも manifest に入らない）が入らないことも、コードで確かめた。
  - `to_center` の分母が manifest の `size`、ぼかしの箱が `[x, y, w, h]`（`self_footage.py:90`）で、`_overlaps` の座標系と一致している。
- `dataset/train_l0.py:67`: `FILTER = L0FilterConfig()` はモジュールの可変な大域で、テストが `monkeypatch` で差し替える。`evaluate(..., filter_config=FILTER)` の引数にすると、並行して違う設定で評価する将来の使い方と、設定を JSON に書く箇所（`asdict(FILTER)`）が 1 本になる。
- `dataset/train_l0.py:507`・`self_labels.py`: `src.labels` は `Path | None` で `# type: ignore[arg-type]` を使っている。self の素材では `_kind_extras` が必ず入れるので `assert src.labels is not None` か `Source` を kind ごとに分ける方が安全（型の ignore を 1 つ減らせる）。
- 学習と評価の前処理: 学習は Ultralytics が 1920×1080 を letterbox して 640 に縮め、評価（と書き出し）は 640×480 に**引き伸ばす**（`train_l0.py:74, 1416`、PREPROCESS）。self の 16:9 だと縦に 1.33 倍伸びて見える。real と mix は同じなので相対比較には効かないが、絶対の再現率を「実機の値に近い」と読まれないよう、報告に 1 行書く（実機のカメラが 4:3 かどうかで意味が変わる）。
- `dataset/train_l0.py:529` の run の manifest には、台帳（`self_labels.toml`）の SHA-256 が書かれない。箱の値は manifest に入るので再現はできるが、「どの版の台帳から作ったか」は model card から辿れない。`Footage` に `labels_sha256` を持たせて manifest の `notes` か `sources[name]` に写すと、台帳を直して再 build したときの比較が追える。
- `dataset/compare_l0.py:212-214`: `steps` は `ceil(train ÷ batch)`。Ultralytics の dataloader は最後の端数のバッチを捨てない設定が既定なので近似として合っているが、`drop_last` の既定に依存する（版が変わると変わりうる）。表の名前を「ステップ数（概算）」にしておくとよい。
- `dataset/self_labels.py:250-287`（`sheet`）: `# pragma: no cover` が関数全体に付いており、`--out` の出力先が検査されない（Git の管理下を指しても止まらない）。台帳の README は「作業用のフォルダに置く」と書くのみ。出力先が `git rev-parse --show-toplevel` の中なら止める、または `.gitignore` 済みの `dataset/out/` の中だけを許す、の 2 択を検討。`cv2.imread` が `None` のときの `cv2.LUT` の失敗も分かりにくい。
- `dataset/self_labels.toml` の台帳: 46〜61 行の B の note、40 行の A の note に書いた「ignore のフレーム」と、`mark` の範囲が少し違う（A の note は 1189〜1207、mark は 1183〜1207）。実害は無い（`ignore` が広い側）。次に台帳を直すときにそろえる。`note` / `reason` に地名・路線名・距離標は無く、R12 の約束どおり。`labeler` / `method` に「確かめたのは 1 人（Claude）」と書いてあり、正解の質の限界が台帳に残っている（良い点）。
- `dataset/tests/test_compare_l0.py:11-13`: テストが `from test_train_l0 import ...` / `from test_train_l0_sdata import ...` と、テストのファイルどうしで import している（`test_compare_l0 → test_train_l0_sdata → test_train_l0`）。pytest の `pythonpath = ["."]` と `tests/` の `rootdir` に依存し、片方を移すと全部が壊れる。`tests/conftest.py` か `tests/helpers.py` に `world`・`manifest`・`sha` などを移すのを推奨。
- `dataset/train_sources.toml`: 既定の一覧が `private/self-footage`・`private/self-synth/s1`・`private/mapillary-doto` を指すので、private の素材が無い checkout では `build` が「置き場所が無い」で止まる（既存の `eval-by-sa` も同じ性質）。README の「`--root <main の checkout>/dataset`」で足りるが、エラー文に「private の素材は main の checkout にだけある」を足すと迷わない。
- `dataset/pyproject.toml`: `--cov=self_labels --cov=compare_l0` を足し、ruff の `known-first-party` にも入っていて整合。`# pragma: no cover` の関数（`sheet`・`main`）が合計行数に対して小さいことを、カバレッジの下限 70% の根拠として確かめておく。
- 性能: `compare_l0.build` は `train_l0.build` を 2 回呼び、self の全フレーム（1920×1080 の JPEG）を 2 回ハッシュしてコピーする。枚数が増えたら、real の arm の画像を mix にハードリンクする（同じ SHA なので）と build が半分になる。今は枚数が小さいので不要。

## 優先順位の目安

1. C1（card の seed・manifest の結び付けと `check_same` の再検査）。比較の表の根拠そのものなので、実データの 1 周の前に直す。
2. W1・W2・W5・W6（エラーの扱い。いずれも小さい修正）。
3. W8 と W10（`fp_runs` を分けるとテストが書ける）。
4. W3・W4・W7・W11 は表と card の読みやすさ・安全側への倒し方。W9 は次の cycle。
