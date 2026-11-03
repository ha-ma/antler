## edge-latency-reviewer 結果（ログ: なし、n = 0）

対象: `edge/detector/src/detector/{pipeline,sources,throttle,frame,inference,config,ports,log}.py` と `docs/specs/edge-camera/functional.md`（ブランチ feat/edge-camera、692ca33）。
走行ログ（`edge/` 配下の `*.jsonl`、`logs/`）は存在しない（`.claude/logs/sfad-guard.jsonl` は hook のログで対象外）。合成値は入れない。以下はコード読みのみ。数値は計算していない。

| 区間               | 予算                  | p50 | p95 | 最大 | 判定                                        |
| ------------------ | --------------------- | --- | --- | ---- | ------------------------------------------- |
| 推論               | ≤100 ms（目標 50）    | -   | -   | -    | 測れず                                      |
| 判定（2 フレーム） | ≤250 ms               | -   | -   | -    | 測れず（この feature の範囲外。edge-judge） |
| 通信               | ≤50 ms                | -   | -   | -    | 測れず（`t_sent` を出す経路がまだ無い）     |
| 描画               | ≤50 ms                | -   | -   | -    | 測れず（`t_shown` は PWA 側）               |
| 合計               | <1,000 ms（目標 500） | -   | -   | -    | 測れず                                      |

### Critical

なし。`t_frame` を持たずに推論へ進む経路は無い。`frame.processed`・`infer.failed`・`infer.over_budget`・`frame.out_of_order`・`clock.jump` のすべてに `t_frame` と `seq` がある（`pipeline.py` L75-108、`throttle.py` L38-47）。`t_sent` は送信段がまだ無いので判定できない（pwa-connect で再確認）。

### Warning

W1. カメラの `t_frame` が「read() から戻った瞬間」で、遅延を実際より良く測る（`sources.py` L94-96）。

- ドライバやバッファで待った分が `t_frame` の後ろに隠れる。ch6 の合計の起点は「カメラフレーム時刻」なので、起点が遅れる。
- spec の Deferred（L159）が認めている。ただし期日 11-05 の実測より前に直さないと、最初の p95 が無意味になる。
- 実機では `CAP_PROP_POS_MSEC` か、grab() 直後の打刻に切り替える。それが取れないときは、ログに「t_frame は read 戻り時刻」と明記する。

W2. 同期の 1 本ループで、推論中にカメラのバッファが古い絵を溜める（`pipeline.py` L52-70）。

- 推論 100 ms、間引き 100 ms（10 fps）だと余裕が無い。推論が間引き間隔を超えるたびに、次の `read()` はバッファ内の古い絵を返す。
- W1 の打刻位置と合わさって、古い絵に「新しい t_frame」が付く。`ts − t_frame` を見ても滞留は出ない。
- spec L157 は「古い絵のまま `t_frame` が次へ渡る」と書いているが、L159 と矛盾する。現実装では `t_frame` は新しく、絵が古い。L157 を直す。
- 実機の前に、(a) `CAP_PROP_BUFFERSIZE` を 1 にする（AVFoundation で効くかは実機で確認）、(b) 読み取り専用スレッドが最新 1 枚だけ持つ、のどちらかを入れる。(b) なら W1 の打刻も grab 時点に移せる。

W3. 「推論」区間が `infer_ms` だけで、ch6 の定義（フレーム取得 → 一次検知の結果）より狭い。

- `infer_ms` は `detector.detect()` のみ（`pipeline.py` L68-70, L89）。リサイズ（L66）と、`read()` 戻りから推論開始までの時間が入らない。
- 結果完了時刻がログに無い。`ts`（ログ書き出し時刻）で代用はできるが、`frame.processed` の書き出しは検出後なので近似にとどまる。
- `frame.processed` に `t_infer_done`（壁時計、JST、ミリ秒）と `resize_ms` を足す。これで推論区間 = `t_infer_done − t_frame` が取れる。判定区間（最初の閾値超え → ON 確定）も同じ時計で引ける。

W4. 呼び出し側の処理が同じスレッドで読み取りを止める。

- `process_frames` はジェネレータで、消費側（判定・WebSocket 送信）が重いと、次の `read()` に入るのが遅れる。W2 の滞留がさらに悪化する。
- B2-5 の VLM は、このループでインラインに待たない。結果待ちでフラグ ON を遅らせない（0.8 以上は待たない）という契約を、edge-judge の spec に書く。
- 1 Hz のヒートビートとフラグ変化の送信は、別キュー（または変化を優先）にする。同じキューだと、変化が最大 1 秒遅れ得る。

W5. 古い結果を捨てる規則が無い。

- `infer.over_budget` は警告だけで結果は残る（意図どおり）。ただし完了時点で `now − t_frame` が閾値（例 300 ms）を超えたフレームを、判定に流すか捨てるかが未定。
- 判定の 2 フレーム連続は `seq` 連続を条件にするか、`t_frame` 間隔を条件にするかを、edge-judge で決める。

### Info

I1. 間引きの前に全フレームを `read()` している（`pipeline.py` L54-63）。

- 60 fps・1280×720 の BGR 変換とコピーを毎フレーム行い、6 枚中 5 枚を捨てる。`grab()` だけで捨て、通すフレームだけ `retrieve()` すれば、色変換とコピーを約 1/6 に減らせる。
- `Capture` プロトコルが `read()` のみなので、`grab()/retrieve()` を足す変更が要る。実機で `read()` の 1 回の時間を測ってから決める。

I2. `resize_frame` は numpy の整数インデックス（最近傍）で、毎回インデックス配列を作る（`frame.py` L42-44）。

- 1280×720 → 640×480 の実時間は未測定。spec の「10 ms 未満」（L260）は未検証のチェック項目のまま。
- `Frame` の再構築で `__post_init__` の検査と `astimezone` がもう 1 回走る（数十 µs のはず、未測定）。
- 16:9 を 4:3 に引き伸ばす。遅延ではなく精度（B2-2）の話なので、人 B に共有する。
- CoreML 側がレターボックスや自前リサイズを持つなら二重になる。実モデルの入力サイズを決めるときに確認する。

I3. ログは同期の `StreamHandler(stdout)` で、10 fps × 1 行（`log.py` L45-52）。書き込み自体は軽い。

- stdout がパイプで、読み手が詰まると `logger.info` でループが止まる（launchd・tee など）。ファイル出力か非同期ハンドラ（`QueueHandler`）を検討する。

I4. `VideoFileSource` の `t_frame` は「開始時刻 + seq/fps」の合成値（`sources.py` L83）。

- 動画の再生ログでは `ts − t_frame` が実遅延にならない。再生は精度評価用で、遅延の根拠にしない。走行ログ（`CameraSource`）だけを遅延の根拠にする。

I5. `t_frame` は壁時計（`datetime.now(UTC)`）で、NTP の補正で飛び得る。

- `FrameThrottle` は 1 秒超の戻りを `clock.jump` として扱うので、取り込みは壊れない。
- 端末間の時計のずれ（Mac とスマホ）は spec の Deferred（L160）。ack の往復から補正するか、しないかを、通信・描画区間の報告に明記する。いまは補正の仕組みが無い。

### 測れなかったもの

- 推論（実測）: 実機・実モデルが無い。`frame.processed.infer_ms` が出れば p50/p95 は出せる。W3 の `t_infer_done` と `resize_ms` を足すと、ch6 の定義に合う。
- 判定（2 フレーム）: 判定段が未実装。ログに `flag_on_confirmed`（確定時刻）と、最初の閾値超えフレームの `t_frame` が要る。
- 通信: `t_sent` の送信段が未実装。フラグ JSON と走行ログの両方に `t_sent` を残し、PWA の受信時刻（`t_recv`）を ack に入れる。
- 描画: PWA の `t_shown` ack が未実装。
- 合計: 上記が揃うまで出せない。端末間の時計補正の方法（ack の往復の半分で補正するか）を先に決める。

### 次にやること（優先順）

1. W2 と W1: 最新 1 枚だけ保持する取り込みと、grab 時点の打刻（11-05 の実機の前）。
2. W3: `t_infer_done` と `resize_ms` を `frame.processed` に足す（許可リストの項目を増やすので、spec の R6 と AC に反映）。
3. spec L157 の記述の矛盾を直す。
4. edge-judge と pwa-connect の spec に W4・W5 を引き渡す。
