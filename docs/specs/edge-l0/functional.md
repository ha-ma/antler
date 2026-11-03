---
feature: edge-l0
target_paths:
  - edge/detector/src/detector/l0/
  - edge/detector/src/detector/inference.py
  - edge/detector/src/detector/judge.py
  - edge/detector/src/detector/hub.py
  - edge/detector/src/detector/config.py
  - edge/detector/config.example.toml
  - edge/detector/tests/test_l0_acceptance.py
  - edge/detector/tests/test_l0_coreml.py
  - edge/detector/tests/test_l0_tracker.py
  - edge/detector/tests/test_l0_stage.py
  - edge/detector/tests/test_l0_config.py
tier: 1
---

# 仕様: edge-l0（L0: YOLO を Neural Engine に、トラッカー・距離・横速度・TTC、即時ルール）

## 概要

B の判断を 3 層（L0 YOLO / L1 ローカル jev 互換 / L2 任意）にする変更指示の Step 2。
L0 は「赤を鳴らす唯一の層」で、YOLO の推論・トラッカー・距離・横方向速度・TTC・即時ルール（2 フレームで赤、1.5 秒で解除）を、モデルに数値判断をさせない決定的なコードで持つ。
L1（edge-l1）はまだ無い。この feature は、L1 が無くても赤が従来どおり鳴ることを受け入れテストで固定し、L1 が使う材料（`TrackPoint` の形の track と `ttcSec`）を用意する。

要件: `docs/changes/2026-11-03-b-l1-local-jev.md`（原本が直るまでこちらが正）§3.1 B1-3・B2-2・B2-3・B2-6、§3.2、§3.4、§3.5、§4 Step 2。
ch4-edge.md B2-1・B2-4（2 フレーム・1.5 秒・距離表・左右）、ch6-nfr.md「B 遅延」「B 誤検知」、ch7-data.md（JudgeRequest の `track` と `ttcSec`。形は schema-judge で凍結済み）。
既存: docs/specs/edge-camera/functional.md（推論の差し込み口）、docs/specs/edge-judge/functional.md（判定・配信）。

**範囲外**（別 feature）: L1 のクライアント・4 問・fusion・`l1.overrode` の再送（edge-l1）、温度スケーリング（edge-l1-calibration）、L2（edge-l2、任意）、
`bench_l1.py` と Mac mini 実機での ANE fps 計測（Step 0・Step 6。ユーザーの実機作業）、起動の入口（CLI。edge-judge の Deferred のまま）、Capture の `l1Probs`（edge-capture / edge-l1）。

**Tier 1 の根拠**: 認可・永続化スキーマ・外部副作用（新しい待ち受けや送信）・並行性のどれも足さない。追加は同期の計算（トラッカー）と、推論モデルの読み込み設定だけ。配信と WebSocket は edge-judge のまま。

## Example Map

Story: B の検知システムとして、L1 や回線の有無に関係なく、YOLO が鹿を 2 フレーム見たら赤を鳴らし、L1 が判断に使う「距離・横の動き・衝突までの秒数」を決定的なコードで出したい。

- R1: CoreML の compute units（B1-3）
  - YOLO（CoreML）は既定で `cpu_and_ne`（CPU と Neural Engine。GPU は L1 の MLX に空ける）で読み込む
  - 設定 `[coreml] compute_units` で `cpu_only` / `cpu_and_gpu` / `cpu_and_ne` / `all` を選べる。それ以外の値・型違い → `ConfigError`（キー名つき）
  - 読み込みは coremltools の `MLModel(path, compute_units=ComputeUnit.<名前>)`。ローダは差し替えられる（テストは偽ローダで、渡った compute units を確かめる。実機の ANE fps は Step 0）
  - 設定ファイルは **TOML のまま**（指示書の `config.yaml` は、既存の `config.py` が TOML（tomllib・標準ライブラリ）なので `[coreml]` テーブルで満たす。pyyaml を足さない。推奨で決定）
- R2: YOLO の処理を `detector/l0/` に移す（§3.2）
  - `DeerDetector`・`ScriptedDetector` と CoreML のアダプタは `detector.l0` に置く。`detector.inference` は同じ名前を出し直すだけの互換の入口として残し、既存の import とテストを変えない
  - 置き場所は `edge/detector/src/detector/l0/`（指示書の `edge/detector/l0/` は、パッケージが `src/detector/` にあるため。推奨で決定）
  - CoreML の出力は Ultralytics の NMS 付きエクスポートの形（`confidence` N×クラス数、`coordinates` N×4 の正規化 xywh）を読み、クラス名はモデルのメタデータ `names` から取る（小文字にそろえる）。読めない・形が違う → その推論は例外（パイプラインが `infer.failed` にする。既存の失敗の扱い）
  - **`names` に `deer` が無いモデルは読み込み時に拒否する**（COCO には deer が無い。黙って全部捨てて永久に見逃さない。spec-adversary C2）
  - 座標の浮動小数の誤差（0〜1 をわずかに外れる値）は 0〜1 に切り詰める（画面端の鹿を「不正」で捨てない。NaN はそのまま渡し、`DeerDetector` が不正として捨てる）
  - 入力: パイプラインの 640×480・BGR の画像を RGB に並べ替え、モデルの入力の大きさに最近傍で引き伸ばして渡す（余白は足さない。引き伸ばしなので正規化座標は元の画面の座標のまま使える）
- R3: トラッカー（B2-2・B2-6）
  - 入力は「`[tracker] min_conf`（既定 0.4）以上・高さが正の deer」の検出。判定の閾値とは別に持つ（判定を 0.8 に上げても、L1 が 0.4〜0.8 の帯を見られるように）。推論失敗・全部不正のフレームでは何もしない（時刻も進めない）。鹿 0 件の正常なフレームは時刻を進める（トラックが古くなる）
  - IoU（既定 0.3 以上）で前のフレームのトラックと結ぶ。組は IoU の大きい順に貪欲に決め、同点はトラック ID の小さい順・検出の順で決める（同じ入力列で同じ ID。乱数を使わない）
  - 結ばれなかった検出は新しいトラック（ID は 1 から増える整数。作り直しても再利用しない）。最後に見てから `max_age_s`（既定 1.0 秒＝判定の「連続」の許容と同じ、`t_frame` の差）を超えたトラックは消し、ちょうどでは残す
  - `t_frame` の戻り: トラッカーが見た最新の `t_frame` 以下のフレーム（同時刻を含む）は、結び付けも履歴への追加もしない。1.0 秒より大きく戻ったら、トラックを全部消して（`l0.tracker_reset`）そのフレームから数え直す（壁時計が大きく戻って止まり続けない）
  - 履歴は直近 `window_s`（既定 1.0 秒）と 64 点まで（JudgeRequest の `track` の上限）。点の `t_frame` は狭義の昇順
- R4: 距離・横方向速度・TTC（B2-2・B2-6。数値はコードで出す）
  - 距離 m = 判定と同じ距離表の線形補間（丸めない小数）。**表より近い側（高さが表の最大を超える）は、表の端から反比例で外挿**（距離 = 端の距離 × 端の高さ ÷ 高さ。4 m より近い鹿でも距離が縮み、TTC が `null` にならない。spec-adversary C1）。表より遠い側は端の値で止める（遠い鹿の TTC は出なくてよい）。AlertFlag の `distanceM` は従来どおり表の端で止めた整数
  - 横位置 m = (中心 x − 0.5) × 2 × tan(水平画角/2) × 距離（ピンホール。水平画角 `hfov_deg` 既定 70°。実車の画角で測り直す）
  - 速度は履歴の最初の点との差で出す。差の時間が `MIN_SPAN_S`（0.2 秒。5 fps の 1 フレーム間隔）未満なら「測れない」（高さの揺れで極端な値を出さない）
  - 点ごとの `lateralMps` = （その点の横位置 − 最初の点の横位置）÷ 時間。**正は「車の進路（画面中央）へ近づく向き」**（その点の `side` が L なら右向きが正、R なら左向きが正。schema-judge が edge-l0 に預けた向きの決定。推奨で決定）。測れないとき 0.0。鹿が中央をまたいで進み続けると、またいだ後は「離れる」になり符号が負に変わる（`pos` は `lane` のまま。L1 は `pos` と合わせて読む）
  - TTC 秒 = 最新の距離 ÷ 接近速度（接近速度 = （最初の点の距離 − 最新の距離）÷ 時間）。接近速度が 0.5 m/s 以下（近づいていない）・測れない → `None`（JSON の `ttcSec: null`）
  - `pos` = 横位置の絶対値が `lane_half_width_m`（既定 1.75 m）以下なら `lane`、超えたら `shoulder`
  - L1 に渡す点の列は `TrackPoint` の形（`t` は最新を 0 とした 0 以下の秒、`conf`・`distanceM`・`lateralMps`・`side`・`pos`）で、`detector.schema` の pydantic モデルに通る。NaN・無限大は出さない
  - 主トラック: 最新の時刻に見えたトラックのうち、ボックスがいちばん高いもの（同じ高さなら確信度、さらに ID の小さい順）。最新の時刻に見えたトラックが無ければ、最後に見た時刻がいちばん新しいもの
- R5: L0 の即時ルール（B2-3）
  - 赤（`deer: true`）は L0 だけで決める: 閾値以上の鹿が 2 フレーム連続で ON、最後に見てから 1.5 秒で OFF、方向は 2 フレームで切り替え（edge-judge R1 の規則をそのまま `L0Stage` の中で使う）
  - 閾値の既定は **0.4 のまま**（ch6「誤検知より見逃しを抑える」と「L1 無しで赤が従来どおり」を守る）。指示書の「≥0.8」は旧 B2-3 の「0.8 以上は二次確認を待たない」の言い換えと読み、0.4〜0.8 の帯の扱い（L1 による降格）は edge-l1 の fusion で決める。閾値は `[judge] threshold` で 0.8 にも切り替えられる（推奨で決定。spec-adversary I7 は「ユーザーに確かめる問い」とした。PR に確認事項として書く）
  - 赤の送信経路（`AlertHub.on_result` → 判定 → 送信）は同期のまま。L1・L2 を await しない。`L0Stage.update` は判定を先に決め、続けて同じ呼び出しでトラッカーを更新してから返す（1 ms 未満）。送信はその後で、`flag.sent` には**同じフレームまで**のトラッカーの値が載る。トラッカーは判定の結果を変えない
  - トラッカーが例外を出しても判定と送信は止めない（`l0.tracker_failed` を warning で残し、トラッカーを作り直す。ID は続きから。ログは 1 秒に 1 回まで）
  - `flag.sent`（deer: true のとき）に、主トラックの `track_id`・`ttc_s`・`lateral_mps` を必ず足す。生きたトラックが無い（鹿が隠れてトラックが消えた）ときは 3 つとも `null`。deer: false には付けない（ログだけ。AlertFlag の形は変えない）
- R6: 設定
  - `[coreml] compute_units`（既定 `cpu_and_ne`）
  - `[tracker] min_conf`（既定 0.4、0〜1）・`iou_threshold`（既定 0.3、0.05〜0.95）・`max_age_s`（既定 1.0、0.1〜5）・`window_s`（既定 1.0、0.2〜5）・`hfov_deg`（既定 70、10〜170）・`lane_half_width_m`（既定 1.75、0.5〜5）
  - `[l1]`・`[l2]` は**今回は足さない**（読めても使われない設定は「L1 有効」に見えて嘘になる。edge-l1 の cycle で足す。推奨で決定）
  - 見本 `edge/detector/config.example.toml` に全セクションの既定値を書き、テストで読めることを確かめる

Questions は全問、推奨で決定（メインセッションの指示。2026-11-03）。ch9 ④ は推奨（local-jev＋Qwen2.5-1.5B、L1 を赤の経路に入れない）を仮採用中。保留は下の Deferred。

## ユースケース

### UC-1: compute units（R1）

- **Given**: `[coreml] compute_units` の設定と偽のローダ
- **When**: CoreML の検出器を作る
- **Then**: ローダに設定どおりの compute units が渡る。既定は `cpu_and_ne`

### UC-2: CoreML の出力の読み取り（R2）

- **Given**: NMS 付きエクスポートの形の出力（偽のモデル）
- **When**: `detect`
- **Then**: クラス名つきの `Detection` が返り、形の違う出力は例外

### UC-3: トラッカー（R3）

- **Given**: 検出の列
- **When**: `Tracker.update`
- **Then**: IoU で ID が続き、消えたトラックは `max_age_s` で消える。同じ入力で同じ ID

### UC-4: 距離・横速度・TTC（R4）

- **Given**: 近づく・横切る・止まっている鹿のトラック
- **When**: 指標を計算する
- **Then**: 距離・`lateralMps`（向きつき）・TTC（近づかなければ None）・`pos` が R4 のとおり

### UC-5: 即時ルール（R5）

- **Given**: `AlertHub`（L0 だけ）
- **When**: 鹿のフレームが入る
- **Then**: 2 フレーム目の `on_result` の中で同期に ON が送られ、トラッカーの値がログに残る

### UC-6: 設定（R6）

- **Given**: TOML
- **When**: `load_config`
- **Then**: 既定・指定・不正が R6 のとおり。見本の設定ファイルが読める

## 状態パターン

### S-1: L1 が無い

- **Given**: `detector.l1` が存在しない → **Then**: 赤は従来どおり鳴る（受け入れテスト）

### S-2: トラッカーが壊れた

- **Given**: トラッカーが例外 → **Then**: 判定と送信は続き、`l0.tracker_failed` が残る

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（Mac mini 実機、§4 Step 0）/ 期日=2026-11-05（Day 3）/ 暫定挙動=CoreML の読み込みと出力の名前（`confidence`・`coordinates`・メタデータ `names`）は Ultralytics の NMS 付きエクスポートを前提に書き、偽のモデルでだけ確かめた。実モデルでの ANE fps と出力の形は未計測。NMS に焼き込まれた `confidenceThreshold`（Ultralytics の既定 0.25）が `[tracker] min_conf`・`[judge] threshold` 以下であること、引き伸ばし（余白なし）での精度は実機で確かめる。精度が落ちるなら 640×480 の入力でエクスポートし直す] 実機での CoreML の確認
- [Deferred: 担当=人 B（edge-l1）/ 期日=2026-11-05（Day 3）/ 暫定挙動=閾値の既定は 0.4 のまま。0.4〜0.8 の帯を L1 で降格するかは fusion で決める] B2-3 の「≥0.8」と 0.4〜0.8 の帯
- [Deferred: 担当=人 B（edge-l1）/ 期日=2026-11-05（Day 3）/ 暫定挙動=`[l1]`・`[l2]` の設定は無い（書くと `ConfigError`）。L0 単独で動く] L1・L2 の設定。あわせて、指示書 §3.5 の L1 の `base_url` の既定 `127.0.0.1:8765` は WebSocket の既定ポート 8765 とぶつかる。edge-l1 で別ポートを決める
- [Deferred: 担当=人 B（Day 4 の調査走行）/ 期日=2026-11-06 / 暫定挙動=水平画角 70°・車線の半幅 1.75 m・接近の下限 0.5 m/s は暫定。距離表と同じく実車で測り直す] 画角と横位置の較正
- [Deferred: 担当=人 B（edge-l1）/ 期日=2026-11-05 / 暫定挙動=トラッカーの値は `flag.sent` のログに出すだけ。JudgeRequest の組み立て（`speedKmh`・`light` など車の状態を含む）は edge-l1] JudgeRequest への受け渡し

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] LAC-1: L1 が無い構成（`detector.l1` を import できない、設定に `[coreml]` がある）で、偽の推論の鹿 6 フレームを `pump` に流すと、本物の WebSocket クライアントが従来どおり ON（2 フレーム目の `t_frame`、距離・L/R つき、JSON Schema に通る）を受け、消えて 1.5 秒後に OFF を受ける。`flag.sent` に `ttc_s` が付く

UC-1 compute units:

- [x] CU-1a: 既定の設定で、ローダに `cpu_and_ne`（`ComputeUnit.CPU_AND_NE`）が渡る
- [x] CU-1b: `cpu_only`・`cpu_and_gpu`・`all` を選ぶとそれぞれが渡る
- [x] CU-1c: モデルのパスが空 → 分かる例外（`ConfigError`、キー名 `infer.model_path`）

UC-2 CoreML の出力:

- [x] CU-2a: `confidence`・`coordinates` からクラス名つきの検出を作る（各行の最大のクラス）
- [x] CU-2b: 行数が合わない・列が 4 でない・出力が無い → 例外（パイプラインが `infer.failed` に数える）
- [x] CU-2c: メタデータの `names`（`{0: 'deer'}` の文字列）を読む。読めないとき → 例外
- [x] CU-2d: [ADDED adversary] BGR の画像を RGB に並べ替え、モデルの入力の大きさに引き伸ばして渡す
- [x] CU-2e: [ADDED adversary] `names` に `deer` が無いモデルは読み込みで拒否。`Deer` は `deer` として読む。0〜1 をわずかに外れた座標は切り詰められて鹿として残る
- [x] MV-1: `detector.inference` から `DeerDetector`・`ScriptedDetector`・`Detection` が従来どおり import でき、`detector.l0` のものと同じ

UC-3 トラッカー:

- [x] TRK-1a: IoU 0.3 以上の検出は同じ ID を引き継ぎ、離れた検出は新しい ID
- [x] TRK-1b: 2 頭が近づいても、IoU の大きい組から結ぶ。同点はトラック ID の小さい順（同じ入力で同じ割り当て）
- [x] TRK-1c: 最後に見てから `max_age_s` を超えたトラックは消え、ちょうどでは残る
- [x] TRK-1d: 履歴は `window_s` と 64 点まで、`t_frame` の狭義の昇順
- [x] TRK-1e: `min_conf` 未満・高さ 0 の検出、推論失敗のフレームはトラッカーに入らない。鹿 0 件の正常なフレームは時刻を進める
- [x] TRK-1f: [ADDED adversary] 同時刻・少し戻ったフレームは結び付けも追加もしない
- [x] TRK-1g: [ADDED adversary] 1.0 秒より大きく戻ったらトラックを消して数え直す（`l0.tracker_reset`）。ID は再利用しない

UC-4 距離・横速度・TTC:

- [x] TRK-2a: 距離は距離表の補間の小数（整数に丸めない）。表より遠い側は端の値
- [x] TRK-2b: 左にいて右へ動く鹿の `lateralMps` は正、左へ離れる鹿は負。右にいる鹿は向きが逆
- [x] TRK-2c: 一定の速さで近づく鹿の TTC = 距離 ÷ 接近速度。止まっている・遠ざかる・点が 1 つ → None
- [x] TRK-2d: 横位置が 1.75 m 以下で `lane`、超えると `shoulder`
- [x] TRK-2e: 点の列が `detector.schema` の `TrackPoint` に通る（`t` は 0 以下、最新が 0、昇順、64 点まで）
- [x] TRK-2f: [ADDED adversary] 表の最大の高さ（4 m）を超えて近づく鹿も距離が縮み、TTC が数で出る
- [x] TRK-2g: [ADDED adversary] 中央をまたいで進む鹿は、またいだ後の `lateralMps` が負になり、`pos` は `lane` のまま
- [x] TRK-2h: [ADDED adversary] 最初の点から 0.2 秒未満では速度を出さない（`lateralMps` 0.0、TTC None）
- [x] TRK-2i: [ADDED adversary] 主トラックは最新の時刻のいちばん高いボックス（同じ高さは確信度、ID の順）。最新に見えていなければ最後に見たのが新しいもの

UC-5 即時ルール:

- [x] RULE-1a: 2 フレーム目の `on_result` の呼び出しの中で ON が送られる（`on_result` はコルーチンでない）
- [x] RULE-1b: トラッカーの有無で、判定の結果と送ったフラグの列が変わらない（同じ入力で比べる）
- [x] RULE-1c: トラッカーが例外を出しても ON・OFF は従来どおり送られ、`l0.tracker_failed` が残る
- [x] RULE-1d: `flag.sent`（deer: true）に `track_id`・`ttc_s`・`lateral_mps` が付く。deer: false には付かない
- [x] RULE-1e: 閾値の既定は 0.4（0.4 ちょうどの鹿 2 フレームで ON）。`threshold = 0.8` にすると 0.79 では ON にならない。そのときもトラッカーは 0.79 の鹿を追う
- [x] RULE-1f: [ADDED adversary] ON の `flag.sent` には、ON を決めたそのフレームまでのトラッカーの値が載る
- [x] RULE-1g: [ADDED adversary] 鹿が隠れて ON のままトラックが消えたら、ハートビートの `flag.sent` の 3 つは `null`
- [x] RULE-1h: [ADDED adversary] トラッカーの例外が続いても `l0.tracker_failed` は 1 秒に 1 回まで

UC-6 設定:

- [x] CFG-1a: 空の TOML で `coreml.compute_units = cpu_and_ne` とトラッカーの既定値
- [x] CFG-1b: 指定した値が読める
- [x] CFG-1c: `compute_units` が一覧の外・型違い、トラッカーの値が範囲外 → `ConfigError`（キー名つき）
- [x] CFG-1d: `[l1]`・`[l2]` は知らないセクションとして `ConfigError`
- [x] CFG-1e: `edge/detector/config.example.toml` が読め、既定値と一致する

状態パターン:

- [x] S-1: L1 が無い（LAC-1 と同じテストで確かめる）
- [x] S-2: トラッカーが壊れた（RULE-1c と同じテストで確かめる）

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule                      | 語彙                                  | 置き場所                                   | 証明 |
| ------------------------- | ------------------------------------- | ------------------------------------------ | ---- |
| R1: compute units         | CoreMLDetector / load_coreml_detector | edge/detector/src/detector/l0/coreml.py    | UC-1 |
| R2: YOLO の処理の置き場所 | DeerDetector / ScriptedDetector       | edge/detector/src/detector/l0/inference.py | UC-2 |
| R3: トラッカー            | Tracker / Track                       | edge/detector/src/detector/l0/tracker.py   | UC-3 |
| R4: 距離・横速度・TTC     | TrackMetrics / track_points           | edge/detector/src/detector/l0/tracker.py   | UC-4 |
| R5: 即時ルール            | L0Stage                               | edge/detector/src/detector/l0/stage.py     | UC-5 |
| R6: 設定                  | CoremlConfig / TrackerConfig          | edge/detector/src/detector/config.py       | UC-6 |

## 非機能要件

- [ ] 遅延: トラッカーの更新は 1 フレーム 1 ms 未満（検出 10 件まで。同期・numpy を使わない小さな計算）。赤の経路に await を足さない
- [ ] 決定性: 乱数を使わない。同じ入力列で同じ ID・同じ値
- [ ] ruff（T20・BLE・ANN・S など）と pytest のカバレッジ 70% 以上。既存の 180 件が Green のまま

## 受け入れ基準

- [ ] 受け入れテスト LAC-1 が Green
- [ ] 全 UC / 全状態パターンのテストが Green、既存テストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（ruff check・ruff format）
- [ ] edge-latency-reviewer と code-reviewer の Critical 0
