# edge-latency-reviewer: edge-run（python -m detector の入口）

対象: ブランチ claude/edge-run の未コミットの変更（app.py・**main**.py・sources.py の close()・bench.py の `--no-l1`・手順書・仕様）。
既存の部品（runner.py・hub.py・server.py・pipeline.py・l1/runner.py・capture/service.py）は変更なし。契約との照合は読んで行った。

遅延 p95: 測れなかった（走行ログが無い。`edge/detector/logs/` が存在しない。Mac mini の実機の作業が済んでいない）
L1 p50/p95: 測れなかった（手順書は L1 なしが既定）・L0 fps 単独 / L1 併走: 測れなかった
テスト: `pytest tests/test_app.py tests/test_app_acceptance.py tests/test_bench_yolo.py` は 54 passed（カバレッジの 70% 判定は 3 ファイルだけの実行のため下回っただけ）
Critical: 0 / Warning: 6 / Info: 9

## 結論

赤の経路（カメラ → L0 → 判定 → WebSocket）に、入口が足した遅延は見つからなかった。組み立ては既存の契約どおり
（`pump(results, hub, background=[l1])`、`service.wrap` は yield のあとに offer、L1 は observer 経由で background）。
L1 が無い・落ちたときの縮退も契約どおり。ただし、**走行ログから ch6 の遅延 p95 を出す手順が手順書に無く**（W3）、
**YOLO 単独の「合格」は読み方を誤らせやすい**（W2）。ここを直すまで、遅延の合否は「体感」になる。

## Critical

なし。

## Warning

### W1. `--log-level WARNING` を選ぶと t_frame / t_sent が走行ログに残らない

- app.py:84（`LEVELS = ("DEBUG", "INFO", "WARNING")`）、app.py:289（ファイルのハンドラの level）、app.py:298（ルートの level）
- `flag.sent`（t_frame・t_sent）、`ack`（t_shown）、`frame.processed` は INFO。WARNING を選ぶと全部落ち、遅延が測れない。ルール「B の走行ログに t_frame / t_sent を必ず残す」に反する。既定は INFO なので事故は選んだときだけ。
- 直し方: choices から WARNING を外す（DEBUG / INFO のみ）。または ファイルのハンドラに「`detector.hub` の flag.sent・ack と `detector.pipeline` の frame.processed は level にかかわらず通す」フィルタを足す。

### W2. YOLO 単独の `meets_ch6: true` が「実機で ch6 を満たす」と読めてしまう

- bench.py の `run_yolo_alone`（約 358〜447 行）、手順書 §7
- (a) `detector.last_invalid` を見ていない。pipeline.py:94 は「全部不正で捨てた」を `invalid_count` として「壊れた鹿なし」に数えるが、`run_yolo_alone` は `detect()` が例外を出さなければ有効に数える。モデルの出力が NaN などで DeerDetector が全部捨てても、速いまま `valid: true` になる。直し方: `getattr(detector, "last_invalid", 0)` が 0 でない回数を数え、一定割合を超えたら `valid = false`（`yolo_invalid_output`）。
- (b) 入力は乱数ノイズ 4 枚で、検出がほぼ出ず後処理が最軽量。note には書いてあるが、JSON のキー名は `meets_ch6`、表は「合格」。手順書 §7 も「`meets_ch6` が `true`」を確かめる基準にしている。直し方: キー名を `infer_only_ok` のようにするか、表の見出しを「推論だけの目安」にし、手順書で `--check --image deer.jpg` の `infer_ms` と並べて見る。実フレーム（`--image`）を `make_frames` の代わりに使えるようにするのが本筋。
- (c) fps の判定は、休みなく回した処理能力（1 / 推論時間）で、p95 ≤ 100 ms ならほぼ 10 fps 以上が自動で満たされる。つまり fps の条件は実質ただの重複で、カメラ → 間引き → 推論を通した実際の fps ではない。実際の fps は走行ログの `pipeline.summary`（read / passed）と `run.started` / `run.stopped` の時刻から出す必要があるが、手順書にその式が無い。
- (d) 10 秒の連続実行なので、ファンレスでない Mac mini でも持続時の熱での低下は見えない（Info 程度）。

### W3. 手順書 §9c では遅延 p95 が出せない（Critical にしなかった理由: ログ自体には 3 つの時刻が残る）

- 手順書 §9c
- `tail -n 400` は 10 fps の `frame.processed` と 1 Hz の heartbeat の `flag.sent` で約 40 秒分。9b で鹿をかざした時刻から 9a を止めて 9c を打つまでに 40 秒以上かかれば、`deer: true` の `flag.sent` は窓の外。さらに `| tail -20` は大半がハートビート（`deer: false`）で埋まる。
- `ack` は PWA をつなぐ §9d のあとにしか出ないのに、9c で「確かめる」としている。順序が逆。
- 集計の式が無く、§11 も「出るまでの体感の秒数」を貼る形。ch6 は p95（500 ms で Warning、1,000 ms で Critical）で判定するので、体感の秒数では判定できない。1 回かざしただけでは n = 1。
- 直し方: 9c を 9d のあとに移し、全体を対象にする。例: `grep '"ack"' <log> | python3 -c '...since_frame_ms の中央値と p95...'` と、`flag.sent` の `deer: true` の onset ごとの `t_sent - t_frame`。onset を 20 回以上かざす手順（かざす → 外す → 2 秒待つ を 20 回）を足す。`ack` の `since_frame_ms` は onset の t_frame からの値（hub.py:`_ack_t_frame` は onset でだけ更新、PWA の `sendAck` も danger の表示開始でだけ送る）なので、onset 同士で突き合わせる計算で成り立つ。

### W4. t_shown はスマホの時計、t_frame / t_sent は Mac mini の時計（手順書に差の確認が無い）

- hub.py:`_on_ack`（`since_frame_ms = t_shown - t_frame`）、apps/pwa の `sendAck`（`new Date(now)`）
- 車の中の AP はインターネットに出ないことが多く、Mac mini の時計は時刻同期なしでずれうる。スマホは携帯回線で合っている。数百 ms〜数秒のずれが `since_frame_ms` に乗り、負の値や過大な値が出ても、合否の判断が狂う。
- 直し方: 手順書に「走行前に Mac mini の `date +%s.%N` とスマホの時刻（ブラウザの `Date.now()`）の差を測って報告に書く」、または Mac mini を AP 越しでなく NTP につないでから測る、を足す。差が 50 ms を超えるなら `sent→shown` の数字は参考値と書く。

### W5. 起動中（モデルの読み込み・カメラを開く間）、イベントループが止まり Ctrl-C が効かない

- app.py:334〜337（`_detector` と `_source` を `serve` の中で同期に呼ぶ。シグナルのハンドラは `loop.add_signal_handler` なので、ループが回るまで動かない）
- CoreML の初回のコンパイルは数十秒。その間は「止めています」も出ず、2 回目の Ctrl-C（強制終了）も効かない。仕様 S-6 は「旗が残り、読み込みのあとで止まる」としていて、それは満たす。ただし手順書 §10 の「戻らないときは 5 秒で自動で抜ける」は起動中には当たらず、利用者は待つしかない（macOS のカメラ許可のダイアログも同じループを止める）。赤の経路への影響は無い。
- 直し方（軽い順）: 手順書に「起動の直後は最大数十秒 Ctrl-C が効かない」と書く。または `await asyncio.to_thread(_detector, config, deps)` と `_source` を同様にする。

### W6. 手順書の「5 秒で自動で抜ける」は forced の全体の上限ではない

- app.py:382〜395（`finally` の中で `service.close()` が同期）、app.py:82（5 秒は pump だけ）
- forced のとき: 5 秒（pump）＋ `service.close()`（保存のキュー最大 2 秒＋ HTTP のスレッド最大 2 秒。**ループの上で同期に呼ぶので、その間は WebSocket の ping・配信も止まる**）＋ WebSocket の close 1 秒。最大 10 秒前後。手順書 §10 と表の説明は 5 秒としている。通常の停止（OFF を送ってから片付ける）でも、`service.close()` の間はループが止まるので、PWA に OFF が届くのは `service.close()` の前（pump の settle 中）であることだけに依存している。いまの順序（pump → capture → WebSocket）ではそのとおりなので事故にはならないが、順序を変えると壊れる。
- 直し方: 手順書を「最大 10 秒」にする。コードは `await asyncio.to_thread(service.close)`。

## Info

1. **入口が足した遅延（赤の経路）**: `StoppableSource.read` は 1 回の `Event.is_set()`（約 100 ns）。ファイル出力は `frame.processed`（約 10 Hz、`logging.FileHandler` は 1 行ごとに flush）を、推論のあと・yield の前に同じスレッドで書く。数十 µs〜ms の見込みで、frame→sent の数字には入るがごくわずか。`flag.sent` の `t_sent` は `sender(text)` の**前**に取った時刻（hub.py `_emit`）なので、ログ書きが t_sent を膨らませることは無い。stdout には何も出さず、端末（stderr）は WARNING 以上のみ。ただし `infer.over_budget` は遅いと毎フレーム WARNING で端末に出る。端末が詰まる（ssh の停止、Ctrl-S）と推論スレッドが書き込みで待つ。重要度は低いが、遅いときほど遅くなる形ではある。
2. **t_frame は `read()` が戻った時刻**（sources.py `CameraSource.read`）。60 fps のカメラを 10 fps に間引き、推論中（約 30〜100 ms）は読まないので、ドライバのバッファに溜まった古いフレームが次の `read()` で返る可能性がある。そのぶん frame→sent は実際の「鹿が写ってから」より短く出る。edge-camera の Deferred（最新フレーム優先）の既知の件。実機で 1 度、画面のストップウォッチをカメラに写して実際の遅れを見ると、この見落としが分かる。
3. **停止の順序**: pump（刻み続けて OFF を送る）→ capture → WebSocket → カメラ。契約（`CaptureService` の docstring、仕様 R3）どおり。`StoppableSource` は旗のあとに戻ったフレームを捨てて None を返すので、停止の瞬間の最後の 1 フレームの赤は出ないが、停止中なので問題なし。
4. **forced でカメラを解放しない判断は妥当**。別スレッドが `read()` の中にいる VideoCapture を解放すると落ちうる、OS がプロセス終了で離す、`logging.shutdown()` のあとの `os._exit`。サブプロセスのテスト（RUN-4b）がある。forced では OFF が届かないが、プロセス終了で TCP が閉じるので PWA は切断で知る。2 回目の Ctrl-C は `service.close()` を飛ばすので、保存キューの未書き込みの検知フレームは失われうる（意図した強制終了として許容）。
5. **`reason = "startup"` のまま `finally` に入る経路**（app.py:344、`_drive` が CancelledError などで抜けた場合）。`source.close()` が `read()` 実行中のスレッドの横で走る。シグナルのハンドラが旗を立てるだけなので通常は起きない。低い。
6. **カメラの `read()` が 1 回失敗するとプロセスが終わる**（`CameraSource.read` → SourceError → pump 終了 → exit 1、再接続なし）。仕様の Deferred（自動の再接続、担当=人 B、Day 6）に記載済みなので新規の指摘ではない。ただし、走行中の 1 フレームの欠落で赤が全部止まるので、launchd の KeepAlive と、せめて連続 N 回の失敗で落とす形を Day 6 に確実に入れてほしい。`read()` が戻らず固まる場合は、ハートビートが止まり（stalled、3 秒）PWA は「未接続」になる（誤って「鹿なし」は送らない）。
7. **L1 の縮退は契約どおり**: `start_l1` は SDK なし・URL 不正で None を返し、`pump(background=[])` で L0 だけで動く。L1 のタスクが死んでも `_report_background` が critical を残して検知は続く。`start_l1` が想定外の例外を出すと `serve` が落ちる（app.py:363、try なし）が、現在の実装は例外を出さずに None を返す設計。
8. **ANE の判定の目安**（手順書 §7 の cpu_only と比較）: nano のモデルは CPU でも速いので「ほぼ同じ」でも ANE 未使用の証拠にはならず、`cpu_and_ne` は ANE を保証せず CPU に落ちることもある。目安として貼るのはよいが、合否に使わない。GPU 指定でないこと（`run.started` の `compute_units: cpu_and_ne`）は走行ログで確認できる。
9. **PWA の開発サーバーは http のため、`navigator.wakeLock` は secure context でなく取れない**ことがある（LAN の http）。§9d で B4 の Wake Lock を確かめるものではない旨を書くとよい。また、ルートを INFO にしたので httpx（L1 の呼び出しごとに 1 行）などの第三者の INFO もファイルに入る。DEBUG を選ぶと PIL・coremltools の DEBUG が推論スレッドの同期の書き込みで増える（`_QUIET` は websockets だけ）。SIGHUP（ターミナルを閉じる）は扱わず、`run.stopped` が残らない。

## 測れなかったこと

- frame→sent / sent→shown の p95: 走行ログが未取得（実機の作業は 2026-11-07 にユーザー。仕様の Deferred）。ログに 3 つの時刻（`flag.sent` の t_frame・t_sent、`ack` の t_shown）が出る経路は、コードとテスト（RUN-AC-1）で確認した。
- L1 の p50 / p95、上書き件数、L1 併走の L0 fps 低下（20% 基準）: この feature は L1 なしが既定で、`--no-l1` は YOLO 単独のみ。併走の計測は `bench_l1.py`（`--no-l1` なし）で別に要る。
- 実物の yolo26n-480 の ANE での ms・fps、macOS のカメラ許可、PWA の赤の点滅・Wake Lock・「未接続」帯は実機待ち。

## 直す優先順位（提案）

1. W3（手順書の集計と順序）と W4（時計の差）: 実機の作業の前に直さないと、持ち帰る数字で合否が出せない。
2. W2（`last_invalid` の扱いとキー名・表の言葉）。
3. W1（`--log-level` から WARNING を外す）。
4. W5・W6（手順書の文言。コードは任意）。

## 対応（2026-11-06、メインセッション）

- 直した: W1（`--log-level` は DEBUG / INFO だけ）、W3（9c はファイル全体を grep、`ack` は 9d のあとと明記、9e に p50 / p95 の集計と 10 回以上）、W4（9e に両端末の時刻の自動設定と、同じ時計の `t_sent − t_frame` との突き合わせ）、W2 の手順書側（bench は乱数画像の推論の速さだけと明記）、W5・W6 の手順書側（自動で抜けるのは 10 秒ほど、読み込み中は Ctrl-C が効かない）
- 次に回す: W2 のコード側（`run_yolo_alone` の `last_invalid`・キー名）、W5 のコード側（起動中の `to_thread`）、Info の各項目
