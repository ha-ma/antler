---
feature: edge-l1
target_paths:
  - edge/detector/src/detector/l1/
  - edge/detector/src/detector/fusion.py
  - edge/detector/src/detector/hub.py
  - edge/detector/src/detector/runner.py
  - edge/detector/src/detector/config.py
  - edge/detector/src/detector/l0/stage.py
  - edge/detector/config.example.toml
  - edge/detector/pyproject.toml
  - edge/detector/tests/test_l1_acceptance.py
  - edge/detector/tests/test_l1_questions.py
  - edge/detector/tests/test_l1_client.py
  - edge/detector/tests/test_l1_calibration.py
  - edge/detector/tests/l1_fakes.py
  - edge/detector/tests/test_l1_runner.py
  - edge/detector/tests/test_l1_config.py
  - edge/detector/tests/test_fusion.py
  - edge/detector/tests/test_l1_hub.py
  - edge/detector/tests/test_l1_authz.py
spec_confirmed_at: fdbc87c
tier: 2
---

# 仕様: edge-l1（L1: local-jev への 4 問、校正後 0.9 以上のときだけ降格する fusion）

**l0-fp-filter（2026-11-06）での変更**: L0 の検出に後処理（`[l0_filter]`）が入った。fusion の「赤の候補のトラックが 1 つだけ」の候補は後処理の後の検出から数える（無視する領域で弱めた枠は候補から外れる。領域は画面の端だけ・既定は空なので、既定では変わらない）。この仕様のコードと規則は変えていない（`docs/specs/l0-fp-filter/functional.md` R3）。

**edge-run（2026-11-06）での変更**: 起動の入口 `python -m detector` が `start_l1(config, hub, observer=capture.on_l1_answer)` を呼んで pump の background に渡す。`--no-l1` で `l1.enabled = false` に上書きできる。pyproject に実行用の extra `run` を足し、config.example.toml の `[infer]` にコメントを足した（`docs/specs/edge-run/functional.md`）。L1 の挙動は変わらない。

## 概要

B の判断を 3 層にする変更指示の Step 3。L1 は Mac mini 上の jev 互換サーバー（local-jev ＋ Qwen2.5-1.5B）に、L0 が決定的に出した状態を文字で渡し、
4 問（alert_level / on_roadway / static_shoulder / false_positive）を 1 リクエストで聞く。答えは**降格にだけ**使う: 校正後 confidence が 0.9 以上で、
`calibration.json` が読めているときに限り、L0 の赤を「赤でない」（`deer: false`。PWA は GPS で琥珀か緑を出す）に下げ、`AlertFlag.l1` を付けて再送する。
**赤は L0 だけで鳴らす。** 赤の送信経路に L1 の await を入れない。L1 が止まっても、遅くても、壊れた答えを返しても、L0 だけで動き続ける。

要件: `docs/changes/2026-11-03-b-l1-local-jev.md`（原本が直るまでこちらが正）§3.1 B2-4・B2-5・B2-6・B2-8、§3.2、§3.4、§3.5、§4 Step 3。
契約: docs/specs/schema-judge（`JudgeRequest`・`JUDGE_QUESTIONS`・`AlertFlag.l1`）。L0: docs/specs/edge-l0（`L0Stage`・トラッカー・`track_points`・TTC）。配信: docs/specs/edge-judge。

**範囲外**（別 feature）: 温度の学習（`l1/calibrate.py`・`dataset/export_l1_labels.py`。Step 4 edge-l1-calibration）、L2（Step 5、任意）、
`bench_l1.py` と Mac mini 実機での p50/p95（Step 0・6。ユーザーの実機作業）、`Capture.l1Probs` の保存（Capture を作る edge-capture が無い）、起動の入口（CLI。edge-judge の Deferred のまま）、PWA（`l1` は読まない）。

**Tier 2 の根拠**: 外部副作用（ローカルの HTTP サーバーへの `POST`）と並行性（検知と並んで動く非同期のタスク）を足す。永続化スキーマ・認可は足さない。

## 依存（実在と中身を 2026-11-03 に確かめた）

- `typesafe-sdk==0.7.5`（PyPI、MIT、github.com/typesafe-ai/typesafe-sdk-python）。wheel の中身を読み、`AsyncTypeSafeClient.system_one(state, questions, model=, timeout=)`・
  `RetryPolicy(max_retries=0)`・`transport=`（`httpx2.MockTransport` でテストできる）・`compression=False`・例外 `TypeSafeError` の系統を確かめた。
  依存の `httpx2` は pydantic の組織（BSD-3-Clause）。**入れる**: `pyproject.toml` の extra `l1` と `dev`（CI が `[dev]` を入れ、実物の SDK でテストする）
- `local-jev`（github.com/amithgc/local-jev、MIT、コミット `64a0b31ff343dca32142496cf9edca5a0174a18d`）。README で `POST /v1/systemone` の形（`questions` は名前をキーにした辞書、
  `instructions`、choice の `criteria`、答えは `answers.<名前>` に `noul` か `choice`・`probabilities`・`confidence`）と、既定のポート 8765 を確かめた。
  **detector の依存には入れない**（別プロセスのサーバー。torch とモデルの重みを引く）。Mac mini で `local-jev serve --model llm-qwen2.5-1.5b --port 8766` として別に動かす（Step 0）。コミットは `CREDITS.md` と config の見本に書く
- `mlx` とモデルの重みは入れない（local-jev の側が使う）

> 2026-11-06 pwa-https が `config.py` に `[tls]`・`[pwa_server]` のセクションを足した（`pyproject.toml` は pwa_server の E501 の除外だけ）。`[l1]` の読み方・既定値は変わらない。

## Example Map

Story: B の検知システムとして、L0 の赤を遅らせずに、看板・雪・杭の誤検知や路肩で止まっている鹿の赤を、校正済みの L1 が確信しているときだけ下げたい。
L1 が使えないときは、何も起きなかったように L0 だけで動き続けたい。

- R1: 4 問（B2-4）
  - 質問は `detector.schema.JUDGE_QUESTIONS`（schema-judge で凍結）を import する。`l1/` に質問文の文字列を書かない
  - SDK に渡す形へ写す: `{id: {"type": type, "instructions": text}}`、choice は `"criteria": {option: None, ...}`（選択肢の名前だけ。説明文は足さない。足すと校正が無効になるので Step 4 で決める。推奨で決定）。順序は `JUDGE_QUESTIONS` のまま
- R2: L1 に送る状態（B2-4・B2-6）
  - 聞く対象のトラック: L0 が赤のあいだは**赤の候補のトラック**（生きているトラックのうち、最後の点の確信度が `judge.threshold` 以上のもの）でいちばん高いボックス。赤でないときは主トラック（edge-l0 R4）。対象が無ければそのティックは送らない（`track` は 1 点以上が要る）。spec-adversary C1
  - `track` = 対象の `track_points`（64 点まで）、`ttcSec` = 対象の TTC（無ければ `null`）、`recentAlerts30s` = 直近 30 秒（単調時計）に L0 が赤になった回数（今のエピソードと、降格したエピソードも数える）
  - edge が知らない車の状態は、**降格に寄らない値**で固定する: `speedKmh = 60.0`（北海道の一般道の法定速度）、`zone = "inside"`、`light = "night"`、`headlight = "low"`（schema-judge の Deferred どおり）。推奨で決定（実値は docs/specs/pwa-uplink で回収した: PWA の `vehicle` が届き、校正が `context: "real"` か校正なしのときだけ実値で聞く。それ以外はこの固定値。校正の学習でも同じ固定値を使う）
  - `model` = 設定の `l1.model`（既定 `jev-latest`。local-jev が既定のモデルに割り当てる）
  - 送る前に pydantic の `JudgeRequest` に通す。通らない → 送らず `l1_unavailable`（`reason=invalid_request`）
  - 数値の判断（距離・TTC・左右・確信度）はモデルにさせない。AlertFlag の `conf`・`distanceM`・`side` は L0 の値のまま。L1 が変えられるのは「赤か、赤でないか」だけ
- R3: クライアント（B2-4）
  - `typesafe-sdk` の `AsyncTypeSafeClient` で `POST {base_url}/v1/systemone` に 4 問を 1 リクエストで送る
  - 接続先: 環境変数 `TYPESAFE_BASE_URL`（前後の空白を除いて空でなければ）、無ければ設定の `l1.base_url`。SDK の既定（`https://api.typesafe.ai`）には落とさない（`base_url` を必ず明示して渡す）
  - API キー: 環境変数 `TYPESAFE_API_KEY` があればそれ、無ければ `local`（SDK が必須にしている。local-jev は `LOCAL_JEV_API_KEY` が無ければ見ない）。キーはログに出さない
  - リトライしない（`RetryPolicy(max_retries=0)`）。タイムアウトは `l1.timeout_ms`（既定 800 ms）を SDK に渡し、さらに `asyncio.timeout` で同じ長さに上から抑える。圧縮しない（`compression=False`）
  - 答えの読み取り: 4 問すべてが揃い、alert_level は choice で `none`・`zone`・`danger` の 3 つの確率を持ち、3 問は noul。確率はすべて有限の 0〜1。欠落・型違い・範囲外 → `L1Unavailable`（`reason=bad_response`）
  - SDK が入っていない → 起動時に `l1_unavailable`（`reason=sdk_missing`）を 1 回残し、L1 を動かさない（L0 だけ）
  - SDK のロガー（`typesafe_sdk`）は warning 以上だけにする（本文をログに出さない）
- R4: 校正（B2-5 の前提。B2-7 のファイルの形をここで決める）
  - `calibration.json` = `{"version": 1, "model": "<答えたモデルの名前>", "temperatures": {"alert_level": T, "on_roadway": T, "static_shoulder": T, "false_positive": T}}`。T は有限の 0.05〜20
  - 置き場所は設定の `l1.calibration_path`（既定 `calibration.json`。相対パスは設定ファイルのあるディレクトリから）。起動時に 1 回読む
  - 無い・読めない・形が違う → 「校正なし」。`l1.calibration_unavailable`（`reason`）を 1 回残す。**校正なしでは上書きしない・L2 の候補にもしない・AlertFlag に `l1` を付けない**（`l1.conf` は校正後の値と決まっているため）。答えは `l1.result` のログにだけ残す
  - `calibration.json` の `model` は**実体のモデル名**（例 `llm-qwen2.5-1.5b`）。別名（`jev-latest`・`jev-preview`・`local-jev-latest`）は書けない（形が違う扱い）。local-jev の README は「応答の `model` は実際に答えたモデル」と書いている
  - 答えたモデル（応答の `model`）が `calibration.json` の `model` と違う・別名・空 → その答えは校正なしとして扱う（`l1.calibration_mismatch` を 1 秒に 1 回まで）。spec-adversary W3
  - 当て方: noul は `sigmoid(logit(p) / T)`、choice は `softmax(log(p_i) / T)`。p は 1e-6〜1−1e-6 に切り詰めてから使う
- R5: fusion（B2-5）
  - L1 の結論: 校正後の false_positive ≥ `override_conf` → 結論 `zone`・conf はその値・理由 `false_positive`。そうでなく alert_level の校正後の最大が `none` か `zone` で ≥ `override_conf` → 結論はその値・理由 `alert_level`。それ以外 → 結論は alert_level の校正後の最大・上書きしない
  - **上書き（降格）の条件をすべて満たすときだけ** 出力を `deer: false` にする:
    1. 校正あり、結論が上の 2 つの理由のどちらか
    2. L0 が今赤で、その答えの問い合わせが**今の赤のエピソードの中で**作られた
    3. 赤の候補のトラックが**ちょうど 1 つ**で、それが問い合わせたトラック（看板について聞いて鹿の赤を消さない。2 頭いたら降格しない。spec-adversary C1）
    4. 理由が `alert_level`（路肩で静止など）のときは、問い合わせたトラックの今の `pos` が `lane` でない（数値の判断はコード。車線上の鹿は L1 が何と言っても赤のまま。B2-6、spec-adversary C2。`false_positive` は「鹿でない」という意味の判断なので `pos` で止めない）
    5. 答えが新しい: 問い合わせの開始から `3 / rate_hz + timeout_ms`（既定 2.0 秒）以内（spec-adversary C2）
    6. 入力が止まっていない（`judge.stalled` のあいだは何も送らない。spec-adversary W1）
  - 条件は答えが届いたときだけでなく、`on_result` と `tick` のたびに確かめ直す（L0 の状態・トラック・時刻が変われば外れる）
  - 赤のエピソード = L0 が赤になってから赤が解けるまで。赤になるたびに番号が増える。**エピソードより前に作った問い合わせの答えでは降格しない**（既定の設定では赤は必ず一度は鳴る）
  - **L1 は上げない**: L0 が赤でないときに L1 が `danger` と言っても何もしない（on_roadway が高くても同じ）
  - 降格の解除: 次の答えが条件を満たさない（校正後 0.9 未満・`danger`）・L1 の失敗（`l1_unavailable`）・条件 3〜5 が外れる → すぐ赤に戻す（赤へ戻す向きは遅らせない）。赤に戻すフラグは今の L0 の `t_frame`・`conf`・`distanceM`・`side`
  - **反転の上限**: 降格を解いて赤に戻してから 1 秒は、再び降格しない（赤と琥珀の入れ替わりを 1 Hz 以下にする。AlertState.md の点滅の上限と同じ。spec-adversary C3）
  - L0 の赤が解けた → エピソードを閉じ、答えを捨てる
  - 0.5〜0.9（`l2_route_conf`）は L2 の候補として `l1.l2_candidate` をログに残す（L2 は未実装。`l2: "not_implemented"`）。0.5 未満はログだけ。どちらも校正ありのときだけ
  - 出力（deer）が変わったら、すぐ AlertFlag を再送する（`reason=l1`）。変わらない答えでは再送しない（次のハートビートが新しい `l1` を運ぶ）
  - `AlertFlag.l1 = {alert_level, conf, overrode, latencyMs}` を、今のエピソードの校正済みの答えがあるあいだ、そのエピソードのすべてのフラグ（変化・ハートビート・新しい接続への snapshot）に付ける。`alert_level`・`conf` は結論、`overrode` はそのフラグが降格されたか、`latencyMs` は問い合わせの所要時間（0.1 ms に丸める）
  - フラグの JSON は NaN・無限大を書かない（`allow_nan=False`。schema-judge R3 が edge に預けた責務）。`l1` の値は作る時点で有限の範囲に収める
- R6: 赤の経路（B2-3・B2-8）
  - L0 が赤になったら、その `on_result` の呼び出しの中で同期に送る（edge-l0 R5 のまま）。`wait_for_l1_before_red = false`（既定）では L1 の答えを待たない
  - `wait_for_l1_before_red = true`（B2-8、MAY）: L1 が直前の問い合わせに成功しているときだけ、赤を**最大 150 ms**（B2-8 の前提「L1 ≤150 ms」。`timeout_ms` とは別の固定の上限）保留し、L1 をすぐ起こす。保留中にこのエピソードの答えが来たら、それで決めた出力を送る。期限が来たら赤を送る（tick が送るので、tick の間隔 0.1 秒ぶん遅れうる。合計でも 250 ms 以下で、赤の 1,000 ms 未満に収まる）。L1 が失敗中・止まっている・無効なら保留しない。spec-adversary W2
  - この設定では、答えが降格なら最初の赤が鳴らないことがある（既定 false の理由）。保留のあいだの出力は保留前のもの（`deer: false`）のまま
  - 保留の前から問い合わせが飛んでいると、起こしても前の答えを待つ（同時 1 つまで）。そのときは期限の赤になる
- R7: 止まらないこと
  - L1 のタスクは、タイムアウト・接続できない・HTTP のエラー・壊れた答え・予期しない例外のどれでも死なない。`l1_unavailable`（`reason` と例外の型名）を 1 秒に 1 回までログに残し、次のティックでまた聞く。回復したら `l1.recovered` を 1 回
  - 問い合わせは同時に 1 つまで（前の答えか失敗を待ってから次。レートは問い合わせの開始から `1 / rate_hz` 秒ごと）
  - 失敗が続いたら間隔を延ばす: n 回続けて失敗したら次まで `min(2.0, (1 / rate_hz) × 2^n)` 秒（打ち切っても local-jev は計算を続けるので、詰めて送ると YOLO と GPU を奪い合う。spec-adversary I1）。成功で元に戻る
  - 赤になる前から飛んでいる問い合わせは取り消さない（サーバーは計算を続けるため）。その答えは降格に使わず、届いたらすぐ次を聞く（spec-adversary I2）
  - L1 のタスクはイベントループの上で動き、`AlertHub`・L0 の状態を触るのはループの上だけ。HTTP は非同期で、ループを塞がない
  - `detector.hub` と `detector.fusion` は `detector.l1` を import しない（L1 が無くても edge-l0 の LAC-1 が通る）。L1 を起動するのは `detector.l1.start_l1`（`pump(..., background=...)` に渡す）
- R8: 設定（§3.5。TOML のまま。edge-l0 で決めた）
  - `[l1]`: `enabled`（既定 true）・`base_url`（既定 `http://127.0.0.1:8766`。空は `ConfigError`）・`model`（既定 `jev-latest`。JudgeRequest の `model` と同じ字種）・`rate_hz`（既定 2.5、2〜3）・
    `timeout_ms`（既定 800、50〜800）・`override_conf`（既定 0.9、**0.9〜1**。B2-5 の MUST より下げられない）・`l2_route_conf`（既定 `[0.5, 0.9]`、0 ≤ 下 < 上 ≤ override_conf）・`wait_for_l1_before_red`（既定 false）・`calibration_path`（既定 `calibration.json`）
  - **ポート: L1 の既定は 8766**（指示書の 8765 は WebSocket の既定 8765 とぶつかる。edge-l0 の Deferred。WebSocket は動かさない。推奨で決定）。local-jev は `--port 8766` で起動するか、`TYPESAFE_BASE_URL` で向け先を変える
  - **接続先はループバックだけ**（`127.0.0.1`・`::1`・`localhost`、scheme は http か https）。環境変数で車外の URL（クラウドの Jev など）が残っていても送らない: `start_l1` が `l1_unavailable`（`reason=remote_not_allowed`）を残して L1 を動かさない（オフライン前提。spec-adversary W4。推奨で決定）。起動時に実際の接続先の scheme・host・port を `l1.endpoint` で 1 回残す（認証情報・パス以外は出さない）
  - `[l2]`: `enabled`（既定 `"auto"`、`"auto"` か `"off"`）。L2 は未実装で、今は誰も読まない（Step 5 で使う）
  - 組み合わせ: `tracker.min_conf` が `judge.threshold` より大きい → `ConfigError`（赤なのに主トラックが無く、L1 が聞けない。edge-l0 の Deferred を回収）
  - 見本 `config.example.toml` に `[l1]`・`[l2]` を書き、テストで読めることを確かめる
- R9: ログ（edge-latency-reviewer §6 が読む）
  - `l1.result`（答えごと）: `episode`・`track_id`・`latency_ms`・`model`・`alert_level`・`conf`・`conf_raw`・`calibrated`・`reason`・`route`（`override` / `l2_candidate` / `log` / `uncalibrated` / `no_episode`）・`overrode`
  - `l1_unavailable`: `reason`（`timeout` / `connect` / `http` / `bad_response` / `invalid_request` / `sdk_missing` / `error`）と `error_type`。本文・URL のキー・API キーを出さない
  - `flag.sent` に `l1`（AlertFlag と同じ 4 項目）を入れ子で足す（付けたフラグのときだけ）
  - ack の遅延の基準（`_ack_t_frame`）は**送った出力の deer** で決める（L0 の状態ではない。降格のあと赤に戻したときも、赤を出し直したフレームから測る。spec-adversary I3）
  - 状態（track など）と質問文はログに出さない（質問文は固定、状態は `l1.result` の要約だけ）

Questions は全問、推奨で決定（メインセッションの指示。2026-11-03）。ch9 ④ は推奨（local-jev＋Qwen2.5-1.5B、L1 を赤の経路に入れない）を**仮採用**。保留は下の Deferred。

## ユースケース

### UC-1: 4 問と状態（R1・R2）

- **Given**: 主トラックのある L0
- **When**: L1 に送る問い合わせを作る
- **Then**: `JudgeRequest` に通る状態と、`JUDGE_QUESTIONS` を写した 4 問ができる。主トラックが無ければ作らない

### UC-2: クライアント（R3）

- **Given**: local-jev の形で答えるサーバー（`httpx2.MockTransport`）
- **When**: `judge`
- **Then**: 1 回の `POST /v1/systemone` に 4 問が入り、答えが読める。壊れた答え・HTTP のエラー・タイムアウト・接続できない → `L1Unavailable`（理由つき）

### UC-3: 校正（R4）

- **Given**: `calibration.json` の有無・中身
- **When**: 読み込み、答えに当てる
- **Then**: 温度で確率が変わる。無い・壊れている・モデル違い → 校正なし

### UC-4: fusion（R5）

- **Given**: L0 の赤と L1 の答え
- **When**: 答えを当てる
- **Then**: R5 の条件をすべて満たすときだけ降格し、それ以外は L0 のまま。上げない

### UC-5: 配信（R5・R6）

- **Given**: `AlertHub` と fusion
- **When**: 赤・答え・失敗・赤の解除が起きる
- **Then**: 出力が変わったときに再送し、`l1` が R5 のとおり付く。赤は待たずに送る（保留の設定のときだけ最大 `timeout_ms` 待つ）

### UC-6: L1 のタスク（R7）

- **Given**: 偽のクライアント
- **When**: 成功・失敗・例外・遅延が続く
- **Then**: タスクは死なず、問い合わせは 1 つずつ、`l1_unavailable` は 1 秒に 1 回まで

### UC-7: 設定（R8）

- **Given**: TOML
- **When**: `load_config`
- **Then**: 既定・指定・不正が R8 のとおり。見本が読める

## 状態パターン

### S-1: L1 が止まっている

- **Given**: 接続先にサーバーがいない → **Then**: 赤は従来どおり鳴り、`l1_unavailable` が残る（受け入れ (a)）

### S-2: 校正が無い

- **Given**: `calibration.json` が無い → **Then**: 答えが false_positive 0.99 でも降格しない（受け入れ (b)）

### S-3: L1 が遅い

- **Given**: 答えが `timeout_ms` より遅い → **Then**: 打ち切って `l1_unavailable`（`timeout`）、L0 のまま

## Questions（Deferred のみ残存可）

決着済み（2026-11-03、spec-adversary の指摘を推奨で決定。PR にも書く）:

- 看板について聞いて鹿の赤を消す（C1）→ 赤のあいだは赤の候補について聞き、赤の候補がちょうど 1 つでそれが問い合わせたトラックのときだけ降格
- 車線上の鹿の降格（C2 の Question）→ 理由が alert_level のときは `pos = lane` で降格しない。false_positive は止めない
- 降格が切れない（C2）→ 開始から 2.0 秒で切れる。毎フレーム・毎 tick 確かめ直す
- 赤と琥珀の速い入れ替わり（C3）→ 赤に戻してから 1 秒は再び降格しない
- 保留の上限（W2）→ 150 ms 固定。接続先（W4）→ ループバックだけ。モデル名（W3）→ 実体の名前だけ

- [Deferred: 担当=ユーザー（Mac mini 実機、§4 Step 0・Step 6）/ 期日=2026-11-05（Day 3）/ 暫定挙動=local-jev の実物には繋いでいない。SDK の実物を `httpx2.MockTransport` 越しに使い、local-jev の README の応答の形で確かめた。Qwen2.5-1.5B の p50/p95、YOLO と併走したときの L0 の fps、答えの正しさは未計測] 実機での L1 の計測
- [Deferred: 担当=人 B（Step 4 edge-l1-calibration）/ 期日=2026-11-06 / 暫定挙動=`calibration.json` は無い → 上書きしない。形（version・model・temperatures）と当て方はこの feature で決めた。choice の選択肢の説明文は足していない（足すなら校正と同時）] 温度の学習と選択肢の説明文
- [Deferred: 担当=人 B（docs/specs/pwa-uplink が実装済み。残りは実値での温度の再学習）/ 期日=2026-11-06 / 暫定挙動=`calibration.json` が固定値で学習したもの（`context` が無い）のあいだは `speedKmh=60`・`zone=inside`・`light=night`・`headlight=low` の固定値で聞く（降格に寄らない値）。PWA の実値は校正が `context: "real"` か校正なしのときだけ使う] 車の状態の実値
- [Deferred: 担当=人 B（edge-capture、未起票）/ 期日=2026-11-06 / 暫定挙動=`Capture.l1Probs` は作らない。確率は `l1.result` のログにだけ残る] Capture へのソフトラベル（B2-9）
- [Deferred: 担当=人 B（Step 5 edge-l2、任意）/ 期日=2026-11-07 / 暫定挙動=0.5〜0.9 は `l1.l2_candidate` のログだけ。`[l2] enabled` は読むが使わない] L2
- [Deferred: 担当=人 B（Step 6 の比較実験のあと）/ 期日=2026-11-07 / 暫定挙動=TTC と横速度は edge-l0 のまま 2 点の差（平滑化しない）。L1 にはその値を渡す] TTC の平滑化（edge-l0 から持ち越し）
- [Deferred: 担当=人 B（起動の入口の feature。edge-judge の Deferred）/ 期日=2026-11-06 / 暫定挙動=`start_l1(config, hub)` が L1 のタスク（コルーチン）を返し、`pump(..., background=[...])` で動かす。CLI はまだ無い] 起動

## Test List（Canon TDD Step 1）

外側ループ（受け入れ。§4 Step 3）:

- [x] AC-a: L1 の接続先にサーバーがいない（空きポートを閉じたもの）構成で、鹿 6 フレームを `pump` に流すと、本物の WebSocket クライアントが LAC-1 と同じ ON（同じ `t_frame`・距離・L/R）と OFF を受け、`l1_unavailable`（`connect`）が残る。フラグに `l1` は付かない
- [x] AC-b: `calibration.json` が無い構成で、L1 が false_positive 0.99 を返しても、赤は L0 の解除まで続き（`deer: false` は解除の 1 回だけ）、`l1` は付かず、`l1.result` は `route=uncalibrated`
- [x] AC-c: 温度 1.0 の `calibration.json` があり、L1 が false_positive 0.95 を返すと、赤のあと `deer: false`・`l1 = {alert_level: zone, conf: 0.95, overrode: true, latencyMs}` のフラグが `reason=l1` で送られ、JSON Schema に通る

UC-1 4 問と状態:

- [x] Q-1a: `wire_questions()` は `JUDGE_QUESTIONS` の順の 4 つの名前で、`instructions` が質問文と同じ、alert_level だけ `criteria = {none, zone, danger}`（値は None）
- [x] Q-1b: `detector/l1/` のソースに質問文の文字列が書かれていない（import だけ）
- [x] REQ-1a: 主トラックがあると、`JudgeRequest` に通る問い合わせができる（track は `track_points`、ttcSec、recentAlerts30s、固定の車の状態、model）
- [x] REQ-1b: 主トラックが無い → 作らない（None）
- [x] REQ-1c: TTC が無い → `ttcSec: null`
- [x] REQ-1d: `JudgeRequest` に通らない（model の字種違いなど）→ `L1Unavailable(invalid_request)`
- [x] REQ-1e: [ADDED adversary] 赤のあいだは、主トラック（0.45 の高い看板）ではなく赤の候補（0.85 の鹿）について聞く

UC-2 クライアント:

- [x] CL-1a: 1 回の `POST /v1/systemone` に、model・状態・4 問が入る。リトライしない（500 で 1 回だけ）
- [x] CL-1b: 答えの読み取り（choice の確率 3 つ・noul 3 つ・答えたモデル名）
- [x] CL-1c: 答えの欠落・型違い・確率の範囲外・choice の選択肢の不足 → `L1Unavailable(bad_response)`
- [x] CL-1d: HTTP のエラー → `http`、接続できない → `connect`、`timeout_ms` を超える → `timeout`
- [x] CL-1e: 接続先は `TYPESAFE_BASE_URL` が設定の `base_url` より優先、空白だけの環境変数は無視。API キーは `TYPESAFE_API_KEY`、無ければ `local`
- [x] CL-1f: SDK が import できない → `make_client` が `L1Unavailable(sdk_missing)`

UC-3 校正:

- [x] CAL-1a: 正しい `calibration.json` を読める
- [x] CAL-1b: 無い・JSON でない・version 違い・温度の欠落・範囲外・NaN → 校正なし（理由つき）
- [x] CAL-1c: 温度 1 では確率が変わらず、温度 2 では 0.5 に寄る（noul・choice とも）。0 と 1 の確率も有限に収まる
- [x] CAL-1d: 答えたモデルが違う → 校正なし
- [x] CAL-1e: [ADDED adversary] `calibration.json` の `model` が別名（`jev-latest`）→ 形が違う。応答の `model` が別名・空 → 校正なし。`l1.calibration_mismatch` は 1 秒に 1 回まで

UC-4 fusion:

- [x] FU-1a: 校正後の false_positive ≥ 0.9 で、今のエピソード・同じトラック → 降格（結論 zone、理由 false_positive）
- [x] FU-1b: alert_level の `zone`（または `none`）が校正後 ≥ 0.9 → 降格（結論はその値）
- [x] FU-1c: 0.9 未満・`danger` → 降格しない。0.5〜0.9 は `l2_candidate`、0.5 未満は `log`
- [x] FU-1d: 校正なし → 降格しない（`uncalibrated`）、`l1` を付けない
- [x] FU-1e: エピソードより前に作った問い合わせ・前のエピソードの答え → 降格しない
- [x] FU-1f: 問い合わせたトラックが赤の候補でない・赤の候補が 2 つ → 降格しない。降格中に 2 頭目が閾値を超える → 赤に戻る
- [x] FU-1k: [ADDED adversary] 理由が alert_level で、トラックの今の `pos` が `lane` → 降格しない。降格中に `lane` に入る → 赤に戻る。false_positive は `lane` でも降格する
- [x] FU-1l: [ADDED adversary] 答えが古くなる（開始から 2.0 秒）→ 赤に戻る（tick で確かめ直す）
- [x] FU-1m: [ADDED adversary] 降格を解いて赤に戻してから 1 秒は再び降格しない。1 秒を過ぎた条件を満たす答えでは降格する
- [x] FU-1g: L0 が赤でないときの `danger` → 何もしない（上げない）
- [x] FU-1h: 降格中に、条件を満たさない答え → 赤に戻る。L1 の失敗 → 赤に戻る
- [x] FU-1i: L0 の赤が解ける → エピソードが閉じ、`l1` が付かなくなる
- [x] FU-1j: `recentAlerts30s` は直近 30 秒の赤の回数（30 秒より古いものは数えない）

UC-5 配信:

- [x] HUB-1a: 降格で `deer: false`・`reason=l1`・`l1.overrode=true` が再送され、JSON Schema に通る。`conf`・`distanceM` は付かない（deer: false の形）
- [x] HUB-1b: 出力が変わらない答えでは再送しない。次のハートビートに `l1` が付く
- [x] HUB-1c: 降格中のハートビートと新しい接続への snapshot も `deer: false` と `l1` を運ぶ
- [x] HUB-1d: `flag.sent` のログに `l1` が入れ子で入る
- [x] HUB-1e: fusion を渡さない `AlertHub` は従来どおり（既存のテストが Green）
- [x] HUB-1f: `wait_for_l1_before_red = true` で L1 が健全 → 赤を保留し（150 ms まで）、期限までに答えが来れば答えで決めた出力、来なければ期限の tick で赤。L1 が失敗中 → 保留しない
- [x] HUB-1g: フラグの JSON に NaN を書かない（`allow_nan=False`）
- [x] HUB-1h: [ADDED adversary] 入力が止まっている（stalled）あいだに答えが来ても何も送らない
- [x] HUB-1i: [ADDED adversary] 降格から赤に戻すフラグは今の L0 の値で、ack の基準はその赤のフレーム
- [x] LOG-1a: [ADDED adversary] ログに API キー・URL のパス・track の点・質問文が出ない。`l1.endpoint` は scheme・host・port だけ
- [x] HUB-1j: [ADDED review] fusion が例外を出しても、赤（変化・ハートビート・snapshot）は L0 のまま送られ、`fusion.failed` が残る。NaN の退避は `l1` を外し数を 0 にして `deer` を届ける

UC-6 L1 のタスク:

- [x] RUN-1a: 成功した答えが `hub.on_l1` に渡り、`l1.result` が残る
- [x] RUN-1b: タイムアウト・`L1Unavailable`・予期しない例外が続いてもタスクは死なず、`l1_unavailable` は 1 秒に 1 回まで、回復で `l1.recovered`
- [x] RUN-1c: 問い合わせは同時に 1 つまで、開始から `1 / rate_hz` 秒ごと
- [x] RUN-1d: 主トラックが無いティックは送らない
- [x] RUN-1e: `wake` で次のティックを待たずに聞く（保留の設定）
- [x] RUN-1f: `start_l1` は `enabled = false` で None、SDK が無ければ `l1_unavailable(sdk_missing)` を残して None
- [x] RUN-1g: `pump(..., background=[...])` は入力が尽きたらバックグラウンドのタスクを片付ける
- [x] RUN-1h: [ADDED adversary] 失敗が続くと間隔が 2 倍ずつ延び（2 秒まで）、成功で戻る
- [x] RUN-1i: [ADDED adversary] 接続先がループバックでない（環境変数のクラウドの URL）→ `start_l1` が `remote_not_allowed` を残して None
- [x] RUN-1j: [ADDED review] 失敗が何千回続いても間隔は 2 秒で頭打ち（OverflowError にしない）。後始末（`on_l1_failed`）が例外でもタスクは死なない（`l1.release_failed`）。background が死んだら `pump` が `background.died` を残し、検知は続ける

UC-7 設定:

- [x] CFG-1a: 空の TOML で `[l1]`・`[l2]` の既定値（base_url の既定は 8766）
- [x] CFG-1b: 指定した値が読める。`calibration_path` の相対パスは設定ファイルのディレクトリから
- [x] CFG-1c: 範囲外（`override_conf` 0.89、`timeout_ms` 801、`rate_hz` 1.9）・型違い・空の `base_url`・`l2_route_conf` の順序違い・`[l2] enabled` の値違い → `ConfigError`（キー名つき）
- [x] CFG-1d: `tracker.min_conf` > `judge.threshold` → `ConfigError`
- [x] CFG-1e: `config.example.toml` が読め、既定値と一致する

認可（threat.md の ❌ セル。[ADDED threat]）:

- [x] AUTH-1: ループバックでない接続先（設定・環境変数のクラウドの URL）には送らない（`remote_not_allowed`）
- [x] AUTH-2: local-jev の答え（false_positive 0.99）だけでは赤は下がらない（校正なし・前のエピソード・赤の候補でないトラック）
- [x] AUTH-3: 端末の ack・label・flag の形のメッセージで赤は下がらない
- [x] AUTH-4: 降格から赤に戻すとき、距離・方向・確信度は L0 の値（L1 は数値を変えない）
- [x] AUTH-5: L0 が赤でないとき、L1 の danger 0.99 で赤にならない
- [x] AUTH-6: 端末のメッセージで赤にならない
- [x] AUTH-7: 答えに余分な項目（`override_conf`・`base_url` など）があっても、設定・閾値は変わらない
- [x] AUTH-8: 端末のメッセージ（設定のような文字列）で設定・閾値・校正は変わらない
- [x] AUTH-9: detector は `calibration.json` を読むだけ（走らせた後も中身が変わらない）

状態パターン:

- [x] S-1: L1 が止まっている（AC-a と同じテストで確かめる）
- [x] S-2: 校正が無い（AC-b と同じテストで確かめる）
- [x] S-3: L1 が遅い（CL-1d と RUN-1b で確かめる）

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule               | 語彙                                           | 置き場所                                     | 証明 |
| ------------------ | ---------------------------------------------- | -------------------------------------------- | ---- |
| R1: 4 問           | wire_questions / QUESTION_IDS                  | edge/detector/src/detector/l1/questions.py   | UC-1 |
| R2: 状態           | build_request / VehicleContext                 | edge/detector/src/detector/l1/request.py     | UC-1 |
| R3: クライアント   | TypesafeJudgeClient / L1Answer / L1Unavailable | edge/detector/src/detector/l1/client.py      | UC-2 |
| R4: 校正           | Calibration / load_calibration                 | edge/detector/src/detector/l1/calibration.py | UC-3 |
| R5: fusion         | Fusion / L1Verdict                             | edge/detector/src/detector/fusion.py         | UC-4 |
| R6: 赤の経路       | AlertHub.on_result / AlertHub.on_l1            | edge/detector/src/detector/hub.py            | UC-5 |
| R7: 止まらないこと | run_l1 / start_l1                              | edge/detector/src/detector/l1/runner.py      | UC-6 |
| R8: 設定           | L1Config / L2Config                            | edge/detector/src/detector/config.py         | UC-7 |

## 非機能要件

- [x] 遅延: 赤の送信経路（`on_result`）に await を足さない。fusion の計算は同期で 1 ms 未満
- [x] L1 の 1 問い合わせは `timeout_ms`（800 ms）で必ず打ち切る。リトライしない
- [x] 決定性: 乱数を使わない。同じ答えの列で同じ出力
- [x] ruff と pytest のカバレッジ 70% 以上。既存の 242 件が Green のまま（edge-l0 の CFG-1d は `[l1]`・`[l2]` を足したので `[l3]` で確かめるよう書き換えた）

## 受け入れ基準

- [x] 受け入れテスト AC-a・AC-b・AC-c が Green
- [x] 全 UC / 全状態パターンのテストが Green、既存テストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（ruff check・ruff format）
- [x] edge-latency-reviewer・code-reviewer・alert-contract-guard の Critical 0
