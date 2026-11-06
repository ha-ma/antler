# セキュリティ・プライバシー監査: dataset-train（S データ・自分の映像・比較）

- 日付: 2026-11-07
- ブランチ: claude/dataset-train-sdata（未コミットの変更と未追跡ファイル）
- 対象: dataset/self_labels.py・self_labels.toml・train_l0.py・compare_l0.py・train_sources.toml・README.md・pyproject.toml・tests 3 本・docs/specs/dataset-train/functional.md
- 方法: 読み取りのみ（git diff / git status / grep / コードの通読）。テストは回していない

## Critical（即時対応）

なし。

## Warning（早期〜計画的対応）

### W1. 重みの配布区分が「無い」ときに緩い側へ倒れる | CWE-693 / CWE-1188

- train_l0.py:529・584・634（`distribution=manifest.get("distribution")`）と train_l0.py:1076〜1081
- 素材の manifest に `distribution` が無い（キー欠落・typo）と None になり、`private` が False のまま model card は `"ask_user"` になる。`not_allowed` が出るのは明示された素材だけ
- `base.by_sa` が True の重み（`--allow-by-sa-base` で学習）でも、他の素材がすべて公開なら `distribution` は `ask_user`。CC BY-SA を含む派生であることは `base.by_sa` に出るが、配布区分には反映されない
- 影響: private の素材（自分の映像）や BY-SA 派生の重みが、配布してよいように見える model card になる
- 修正案: `self` / `synth` の manifest に `distribution` が無ければ TrainError。`known.by_sa` のときは `distribution = "not_allowed"`（または専用の値）にする。テストを 1 本足す

### W2. `compare_l0.py summarize` の `--prefix` を検証していない（パストラバーサル） | CWE-22

- compare_l0.py:177〜182（`target = out_dir / f"{prefix}.json"`）、`runs`・`_cards`・評価 JSON の読み出しも同じ
- `build` は `NAME` で検証するが、`summarize` は検証しない。`--prefix ../../x` で `out/compare/` の外に `.json` / `.md` を作れる。`x` モードなので既存の上書きはできない。読み出し側も同じ prefix で `out/` の外を指せる
- 影響: 操作者自身の CLI のみで外部入力ではないため低い。ただ「`out/` の中だけに書く」約束は破れる
- 修正案: `summarize` の先頭で `NAME.match(prefix)`（`build` と同じ）

### W3. `self_labels.py sheet` が上書きの約束を守らず、manifest の画像パスを閉じ込めない | CWE-73 / CWE-22

- self_labels.py:286（`cv2.imwrite(str(out), grid)`）、self_labels.py:273（`footage / row["image"]`）
- `--out` が既存ファイルなら黙って上書きする（台帳 `self_labels.toml` を指定すれば壊せる）。`x` モードの約束が、この道具だけ当てはまらない
- manifest の `image` に `..` や絶対パスがあれば `footage` の外の画像も読む（読んだ画像は重ね描きの出力に入る）。manifest は dataset-footage の出力で信頼できる前提のため低い
- 修正案: 出力が既にあれば止まる（`exists()` の確認。`imwrite` は `x` を持たないので `exists` を先に見る）。`--out` が `dataset/` の Git 管理下（`private/`・`out/` 以外）なら止める。画像は `resolve()` が `footage` の中にあることを確かめる
- 補足: この道具の出力は画像（匿名化後のフレーム）。README・docstring に「Git に入れない」とあるが、出力先を `dataset/private/` か `out/` に限る検査はない。gitignore 外に置けばコミットされうる

### W4. 比較の BY-SA 検査が model card の自己申告に頼る | CWE-345

- compare_l0.py:263〜265
- `card.get("base", {}).get("by_sa")` が偽・欠落なら通る。元の重みの SHA-256 が `KNOWN_BASES`（train_l0.py:147〜152）の BY-SA の重み（`55567b36…`）かどうかを直接は見ない。他の重みと SHA-256 が一致するかを見るだけで、全 seed の card が同じ欠落でも通る
- BY-SA を含む元の重みでの比較は、通常の経路では `train` が `--allow-by-sa-base` なしで止め、比較側も `by_sa` が True なら止まる（テストあり）。二重に止まるのは良い。穴は card を手で編集した場合と、古い形式の card
- 修正案: compare 側でも `KNOWN_BASES` を引き、`by_sa` の真偽は card でなく SHA-256 から決める。未知の SHA-256 は止める

### W5. 撮影者名の塩なしハッシュが評価の JSON に残る | CWE-327 / CWE-359

- train_l0.py:636（`sha256(creator_username)`、先頭 10 桁を group に使う）、train_l0.py:1296（`by_group` を評価の JSON に出す）
- Mapillary のユーザー名は公開されている。塩の無いハッシュなので、既知のユーザー名との照合で戻せる。仕様（functional.md R11 の W6）も「匿名化とは呼ばない」と認めている
- 現状の置き場は gitignore 済みの `dataset/out/`（`dataset/out/` が ignore されていることは `git check-ignore` で確認した）。ただ、評価の JSON の `by_group` は報告書に貼りやすく、貼ればコミットされる
- 修正案（どちらか）: 評価の JSON の `by_group` から negatives の group を落とす（`by_source` の集計だけで足りる）。または run ごとのランダムな塩を manifest に持たせ、HMAC にする。README の「報告書に貼らない」の一行も添える

### W6. S データの背景以外の出所（鹿の 3D モデルのライセンス）を train_l0 は見ない | CWE-1357

- train_l0.py:572〜（`collect_synth`）
- 背景の走行・`synth_background`・train の走行は検査している。一方、合成した鹿のモデル（synth.py:394〜405 は CC0 を要求）の `license` は run の取り込み時に再確認しない。`allowed_use` と `license = self` の自己申告だけ
- 影響: 取り込み側の検査が通っても、synth の manifest の `models[].license` が CC0 以外でも学習に入る可能性（synth.py 側で止まる前提）
- 修正案: `manifest["models"]` の全 `license` が `CC0` で始まることを collect_synth でも確かめる（`author` は run の manifest に写さないこと。いま写していない）

## Info

- I1. gitignore と未追跡: `git status` の未追跡は `.py` / `.toml` / tests のみ。画像・`.pt`・`.pyc`・`.coverage`・キャッシュは `!!`（ignored）。`dataset/private/`（.gitignore:52）・`dataset/out/`（:60）・`edge/**/models/`（:42）・`*.pt`（:45）が効いていることを `git check-ignore -v` で確認した。`edge/detector/models` に追跡されたファイルは無い
- I2. 秘密情報: 対象ファイル（コード・TOML・tests・README・spec）に API キー・トークン・パスワード・メール・絶対パス（`/Users/…`）・ユーザー名の直書きは無い。tests の `alice` / `bob` / `145.2` / `根室` は漏れを検出するための偽データ（test_train_l0_sdata.py:160〜178・427）
- I3. 台帳 `self_labels.toml` はコミット対象。含むのは動画 ID（`20261106_deer-crossing` など。撮影日が分かる）、フレーム番号、画素座標、作業メモ、`labeler`（モデル名）。氏名・経度緯度・端末情報・地域は無い。動画 ID の日付を伏せたいなら別名にする（R12 の範囲では許容）
- I4. 台帳・素材のパスの閉じ込め: 良好。`labels` は絶対パス・リンクを拒否し、`resolve()` 後に一覧のフォルダの中かつファイルであることを確認（train_l0.py:288〜301）。素材の `path` は相対・リンク拒否・`dataset/` の中かつ `raw/`・`out/` の外・配下のリンクも禁止・同一実体の重複も禁止（train_l0.py:304〜320）。画像は `_tree` が manifest の `image` と 1 対 1・SHA-256 で照合するので、manifest の `..` で外のファイルを学習に混ぜられない
- I5. 上書き禁止: `build`（`mkdir` の `FileExistsError`）、重み（`xb`）、model card（`x`）、評価の JSON（`target.exists()` と `x`）、比較の JSON / md（`x`）で守られている。例外は W3 の `sheet`。比較の `build` が途中で失敗したときの `rmtree` は、そのプロセスで作った run だけ（`made` リスト）
- I6. CC BY-SA が学習へ入る道: 見つからなかった。`use = train` かつ `license = CC-BY-SA` は読み込みで止まる（train_l0.py の load_sources）。`negatives` は `use = eval` だけで、collect_negatives は split を `eval` 固定。yolo は manifest の最も厳しいライセンスと一覧の license が違えば止まる。`license_class` は分類できない文字列（NC・ND 等）を止める。`eval-by-sa` と `mapillary-doto` は `use = eval`。漏れの検査は SHA-256 と group の両方で学習側と評価側をまたぐ
- I7. BY-SA 派生の元の重み: `train` は `--allow-by-sa-base` なしで止まり、`compare_l0` は常に止まる（W4 の穴を除く）。model card に `base.by_sa`・`base.origin` が出る
- I8. 重みの配布不可: model card の `distribution_note` に AGPL と private の件が出る。`distribution` は素材の manifest 次第（W1）
- I9. run の manifest の内容: `seq` に動画 ID・フレーム・`t`（動画内の秒）、`origin` に `private/…` の相対パス、negatives は Mapillary の画像 ID（ファイル名）と撮影者ハッシュ。`creator_username`・`attribution`・`sequence`・経度緯度・`region` は写していない（テストで `alice` / `145.2` / `根室` / `Mapillary` / `道東` / `area` が無いことを確認している）。`labels_note` は yolo の manifest の自由文をそのまま通す（外部の文字列。正規化はしない）
- I10. `dataset.yaml`（train_l0.py:960）と Ultralytics の `project` に開発機の絶対パス（ホームのユーザー名を含む）が入る。どちらも gitignore 済みの `dataset/out/` の中。報告書に貼らないこと
- I11. `evaluate` の `root / entry["origin"]`（train_l0.py:1412）は絶対パス・`..` を拒否しない。run の manifest は自分で作った `out/` の中の信頼できるファイルで、読む前に SHA-256 の一致も確かめるので悪用の余地は小さい。気になるなら `origin` の相対・`private/` 配下の確認を足す
- I12. 比較の JSON（compare_l0.py `summarize`）に出るのは、素材名・件数・TP/FN/FP・閾値・元の重みの名前 / SHA-256 / origin・epochs・device・ultralytics の版・run 名。パス・撮影者・経度緯度・時刻（`created` 以外）は無い。`created` は manifest と model card にあるが日時のみ

## 総合評価

- リスクレベル: Low（Critical 0、Warning 6）
- 個人情報の漏れ: 見つからず。台帳に載る日付入りの動画 ID は許容範囲。Mapillary の撮影者ハッシュ（W5）だけが再識別されうる
- 推奨アクション（優先順）:
  1. W1（配布区分の fail-open と BY-SA 派生）: 修正が小さく、ライセンスの約束に直結する
  2. W4（比較の BY-SA 検査を SHA-256 から決める）
  3. W2・W3（入力の検証と上書き禁止の穴。ローカル CLI なので低い）
  4. W5（評価の JSON の `by_group` から negatives を落とす）
  5. W6（synth のモデルのライセンスを取り込み側でも確認）
