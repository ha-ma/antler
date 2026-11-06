---
feature: edge-l1-calibration
target_paths:
  - dataset/export_l1_labels.py
  - dataset/pyproject.toml
  - dataset/local_ci_checks.toml
  - dataset/tests/
  - edge/detector/src/detector/l1/calibrate.py
  - edge/detector/tests/test_l1_calibrate.py
  - edge/detector/tests/l1_synth.py
spec_confirmed_at: c527e94
tier: 2
---

# 仕様: edge-l1-calibration（L1 の校正: A のシミュレーションのログ → 正解付き JudgeRequest、質問ごとの温度スケーリング）

**dataset-train（2026-11-06）での変更**: `dataset/pyproject.toml` のカバレッジと isort に `train_l0` を足し、`dataset/tests/` に `test_train_l0.py` を足した（`docs/specs/dataset-train/functional.md`）。この feature の挙動は変わらない。

## 概要

B の判断を 3 層にする変更指示の Step 4（B2-7、SHOULD）。L1（local-jev ＋ Qwen2.5-1.5B）の確率は校正されていないので、edge-l1 は `calibration.json` が無いあいだ降格しない。
この feature はその `calibration.json` を作る道具を足す:

1. `dataset/export_l1_labels.py` — A のシミュレーションのトレース（1 物体の 0.1 秒ごとの位置）から、edge が実行時に送るのと同じ形・同じ場面の `JudgeRequest` と、4 問の正解ラベルを作る。sim はまだトレースを書き出さないので、sim の鹿の 5 パターンの定数を写したシード付きの合成トレースも作れる
2. `edge/detector/src/detector/l1/calibrate.py` — L1 の生の確率と正解から、質問ごとの温度 T を NLL 最小で学び、検証用のデータで「本物の危険な鹿を降格しない」ことを確かめてから、edge-l1 の読み込み側（`load_calibration`）と同じ形の `calibration.json` を書く。当て方は edge-l1 の `Calibration` をそのまま使う

**実機の L1 の生の確率はまだ無い**（Step 0・6、ユーザーの Mac mini 作業）。この feature の正しさは (a) 書いたファイルを読み込み側が同じ温度で読める (b) 合成の過信した確率から温度を取り戻し、ECE が下がる (c) ラベル付きの問い合わせが `JudgeRequest` に通り、実行時と同じ場面から選ばれる、の 3 点で示す。
**合成データで学んだ温度は実機に置かない**（`source=synthetic` の答えからは、`--allow-synthetic` を付けないかぎり書かない）。

要件: `docs/changes/2026-11-03-b-l1-local-jev.md`（原本が直るまでこちらが正）§3.1 B2-7・B2-9、§3.2、§4 Step 4。
契約: docs/specs/edge-l1 R2（車の状態の固定値・赤の候補について聞く）・R4（`calibration.json` の形と当て方）・R5（降格の結論）、docs/specs/schema-judge（`JudgeRequest`・`Capture.l1Probs`）、docs/specs/edge-l0（トラッカーの窓・`track_points`・TTC・`pos`）、docs/specs/drive-3d R5・R6（鹿の 5 パターン・検知の距離と画角）。
敵対レビュー: `docs/reports/2026-11-03-spec-adversary-edge-l1-calibration.md`（C1〜C3・W1〜W4 を取り込んだ）。

**範囲外**: 実機での生の確率の収集と学習（`bench_l1.py`、Step 0・6）、sim のトレースの書き出し（sim は編集しない）、`Capture.l1Probs` の保存（edge-capture）、選択肢の説明文、L2。

**Tier 2 の根拠**: 永続化する形を 2 つ足す（ラベルと答えの JSONL・`calibration.json` を書く側）。`calibration.json` の温度は「L1 で赤を下げてよいか」（B2-5）を決める入力なので、壊れた・偏ったデータから緩い温度を書く経路が安全に効く。認可・外部副作用（ネットワーク）・並行性は足さない。

## 依存

- 新しい依存は足さない。`numpy`（detector の既存の依存）と標準ライブラリだけ。torch・scipy は使わない（温度は 1 変数の凸最適化なので黄金分割探索で足りる）
- dataset のスクリプトは `detector`（`pip install -e "edge/detector[dev]"`、CI が入れる）から `build_request`・`VehicleContext`・`L1Target`・`TrackerConfig`・`JudgeConfig`・`L1Config`・トラッカーの定数を import して、edge と同じ組み立てと既定値を使う

## Example Map

Story: B の開発者として、A のシミュレーションで正解の分かる場面をたくさん作り、L1 の確率が「0.9 と言ったら 9 割当たる」ように質問ごとの温度を学びたい。
学んだ温度は edge-l1 がそのまま読める形で書き、壊れた・偏ったデータや、本物の危険な鹿を降格してしまう温度は書かない。

- R1: sim のトレース（入力の形。sim が書き出すまでの約束）
  - JSONL。1 行 = 1 物体の 1 場面: `{"format": "antler-sim-trace", "version": 1, "id", "source": "sim" | "synthetic", "seed", "light", "weather", "zone", "object": {"kind", "pattern"}, "ticks": [...]}`
  - `light` は `dawn|day|dusk|night`（sim の LightPeriod と JudgeRequest の Light が同じ）、`weather` は `clear|cloudy|snow|fog`、`zone` は `inside|outside`
  - `object.kind` は `deer | sign | post | snow`。`pattern` は鹿のとき `roadside|eyeshine|crossing|herd|frozen`（sim の DeerPattern）、鹿でないとき `null`
  - `ticks` は 0.1 秒ごと（sim の DETECT_TICK_MS）: `{"t": ms, "carS", "carD", "carSpeed": m/s, "objS", "objD", "occluded": bool, "pose": "idle|walk|run|look" | null, "conf"?: 0〜1}`。座標は sim の道の座標（s 前・d 右、m）。緯度経度・端末識別子は持たない
  - 読み込みの検証: 形式名・版・語彙・有限の数・`t` の狭義の昇順・1 tick 以上・`id` の重複なし。1 行でも違えば**ファイル全体を拒否**し、行番号と欄の名前を出す（学習データを黙って欠けさせない。推奨で決定）
- R2: 合成トレース（sim が書き出すまでの代わり）
  - `--synthetic --seed N`。乱数は `numpy.random.default_rng(seed)` だけ。同じシード・同じ引数で同じバイト列
  - 鹿は sim の定数を写した簡略な運動（まっすぐな道、車は場面ごとに一定の速さ 30〜80 km/h でブレーキをかけない、車線の中央 `d = -1.75`）。パターンの割合は sim の PATTERN_WEIGHTS（roadside 0.3 / eyeshine 0.2 / crossing 0.25 / herd 0.15 / frozen 0.1）。出る位置・動き出す距離（80〜100 m）・渡る速さ（2.6〜4.6 m/s、0.6 秒で最高速）・群れの遅れ（1 頭 1 秒）・立ちすくみの位置（車線の中央）は deer-motion.ts の値
  - eyeshine は sim と同じく林の中で遮蔽されるので、見える点が無く捨てられる（学習データのパターンの割合は sim と変わる）
  - 鹿でない物（看板・杭・雪）は sim に無いので合成する: 路肩に静止（看板 4〜7 m・杭 3.5〜5 m・雪 2.5〜6 m、左右は半々）。全体の 25%（推奨で決定。実行時の赤の候補に占める誤検知の割合は不明なので Deferred）
  - 光は day 0.3 / dawn 0.1 / dusk 0.2 / night 0.4（夜と薄暮が多い衝突の時間帯に寄せる。推奨で決定）
  - トレースの `source` は `synthetic`。sim の物理の写しではなく、形と分布を真似たもの（sim を正とする）
- R3: 問い合わせの場面（edge-l1 R2・edge-l0 のトラッカーと同じ）
  - 見える tick: 遮蔽なし・カメラ（車の中心から前 1.2 m）より前・距離 120 m 以内・画角 ±35°（TrackerConfig の hfov_deg 70 の半分）以内（sim の cameraSees と同じ）
  - `conf`: トレースに `conf` があればそれ。無ければ（sim は確信度を持たない）物の種類・光・距離から決める式＋シード付きの揺らぎ（鹿は 0.88 基準、鹿でない物は 0.82 基準、夜 −0.04、距離 120 m で −0.10 の比例、σ 0.04、0.40〜0.99 に収める）。推奨で決定（実値は Deferred）
  - **赤の候補の tick** = 見える かつ `conf ≥ JudgeConfig().threshold`（0.8）。L0 の赤は候補の tick が 2 つ続いたところで始まる（B2-3）
  - **問い合わせの時刻の集合** = 赤の始まりの tick と、そこから `1 / L1Config().rate_hz`（0.4 秒）ごとの tick のうち、赤の候補であるもの。実行時に L1 が聞かれるのは赤の候補だけなので、その集合から `tq` をシード付きで一様に 1 つ選ぶ（1 トレース 1 件。`--per-trace` で増やせる）。集合が空のトレースは捨てて数える
  - track = edge-l0 のトラッカーと同じ: 見える tick を古い順につなぎ、間が `max_age_s`（1.0 秒）を超えたら新しいトラック。`tq` のトラックのうち `tq − window_s`（1.0 秒）以降の点、64 点（MAX_POINTS）まで。各点 `t = (tick.t − tq) / 1000`（0 以下、昇順）・`conf`・`distanceM`・`lateralMps`・`side`・`pos`
  - `lateral = objD − carD`（右が正）。`side` = `lateral < 0` なら L（sim の cameraSees と同じ）。`pos` = `|lateral| ≤ lane_half_width_m`（1.75）なら `lane`、それ以外 `shoulder`。`distanceM` = カメラから物までの直線距離
  - `lateralMps` と `ttcSec` は edge-l0 のトラッカーと同じ式: 窓の最初の点からの横の変化 ÷ 時間（L なら右向き、R なら左向きが正 = 進路へ近づく）、`ttc = 距離 ÷ 接近の速さ`（時間差 0.2 秒未満・接近 0.5 m/s 以下は null）。定数は `detector.l0.tracker` から import する
- R4: 問い合わせ（edge-l1 R2 と同じ組み立て）
  - `detector.l1.request.build_request` に通す（`JUDGE_QUESTIONS` の 4 問、pydantic の `JudgeRequest` の検証つき）。`model` は `--model`（既定は `L1Config().model` = `jev-latest`）
  - 車の状態は既定で `VehicleContext()` の固定値（60 km/h・inside・night・low）。edge が実行時に送る値と同じにしないと、学んだ温度が実行時の分布とずれる（edge-l1 R2「校正の学習でも同じ固定値」）。`--context actual` で sim の実値（速さ・光・ゾーン、ヘッドライトは day なら off、それ以外 low）を入れられる（固定値との差を測るため）
  - `recentAlerts30s` はシード付きで 1〜3（1: 0.6 / 2: 0.25 / 3: 0.15。聞かれるのは赤のあいだなので 1 以上）
- R5: 正解ラベル（`tq` の真の位置と、その先 6 秒の動きから機械的に）
  - `in_lane` = `|objD − carD| ≤ 1.75`。`toward` = 車線へ近づく横の速さ（`tq` の前の tick との差。m/s）。`enters` = `tq` から 6 秒以内（トレースの時刻）で、車が物を追い越す前に `in_lane` になる tick がある（**先読み**。動き出す前の横断・待っている群れ・出始めの立ちすくみを「静止」と教えない。spec-adversary C1）
  - `false_positive` = 鹿でない
  - `on_roadway` = 鹿 かつ（`in_lane` または `toward ≥ 0.5` または `enters`）
  - `static_shoulder` = 鹿 かつ `in_lane` でない かつ 横の速さの絶対値 < 0.3 m/s かつ `enters` でない
  - `alert_level` = `danger`: 鹿 かつ（`in_lane` または `enters`）かつ 前方の道のり ÷ **問い合わせの速さ**（`speedKmh`。既定の固定値なら 60 km/h）≤ 6 秒。それ以外は問い合わせの `zone` が `inside` なら `zone`、`outside` なら `none`
  - 既定（固定の車の状態）では `zone = inside` なので **`none` のラベルは出ない**（alert_level の正解は zone と danger の 2 つ）。温度は 3 つの選択肢の softmax にかけるので学習はできる。none の過信は評価で数える（R9）
  - 閾値（0.5 m/s・0.3 m/s・6 秒）は推奨で決定: 6 秒は 60 km/h で 100 m（sim の動き出す距離 80〜100 m と、雪道の制動距離に余裕を足した長さ）
- R6: ラベルの出力
  - JSONL。1 行 = `{"id", "request": JudgeRequest（by_alias の JSON）, "labels": {"alert_level": "zone", "on_roadway": bool, "static_shoulder": bool, "false_positive": bool}, "meta": {"traceId", "source", "kind", "pattern", "light", "zone", "speedKmh", "context": "fixed" | "actual"}}`
  - 合成の既定は **問い合わせ 240 件**（捨てたトレースを除いた数。1 問あたり 240 件で目標の 100〜300 の中）。終わりに件数（全体・別々のトレースの数・問ごと・クラスごと・捨てたトレースの数）を JSON で標準出力に出す
  - 別々のトレースの数が `--min-per-question`（既定 100）未満なら書かずに exit 1（`--per-trace` で水増ししない。spec-adversary W3）。出力先は `--out` で必ず指定する（既定のパスを持たない）。親ディレクトリが無ければ作らない
- R7: 学習（B2-7）
  - 入力（答えのファイル）: JSONL。1 行 = `{"id", "model", "probs": Capture.l1Probs と同じ形, "labels": R6 と同じ形, "meta": {"traceId", "source", ...R6 の meta}}`。`model` は L1 が実際に答えたモデル名（local-jev の応答の `model`）。ラベルの行に `model` と `probs` を足したもの（足す道具は Deferred の bench_l1.py）
  - 検証: 4 問の確率は有限の 0〜1、alert_level は none・zone・danger の 3 つ、ラベルの型と語彙、`meta.traceId`・`meta.source` がある、`id` の重複なし。1 行でも違えば全体を拒否（行番号つき）
  - 全行の `model` が同じで、空でなく、前後に空白が無く、別名（`MODEL_ALIASES`）でない。違えば書かない（edge-l1 R4: 実体のモデル名だけが校正の相手）
  - `source` は許可リスト: `sim` だけ（`--allow-synthetic` のときだけ `synthetic` も）。表記ゆれ（`Synthetic`・`synth`）や不明な値は書かない（code-reviewer C3）
  - `synthetic` を含む答えから書くときは、モデル名を `synthetic:<答えのモデル名>` にする。実行時の答えのモデル名と一致しないので、手違いで実機に置いても当たらない（合成で学んだ温度で本物の赤が下がらない。spec-adversary W3、edge-latency-reviewer W2）
  - **学習用と検証用に分ける**: `sha256(traceId)` の先頭 8 桁 ÷ 2^32 < `--holdout`（既定 0.3）のトレースを検証用（乱数を使わず、同じトレースは必ず同じ側。spec-adversary C3）。温度は学習用だけで学ぶ
  - 問ごとに β = 1/T を `[1/20, 1/0.05]`（読み込み側の範囲）で、NLL を最小にする（log β の黄金分割探索、120 回。NLL は β について凸）。確率は `Calibration` と同じく 1e-6〜1−1e-6 に切り詰める
  - 学びの式は `Calibration.noul`・`Calibration.choice` と同じ（noul は `sigmoid(logit(p)/T)`、choice は `softmax(log(p_i)/T)`）。テストで `Calibration.apply` と突き合わせる
  - **書かない条件**（推奨で決定）:
    1. 学習用の別々のトレースが `--min-samples`（既定 100。100 より下げられない）未満、または検証用が 30 未満
    2. 学習用で noul の正か負が 10 件未満、alert_level で 10 件以上あるクラスが 2 つ未満。**学習用・検証用それぞれで正解 danger の別々のトレースが 10 未満**（4 の「降格 0 件」が空振りで通らないように。code-reviewer C2・edge-latency-reviewer C1）
    3. 学んだ T が 0.25 未満（生の 0.63 が校正後 0.9 になるほど鋭くする。分離できるデータでは T が下限へ張り付く。1.5B の LLM をそこまで鋭くする根拠は合成・シミュレーションのデータからは出ない。spec-adversary W1）
    4. **検証用で、正解が `danger` の答えを降格する**（校正後の false_positive ≥ 0.9、または alert_level の最大が none か zone で ≥ 0.9。edge-l1 R5 の結論 `fusion.conclude` をそのまま使う。条件 4 の車線の判定は数えず厳しい側に倒す）ものが 1 件でもある
    - 降格の誤りは「正解が danger の答えの降格」だけなので、4 は「検証用の降格の精度 1.0」と同じで、敵対レビューの案（精度 0.9 以上）より厳しい。精度と Wilson の下限、danger の件数と「danger を降格する割合」の Wilson の上限は要約に出す。降格が 0 件の校正は書く（降格しない校正は安全側）
  - 4 の閾値は、実行時に選べるいちばん低い `override_conf`（0.9）に固定する。`fit` には閾値を変える引数を持たない（上げると判定が甘くなる。code-reviewer C1）。`min_samples`・`holdout` の範囲はライブラリの口（`calibrate()`）でも検査する
  - T が上限 20 に張り付くのは書く（確率を 0.5 に寄せる向きで、降格を減らす。安全側）。ただし `l1.calibrate.bound` を残す
- R8: 書き出し
  - `{"version": 1, "model": <答えのモデル名>, "temperatures": {4 問: T}}` の 3 キーだけ。T は 6 桁に丸めて有限の 0.05〜20
  - 書き先と同じディレクトリの一時ファイルに書き、`load_calibration` で読み戻して同じ温度・同じモデルであることを確かめてから `os.replace` で置き換える（失敗したら前のファイルを残し、一時ファイルを消す）
  - ECE・NLL・降格の精度の前後を `--report`（任意）に JSON で書き、要約を標準出力に出す。報告は `calibration.json` より先に書く（報告が書けなければ校正も置き換えない）
- R9: 評価
  - ECE: 10 等幅 bin、上位ラベル（noul は `max(q, 1−q)` と「0.5 以上を正と言って当たったか」、choice は最大の確率と「最大が正解か」）
  - 降格の指標（`evaluate` は `--override-conf`、0.9〜1、既定 0.9。`fit` の検証は 0.9 固定）: 降格した件数・その精度（正解が danger でない割合）と Wilson の 95% 下限・**正解が danger の答えを降格した件数**（全体と pattern 別）・alert_level の none が ≥ 0.9 になった件数（none は正解に出ないので過信を別に数える。spec-adversary W2）
  - `evaluate` サブコマンド: 答えのファイルと `calibration.json` から、校正なし・校正ありの指標を出す（分割しない）
- R10: 実行の口と CI
  - `python dataset/export_l1_labels.py --synthetic --seed 7 --out ...`、`python -m detector.l1.calibrate fit ANSWERS --out calibration.json`、`python -m detector.l1.calibrate evaluate ANSWERS --calibration calibration.json`
  - 入力の誤りは exit 2（理由と行番号を標準エラー）、件数・偏り・検証で書かないときは exit 1、成功は exit 0
  - `print` を使わない（ruff T20）。出力は `sys.stdout.write` と logging
  - dataset のテストができたので、`dataset/local_ci_checks.toml` の `required = false`・`ci = false` を消し、ruff を足す。`.claude/sfad.json` の test_command に dataset の pytest を足す（CLAUDE.md の「学習スクリプトの cycle でテストができたら消す」。推奨で決定）
  - 生成物（`dataset/out/`・`edge/detector/calibration.json`）は git に入れない。テストは `tmp_path` だけに書き、既定の置き場所に触れない

Questions は全問、推奨で決定（メインセッションの指示。2026-11-03）。ch9 ④ は推奨（local-jev＋Qwen2.5-1.5B、L1 を赤の経路に入れない）を**仮採用**。ch9 ③ の「学習データ配布の可否確認」は要確認のまま（この feature は合成とシミュレーションのデータだけを扱い、実写・購入物を `dataset/` に入れない）。

## ユースケース

### UC-1: トレースを読む（R1）

- **Given**: sim のトレースの JSONL
- **When**: `load_traces`
- **Then**: 正しいものは読め、1 行でも違えば行番号つきで全体を拒否

### UC-2: 合成トレース（R2）

- **Given**: シード
- **When**: `synthetic_traces`
- **Then**: 同じシードで同じトレース、sim の 5 パターンと鹿でない物が R2 の割合で出る

### UC-3: 問い合わせの場面（R3・R4）

- **Given**: トレース
- **When**: `query_times`・`build_example`
- **Then**: 赤の候補の 0.4 秒ごとの時刻から選び、edge-l0 と同じ窓の track・TTC と、固定の車の状態の `JudgeRequest`

### UC-4: 正解ラベル（R5）

- **Given**: パターンごとの場面
- **When**: `label_at`
- **Then**: R5 の規則（先読みつき）どおりの 4 つのラベル

### UC-5: 出力（R6）

- **Given**: 合成 240 件
- **When**: CLI
- **Then**: JSONL と件数の要約。足りなければ書かない

### UC-6: 学習（R7）

- **Given**: 答えのファイル
- **When**: `fit_temperatures`・`calibrate`
- **Then**: 問ごとの T。書かない条件に当たれば理由つきで拒否

### UC-7: 書き出し（R8）

- **Given**: 学んだ温度
- **When**: `write_calibration`
- **Then**: 読み込み側が同じ値で読める。失敗しても前のファイルが残る

### UC-8: 評価（R9）

- **Given**: 答えと校正
- **When**: `evaluate`
- **Then**: ECE・NLL・降格の指標

## 状態パターン

### S-1: 校正の前提が崩れたデータ

- **Given**: 片方のクラスしか無い・分離できる・モデル名が別名・合成・危険な鹿を降格する → **Then**: `calibration.json` を書かない（edge-l1 は校正なしのまま降格しない）

### S-2: 既に `calibration.json` がある

- **Given**: 前の校正がある → **When**: 書き出しが途中で失敗 → **Then**: 前のファイルが残る

## Questions（Deferred のみ残存可）

決着済み（2026-11-03、spec-adversary の指摘を推奨で決定。PR にも書く）:

- 動き出す前の鹿を「静止」と教える（C1）→ 6 秒の先読み。danger は問い合わせの速さで割る
- 問い合わせの分布（C2）→ 赤の候補の 0.4 秒ごとの時刻から選び、トラッカーの窓（1 秒）と途切れ（1 秒）で track を切る
- 書いてよいかの判定（C3）→ トレース単位の検証用 3 割で、危険な鹿の降格 0 件（降格の精度 1.0 と同じ）。T は 0.25 以上
- 合成の温度を実機に置く（W3）→ `--allow-synthetic` なしでは書かない。件数は別々のトレースで数える

- [Deferred: 担当=人 A（sim のログの書き出し。sim は編集しない指示）/ 期日=2026-11-06 / 暫定挙動=合成トレース（R2）で学ぶ。形（R1）は決めたので、sim が同じ JSONL を書けば `--traces` でそのまま読める。合成の車はブレーキをかけないので、赤のあとに減速する track は sim のトレースで補う] sim が 0.1 秒ごとのトレースを書き出す（`drive-harness.ts` の頭なしの走行から 1 物体ずつ）
- [Deferred: 担当=人 A / 期日=2026-11-06 / 暫定挙動=確信度は R3 の式、鹿でない物（看板・杭・雪）は合成だけで全体の 25%] sim に検出の確信度と、鹿でない物を足す。実行時の赤の候補に占める誤検知の割合（調査走行で測る）
- [Deferred: 担当=人 B（`scripts/bench_l1.py` を書く。ラベルの request を local-jev に送り、`model`・`probs` を足した答えの JSONL と所要時間を書く）＋ユーザー（Mac mini 実機で回す、§4 Step 0・Step 6）/ 期日=2026-11-05 / 暫定挙動=`calibration.json` は置かない → edge-l1 は降格しない。合成で学んだ温度は `synthetic:` のモデル名なので置いても当たらない] 実機の L1 の生の確率の収集と学習。Step 6 で測るもの: L1 の p50/p95（`timeout_ms` 800 の内側か）、YOLO と併走したときの L0 の fps 低下（20% 以内、§6）、実機の答えでの `fit` の結果（書けたか・理由）、走行ログでの上書きの件数と正誤（edge-latency-reviewer W3）
- [Deferred: 担当=人 B（Step 6 の比較のあと）/ 期日=2026-11-07 / 暫定挙動=選択肢の説明文は足さない（質問を変えると凍結した schema と校正が両方変わる）] choice の選択肢の説明文（edge-l1 から持ち越し）
- [Deferred: 担当=人 B（PWA から速度・ゾーンを返す feature、未起票）/ 期日=2026-11-06 / 暫定挙動=固定値で学ぶ。`--context actual` で sim の実値の問い合わせも作れるので、Step 6 で固定値との差を測る] 車の状態の実値（edge-l1 から持ち越し）
- [Deferred: 担当=人 B（edge-capture、未起票）/ 期日=2026-11-06 / 暫定挙動=答えのファイルの `probs` を `Capture.l1Probs` と同じ形にしたので、Capture ができたらソフトラベルとして同じ値を残せる] Capture へのソフトラベル（B2-9）

## Test List（Canon TDD Step 1）

外側ループ（受け入れ。§4 Step 4）:

- [x] AC-1: 合成 240 件（seed 7）を書き出すと、全行の request が `JudgeRequest` に通り、車の状態が `VehicleContext()` の固定値、全行が赤の候補の場面（track の最後の点の conf ≥ 0.8、窓 1 秒）、1 問あたり 240 件（100〜300）、noul の 3 問は正と負が各 10 件以上、alert_level は zone と danger が各 10 件以上
- [x] AC-2: 合成の過信した答え（真の確率の logit を 2.5 倍、2,000 件、シード付き）で温度を学び、`calibration.json` を書くと、`load_calibration` が同じモデル・同じ温度で読み、各問の T が 2.5 ± 0.3、ECE が下がる
- [x] AC-3: 書き出したラベル → ラベルから作った偽の L1 の過信した答え（シード付きの雑音で、ときどき外す）→ `fit`（`--allow-synthetic`）→ 書き出し → edge-l1 の `load_calibration` が読め、検証用で正解 danger の降格が 0 件（danger は 10 件以上）。合成なのでモデル名は `synthetic:<答えのモデル>` で、`matches(答えのモデル)` は偽（実機では当たらない）

UC-1 トレース:

- [x] TR-1a: 正しいトレース（鹿・鹿でない物、`conf` あり・なし）が読める
- [x] TR-1b: 形式名・版の違い・語彙の外（kind・pattern・light・zone・pose）・NaN や無限大・`t` が昇順でない・tick が 0・欄の欠落・`id` の重複 → 行番号つきで全体を拒否

UC-2 合成トレース:

- [x] GEN-1a: 同じシードで同じトレース、違うシードで違うトレース
- [x] GEN-1b: 2,000 件で、鹿でない物が 25% 前後、鹿の 5 パターンが sim の割合の前後で出る。eyeshine は遮蔽されている
- [x] GEN-1c: 横断の鹿は動き出す距離の手前で静止し、そのあと反対側へ渡る。群れの 2 頭目は 1 秒ほど遅れる。立ちすくみは車線の中央で止まる

UC-3 問い合わせの場面:

- [x] TRK-1a: 遮蔽・カメラの後ろ・120 m 超・画角 35° 超の tick は点にならない
- [x] TRK-1b: 点の `t` は 0 以下の昇順、窓 1 秒（64 点まで）。`pos` は 1.75 m で lane / shoulder、`side` は左が L
- [x] TRK-1c: `lateralMps` は進路へ近づく向きが正（左右とも）。`ttcSec` は edge-l0 の式、近づかない・0.2 秒未満は null
- [x] TRK-1d: 問い合わせは `JudgeRequest` に通り、既定の車の状態は固定値、`--context actual` では sim の速さ・光・ゾーンとヘッドライト（day は off）
- [x] TRK-1e: 確信度はトレースの値があればそれ、無ければ式（0.40〜0.99、同じシードで同じ値）
- [x] TRK-1f: [ADDED adversary] 問い合わせの時刻は、赤の候補が 2 つ続いた tick と、そこから 0.4 秒ごとの赤の候補の tick だけ。conf 0.8 未満の tick・赤の候補が続かないトレースからは作らない
- [x] TRK-1g: [ADDED adversary] 1 秒以下の見えない間はトラックが続き、1 秒を超えると新しいトラックになる。窓の外の点は入らない

UC-4 正解ラベル:

- [x] LBL-1a: 鹿でない物 → false_positive、ほかは偽、alert_level は zone（ゾーン外の実値なら none）
- [x] LBL-1b: 路肩で静止した鹿（この先も車線に入らない）→ static_shoulder、on_roadway 偽、zone
- [x] LBL-1c: 車線へ渡ってくる鹿（前方 100 m 以内）→ on_roadway・danger。100 m より先 → on_roadway・zone
- [x] LBL-1d: 車線で立ちすくむ鹿 → on_roadway・danger、static_shoulder 偽（車線の中）
- [x] LBL-1e: 渡りきって車線から離れていく鹿 → on_roadway 偽、static_shoulder 偽（動いている）
- [x] LBL-1f: [ADDED adversary] 動き出す前の横断の鹿（路肩で静止、6 秒以内に車線へ入る）→ on_roadway・danger、static_shoulder 偽
- [x] LBL-1g: [ADDED adversary] 待っている群れの 2 頭目・出始めの立ちすくみ（横の速さ 0.5 m/s 未満）も、6 秒以内に車線へ入るなら on_roadway
- [x] LBL-1h: [ADDED adversary] danger の時間は問い合わせの速さ（固定の 60 km/h）で割る。トレースの車が 30 km/h でも、90 m 先なら danger

UC-5 出力:

- [x] OUT-1a: 行の形（id・request・labels・meta）と件数の要約（別々のトレース・問ごと・クラスごと・捨てたトレース）
- [x] OUT-1b: 別々のトレースの数が `--min-per-question` 未満 → 書かずに exit 1（`--per-trace` を増やしても件数にならない）。トレースの誤り → exit 2
- [x] OUT-1c: `--traces` で読んだトレースからも同じ形で書ける

UC-6 学習:

- [x] FIT-1a: noul・choice とも、過信（k = 2.5）と過小（k = 0.5）の答えから T ≈ k を取り戻し、NLL が下がる
- [x] FIT-1b: 学んだ T で `Calibration.apply` した NLL が、学習の NLL と一致する（式が読み込み側と同じ）
- [x] FIT-1c: 学習用の件数不足・検証用の件数不足・片クラス・alert_level のクラス不足 → 理由つきで書かない
- [x] FIT-1d: 分離できるデータ（T が 0.25 未満）→ 書かない。上限に張り付く → 書いて `l1.calibrate.bound` を残す
- [x] FIT-1e: モデル名の混在・空・前後の空白・別名（jev-latest）→ 書かない。`source=synthetic` → `--allow-synthetic` なしでは書かない。付ければ `synthetic:` のモデル名で書く。許可リストの外（`Synthetic`・`synth`・`local-jev`）は書かない
- [x] FIT-1f: 答えの行の誤り（確率の欠落・範囲外・NaN・選択肢の不足・ラベルの型違い・語彙の外・meta の欠落・id の重複）→ 行番号つきで全体を拒否
- [x] FIT-1g: [ADDED adversary] 構造的に間違う偽 L1（動き出す前の横断の鹿に false_positive 0.97）→ 検証用で危険な鹿を降格するので書かない
- [x] FIT-1h: [ADDED adversary] 学習用と検証用はトレースの id のハッシュで分かれ、同じトレースは必ず同じ側。温度は学習用だけで決まる
- [x] FIT-1i: [ADDED review] 検証用か学習用の正解 danger の別々のトレースが 10 未満 → 書かない（降格 0 件の空振りを防ぐ）
- [x] FIT-1j: [ADDED review] ライブラリの口（`calibrate()`）でも `min_samples` 100 未満・`holdout` の範囲外は ValueError。`fit` に `--override-conf` は無い（1.0 も拒否）

UC-7 書き出し:

- [x] WR-1a: 書いたファイルは version・model・temperatures の 3 つだけで、`load_calibration` が同じ値で読む
- [x] WR-1b: 書き出しの検証に失敗すると、前の `calibration.json` は残り、一時ファイルも残らない

UC-8 評価:

- [x] EV-1a: ECE は既知の値になる（全問正解・確信度 1 で 0、確信度 0.9 で正解率 0.5 なら 0.4）
- [x] EV-1b: 降格の指標: 降格した件数・精度・Wilson の下限・正解 danger を降格した件数（pattern 別）・none ≥ 0.9 の件数
- [x] EV-1c: `evaluate` が校正なし・校正ありの指標を出す

実行の口:

- [x] CLI-1a: `fit` と `evaluate` の exit（成功 0・書かない 1・入力の誤り 2）と標準出力の JSON の要約
- [x] CLI-1b: `export_l1_labels.py` の CLI が合成で書き、要約を出す

認可（threat.md の ❌ セル。[ADDED threat]）:

- [x] AUTH-1: 壊れたトレースからはラベルを 1 行も書かない（exit 2）
- [x] AUTH-2: 書かない条件に当たる答えからは `calibration.json` を書かない（前のファイルも変えない）
- [x] AUTH-3: `evaluate` は `calibration.json` を読むだけ（走らせた後も中身が変わらない）
- [x] AUTH-4: `source=synthetic` の答えは `--allow-synthetic` なしでは書かない
- [x] AUTH-5: `fit` の CLI にモデル名を渡す口が無い（`--model` は拒否）。書くモデル名は答えの `model`
- [x] AUTH-6: 温度の下限 0.25・範囲 0.05〜20 を CLI の引数で変えられない
- [x] AUTH-7: 学んだ T が 0.25 未満なら書かない
- [x] AUTH-8: 0.05〜20 の外の温度の `calibration.json` は読み込み側が拒否する（書く側の値は必ずその中）
- [x] AUTH-9: 答えの行の余分な項目（`temperatures`・`override_conf`・`model_override` など）で閾値・温度・モデル名は変わらない

状態パターン:

- [x] S-1: 校正の前提が崩れたデータでは書かない（FIT-1c〜FIT-1g で確かめる）
- [x] S-2: 書き出しの失敗で前のファイルが残る（WR-1b で確かめる）

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule         | 語彙                                   | 置き場所                                   | 証明 |
| ------------ | -------------------------------------- | ------------------------------------------ | ---- |
| R1: トレース | Trace / Tick / load_traces             | dataset/export_l1_labels.py                | UC-1 |
| R2: 合成     | synthetic_traces                       | dataset/export_l1_labels.py                | UC-2 |
| R3・R4: 場面 | query_times / track_at / build_example | dataset/export_l1_labels.py                | UC-3 |
| R5: ラベル   | label_at                               | dataset/export_l1_labels.py                | UC-4 |
| R6: 出力     | export / main                          | dataset/export_l1_labels.py                | UC-5 |
| R7: 学習     | fit_temperatures / calibrate / Sample  | edge/detector/src/detector/l1/calibrate.py | UC-6 |
| R8: 書き出し | write_calibration                      | edge/detector/src/detector/l1/calibrate.py | UC-7 |
| R9: 評価     | evaluate / ece / override_metrics      | edge/detector/src/detector/l1/calibrate.py | UC-8 |

## 非機能要件

- [x] 決定性: 乱数は `numpy.random.default_rng(seed)` だけ。同じシード・同じ引数で同じ出力（バイト列）。学習と検証の分割は乱数を使わない
- [x] 依存を足さない（numpy と標準ライブラリ）。240 件の書き出しと 2,000 件の学習がそれぞれ 2 秒以内（手元の計測で 0.16 秒・0.02 秒）
- [x] 個人情報を扱わない: トレースは道の座標（s・d）だけで、緯度経度・端末識別子を持たない
- [x] ruff と pytest のカバレッジ 70% 以上。既存の 367 件が Green のまま

## 受け入れ基準

- [x] 受け入れテスト AC-1・AC-2・AC-3 が Green
- [x] 全 UC / 全状態パターンのテストが Green、既存テストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（ruff check・ruff format、edge と dataset）
- [x] code-reviewer・edge-latency-reviewer の Critical 0（C1〜C3・C1 を直した。docs/reports/2026-11-03-{code-reviewer,edge-latency-reviewer}-edge-l1-calibration.md）
