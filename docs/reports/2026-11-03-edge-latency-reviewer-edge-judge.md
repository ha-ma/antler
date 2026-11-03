## edge-latency-reviewer 結果（ログ: なし、n = 0）

対象: `edge/detector/src/detector/{judge,flag,hub,server,runner}.py`（読み取りの補助に pipeline・frame・throttle・sources・config・log）と `docs/specs/edge-judge/{functional,resilience}.md`。ブランチ feat/edge-judge（43bd761）。
走行ログは存在しない（`edge/` 配下に `*.jsonl` なし、`logs/` なし。`.claude/logs/sfad-guard.jsonl` は hook のログで対象外）。合成値は入れない。p50 / p95 / 最大は計算していない。以下はコード読みと、設定値からの算術、標準ライブラリでの 1 件の再現確認だけ。

| 区間               | 予算                  | p50 | p95 | 最大 | 判定                                                                  |
| ------------------ | --------------------- | --- | --- | ---- | --------------------------------------------------------------------- |
| 推論               | ≤100 ms               | -   | -   | -    | 測れず（ログなし。`frame.processed.infer_ms` はあるが推論器は未実装） |
| 判定（2 フレーム） | ≤250 ms               | -   | -   | -    | 測れず。設定から見た構造上の上限は後述（W1）                          |
| 通信               | ≤50 ms                | -   | -   | -    | 測れず（ack に受信時刻がなく、通信と描画を分けられない。W2）          |
| 描画               | ≤50 ms                | -   | -   | -    | 測れず（同上）                                                        |
| 合計               | <1,000 ms（目標 500） | -   | -   | -    | 測れず（時計のずれを補正していない）                                  |

### Critical

なし。

- `flag.sent` は `change` / `heartbeat`（`_emit`、hub.py L139-158）と `snapshot`（L88-97）の 3 経路すべてで `t_frame` と `t_sent` を JSON ログに出す。フラグを送って `flag.sent` が出ない経路は、`sender` が例外を投げた場合だけ（`_emit` が途中で抜ける）。`broadcast(..., raise_exceptions=False)` なので実際には起きにくい。
- `t_frame` を持たない `FrameResult` や `JudgeState` は作れない（`JudgeState.t_frame` は必須）。
- JSON 行は標準出力には出る。ファイルに残す設定と、実走行の入口が無い（W7）。これは Critical の条件（ログに残らない経路）とは別。

### Warning（優先順）

**W1. ON フラグの `t_frame` が「2 枚目」のフレームで、判定区間の 1 枚目待ちがどのログにも出ない**（judge.py L90-98）

- ON にした時点の `JudgeState.t_frame` は 2 枚目の `t`。`flag.sent` の `t_sent − t_frame` と ack の `since_frame_ms` は、ch6 の「判定（2 フレーム）」より 1 フレーム間隔ぶん短く出る。間隔は 10 fps で約 95〜100 ms、5 fps で約 200 ms（throttle.py の間隔 1/fps − 5 ms 許容）。合計も同じだけ良く見える。
- 設定からの上限の算術（測定ではない）: 判定 = 1 フレーム間隔 + 2 枚目の推論（予算 100 ms）+ ループへの受け渡し。10 fps で約 200 ms、**5 fps（下限の設定）で約 300 ms となり 250 ms を超えうる**。推論が 100 ms ちょうどなら、同期ループ（pipeline.py L52-70）の実効間隔は max(間隔, 推論) になる。
- 直し方: `Judge` が連続の 1 枚目の `t_frame` を持ち（`_streak` が 0 → 1 になるとき）、ON の `flag.sent` に `t_first_hit` をログ項目として足す（ワイヤのフラグには足さない。schema は凍結）。足すまでは `frame.processed`（`deer_count ≥ 1`、`max_conf ≥ 0.4`）の 2 枚目の 1 つ前から引ける。ただし高さ 0 のボックスは `max_conf` に出ないので厳密ではない。

**W2. ack の遅延は、時計のずれを含み、通信と描画を分けられず、どのフラグへの ack か分からない**（hub.py L117-137）

- `since_frame_ms = t_shown（スマホの時計）− t_frame（Mac の時計）`。補正なし（spec L69・L159、Deferred）。ずれた値が p50 / p95 に混ざる。
- 補正の案（スキーマ変更なし）: ack を受けた Mac の壁時計を `t_ack_recv` としてログに足し、`t_ack_recv − t_frame` を出す。両方 Mac の時計なので**ずれの影響を受けない合計の上限**（上り経路の分だけ大きい）になる。`ts`（ログ書き出し時刻、Mac）でも代用できるが、明示のほうがよい。
- 通信（`t_sent` → スマホ受信）と描画（受信 → `t_shown`）は、ack に受信時刻が無いので分けられない。ch7 の ack は `t_shown` だけ。分けるには ack に `t_recv` が要る。これは schema の変更なので、凍結 API の変更として人 A・人 B の合意が要る。当面は「通信 + 描画」を 1 つの区間として報告する。
- ack にフラグの識別子がない。`_ack_t_frame` は「最後に送った deer:true の最初の t_frame」だけで、ON → OFF → ON が 1 秒内に続くと、遅れた前の ack が新しい ON に結びつく。
- `_ack_t_frame` は、クライアントが 0 のときの ON でも更新される（`sent` を見ていない。L144-145）。接続前の ON の `t_frame` が、再接続後の snapshot への ack（W3）と結びついて、数秒〜数十秒の `since_frame_ms` が出る（PWA は danger の表示を始めたとき ack を 1 回送る）。`ack` のログに `last_flag_reason`（直近に送ったのが change / snapshot か）を足すか、`since_frame_ms` を change の ack だけに付ける。

**W3. 停止中・再接続時に snapshot が「新しい `t_sent`」で古い状態を送り、接続のやり直しが続く**（hub.py L82-98、server.py L119-121）

- `snapshot()` は `_stalled` を見ない。`tick` が守っている「見えていないのに鹿なしを送らない」（L79）を破る。
- 利用者に見える結果（W6 と PWA の動作の組み合わせ。PWA 側は未実行で、コードの記述からの推定）: カメラ停止 → ハートビートが止まる → PWA が 3 秒で閉じる → 1 秒後に再接続（約 4 秒）→ snapshot が新しい `t_sent` で古い状態を運ぶ → PWA は「未接続」を外して古い緑 / 赤を出し、3 秒タイマーが戻る → 3 秒後にまた閉じる。停止のあいだ約 4 秒周期で、グレー帯が古い状態の上で点いたり消えたりし、ログに `client.connected` / `disconnected` が積もる。
- 再接続時の snapshot は `t_sent − t_frame` が遅延ではなく滞留時間になる。分析側は `reason=change` だけを見る約束にする（または snapshot の `flag.sent` に `stale: true` を付ける）。
- 直し方: `_stalled` のときは snapshot を送らない（PWA は無受信のまま「未接続」を保つ）。

**W4. 1 本のティッカー・タスクが落ちると、expire とハートビートが黙って止まる**（runner.py L34-37）

- `ticker()` は例外を捕まえない。`hub.tick()` が一度でも例外を出すとタスクが終わり、`pump` は気づかず続ける（`await task` は finally でだけ）。入力が止まると ON が解けない（固定の赤）。resilience.md の「固定の ON を作らない」に反する。
- 直し方: `ticker` の中で `try/except Exception` して `logger.error("ticker.error")` で続ける。または `pump` のループで `task.done()` を見る。

**W5. 遅いクライアントの上限が緩く、危険フラグが古いフラグの後ろに並びうる**（server.py L29, L91-104）

- `MAX_WRITE_BUFFER = 256 KB`。フラグは約 250 B なので、約 1,000 通（ハートビート 1 Hz なら約 17 分）溜まるまで `client.slow` で切らない。OS の送信バッファ（`get_write_buffer_size` は見ない）も入れると、劣化した Wi-Fi では危険フラグが古いフラグの後ろに並び、配信が通信予算（50 ms）どころか ping の切断（下記 Info）まで遅れうる。実質的な守りは ping だけ。
- 直し方: 16 KB 程度（約 60 通）に下げる。`serve(..., compression=None)` も足す（既定は permessage-deflate で、約 250 B のフラグを接続ごとに圧縮する。遅延への効きは小さいが利点もない）。
- 良い点: `broadcast()` は待たない（`websockets.asyncio.server.broadcast`）。ハートビートと変化の送信は同じ同期経路で、キューも待ちもないので詰まらない。TCP_NODELAY は asyncio の既定。

**W6. 停止の検知から「未接続」までの時間と、復帰の記録**（hub.py L67-80）

- 停止は `stall_after_s = 3.0` 後にハートビートを止める。PWA は 3 秒無受信で閉じる（edge-client.ts L5）。カメラが止まってから「未接続」まで 3.0〜6.0 秒（最後のハートビートが出る前の 0〜3 秒 + PWA の 3 秒）。間に 1.5 秒の OFF（`expire`）が入る。
- `judge.stalled` は 1 回だけ出るが、`judge.recovered` が無い。`_stalled = False` に戻すだけ（L63）。停止の長さがログから出せない。復帰時に `judge.recovered`（停止の秒数つき）を出す。
- ハートビートの間隔は 1.0〜1.1 秒（ティック 0.1 秒の刻みでの判定、L73）。PWA の 3 秒に対して余裕は 2 通ぶん。ループが 2 秒以上詰まる（Info のログのブロッキング）と PWA が閉じる。

**W7. 実走行でログが出ない（どの Deferred にも載っていない）**

- `AlertServer` / `pump` / `AlertHub` を組み立てて動かす入口（`__main__` やスクリプト）が、テスト以外に無い（`grep` で確認）。`configure_logging` は標準出力だけで、ファイル（`*.jsonl`）に残す設定が無い。ch6「B：検知・遅延・切断をローカルログに」と、このエージェントの探索先（`edge/**/*.jsonl`、`logs/`）に合わない。`functional.md` と `roadmap.md` を `Deferred|入口|CLI|__main__|jsonl|logs/` で検索したが、入口とファイル出力を先送りする記述は無い。別 feature に回すなら、spec の Deferred に担当と期日を書く。
- 直し方: 入口を作り、`logs/run-YYYYMMDD-HHMMSS.jsonl` に書くハンドラーを足す（標準出力と両方）。`.gitignore` に `logs/` を入れる（匿名でも、走行時刻と距離が入る）。11-05 の実機測定より前に必要。

**W8. 起点が実際より遅い（edge-camera W1・W2 の再掲）**

- `t_frame` は `read()` から戻った瞬間（sources.py L98）。カメラ内のバッファと、推論中に溜まった古い絵（pipeline.py L52-70）が `t_frame` の前に隠れる。判定と合計は、これを引き継いで常に実際より短く出る。実機の前に、読み取り専用スレッド（最新 1 枚だけ持つ）か `CAP_PROP_BUFFERSIZE=1` を入れる。対応済みかは edge-camera 側の報告を参照。

### Info

- **ping の設定が spec と違う**: spec（resilience.md L16, L27）は「5 秒おきに ping、5 秒で切る」。実装は `ping_interval=1.5`・`ping_timeout=2.5`・`close_timeout=1.0`（server.py L42-45）。切断の検知は最大 4.0 秒、接続が外れるまで最大 5.0 秒（websockets の keepalive は失敗後に close_timeout を待つ）。spec が緩い。実装のほうが安全。spec を実装に合わせて直す（resilience.md の 2 か所）。
- **5 秒以内の再接続**は主にクライアントの動作。PWA は 3 秒無受信で閉じ、1 秒後に再接続（edge-client.ts L5）。Wi-Fi が戻っていれば、検知 2〜3 秒 + 1 秒 + 接続で約 4.x 秒。余裕は 1 秒弱。「切断テスト」（ch6 の測り方）で実測する。サーバー側は、古い接続が最大 5 秒スロットを占める（`max_clients=16`）が、再接続は別の接続で通る。
- **範囲外の `t_shown` で接続が切れる**: `"9999-12-31T23:59:59+00:00"` や `"0001-01-01T00:00:00+14:00"` は `fromisoformat` は通るが、`format_t_frame` の `astimezone(JST)` が `OverflowError` を出す（標準ライブラリで確認）。`_on_ack` は `ack.invalid` に落とさず例外が出て、`_handle` の `except` が `client.error` を出してその接続を閉じる。判定と他のクライアントには影響しない。LAN 内のみなので Info。`format_t_frame` を `try/except (OverflowError, ValueError)` で囲んで `ack.invalid` にする。
- **snapshot の `t_sent` が 2 つ**: ワイヤに載せる値（L87）とログの値（L92）が別々の `self._wall()` の呼び出しで、数 µs〜ms ずれる。1 回の値を共有する。
- **スレッド**: `asyncio.to_thread(next, results, None)` で推論は別スレッド。ループは推論で止まらない（ping と送信が止まらない設計は正しい）。numpy のリサイズ（frame.py L42-44）は GIL を持つが短い。推論器（CoreML）は GIL を放すかを実機で確認する。
- **ログのブロッキング**: `hub` のログは `StreamHandler`（同期）でループの上から書く。標準出力が詰まる（パイプの先が遅い）と、ループ全体と ping が止まる。ファイル出力にする（W7）と避けられる。
- **ack のクライアント識別**: `ack` にはクライアントの識別子がなく（プライバシー上は正しい）、複数台の ack が同じ `_ack_t_frame` と結びつく。デモは 1 台なので影響は小さい。
- **判定の `_last_hit_mono`**（`now` はループが結果を受けた時刻）と `_maybe_off`（`t_frame` の差）は別の時計で 1.5 秒を測る。推論の遅れぶんだけ expire の OFF は update の OFF より遅れる。仕様どおり。

### 測れなかったもの

- 推論 — ログが無い。推論器（YOLOv8 CoreML）が未実装で、`infer_ms` を出す実機の走行が無い。`frame.processed` に `t_infer_done`（edge-camera W3 の提案）を足すと、`t_infer_done − t_frame` が取れる。
- 判定（2 フレーム）— 1 枚目の `t_frame` がどのログにも無い（W1）。`flag.sent` に `t_first_hit` を足す。
- 通信 — ack にスマホの受信時刻が無い（W2）。ack に `t_recv` を足す（schema 変更、合意が要る）。
- 描画 — 同上。
- 合計 — 時計のずれを補正していない（W2）。ack に `t_ack_recv`（Mac の壁時計）を足すと、ずれの影響を受けない上限が取れる。

### 次に足すと測れるもの（まとめ）

1. `flag.sent`: `t_first_hit`（ON のとき）、`stale`（snapshot のとき）。
2. `ack`: `t_ack_recv`、`last_flag_reason`、`since_recv_ms`（`t_ack_recv − t_frame`）。
3. `frame.processed`: `t_infer_done`。
4. `judge.recovered`（停止の秒数）。
5. 実走行の入口と `logs/*.jsonl`。
