---
feature: edge-run
target_paths:
  - edge/detector/src/detector/__main__.py
  - edge/detector/src/detector/app.py
  - edge/detector/src/detector/sources.py
  - edge/detector/src/detector/bench.py
  - edge/detector/pyproject.toml
  - edge/detector/config.example.toml
  - edge/detector/.gitignore
  - edge/detector/tests/test_app.py
  - edge/detector/tests/test_app_acceptance.py
  - edge/detector/tests/test_bench_yolo.py
  - edge/detector/tests/test_sources.py
  - scripts/bench_l1.py
  - docs/runbooks/2026-11-06-mac-mini-edge-run.md
  - docs/runbooks/2026-11-04-mac-mini-day0.md
spec_confirmed_at: 94f0477
tier: 1
---

# 仕様: edge-run（B の車載検知を Mac mini で 1 つのコマンドで起動する）

**l0-fp-filter（2026-11-06）での変更**: config.example.toml に `[l0_filter]` のセクション（L0 の誤検出の後処理。既定でオン・無視する領域は空）を足した。起動の入口と `bench` は `load_coreml_detector` を通るので、後処理は自動で入る（入口のコードは変えていない。1 フレーム 1 ms 未満。`docs/specs/l0-fp-filter/functional.md`）。この feature の挙動は変わらない。

## 概要

B の部品（edge-camera・edge-judge・edge-l0・edge-l1・edge-capture）は main に入ったが、組み立ててあるのはテストの中だけで、
実機で動かす入口が無い（edge-judge の Deferred「起動の入口」）。この feature で次を作る。

1. 起動の入口 `python -m detector --config edge/detector/config.toml`: カメラ → L0（CoreML の YOLO）→ 判定 → WebSocket（8765）→ PWA と、
   capture の HTTP（8767）、有効なら L1（local-jev、8766、非同期で降格だけ）を組み立てて動かし、Ctrl-C で片付ける
2. L1 なしの起動（`--no-l1` か `[l1] enabled = false`）と、YOLO 単独の計測（`scripts/bench_l1.py --no-l1 --model X`）

> 2026-11-07 pwa-https（`docs/specs/pwa-https/functional.md` UC-3i）が、`serve` で `tls.server_context(config)` を AlertServer に渡すようにした。`[tls]` があれば WebSocket は wss（Capture は前から https）。`[tls]` が壊れていれば `TlsError` を StartupError にして終了コード 2（平文で待ち受けない）。`[tls]` が無ければ今までどおり ws。テストは `tests/test_tls_servers.py` の UC-3i。

3. 起動前の検査 `--check`（設定・モデル・カメラ 1 枚・推論 1 回。待ち受けない）
4. 手順書 `docs/runbooks/2026-11-06-mac-mini-edge-run.md`（yolo26n-480 の運び方、`[camera]` の導入、L1 なしの起動と計測、PWA をつないで赤が出るまで）

要件: ch4-edge.md B1-1（自動起動の前段の「1 コマンドで起動」。自動起動そのものは範囲外）・B1-2（解像度と fps は設定ファイル）・B1-3（アダプタで分離）・B3-2（WebSocket 配信）、
ch6-nfr.md「B 遅延」（推論 ≤ 100 ms、目標 50 ms。走行ログの `t_frame` / `t_sent`）・「B 可用性」（L1 が落ちても L0 だけで動く）。
既存: `docs/specs/edge-judge`（hub・server・pump）・`edge-l0`（CoreML の読み方）・`edge-l1`（start_l1）・`edge-capture`（CaptureService の docstring の組み立て順）・`edge-day0`（bench）。

**範囲外**: 自動ログイン・launchd での自動起動・Wi-Fi AP・QR・mDNS の設定の自動化（別 feature）、カメラの最新フレーム優先の取り込み（edge-camera の Deferred）、
カメラが落ちたときの自動の再接続、ログのローテーション、`apps/`（PWA は別セッション。この feature では編集しない）、実機での実測（ユーザーの作業）。

**Tier 1 の根拠**: 新しい待ち受け・認可・永続化スキーマを作らない。待ち受け（WebSocket・capture の HTTP）と外への送信（L1 はループバックだけ）は、
既存の edge-judge・edge-capture・edge-l1 の threat.md / resilience.md が定める部品をそのまま組み立てる。並行性は既存の `pump`（推論のスレッド 1 本＋イベントループ）と
capture の HTTP のスレッドで、この feature が足すのは停止の順序（止める旗・片付け）だけ。停止の失敗モードは下の「状態パターン」に書き、テストで確かめる。

## Example Map

Story: 人 B として、Mac mini の前で `python -m detector --config edge/detector/config.toml` を打てば、カメラの前に鹿の写真をかざしたときにスマホの PWA が赤になり、
Ctrl-C で全部が片付き、走行ログ（`t_frame` / `t_sent`）がファイルに残るようにしたい。L1（local-jev）を入れていなくても動かしたい。

Questions は全問、推奨で決定（親セッションの指示「推奨で決めて進める」。2026-11-06）。ch9 ④ は推奨（local-jev＋Qwen2.5-1.5B、L1 を赤の経路に入れない）を仮採用中。保留は下の Deferred。

- R1: 入口と引数（推奨で決定）
  - `python -m detector`（`src/detector/__main__.py` は薄い `main(argv)`。本体は `src/detector/app.py`）。console_scripts は足さない（入れ直しが要るため。`-m` だけで足りる）
  - `--config PATH`（必須）。`--no-l1`（`l1.enabled = false` に上書き）、`--no-capture`（`capture.enabled = false` に上書き）、`--check`（下の R6）、`--image PATH`（`--check` の推論にカメラの代わりの画像を使う）
  - `--log-dir DIR`（既定: 設定ファイルのディレクトリの `logs/`）、`--log-level`（既定 `INFO`。ファイルに書く下限）。新しい設定のセクションは足さない（`[log]` を足すと設定の検査の対象が増える。起動ごとの選択なので引数で足りる）
  - 終了コード: `0` = Ctrl-C・SIGTERM で止めた（上限を超えて取り消した `forced` も）、動画の入力が尽きた、`--check` が通った。`1` = 動いている途中で止まった（カメラが読めなくなった、パイプラインの例外）・想定外の例外。`2` = 起動できない（設定・モデル・カメラ・ポート）。`130` = 2 回目の Ctrl-C、シグナルの受け口を付ける前（設定の読み込み中）の Ctrl-C。`2` のときは何も待ち受けたまま残さない（spec-adversary C2）
- R2: 起動前の検査（推奨で決定。待ち受けとカメラより先に、安いものから）
  - 設定: `load_config`（知らないキー・範囲外はそのメッセージで exit 2）
  - モデル: `infer.model_path` が空 → exit 2「infer.model_path が空」。相対パスは**設定ファイルのディレクトリから**解決する（`resolve_path`。`l1.calibration_path`・`capture.dir` と同じ）。無い → exit 2「モデルが無い: <ファイル名>（手順書 docs/runbooks/2026-11-06-mac-mini-edge-run.md の 3. で models/ に置く）」。メッセージに親ディレクトリを出さない（ファイル名だけ）
  - モデルの読み込み: 解決済みのパスを `load_coreml_detector` に渡す（coremltools が無い、deer が無い、画像の入力が無い → その ConfigError で exit 2）。coremltools のそのほかの例外（壊れたモデル）は文言を出さず「モデルを読めない: <ファイル名>（<型名>）」で exit 2（文言に絶対パスが入りうる。spec-adversary C3）
  - モデルの読み込み（CoreML の初回のコンパイルは数十秒）の間の Ctrl-C は旗に残り、読み込みのあと待ち受けずに exit 0 で終わる（spec-adversary C2）
  - カメラ: `camera.source = device` は `open_camera`、`file` は `open_video_file`（相対パスは設定ファイルのディレクトリから）。opencv が無い・開けない → exit 2（SourceError のメッセージ）
  - 順序: 設定 → モデル → カメラ → WebSocket の待ち受け → capture の HTTP の待ち受け。あとの段で失敗したら、それまでに開けたもの（カメラ・待ち受け）を閉じてから exit 2
- R3: 組み立て（edge-capture の `CaptureService` の docstring の順）
  - `hub = AlertHub(config.judge, tracker=config.tracker, l1=config.l1)`、`service = CaptureService.from_config(config)`（`enabled = false` なら None）
  - `results = process_frames(source, config, detector)` を `service.wrap` で包む（結果は先に hub へ、保存はそのあと）
  - `l1 = start_l1(config, hub, observer=service.on_l1_answer)`（`enabled = false`・SDK が無い・ループバックでない → None。L0 だけで動く。edge-l1 のまま）
  - `AlertServer(hub, config.server).start()` → `service.start()` → `pump(results, hub, background=[l1] if l1 else [])`
  - 赤は L0 だけで決まる（edge-l0・edge-l1 のまま）。この feature は判定・配信・保存の挙動を変えない
- R4: 停止（推奨で決定）
  - SIGINT（Ctrl-C）・SIGTERM の 1 回目: 止める旗を立てる。入力（カメラ）の `read()` は旗を見て「終わり」（None）を返し、パイプラインは `pipeline.summary` を残して終わり、
    pump は ON の鹿が 1.5 秒で OFF になるまで刻んでから返る（PWA に OFF のフラグが 1 回届く）。そのあと capture（HTTP の停止・保存のキューの片付け）→ WebSocket の停止 → カメラの解放の順に片付ける
  - pump が返るまでの上限 5 秒（`STOP_TIMEOUT_S`。pump だけの上限で、そのあとの片付けは各部品の上限: 保存のキュー 2 秒・HTTP のスレッド 2 秒・WebSocket の close 1 秒）。超えたら（カメラの `read()` が戻らないなど）pump のタスクを取り消して片付けへ進む（`run.stopped` の理由 `forced`）。
    このとき**カメラは解放しない**（別のスレッドが `read()` の中にいる VideoCapture を解放すると落ちうる。`camera.left_open` を残す）。`asyncio.run` は終わるときに既定の executor のスレッドを待つので、入口は `logging.shutdown()` → `os._exit(0)` で抜け、OS がカメラを離す（spec-adversary C1）。forced では OFF のフラグは届かず、PWA は WebSocket の切断で知る
  - 2 回目の SIGINT・SIGTERM（片付けの途中も）: `run.stopped`（`killed`）を書いて、すぐ `os._exit(130)`（spec-adversary W4）
  - カメラの解放は、forced 以外のどの終わり方でも 1 回（`CameraSource.close()` / `VideoFileSource.close()` を足す。2 回呼んでも害がない）
  - Ctrl-C で止めたときの終了コードは 0（意図した停止）。`run.stopped` の理由は入口の旗から取る（旗で止めてもパイプラインの `pipeline.summary` は `ended: "eof"` になる。spec-adversary I1）
- R5: 走行ログ（推奨で決定）
  - 1 行 1 JSON（既存の `JsonFormatter`）。ファイル `logs/run-YYYYMMDD-HHMMSS.jsonl`（起動した時刻、Mac の現地時刻）に `--log-level` 以上のすべてを書く。`flag.sent`（`t_frame`・`t_sent`）・`ack`（`t_shown`）・`frame.processed`（`infer_ms`）は既存のまま入る
  - 端末（stderr）には WARNING 以上の JSON だけ（1 秒 10 行の `frame.processed` で端末を埋めない）。人が読む数行（待ち受けの URL・L1 と capture の有無・ログのパス・止め方）も stderr に出す。stdout は使わない（`--check` の JSON だけ）
  - 起動の記録 `run.started`: モデルのファイル名（パスでなく）・compute units・target_fps・カメラの source と解像度・WebSocket と capture のポート・L1 と capture の有無。停止の記録 `run.stopped`: 理由（`signal` / `eof` / `error` / `forced` / `startup` / `killed` / `interrupted` / `crashed`）と終了コード
  - ログに絶対パス・クライアントのアドレス・画素・受信の本文を出さない（edge-judge・edge-capture の決まりのまま）。そのため、ファイルにも端末にも**例外のスタックと文言を書かず、型名（`error_type`）だけ**にする（spec-adversary W2）。`websockets` と `detector.websockets` の logger は `--log-level DEBUG` でも INFO 止まり（DEBUG で受信したフレームの中身を出すため。W1）。想定外の例外のスタックは端末（stderr）にだけ出す
  - 同じ秒に起動したときは `-1`・`-2` を付けて上書きしない
- R6: `--check`（推奨で決定）
  - WebSocket と（有効なら）capture のポートを bind → close で確かめ（待ち受けたままにしない）、R2 のモデル・カメラまでを行い、カメラから 1 枚読み（`--image` があればその画像。opencv で読む）、640×480 に縮めて推論を 2 回（1 回目はコンパイルを含む）してから、カメラを閉じる（spec-adversary W5）
  - stdout に JSON 1 つ: `model`（ファイル名）・`compute_units`・`frame_shape`・`first_infer_ms`・`infer_ms`（2 回目）・`detections`（label・conf・xywh）・`deer_detected`（`judge.threshold` 以上の鹿があるか。鹿の写真で false ならモデルか向きを疑う）・`l1_enabled`・`capture_enabled`。exit 0。ログは stderr（WARNING 以上）だけで、走行ログのファイルと capture の置き場所を作らない
  - macOS のカメラの許可（ターミナルに「カメラ」を許可）は、この 1 回目で聞かれる（手順書に書く）
- R7: YOLO 単独の計測（`scripts/bench_l1.py --no-l1 --model X.mlpackage`。推奨で決定）
  - L1 のクライアント・合成の例を作らない（local-jev・typesafe-sdk・dataset が無くても動く）。`--model` が要る（無ければ exit 2）。`--compare` とは一緒に使えない（exit 2）
  - 検出器を同じスレッドで休みなく回す: 最初の 5 回（CoreML のコンパイル）は測らず `first_ms` に 1 回目を残し、続く `--yolo-seconds` 秒の 1 回ごとの ms と fps を出す。フレームはシード付きの乱数画像 4 枚（640×480）
  - JSON（`schema: antler.bench_l1/1` のまま、`mode: "yolo"` を足す）: `l0_alone`（fps・秒・回数・例外・`first_ms`・`infer` の n/p50/p95/max/mean）、`verdict`（`valid`・`invalid_reason`・`target_fps`・`l0_meets_target_fps`・`infer_budget_ms`（100）・`infer_p95_within_budget`・`infer_target_ms`（50）・`infer_p95_within_target`・`meets_ch6`・`note`）。続けて表
  - 予算 100 ms と目標 50 ms は ch6 の値を定数で持つ（設定の `infer.budget_ms` は警告のしきい値で、書き換えると合格に見えるので使わない。spec-adversary W3）。`meets_ch6` = 有効 かつ p95 ≤ 100 ms かつ fps ≥ `pipeline.target_fps`。50 ms は目標で、超えても不合格にしない
  - 例外が 1 回でもある・立ち上がらない → `valid = false`、exit 3（JSON は出す）。有効だが `meets_ch6` が偽 → exit 4。表と JSON に「推論だけ・乱数画像の参考値」と出す（鹿を出さない壊れたモデルでも速く見えるので、鹿が出るかは `--check --image` で見る）。既存の `bench`・`compare` の出力は変えない
- R8: 依存と設定の見本
  - extra `run` = `coremltools==9.0`・`Pillow>=10`・`opencv-python>=4.9`（実行に要るものだけ。`coreml` extra の ultralytics は torch を引くので実行には使わない）
  - `config.example.toml` の `infer.model_path` の注記に yolo26n-480 の置き場所（`models/yolo26n-deer-20261105-480.mlpackage`）を書く。値の既定は空のまま（`Config()` と同じ）
  - `edge/detector/.gitignore`: `logs/`・`config.toml`（車ごとの設定。LAN のアドレスを含む）
- R9: 手順書（`docs/runbooks/2026-11-06-mac-mini-edge-run.md`）
  - 前提（Day 0 の手順書の 1〜3・5 が済んでいる）、モデルの運び方（dev Mac で zip → AirDrop か scp → Mac mini で展開、SHA-256 で照合）、`pip install -e "edge/detector[dev,run]"`、
    設定（`cp config.example.toml config.toml`、`model_path`、`[l1] enabled = false`、`[server] host` / `[capture_server] host` を LAN のアドレスに）、`--check`、YOLO 単独の計測、
    起動と確かめ方（`python -m websockets` のクライアントで AlertFlag を見る → 鹿の写真をカメラにかざして `deer: true` → PWA の開発ビルドを `?edge=` でつないで赤）、止め方、走行ログの見方、うまくいかないとき
  - L1 を後から足す手順（Day 0 の手順書の 6 の local-jev を起動して `[l1] enabled = true`）
  - モデルは CC BY-SA を含む学習の派生で、採用は ch6 の判断のあと（`docs/reports/2026-11-06-dataset-train-run.md`）と 1 行書く
  - Day 0 の手順書の冒頭に、実行と YOLO 単独の計測はこの手順書と書く

## ユースケース

### UC-1: 起動して赤を配信する（R1・R3・R5）

- **Given**: 偽のカメラ（鹿が写るフレームを出し続ける）・偽の L0（`ScriptedDetector`）・ポート 0 → **When**: `run` → **Then**: 本物の WebSocket クライアントが `deer: true` の AlertFlag を受け、
  走行ログのファイルに `run.started`・`flag.sent`（`t_frame`・`t_sent`）が 1 行 1 JSON で残る

### UC-2: 起動前の検査（R2）

- **Given**: モデルが無い・設定が壊れている・カメラが開けない・ポートが使用中 → **When**: `main` → **Then**: exit 2 と分かるメッセージ（stderr）。開けたものは閉じる

### UC-3: 止める（R4）

- **Given**: 動いている → **When**: 止める旗（SIGINT・SIGTERM） → **Then**: exit 0、capture・WebSocket・カメラが閉じ、`run.stopped`（`signal`）が残る

### UC-4: 確かめる（R6）

- **Given**: 設定とモデル → **When**: `--check` → **Then**: 2 回の推論の結果（`deer_detected` つき）の JSON、待ち受けない、exit 0

### UC-5: YOLO 単独の計測（R7）

- **Given**: 偽の検出器 → **When**: `bench --no-l1 --model X` → **Then**: L1 のクライアントを作らず、推論の p50/p95・fps・判定の JSON と表、exit 0

## 状態パターン

### S-1: L1（local-jev）が起動していない・SDK が無い

- `start_l1` が None を返すか、問い合わせが失敗し続ける（`l1_unavailable`）→ L0 だけで動き続ける。赤は変わらない（edge-l1 のまま）

### S-2: 動いている途中でカメラが読めなくなる

- `SourceError`（`camera.lost`）→ pump が例外で終わる → 片付けて exit 1、`run.stopped`（`error`）。自動の再接続はしない（Deferred）

### S-3: 動画の入力が尽きる（`camera.source = "file"`）

- pump が自然に終わる（ON の鹿は 1.5 秒で OFF を送ってから）→ 片付けて exit 0、`run.stopped`（`eof`）

### S-4: 止めても `read()` が戻らない

- 5 秒で pump を取り消し、capture と WebSocket を片付け、カメラは解放せずに `run.stopped`（`forced`）を書いて `os._exit(0)`。2 回目の Ctrl-C は待たずに `os._exit(130)`

### S-5: 起動の途中で失敗する（ポートが使用中など）

- それまでに開けたカメラ・WebSocket・capture を閉じてから exit 2。半端に待ち受けたまま残さない

### S-6: モデルの読み込み中に Ctrl-C

- 読み込みが終わってから旗を見て、待ち受けずに exit 0。設定の読み込み中（受け口の前）は exit 130

### S-7: 想定外の例外

- 走行ログに `run.stopped`（`crashed`・型名だけ）、スタックは端末にだけ、exit 1

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（Mac mini 実機）/ 期日=2026-11-07 / 暫定挙動=入口・`--check`・YOLO 単独の計測は偽のカメラと偽の CoreML でだけテストした。実物の yolo26n-480 の ANE での ms・fps、macOS のカメラの許可、PWA に赤が出るまでは手順書で確かめる] 実機での起動と計測
- [Deferred: 担当=人 B（自動起動の feature）/ 期日=Day 6 / 暫定挙動=人がターミナルで起動する。カメラが落ちたら exit 1 で止まり、再起動は人が行う。launchd の KeepAlive で再起動させる案は自動起動の feature で] 自動起動・自動の再接続
- [Deferred: 担当=人 B（期間と同意の範囲はユーザーの判断）/ 期日=Day 6 / 暫定挙動=起動ごとに 1 ファイル。消さない・回さない。1 時間の走行で数十 MB の見込み（10 fps × 1 行約 300 B）。中身は時刻・遅延・検知・ack と、PWA が返す車の状態（速度・ゾーンの内外・光。緯度経度は無い）。画像・アドレス・本文は無い。誰がいつ消すか、ch5 の同意の範囲に入るかは未決（spec-adversary I2）] 走行ログのローテーションと保存期間
- [Deferred: 担当=人 B / 期日=実機の計測のあと / 暫定挙動=YOLO 単独の計測の入力は乱数画像（鹿が写らず後処理が軽い。fps は楽観側）。鹿の写った実写フレームを入力にする口は、実機の結果を見て足す] 計測の入力の現実味

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] RUN-AC-1: 偽のカメラ・偽の L0・ポート 0・L1 なしで `serve` を回すと、本物の WebSocket クライアントが `deer: true` の AlertFlag（JSON Schema に通る）を受け、止める旗で exit 0、カメラが 1 回だけ閉じ、両方のポートが閉じ、走行ログのファイルに `run.started`・`flag.sent`（`t_frame`・`t_sent`）・`run.stopped`（`signal`）が JSON で残り、ファイル全体に絶対パス・スタックが無い
- [x] RUN-AC-2: `python -m detector --config X` をサブプロセスで起動すると、モデルが無いとき exit 2 で stderr にファイル名と手順書が出て、`--help` は exit 0
- [x] RUN-AC-3: `bench --no-l1 --model X`（偽の検出器）が L1 のクライアントを作らずに `mode: "yolo"` の JSON と表を出し、exit 0

UC-1 引数とログ:

- [x] RUN-1a: `--no-l1` は `l1.enabled = false`、`--no-capture` は `capture.enabled = false` に上書きし、ほかの設定は変えない。`--config` が無いと引数エラー
- [x] RUN-1b: 走行ログのファイルは `--log-dir`（既定は設定ファイルのディレクトリの `logs/`）の `run-YYYYMMDD-HHMMSS.jsonl`（同じ秒は `-1`）。ファイルは `--log-level` 以上、端末は WARNING 以上。書けないと exit 2。`--log-level` は `DEBUG` / `INFO` だけ（`WARNING` を選べると `flag.sent`・`ack` の t_frame・t_sent・t_shown が落ちる。edge-latency-reviewer W1）
- [x] RUN-1c: `run.started` にモデルのファイル名・ポート・L1 と capture の有無が入り、絶対パスが入らない。例外はスタック・文言を書かず型名だけ。websockets の logger は DEBUG でも INFO 止まり（spec-adversary W1・W2）

UC-2 起動前の検査:

- [x] RUN-2a: `infer.model_path` が空 → exit 2。無いパス → exit 2 でファイル名と手順書（親ディレクトリは出さず、カメラより先に止まる）
- [x] RUN-2b: 相対の `model_path`・`camera.path` は設定ファイルのディレクトリから解決し、ローダーには解決済みのパスが渡る（spec-adversary C3）
- [x] RUN-2c: 設定の誤り（知らないキー）・モデルの読み込みの失敗（ConfigError・そのほかは型名だけ）・カメラが開けない（SourceError）→ exit 2、何も待ち受けない。読み込み中の Ctrl-C は待ち受けずに exit 0、受け口の前は 130、想定外の例外は exit 1 で型名だけ（spec-adversary C2）
- [x] RUN-2d: WebSocket のポートが使用中 → exit 2、カメラを閉じる。capture のポートが使用中 → exit 2、WebSocket とカメラを閉じる。`run.stopped`（`startup`）が残る

UC-3 組み立て:

- [x] RUN-3a: L1 が有効なら `start_l1` に capture の `on_l1_answer` が observer として渡り、pump の background に入る。local-jev が居なくても赤は届く
- [x] RUN-3b: capture が有効なら `wrap` で包み、HTTP が待ち受ける（一覧が取れる）。無効なら作らない

UC-4 停止:

- [x] RUN-4a: 止める旗で入力の `read()` が None を返し、pump が返り、capture → WebSocket → カメラの順に閉じて exit 0。閉じる失敗は飲み込み（WebSocket の停止が失敗してもカメラは閉じる。code-reviewer W）、閉じるのは 1 回
- [x] RUN-4b: 止めても `read()` が戻らないと、上限の秒数で取り消し、カメラを解放せずに `run.stopped`（`forced`）。2 回目の要求は上限を待たない。サブプロセスでは Ctrl-C から上限の秒数でプロセスが exit 0 で終わる（spec-adversary C1）
- [x] RUN-4c: SIGINT・SIGTERM の 1 回目は旗を立て、2 回目はすぐ 130 で終わる（自分に `os.kill`、サブプロセスに 2 回の SIGINT で確かめる）
- [x] RUN-4d: 動いている途中の `SourceError` → 片付けて exit 1、`run.stopped`（`error`）
- [x] RUN-4e: 動画の入力が尽きる → exit 0、`run.stopped`（`eof`）
- [x] RUN-4f: `CameraSource.close()` / `VideoFileSource.close()` は解放し、2 回呼んでも・読めなくなったあとでも解放は 1 回

UC-5 `--check`:

- [x] RUN-5a: ポート・設定・モデル・カメラ 1 枚・推論 2 回で JSON（モデルのファイル名・frame_shape・first_infer_ms・infer_ms・detections・deer_detected）を出し、待ち受けず、カメラを閉じ、走行ログと capture の置き場所を作らずに exit 0。ポートが使用中・カメラから読めない・推論が例外を出す（型名だけ出す。code-reviewer W） → exit 2（spec-adversary W5）
- [x] RUN-5b: `--image` はカメラを開かずにその画像で推論する。読めない画像・opencv が無い → exit 2。`--check` なしの `--image` は exit 2

UC-6 YOLO 単独の計測:

- [x] RUN-6a: `--no-l1` は `--model` が要り、`--compare` と一緒は exit 2。L1 のクライアント・合成の例を作らない。検出器を作れないと exit 2
- [x] RUN-6b: 最初の 5 回を測らず、1 回ごとの ms の p50/p95 と fps、`target_fps`・予算 100 ms・目標 50 ms（ch6 の定数）に対する判定と `meets_ch6` を出す（spec-adversary W3）
- [x] RUN-6c: 例外が出る・立ち上がらない → `valid = false` と理由、exit 3（JSON は出す）。有効だが `meets_ch6` が偽 → exit 4
- [x] RUN-6d: 表（Markdown）に YOLO 単独の行と判定（「推論だけ・乱数画像の参考値」）が出る
