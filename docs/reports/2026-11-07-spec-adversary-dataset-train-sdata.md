# 敵対レビュー: dataset-train（2026-11-07 更新分）

spec-adversary（読み取り専用）の結果を、メインセッションが写した。対象は `docs/specs/dataset-train/functional.md` の 2026-11-07 更新分（R9〜R14・R4 の追記・UC-8〜10・Test List）。取り込み方は仕様の「決着済み（2026-11-07）」に書く。

## Critical

- **C1 [R4 × R9・R10] グループの名前が素材をまたいでそろわない**。R4 本文は「グループ名は `<素材の kind>:<グループ>`」、実装（`train_l0.py` の `Item.group`）も接頭辞を付ける。このままだと自分の映像は `self:self:<drive>`、S データは `synth:self:<drive>` になり、同じ走行でも名前が違うので R4 が止めない。例: `use = "eval"` の self の素材に train の走行 D があり、S データが D の背景から作られている → R10 の確認（footage の `drives` の分割が train か）は通り、R4 だけが頼りだが効かない。直し方: self と synth は接頭辞を付けず、manifest の `group`（R10 は引き当てた `self:<drive>`）をそのまま使う。LEAK-1a に「R10 は通るが R4 でだけ止まる例」と「同じ走行が 2 つの self の素材に分かれて train と test に入る例」を足す。

## Warning

- **W1 [R12] 台帳の誤りが黙って通る道**: (a) track のキーの間に `deer = false` のフレームがあるとき、(b) mark の `frames`・track・mark の `video` が manifest に無いとき（特に鹿なしに付けた `ignore` の打ち間違い）、(c) 「1920×1080 の画素」と「動画の `size` で割る」の二重定義、(d) 同じ動画の中の track の `id` の重複。
- **W2 [R12・R10] モザイクの下や背景の実鹿が負例になる**: 鹿が全部モザイクの下にいると `empty` になり train の負例・誤報の分母に入る。R10 は背景の行の `uses` に `synth_background` があるか、台帳で `ignore` でないかを確かめていない。
- **W3 [R13] 後処理の流し方と連続した誤報の数え方**: 後処理は検出器の出力に 1 回だけ流してから閾値を当てるのか、閾値ごとか。`region_scaled` の後に閾値。`L0FilterConfig()` の既定は `ignore_regions = ()` で規則 a だけになることと設定値を JSON に残す。「予測が 2 つ以上続く」の意味（予測のあるサンプルが 2 枚以上続く）。間隔の単位（秒）、クリップごとの合計、`ignore`・`empty` を分母に入れるか。
- **W4 [R14] 比較の条件が学習側しかそろえていない**: 重みの形式、閾値、後処理の設定、評価の重みの SHA が model card と同じこと、`.pt` の推論の conf・iou。`--allow-by-sa-base` の元の重みは評価側の BY-SA を学習に含む。seed 2 つの差がばらつきより小さいときに「良くなった」と書かない規則。
- **W5 [R14・Deferred] 「暫定」の条件**: テストの走行があっても鹿の箱が 0（`blurred`・`ignore`）なら暫定のまま。テストの走行が night-1/2 と同じ道路なら、mix は同じ道の景色を背景で覚えている（報告に 1 行書くか）。
- **W6 [R11 × R5] 個人情報を列挙で止めている**: Mapillary の元の名前（`<image_id>.jpg`）から公開 API で緯度経度・撮影時刻・撮影者が引ける。`attribution`・`sequence`・月・`camera_type` が未定。salt の無い撮影者のハッシュは 39 人の公開名から戻せる。許可リストにする。R9 の「写さない」のテストが無い。（`dataset/out/` は gitignore 済みなので Warning）

## Info

- **I1 Test List と R の対応漏れ**: 別の kind に `labels`・`negative_every`・`footage` を書いたとき、`negative_every` の 0・負・小数・真偽値、self の `license` が self 以外、`labels` が外・リンク、Mapillary を `CC-BY` と書いたとき、`x1 ≥ x2`・`[meta]` の欠け、compare の JSON が既にあるとき、評価の JSON の run が arm の run、台帳の自由記述に地名・路線名・距離標を書かない決まり。

## 問題なし

SHA-256 の画像単位の検査、S データを train だけに置くこと、背景のグループを背景の SHA から引くこと、`footage_manifest_sha256` の違いを notes に回すこと、鹿ありのフレームの付け忘れをエラーにすること、同じ一覧・同じ seed から 2 つの run を作り val と評価側が同じことを確かめること。
