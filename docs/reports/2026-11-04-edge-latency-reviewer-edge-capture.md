# edge-latency-reviewer: edge-capture（edge 側、コミット 2ae9367）

対象: `edge/detector/src/detector/capture/*.py`、`pipeline.py`（FrameResult.image）、`l1/runner.py`（observer）、`config.py`（[capture]）。
作業ツリーでは `capture/http.py:158` に未コミットの修正（`method not in allow.split(", ")`）がある。読んだのは作業ツリー。

## 結果

```
## edge-latency-reviewer 結果
遅延 p95: frame→sent 未測定 / sent→shown 未測定 / 合計 未測定（走行ログ・実カメラ・本番 YOLO が無い。下の「測れなかったこと」）
offer（検知スレッド側の追加）: 受理 p50 2.4 / p99 5.8 ms（n=300）、対象外のフレーム 0.001 ms。目標 1 ms 未満は満たさない
L1 observer（on_l1_answer）: 平均 0.009 / p99 0.020 ms（64 件走査）。ループへの影響なし
Critical: 0 / Warning: 2 / Info: 6
```

赤の経路そのもの（推論→判定→配信）には、保存は入っていない。ただし次のフレームの読み込み前に offer が走るので、ここに 1 フレームあたり約 2.5 ms が乗る（W1）。

測定環境: Apple M2、負荷平均 73（他のセッション・VM が動いている）。M1 / 16 GB の実機ではない。ばらつきの大きい p99・最大より、中央値と相対比を信じること。計測スクリプトはスクラッチパッド（`bench_capture.py`, `bench2.py`, `bench3.py`, `scen.py`, `cvimp.py`）。コードは変えていない。

pytest は 591 件通過、カバレッジ 96.9%（スクラッチパッドの venv）。

## 1. 検知の経路に保存が入って遅くしないか

構造（`service.py:85-93`、`runner.py:59`）: `wrap` は `yield result` のあとに `_offer` を呼ぶ。`pump` は `await to_thread(next, results)` で次を取りに行くので、**offer は次の `next()` の頭、つまり次フレームの `source.read()` の前に、推論と同じスレッドで走る**。
自分の結果の `hub.on_result` とは重ならない（`hub.on_result` が終わってから次の `next()` が呼ばれる）。赤を出す 2 フレーム目を遅らせるのは、1 フレーム目（保存対象）の offer の分。

| 計測                                       | n      | 平均       | p50        | p99       | 最大    |
| ------------------------------------------ | ------ | ---------- | ---------- | --------- | ------- |
| `shrink` 640×480→320（現行の fancy index） | 1000   | 3.34       | 2.54       | 17.9      | 81      |
| 同（負荷がさらに高い回）                   | 2000×3 | 5.9〜7.8   | 2.7〜4.2   | 47〜55    | 86〜128 |
| `offer` 受理（縮小＋ロック＋Pending）      | 300    | 2.68       | 2.41       | 5.82      | 6.78    |
| `offer` 保存対象でないフレーム（鹿なし）   | 1000   | 0.001      | 0.001      | 0.001     | 0.007   |
| 代案 `image[::2, ::2]` のコピー            | 2000   | 0.47〜2.1  | 0.45〜0.64 | 0.9〜27   |         |
| 代案 `cv2.resize(INTER_NEAREST)`           | 2000   | 0.09〜0.40 | 0.09〜0.11 | 0.16〜7.8 |         |

- 費用は `shrink` の `image[rows[:, None], cols[None, :]]`（`jpeg.py:35`）がほぼ全部。GIL の取り合いは**測って確かめた**: スレッドで `shrink` を 6 秒間隙間なく回しても、1 ms 刻みの ticker の遅れは中央値 0.20 ms / p99 6.7 ms で、何もしない場合（0.23 / 5.2 ms）と区別できなかった（`gil.py`、`cv2.resize` も同様）。つまり問題は GIL ではなく、**次のフレームの開始がその分だけ直列に遅れる**ことだけ。
- 保存対象でないフレームの offer は 1 µs。`FrameResult` を保持する部品は `l0/`・`hub`・`fusion` に無い（detections などの値だけを読む）ので、921 KB の `image` が溜まることはない。鹿が出ていないとき（大半）は影響しない。
- `t_frame` は `read()` から戻った瞬間の壁時計（`sources.py:97`）。offer が `read()` の前にあるので、ドライバのバッファに溜まった分の遅れは `t_frame→t_sent` に出ない。実害は 1 フレーム ≈ 2.5 ms で赤の予算（判定 250 ms）に比べて小さいが、**計測には見えない遅れ**である。
- テスト（`test_capture_recorder.py:167-173`）は 5 回の offer が 0.5 秒未満かだけを見ていて、1 ms 目標も `capture.slow_offer`（resilience.md の観測要件、5 ms で警告）も実装・検証されていない。

## 2. 有界キュー・ワーカー・ロックの競合

- **`_cond` は I/O の間に持たれていない。** `_run`（`recorder.py:217-235`）は pop と `_busy` の更新だけ、`_save` は `has` の再採番と `probs` の読み取りだけで取る。`encode`・`store.save`・`attach` は外。`on_l1_answer` が待たされる相手は `offer` の短い区間だけ。
- 例外: `logger.info("capture.run_limit")`（141 行）と `logger.warning("capture.dropped")`（160 行）が `_cond` の中。ログは stdout への同期書き込み（`log.py:47`）。stdout が詰まるとループの `on_l1_answer` が待つ。頻度は min_interval_s（既定 2 秒、下限 0.5 秒）に 1 回以下。
- **`CaptureStore._lock` は I/O の間ずっと持たれている**（`save` は fsync 2 回、`attach` は 1 回、`set_consent`・`mark_uploaded` は件数分）。イベントループはこのロックに触れない（`hub`・`runner`・`l1` は store を使わない）ので、赤の配信は待たない。待つのは HTTP スレッドの一覧とワーカー。
  - 計測: `store.save` p50 0.70 / 最大 3.5 ms、`attach` p50 0.40 / 最大 2.2 ms（この Mac の SSD。fsync は軽い）、`store.list`（2000 件）2.5 ms、`GET /captures`（2000 件・200 件返す）4.2 ms（目標 50 ms に対して余裕）。一覧がワーカーの保存中に待たされても最大 12.5 ms。
  - 最悪は `set_consent` に 200 件を渡したとき 71 ms ロックを持つ。走行後の操作で、そのあいだ保存は `has`/`save` で待つだけ。
- GIL: 一覧（純 Python の JSON 化 ≈ 4 ms）を 20 ms 周期で叩き続けると、ループの遅れの p99 が 7〜14 ms から 16〜27 ms に上がった（負荷の高い環境なので参考値）。PWA は起動時に 1 回しか取らない（`use-pending-captures.ts:35-37` で refetch 無効）ので、実運用の影響は小さい。保存ワーカー単独（20 ms 周期の一覧なし）ではループの遅れの中央値は変わらなかった（1.1 ms）。
- 計測の注意: 最初の実行で出た最大 85 ms のスパイクは、計測スクリプトがループの上で `Thread.join()` を呼んだ時刻（5.2 秒）と一致する。計測の不具合なので数えない。

## 3. `run_l1` の observer

- `_observe` は `hub.on_l1(verdict)` と `l1.result` のログのあと、`asyncio.timeout` の外で呼ばれる（`runner.py:163-165`）。降格・ログ・タイムアウトに影響しない。
- 呼ばれた先の仕事は確率の検査と `_cond` 内の最大 64 件の走査だけ（平均 9 µs）。ディスクに触れない。`fresh=False` は先頭で戻る（`recorder.py:179`）ので、降格・ログ・`stale` による即時の聞き直しは変わらない。
- 例外は二重に握る（`on_l1_answer` の `_probs_of` と `_observe`）。`_cond` の取得・走査の例外は `_observe` が受ける。問題なし。

## 4. `l1Probs` の付与ルール

CONC-3（答えが先／保存が先／保存の途中）は取りこぼさない。`scen.py` の S3（`store.save` の最中に答えを入れる）で一度だけ付いた。`saved` と `late` の組み合わせで穴は見つからなかった。

論理の穴は「どの答えを付けるか」にある（W2）。

- 再現 S1: A のフレーム（t=0）を保存、答えがまだ無い。t=2.9 に別の鹿（B）についての答えが来ると、A の Capture に付く（窓 3 秒以内）。recorder は episode・track_id を持たない。
- 再現 S2: t=0 に前のエピソードの答え（on_roadway=0.99）。t=2.9 に新しい鹿の最初の保存で `_last_answer` が窓内なので 0.99 が付く。t=3.3 の本当の答え（0.01）は `pending.probs is None` を満たさず付かない。**古い答えが最初に付くと、正しい答えが来ても直らない**（一度だけの規則のため）。
- L1 は赤でないときも 2〜3 Hz で主トラックを聞く（`fusion.py:136-152`）ので、「窓内に何かの答えがある」はほぼ常に成り立つ。つまり S2 は連続した鹿・複数の鹿で普通に起きる。
- 答えの `at` は返ってきた時刻（`runner.py:165`）。聞いた時刻 `started` ではないので、最大 800 ms ずれる。
- 校正前の生の確率は付く（`_probs_of` は `answer`＝校正前）。`dict(levels)` でコピーしている。ここは仕様どおり。

## 5. 縮退

- 保存の失敗は赤を止めない。`offer`・`service._offer` が二重に握り、ワーカーは 1 枚ごとに握る。
- `scen.py` S5（エンコーダが常に例外、10 fps で 120 秒）: `capture.failed` 60 件、`capture.degraded` 1 回、回復後に `capture.recovered` 1 回と `capture.saved` が再開。`degraded` は 20 回目に 1 回だけで連発しない。
- S4（ワーカーが止まる、120 秒）: `capture.dropped` 51 件（約 0.4 件/秒）。`_last_saved_t` を満杯でも置く（150 行）ので、毎フレームの warn にはならず min_interval_s で間引かれる。`queue_size` 8 を埋めるまで 16 秒かかる。1 秒に 1 回の間引きは要らない（min_interval_s の下限 0.5 秒でも 2 件/秒）。
- S7: 失敗した offer も `max_per_run`（300）に数えるので、保存が約 10 分失敗し続けると、回復してもその起動では二度と保存しない。`capture.run_limit` は info で 1 回だけ。I2。

## 6. 走行ログ

- `pipeline.py` の変更は `FrameResult.image` の追加と `yield` の引数だけ。`frame.processed` の `t_frame` は変わらない。`hub` は `image` を読まない。`compare=False, repr=False` なので比較・ログに出ない。
- `capture.*` の `extra` のキー（`scen.py` S6 で実測）: `error_type`、`failures`、`id`、`t_frame`、`encode_ms`、`write_ms`、`bytes`、`dropped`、`max_per_run`、HTTP は `method`・`route`・`status`・`ms`。画像・位置・Capture の中身は出ていない。`id` は乱数 48 ビット。
- `capture.saved`・`capture.http` は保存・要求ごとに 1 行。量は上限あり。

## 指摘

### Critical

なし。

### Warning

- W1 `edge/detector/src/detector/capture/jpeg.py:35` と `recorder.py:152` — offer が 1 ms 未満の目標を満たさない（受理時の中央値 2.4 ms、p99 5.8 ms）。しかも次のフレームの読み込みの前に走り、その遅れは `t_frame→t_sent` に出ない。`capture.slow_offer`（5 ms 超）も実装されておらず、テストは 1 ms を見ていない。
  直し方（推奨順）: (1) `result.image` の参照をキューに渡し、縮小をワーカーで行う。`resize_frame`（`frame.py:44`）はフレームごとに新しい配列を作るので、「元の画像は次の推論でも使われる」（recorder.py:151）のコメントは当たらない。検出器が入力を書き換えないことだけ確かめる。キューは最大 8 枚 × 921 KB ≈ 7 MB。(2) offer の中で縮めるなら、`cv2.resize(..., INTER_NEAREST)`（0.1 ms）は `from_config` で cv2 を先に import してから（I4。さもないと初回の 420 ms がこのスレッドに乗る）。`image[::2, ::2]` のコピー（0.5 ms）は `image_width` がちょうど 320 のときだけ使える（設定は 160〜640）。(3) offer の所要を計り、5 ms 超で `capture.slow_offer` を出す。1 ms をテストにする。
- W2 `recorder.py:162-165,192-194` — `l1Probs` を付ける答えの選び方。古い答え（最大 3 秒前、別の鹿・別のエピソード）が先に付き、あとから来る正しい答えは「一度だけ」の規則で捨てられる（再現 S1・S2）。
  直し方: 窓を非対称にする（過去 1 秒・未来 3 秒など。答えは聞いた時刻 `started` 以降のフレームを知らないので、過去側は短い）。observer に `started` を渡す。保存前の pending は、より近い答えが来たら置き換える（保存済みは今までどおり一度だけ）。可能なら `L1Verdict.episode` を observer に渡し、offer 側にも episode を持たせる（hub 側の変更が要るので推奨で決めてよい）。

### Info

- I1 `recorder.py:141,160` — `logger.info/warning` が `_cond` の中。stdout が詰まると L1 のループの `on_l1_answer` が待つ。ロックの外へ出す（`dropped` は戻り値の分岐で）。
- I2 `recorder.py:138,167` — 失敗した offer も `max_per_run` に数える（S7）。成功した保存だけ数えるか、`degraded` からの回復で戻す。
- I3 `store.py:118-134,141-156` — `_lock` が fsync と unlink（`_evict`・`_delete`）の間ずっと持たれる。赤には響かないが、`set_consent` 200 件で 71 ms、期限切れ・退避が一度に多いと `capture.expired`/`capture.evicted` のログがロックの中で連続して出る。起動時の `_expire` は `__init__` で済むので、一覧中に大量に消えるのは長く止めたあとの最初の一覧だけ。
- I4 `jpeg.py:41` — `import cv2` が初回の encode（ワーカー）で走る。別プロセスで計ると 420 ms かかり、そのあいだイベントループが最大 410 ms 止まった（GIL を離さない）。カメラ・動画の入力は `sources.py:_load_cv2` で先に読み込むので実機では起きないが、`from_config` で `OpenCvJpegEncoder` を作る時に import しておくと、別の入力でも最初の鹿に当たらない。
- I5 起動の入口がリポジトリにまだ無い（capture に限らない）。`src/` と `scripts/` で `pump(`・`start_l1(`・`process_frames(` の呼び出しを grep したが、docstring 以外に呼び出しが無い（`scripts/` は `generate_models.py` だけ）。`CaptureService` もテストと docstring だけ。入口ができたら、保存が実機の `t_frame→t_sent` に与える影響を走行ログで測り直す。
- I6 作業ツリーの `capture/http.py:158` の未コミット修正（`allow.split(", ")`）は、コミット済みの `method not in allow`（部分文字列の一致）を直すもの。コミットに入れること。

## 測れなかったこと

- 走行ログ（`edge/detector/logs/*.jsonl`）が無い。`t_frame`・`t_sent`・`t_shown` の内訳（frame→sent、sent→shown、合計の p95）は出せない。
- 実カメラ・本番の YOLO（CoreML・Neural Engine）・L1（local-jev）を同時に回した状態での offer と L0 の fps 低下（20% 基準）。Mac mini M1 / 16 GB の実機でもない。
- 起動の入口が無い（I5）ので、`wrap` → `pump` → `hub` をつないだエンドツーエンド。
- 計測はこの M2 で負荷平均 73 の中。p99・最大は信頼できない。中央値と相対比（現行 shrink : 代案 ≈ 25 : 1〜5 : 1）だけを根拠にした。
