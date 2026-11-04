# edge-latency-reviewer: edge-day0 (a1696ab, feat/edge-day0)

対象: `edge/detector/src/detector/bench.py`、`scripts/bench_l1.py`、`edge/detector/scripts/export_yolo_world.py`、`docs/runbooks/2026-11-04-mac-mini-day0.md`、`docs/specs/edge-day0/functional.md`、指示書 §4 Step0/6・§6。
方法: コードと文書の読み取りのみ（実機・走行ログ・ultralytics は無い環境。テストも実行していない）。

遅延 p95: 走行ログ無し（本コミットは計測の道具で、frame→sent / sent→shown は対象外）
L1 p50/p95: 未計測（実機待ち）・上書き 件数は対象外・L0 fps 単独/併走 未計測
Critical: 2 / Warning: 5 / Info: 5

## Critical

### C1. 手順書の通りでは scripts/bench_l1.py が手元に無い（手順 3）

- `docs/runbooks/2026-11-04-mac-mini-day0.md:42` は `git checkout main && git pull`。`git ls-tree main` に `scripts/bench_l1.py` は無い（このコミットは feat/edge-day0 にだけある）。`export_yolo_world.py`・`bench.py`・extra `day0` も同じ。
- 結果: 手順 4 の `pip install -e "edge/detector[dev,l1,day0]"` が `day0` extra を知らず警告だけで通り、手順 7 でファイルが無く止まる。
- 直し方: マージ後に使うと手順書に書くか、`git checkout feat/edge-day0` を入れる。マージ前にユーザーへ渡さない。

### C2. L1 の p95 が成功した呼び出しだけで、タイムアウトの欠損が数字に出ない（bench.py:176-188, 649-707）

- `run_l1` は失敗を p50/p95 から除く。timeout_ms 既定 800 では、遅い呼び出しほど `timeout` として落ち、p95 は常に 800 ms 以下に張り付く。たとえば 30% が timeout でも p95 は小さく見える。
- 失敗率の検査は、`l1_alone` では n==0 のときだけ（`_problem`、bench.py:617）。併走側の `MIN_ANSWERED_RATIO=0.8` は `l1_with_yolo` にしか効かず、`l1_alone` には無い。exit 0 のまま「p95 合格」と読まれる。
- 受け入れ基準「L1 の p50/p95」を嘘なく判定するには、`l1_alone` にも回答率を出して下限を設けるか、`failed` を含めた打ち切りの p95（失敗を timeout_ms として扱う値）を並べる。
- あわせて、warmup が 1 度も成功していないのに（`warmup_ms=None`）計測に進んでも valid のまま（bench.py:152-162, 289）。初回のモデル読み込みが計測の最初の数件に入る。warmup 失敗は `l1_alone` を無効にするか、少なくとも verdict に警告を出す。

## Warning

### W1. 併走の判定が単発の窓（bench.py:296-309）

- 単独 10 秒（既定）と併走約 40 秒を 1 回ずつ測る。20% の境界付近は run 間の揺らぎ（熱・他プロセス）で合否が変わる。単独窓を L1 前だけに取るので、順序の影響（熱）も混ざる。
- 直し方: 単独 → 併走 → 単独で挟み、前後の単独の差を verdict に出す。または 2〜3 回繰り返して最悪値で判定する。手順書 8b に「2 回流す」を足すだけでも可。

### W2. YOLO の例外が窓内にあっても判定が valid（bench.py:316, 325-328）

- `l0_errors` は出すが `valid` に効かない。併走中にだけ例外が出ると、成功分だけ数えた fps が下がって「不合格」、単独窓に出れば分母が小さくなって「合格」に偏る。errors > 0 の窓は無効にする。

### W3. 20% は ANE 上限の飽和スループットでの比較（bench.py:209-222）

- YOLO ループはペーシング無しで回し続けるので、fps は処理能力。実運転の 10 fps（ペーシングあり）より厳しい側の測りで、合否の意味は「能力の低下」。これは仕様 R3 と `l0_meets_target_fps` に書かれていて問題ないが、手順書 8b の「期待される出力」には 10 fps を保てるかが主で 20% は参考、という読み方が書かれていない。数字を貼るユーザーが取り違えない一文を足す。

### W4. ANE が効いているかの判定基準が無い（手順書 8c, 172 行）

- 「大きく下がれば」だけ。cpu_and_ne と cpu_only の fps 比の目安（例: 2 倍以上なら ANE が効いている、1.2 倍未満なら疑う）を書く。JSON にも比を出すとよい。cpu_and_ne は未対応演算が CPU に落ちても動くので、fps だけでは ANE 稼働の証拠にならない。spec の Deferred に書かれているが、手順書の判断基準が空。

### W5. 入力が一様乱数の画像で、実画像とは負荷が違う（bench.py:250-252）

- ノイズ画像は検出が 0 件なので、NMS 以降の後処理が軽い側に偏る。モデル内 NMS（CoreML パイプライン）なので影響は小さいが、`--check-image` の鹿の写真（既にある）を併走の入力にも使えるようにすると、実運転に近い。現状は fps が楽観側に出うる。

## Info

- I1. 書き出しと l0 の読み方（export_yolo_world.py:107-161 と l0/coreml.py:112-139）: 出力名 `confidence`/`coordinates`、メタデータ `names` を `parse_names` で読み、入力は `imageType`（`load_with_coremltools`）、BGR→RGB と引き伸ばしは l0 側、という対応はコード上で整合している。`verify` が l0 自身の `load_coreml_detector` を通すのも良い。実物の ultralytics 8.4.202 の出力名・`names` の有無は、この環境に無く未検証（測れなかったこと）。
- I2. `shape_verified` は `--check-image` が無いと常に false。手順 7 で必須にしているのは妥当だが、`--check-image` 無しで exit 0 になる。手順書どおりなら問題なし。
- I3. `_ensure_names` の `skip_model_load=True` で開いた mlprogram を `save` する経路は、実機で未確認。出番は `names` が無いときだけ。失敗しても `ExportError` ではなく生の例外で落ちうるので、手順書の「うまくいかないとき」に「traceback をそのまま貼る」を足す。
- I4. 手順 1 の `python3`: 新しい macOS の CLT 付属 Python は 3.9 のことが多い。手順書は uv への分岐があり対応済み。最初から uv を勧める方が打つ回数が減る。
- I5. 手順書のポート 8766 と config 既定 8766 は一致（agent 定義の 8765 は古い。8765 は WebSocket と衝突するため config.py:104 が 8766 にした）。`TYPESAFE_BASE_URL` が bash に残っていると 8766 を上書きするので、手順 8 の前に `echo $TYPESAFE_BASE_URL` が空であることの確認を足すとよい。

## 良い点（嘘の数字を防いでいる箇所）

- 併走で L1 が落ちたとき `l1_failed_during_overlap` で無効にし exit 3（bench.py:309-316）。YOLO 未起動も無効。
- warmup を別クライアント（長いタイムアウト）にして、p50/p95 に混ぜず `warmup_ms`・`warmup_failures` に残す。
- 答えたモデル名を数え、`--compare` で別モデルが答えた系を無効にする。
- YOLO は別スレッド、L1 は asyncio で、CoreML の同期 predict が L1 を塞がない。fps は同一ループのカウンタ差。
- `allow_nan=False`、本文を出さない。

## 測れなかったこと

- 走行ログ（`edge/detector/logs/*.jsonl`）と PWA の ack ログは無く、frame→sent / sent→shown の p95 は出せない（本コミットの対象外）。
- L1 の p50/p95、YOLO の ANE fps、併走の低下率: 実機（Mac mini M1）未実施。
- 実物の Ultralytics 8.4.202 + YOLO-World の CoreML 出力名・`names` メタデータ: 未導入のため未検証。
- 手順書の実行（pip の解決、local-jev のコマンド、`/healthz` と `/v1/models` の存在）: 実行していない。local-jev のコマンドは @64a0b31 の README に依拠する記述で、ここでは確認できていない。
- テスト（`pytest edge/detector`）: 実行していない。
