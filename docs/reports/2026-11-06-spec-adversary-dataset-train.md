# 敵対レビュー結果: dataset-train（2026-11-06）

対象: `docs/specs/dataset-train/functional.md`（feat/dataset-train の草稿、コミット 79c17a3）と未追跡の `dataset/train_sources.toml`。
照合した資料: `dataset/README.md`・`dataset/PRIVATE-DATA.md`・`CREDITS.md`、各素材の `manifest.json`（commons・eval-by-sa・osaki）、ch4 B2-1・B2-2・B2-5、ch5「データ収集と同意」、ch6「ライセンス」、ch7 の Capture、ch9 ③、ch10 Day 5、`capture.schema.json`、`docs/changes/2026-11-04-capture-xywh-top-left.md`、`file-capture.repository.ts`、`capture/store.py`・`capture/model.py`、`l0/coreml.py`・`l0/inference.py`・`config.py`・`frame.py`、`docs/specs/edge-capture/functional.md`、`.gitignore`。

形式: 依頼に合わせて Critical / Warning / Info に分けた。各項目に種類（[Example] 既存 Rule の穴 / [Question] 決まっていない振る舞い / [仮定] 書かれていない前提）、仕様の該当箇所、なぜ穴か、直し方の案を付けている。

---

## Critical（4）

### C1. `license` と `use` は一覧ファイルに書いた値をそのまま信じていて、素材そのものと結び付いていない。`path` の外し方も止めていない

- 種類: [Example]・[仮定]
- 該当: R1（`path`（`dataset/` からの相対）・`license`・`use`）、SRC-1a・SRC-1b、概要の「使ってよい用途とライセンスを機械で確かめ」
- なぜ穴か: R1 が見ているのは「TOML の `license` が許可リストに入っているか」だけ。素材が本当にそのライセンスかは確かめていない。次の書き方がどれも通る。
  - `name="x", path="private/antler-yolo/eval-by-sa", license="CC-BY", use="train"`（評価専用の BY-SA を学習に入れる。R4 の SHA の重なりは、同じ素材を `eval` としても載せたときしか止まらない）
  - `path="../../../Downloads/ANTLER_YOLO_.../data/yolo/dataset"` や絶対パス（README で除外している **V004（GPS・速度・日時の焼き込み）**、S データ 600 枚、BY-SA が全部入る。どれも一覧の他の素材と SHA が重ならないので R4 でも止まらない）
  - `path="raw"`（README では「同意・匿名化の前の生データ」）や `path="out/train/<前の run>"`
  - `external/antler-yolo/commons` の中に置いたシンボリックリンク（`images/train/x.jpg -> ../../../../private/...`）や、大文字小文字だけ違う別名（APFS は区別しないので `private/antler-yolo/EVAL-BY-SA` は同じフォルダを指す。パスの文字列で拒否するやり方は抜けられる）
- 直し方の案（いまのデータで実装できる）:
  1. `path` を `realpath` で解決し、`realpath(dataset/)` の中で、かつ `raw/`・`out/` の外であることを求める。素材の中のシンボリックリンクは、ファイルでもフォルダでもエラーにする（`os.lstat` で確かめる）
  2. **素材フォルダの `manifest.json` と突き合わせる**。commons と eval-by-sa の manifest には `files[].sha256`・`files[].video`・`sources[video].license` がある。「manifest に載っていない画像 → エラー」「SHA が違う → エラー」「`use=train` なのに `sources[video].license` が許可リスト（CC0 / CC BY の各版）の外 → エラー」の 3 つを R1 に足す。TOML の `license` は manifest の値と同じか、それより厳しいことだけを求める
  3. Example を足す: `..`・絶対パス・シンボリックリンク・大文字小文字だけ違う別名・`raw/` を指す `path` → エラー。eval-by-sa を `license="CC-BY"` と偽って書く → manifest のライセンスと合わずエラー

### C2. Capture の画像のパスをどこから取るかが決まっておらず、`file` と `image` で `dataset/` の外を指せる

- 種類: [Example]
- 該当: R3「api の保存（`{key}.json` が `{capture, file, …}`、画像は `file`）と edge の保存（`{id}.json` …、画像は `{id}.jpg`）」、CAP-1a
- なぜ穴か:
  - api の `{key}.json` の `file` は、api（`readStored`）でも「文字列なら何でもよい」として読んでいる。JSON は手で置いたり、別の機械からコピーしたりできるので、`"file": "../../private/osaki-2026-11/images/DSC00724.jpg"` や絶対パスを書けば、同意も許諾の範囲も違う写真が `license=self` の学習データに入る。Osaki さんの写真は一覧のどこにも無いので、R4 の SHA の重なりでも止まらない
  - `capture.image` は schema の pattern（`^[A-Za-z0-9_/-]+\.(?:jpg|jpeg|png)$`）が `/` で始まる絶対パスを通す（`..` は `.` を使えないので通らない）。実装が「Capture の `image` を読む」と書けば、`/Users/.../private/...jpg` を指せる。仕様に「使わない」と書いていない
  - edge の置き方では、ファイル名 `{id}` と JSON の `id` が違っても仕様では止まらない（edge の `store.py` の `_load` は `data.get("id") != stem` を壊れたものとして扱うが、この仕様は書いていない）。api の置き方でも、`{key}` と `capture.id.lower()` が同じかは書いていない
- 直し方の案:
  - R3 に書く: **`capture.image` はパスに使わない**。api: `file` が `^cap_[a-z0-9]+-[0-9a-f]{12}\.(?:jpg|png)$` に合い、`{key}` が `capture.id.lower()` と同じで、`{key}` が `^cap_[a-z0-9]+$` に合う。さらに画像の SHA-256 の先頭 12 桁がファイル名と同じであること（api の書き方の決まり）。edge: `{id}` が `cap_[0-9a-f]{12}` に合い、JSON の `id` と同じ
  - どちらの置き方でも、画像の `realpath` が素材フォルダの中にあり、シンボリックリンクでないこと。外れたら `skipped`（理由 `bad_path`）に数え、manifest には理由だけを書く
  - Example: `file` に `..`・`/`・別の Capture の画像の名前が入っている → 使わない。`image` が絶対パス → 無視して `file` を使う。`{id}.json` の中の `id` が別の値 → 使わない

### C3. Capture を `dataset/out` に入れることが、edge-capture でユーザーが持っている Deferred とぶつかっている。sim の Capture も、出所が確かめられない投稿である

- 種類: [Question]（誰の知識が必要か: ユーザー（ch9 ③）・PO）
- 該当: R3 全体、R1 の `license=self`（「自作。A のキャプチャ」）、範囲外の節（この点に触れていない）、Tier 1 の根拠
- なぜ穴か:
  - `docs/specs/edge-capture/functional.md` の範囲外に「実写の画像を `dataset/` に入れること（ch9 ③ は要確認）」「`dataset/` への取り込みと学習」「ナンバー・顔のぼかし」がある。Deferred（担当=ユーザー、期日=未定）の暫定挙動は「api が受けたファイルを `dataset/` に入れない。取り込みの feature を作らない。実写の画像は `dataset/` に入れない」。この草稿の R3 は `source=vehicle` の Capture（実際の道路の画像。ぼかしは入っていない）を `dataset/out/train/<run>/images/` にコピーするので、まさにその取り込みの feature になっている。ユーザーの判断がまだ出ていない点を、この仕様が黙って先に進めている
  - `POST /api/captures` には認証が無い（edge-capture の A1・A8。sim から呼ぶため）。`source`・`consent: true`・`by: "user"` はどれも送る側が書く値なので、誰でもどんな画像でも「`source=sim`・同意あり・人が囲んだ箱」として送れる。その画像が `license=self`（自作）として学習に入る。著作物や人の写った写真を「自作」として持ち込めて、わざと間違えた箱で学習を汚すこともできる。R3 にこれを止める仕組みは無い
- 直し方の案:
  - 範囲外に「ユーザーが ch9 ③ と edge-capture の Deferred を解くまでは `source=vehicle` を使わない（`skipped` の理由 `vehicle_pending`）」と書く。あわせて Question に立てる
  - sim の Capture については、Question を立てる: 人が見て通した `id` の一覧（例: `capture_allow.txt`）にあるものだけを使うのか。`license` に `self` 以外の値（例: `contributed`）を設けて model card で分けるのか
  - Tier 1 の根拠に「第三者の投稿を学習に入れる」が当たるかどうかを、この Question の答えとあわせて見直す
  - 実務上のこと（甘い仮定）: edge の Capture の箱は必ず `by: "model"` になる（`capture/model.py:135`）。したがって R3 の「user の箱だけ」を通ると、edge の置き方からは 1 枚も学習に入らない。A の「見つけた」（sim の画面）もまだ作られていない（edge-capture の Deferred、担当=人 A）。Day 5 のゲート「A キャプチャ＋実写」は、いまのところ Capture が 0 枚のまま通る。このことを概要か受け入れ基準に書く

### C4. `train` が build の検査を通らずに学習できる入口になっている。`--base` に BY-SA を含む重みを渡せるのに、model card は「BY-SA なし」と書く

- 種類: [Example]・[仮定]
- 該当: R6（`--run`（build の出力）、`--base`、「`CC-BY-SA` を学習に入れていないことを書く」）、決着済みの「`--base` で明示すれば使え、model card に残る」、TR-1a
- なぜ穴か:
  - `train` は `--run` のフォルダを信じている。build のあとで `images/train/` に画像を足したり差し替えたりしても（手作業、別のスクリプト、Ultralytics の `.cache` の作り直しなど）、`train` は気づかない。model card には `manifest.json` の SHA を書くが、中身の画像が manifest と同じかどうかは確かめていない。R1〜R4 の検査が、build のときに 1 回通るだけのものになっている
  - `--base yolo26n-deer-20261105.pt` は、BY-SA の V006〜V008 で学習した重みの派生（CREDITS.md）。これを `--base` に渡すと、新しい重みにも BY-SA が入る。それでも R6 は「`CC-BY-SA` を学習に入れていないことを書く」と決まった文言を書くので、model card の記載が事実と違ってしまう。ライセンスの記録として誤りになる
- 直し方の案:
  - `train` の最初に、`images/{train,val}` と `labels/{train,val}` のファイルの集まりが `manifest.json` と同じ（余分も欠けも無く、SHA-256 も同じ）であること、`dataset.yaml` の `path` がそのフォルダであることを確かめる。違えばエラー。Example: build のあとに 1 枚足す → `train` がエラー
  - model card に元の重みの出所を書く。SHA-256 が確かめた COCO の `yolo26n.pt` と同じときだけ「BY-SA を含まない」と書く。`yolo26n-deer-20261105` の SHA なら「元の重みに CC BY-SA の学習を含む」と書く。知らない SHA なら「元の重みの学習データは不明」と書く。決まった文言にしない
  - 既知の派生（20261105）を `--base` に渡したときは、`--allow-by-sa-base` のような明示のフラグを求める。決着済みの「明示すれば使える」はそのまま守れる

---

## Warning（8）

### W1. 分割の偏り: Capture のグループが少ないと val が 0 枚、または全部 val になる。UTC の日付で分けると朝の走行が 2 つに割れる

- 種類: [Example]・[Question]（Dev）
- 該当: R3「グループ = `source` と `createdAt` の日付（UTC）…既定 20% のグループを val に」、CAP-1d、R4
- なぜ穴か:
  - `source` の値は `sim` と `vehicle` の 2 つだけなので、グループの数は「2 × 日数」が上限。Day 5 の時点では 1〜3 グループになりそう
  - 「20% のグループ」が、グループごとにハッシュ値を閾値と比べるのか（この場合 5 グループでも 0 個にも 5 個にもなる）、ハッシュの順に並べて `round(0.2n)` 個を取るのか（1〜2 グループなら 0 個）が書いていない。どちらでも、Capture が全部 train になって val に Capture が無いか、全部 val になって学習に Capture が 1 枚も入らないかのどちらかが起こる。R4 は学習側の鹿の合計（commons があれば 0 にならない）しか見ないので、「Capture を学習に入れた 1 周」が、Capture の入らないまま黙って通る
  - 調査走行は「日午前」（ch10 Day 5）。UTC の 0 時は JST の 9 時なので、朝の 1 回の走行が 2 つの日付のグループに割れ、隣り合うフレームが train と val の両側に入る（R3 が避けたい状況そのもの）
  - build の時点で val が 0 枚かどうかを確かめていない。0 枚なら Ultralytics が train の途中で落ちる（S-1 は学習側の鹿が 0 のときしか扱っていない）
- 直し方の案:
  - 振り分け方を書く。グループをハッシュの順に並べ、`k = max(1, round(ratio·n))` 個を val にする（n ≥ 2 のとき。train にも 1 個以上残す）。n = 1 のときは全部 train にして、manifest と表示に「Capture の val なし」と書く
  - 日付は JST（Asia/Tokyo）で取る。または `createdAt` の間が 30 分以上空いたところで区切った「走行」を単位にする
  - R4 に足す: val の画像が 0 枚 → エラー。素材ごとに train と val に入った枚数を表示する
  - Example: グループ 1 個、2 個、5 個（閾値方式で全部 val になる seed）、JST 8:55 と 9:05 のフレーム

### W2. 同じ動画・同じ走行のフレームが学習側と評価側に分かれる道を止めていない

- 種類: [Example]
- 該当: R2「同じグループが train と val の両方にある → エラー」「`test` などそれ以外の分割は評価側に回す」、R4（SHA の完全一致だけ）
- なぜ穴か: グループの検査は、1 つの素材の中の train と val のあいだだけ。次の場合は止まらない。
  - `use=train` の素材に `test` 分割があり、同じ動画の train のフレームと test のフレームがある。test は評価側に回るので、同じ動画の隣り合うフレームが学習と評価の両側に入る（README の「同じ動画のフレームを学習と評価の両側に入れない」に反する）
  - 素材をまたぐ場合（commons の V003 を別の素材としてもう一度 `eval` で載せる、など）
  - SHA の完全一致は、ほぼ同じ隣のフレームや、縮小し直した同じ画像を捕まえられない
- 直し方の案: グループの名前空間を素材をまたいで 1 つにする（YOLO は manifest の `video`、Capture は W1 の走行）。「学習側（train・val）のグループと評価側のグループが重なる → エラー」を R4 に足す。Example: commons に `test/V002_99.jpg` を置く → エラー

### W3. 前のモデルとの比較が公平にならない（評価の正解の大半が、前のモデルの学習に使われていた）

- 種類: [仮定]・[Question]（PO・ユーザー）
- 該当: Story「前のモデルと同じ数え方で比べたい」、R8、範囲外「採用は評価を見てユーザーが決める」
- なぜ穴か:
  - eval-by-sa の鹿の箱は V006 の 12 個と V001 の 5 個（manifest の `counts_images_boxes`）。CREDITS.md によると、前の `yolo26n-deer-20261105` は V002・V006〜V009 で学習している。評価側の正解 17 個のうち 12 個は前のモデルが学習で見た画像で、学習していないのは V001 の夜の 5 個だけ。合計の数字では前のモデルが有利に見え、採用の判断を誤らせる
  - val（V003 の 10 枚だけ）は Ultralytics が best.pt を選ぶのに使う。その val でもう一度評価すると、甘い数字になる。R6 は best.pt と last.pt のどちらを `<name>.pt` にするかも書いていない
  - `.pt` を評価するときの前処理が決まっていない。Ultralytics の predict はレターボックス（余白を足す）。`.mlpackage` は L0 を通すので、640×480 を入力の大きさへ引き伸ばす（`CoreMLDetector._stretch`）。同じ重みでも、`.pt` と `.mlpackage` の数字を比べられない
  - COCO の `yolo26n.pt` には `deer` のクラスが無い。「鹿の予測」をクラスの番号 0 で取ると person を鹿として数える
- 直し方の案:
  - 評価の JSON に、素材ごとの数に加えて、グループ（動画）ごとの数を出す。前のモデルの学習に含まれるグループに印を付ける（例: 一覧に `seen_by: ["yolo26n-deer-20261105"]`）か、V001 だけの「学習に使われていない部分」の合計を別に出す
  - `<name>.pt` は best.pt か last.pt かを書く。val の数字には「best の選択に使った」と注記する
  - `.pt` も L0 と同じ引き伸ばしで入力する（`ultralytics` の predict に `rect=False` と、引き伸ばした 640×640 を渡す）と書く。少なくとも、JSON に前処理の名前を残す
  - クラスは `names` で `deer` を探し、無ければエラーにする（`parse_names` と同じ決まり）

### W4. 評価の数え方の端が決まっていない

- 種類: [Example]
- 該当: R8 の「数え方」、R2「座標が 0〜1 の外 → エラー」、R3「0〜1 に切り、幅か高さが 0 になった箱は捨てる」、EV-1a、CAP-1c
- なぜ穴か・足すべき Example:
  - R2 は 0〜1 の範囲（端を含む）しか見ないので、`w=0` や `h=0` の正解を通す。面積 0 の正解はどの予測とも IoU が 0.5 に届かず、必ず FN になる（予測も面積 0 なら 0 で割る）。YOLO のラベルでも w > 0 かつ h > 0 を求めるべき
  - R3 の「中心基準に直してから 0〜1 に切る」は、順番によって結果が変わる。例: `x=0.9, w=0.3` を中心基準に直して `cx=1.05` を 1.0 に切っても、箱は 0.85〜1.15 のままはみ出し、位置もずれる。**角（x1, y1, x2, y2）を 0〜1 に切ってから中心基準に直す**と書く
  - 確信度が同じ予測の順番と、IoU が同じ正解の選び方（たとえば元の並び順）を決めないと、結果が実行ごとに変わりうる
  - 評価側が 0 枚・正解が 0 個のとき、再現率と適合率が 0 での割り算になる。null にするのかエラーにするのかを決める
  - 「鹿なし画像で予測が出た枚数」は FP の個数とは別の数で、FP に重ねて数えるのか分けるのかを JSON の項目名で区別する
  - 確信度がちょうど 0.25 の予測を数えるか（「以上」で数える）。CoreML の NMS の `conf` の閾値と、端の扱いが同じかを Example で固定する
  - L0 が実際に追うのは `min_conf` 0.4 以上（トラッカー）。0.25 の数だけだと、運用で使う数より甘くなる。比較のための 0.25 は残しつつ、0.4 での TP / FN / FP も出すかを Question にする

### W5. 上書きを防ぐ仕組みに抜けがある

- 種類: [Example]
- 該当: R6「`<name>.pt` が既にある → エラー」、R7「`<name>.mlpackage` が既にある → エラー」、R8「`dataset/out/eval/<重みの名前>.json` に書く」、TR-1b「不正な名前」、S-2
- なぜ穴か:
  - `<name>.json`（model card）が既にあるかを確かめていない。`.pt` だけを消した状態だと、前の card を上書きする
  - `--name` に使える文字が R6 に書いていない（TR-1b に「不正な名前」とあるだけ）。`../x` や `/` を使えば `edge/detector/models/` の外に書ける
  - 評価の JSON は `<重みの名前>.json` なので、同じ名前の `.pt` と `.mlpackage` を評価すると後のほうが前のほうを上書きする。別の run で評価しても上書きする。上書きを防ぐ決まりが無い
  - Ultralytics の `export` は、`.pt` の隣に同じ名前で `.mlpackage` を書き、黙って上書きする。「既にあればエラー」の確かめは、export を呼ぶ前にしないと間に合わない
  - 学習の出力（`runs/.../weights/best.pt`）を `<name>.pt` へコピーするときは、既にあれば失敗する書き方（`O_EXCL` か `os.link`。api の `linkNew` と同じ）にしないと、確かめてから書くまでの間に競合する
  - S-2 の「一時フォルダに作ってから名前を付ける」で `os.rename` を使うと、POSIX では行き先が空のフォルダなら黙って置き換わる
- 直し方の案: `--name` は `<run>` と同じ文字の決まり（英小文字・数字・`-`）にする。`.pt`・`.json`・`.mlpackage` のどれか 1 つでもあればエラーにする。評価の JSON は `<重みの名前>.<pt|mlpackage>.<run>.json` にして、既にあればエラー。コピーは排他で作る

### W6. ラベルの無い画像を「鹿なし（負例）」とみなすため、取り違えた画像が「鹿は背景」として学習される

- 種類: [Example]・[仮定]
- 該当: R2「`images/<分割>/*.jpg`…ラベルの無い画像は鹿なし（負例）」、R5「名前は `<素材名>__<元の名前>`」、R1（`name` に使える文字が書いていない）
- なぜ穴か:
  - 次のような場合に、鹿の写った画像が黙って負例になる。ラベルの付いていない Osaki さんの写真を学習用の素材フォルダへ間違えて置いた。ラベルのファイル名の大文字小文字が画像と違う（APFS では見つかり、Linux では見つからないので、機械によって結果が変わる）。画像が `.JPG`・`.jpeg`・`.png`（`*.jpg` に合わないので黙って無視され、そのラベルだけが残る）
  - `name` に使える文字が決まっていないので、`<素材名>__<元の名前>` が衝突する。`Commons` と `commons` は R1 の重複検査を通るが、APFS では同じファイル名になってコピーが上書きされ、画像とラベルの組み合わせがずれる。`a__b` + `c.jpg` と `a` + `b__c.jpg` も同じ名前になる。`name` に `/` が入れば、出力フォルダの外に書ける
- 直し方の案: 負例は「空のラベルファイルがある画像」とし、ラベルファイルの無い画像はエラーにする（C1 の manifest の `files[].label` と突き合わせられる）。対応しない拡張子と、画像の無いラベルファイルもエラーにする。`name` は `^[a-z0-9][a-z0-9-]*$` にして、小文字にしたうえで重複を確かめる。出力するときにファイル名の衝突（大文字小文字を区別しない比較）を確かめる

### W7. Ultralytics の副作用が Tier 1 の根拠（手元にだけ書く・外へ送らない・ダウンロードしない）とぶつかる

- 種類: [仮定]
- 該当: Tier 1 の根拠「書くのは `dataset/out/`・`edge/detector/models/` だけ」「元の重みは手で置く（スクリプトはダウンロードしない）」「外部への送信を足さない」、R6、非機能要件「個人情報」
- なぜ穴か（実際の動きは、使う版で確かめる必要がある）:
  - 既定では、学習の出力は今いるフォルダの `runs/detect/train*/` に書かれる。`.gitignore` にあるのは `edge/**/runs/` だけなので、リポジトリの直下や `dataset/` から実行すると Git に入りうる。そのフォルダには `train_batch*.jpg`・`val_batch*_pred.jpg`（学習画像を並べた画像。PRIVATE-DATA.md が禁じる「写真の切り抜き」にあたる）と `args.yaml` が入る
  - Ultralytics の設定 `sync`（既定で有効）による利用状況の送信、図を描くときのフォントのダウンロード、`check_requirements` によるパッケージの自動インストール（書き出しのときの coremltools など）
  - `.pt` の中に入る `train_args` と `args.yaml` に、`data` の絶対パス（`/Users/<ユーザー名>/...`）が残る。重みを配ると、この情報も一緒に出ていく
- 直し方の案: R6 に「`project` は `dataset/out/train/<run>/ultralytics/`」と書く。実行の前に `settings.update(sync=False)` と、オフラインにする設定（`YOLO_OFFLINE` など。版で確かめる）を入れる。自動インストールを止める。テストでは、学習器に渡す引数に `project` が入っていることを確かめる。model card にはパスを `dataset/` からの相対で書く

### W8. 個人情報と同意のある画像の写しに、保持期間・削除の契機・コミットする報告書に書いてよいことが決まっていない（ドメイン規範レンズ）

- 種類: [Question]（ユーザー・PO）
- 該当: R5 の manifest（Capture の `id`・`source`・`roadSegment`・日付）、非機能要件「個人情報」、受け入れ基準の「結果を `docs/reports/2026-11-06-dataset-train-run.md` に残す」
- なぜ穴か:
  - 「アップロード・履歴」を扱う仕様なのに、`dataset/out/train/<run>/` にコピーした Capture の画像を、いつ、誰の要求で消すかが書いていない。edge は 24 時間で消し、api は Deferred（運用者が管理する）。学習用の写しだけがいつまでも残る
  - manifest の 1 行に `roadSegment` と日付と `source=vehicle` がそろうと、「誰がいつどの区間を走ったか」に近い情報になる（ch5 は区間に丸めることを許しているが、組み合わせについては何も言っていない）
  - 受け入れ基準の報告書は Git に入る。そこに何を書いてよいかが決まっていない。manifest の抜き書き、Capture の id、画像ファイル名、評価で誤報が出た画像の切り抜きなどを書いてしまうおそれがある
- 直し方の案: Question を立てる。「`dataset/out` の Capture の写しの保持期間と、消すきっかけ（run を消す手順。`--prune` など）」「報告書に書いてよいのは素材ごとの件数と評価の数だけで、画像・id・`roadSegment` は書かない」。後者は非機能要件にも書く

---

## Info（6）

- **I1 [Example] 同じ Capture が 2 回入る**（R3・R4）: edge で同意してから api へ送ったものは、edge のフォルダと api のフォルダの両方に同じ `id`・同じ画像としてある。両方の素材を載せると、学習で 2 倍の重みになる。R4 の SHA の検査は学習側と評価側のあいだしか見ない。→ 学習側の中でも `id` と SHA-256 の重複を 1 つにまとめ、`skipped: duplicate` に数える
- **I2 [Question] Capture の素材の `use=eval` と `license`**（R1・R3）: Capture の素材を `use=eval` にしたとき、R3 の分割を使うのか、全部を評価に回すのかが書いていない。評価でも `consent=true` だけを使うのか（使うべき）も明記がない。`vehicle` の Capture の `license` を `self`（自作）と呼ぶのは正しくない（第三者が同意して提供したもの）。誰の知識が必要か: PO
- **I3 [Question] 実際の Capture の取り方**: deploy-a で、本番の api は Blob と Turso（`BlobCaptureRepository`）になっている。ファイルの置き方は手元の開発のときだけ。本番の Capture をどうやって手元のフォルダにするのかが範囲の外にも書いていない。誰の知識が必要か: Dev
- **I4 [仮定] edge のフォルダを、動いている edge から直接読む**: edge は一覧を取るたびに、保持期間（24 時間）を過ぎたものを消す。build の途中で JSON や画像が消えると、`skipped` の理由がずれる。→ 「edge のフォルダは edge を止めてからコピーし、そのコピーを読む」と書く
- **I5 [仮定] 正解ラベルの質**: commons と eval-by-sa の manifest の `labels_note` は「AI による目視の概算ラベル。専門家の正解ではない」。評価の JSON にこの注記を写し、IoU 0.5 での数の揺れを読み手に伝える
- **I6 [仮定] 再現性と帰属表示**: seed は必須だが、MPS では Ultralytics の学習は同じ seed でも完全には同じにならない。決定性は「build の manifest」についてだけ約束する、と書き分ける。CC BY（V003 の Jeff Turner、V009 の Nesnad）の帰属表示を model card の「素材とライセンス」に入れるか、CREDITS.md の行を参照する（重みを配るときに表示の義務がある）。`dataset.yaml` は絶対パスなので、Mac mini へ手でコピーすると使えない。`train` が作り直すのか、コピーの手順を README に書くのかを決める

---

## 問題なし

`consent` は schema で真偽値に限られるので（`"true"` という文字列は通らない）、R3 の `consent === true` で十分。`<run>` の名前の文字の決まりと、既にあればエラーにすること。`conf` が `min_conf` を超えたらエラーにする決まり（edge-day0 と同じ）。SHA-256 の完全一致での重なりの検査そのもの。Capture の `xywh` を左上基準とすること（変更の記録と一致）。L0 の入力を 640×480 にすること（B2-1・`resize_frame` と一致）。
