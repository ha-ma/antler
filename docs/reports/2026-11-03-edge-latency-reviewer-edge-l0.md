# edge-latency-reviewer: edge-l0（feat/edge-l0）

対象: `edge/detector/src/detector/l0/`（coreml・tracker・stage・inference）、`hub.py`・`config.py`・`judge.py` の差分、`tests/test_l0_*.py`。
仕様: `docs/specs/edge-l0/functional.md`、`docs/changes/2026-11-03-b-l1-local-jev.md` §3.4・Step 2。

```
遅延 p95: frame→sent 測れず / sent→shown 測れず / 合計 測れず（n=0、ログ: 走行ログ無し）
L1 p50/p95: 対象外（edge-l1 で入る）・上書き 対象外 ・ L0 fps 単独 未計測 / L1 併走 対象外
Critical: 0 / Warning: 3 / Info: 4
```

走行ログが無いため ch6 の合計 p95（1,000 ms 以上 Critical、500 ms 以上 Warning）は判定できない。ここではコードの経路と、手元で測った L0 の計算時間だけで判断した。

検証: `python3 -m pytest -q tests`（edge/detector）で 240 passed、カバレッジ 99%。サーバーは起動していない。

## Critical（0 件）

赤の経路を確認した結果、Critical に当たるものは無かった。

- 赤（`deer: true`）の経路は `runner.pump` → `AlertHub.on_result`（`def`。コルーチンではない）→ `L0Stage.update` → `Judge.update` → `_emit` → `sender`。この間に `await` は無い。
- `detector/l0/`・`hub.py`・`judge.py` に `async`・`await`・`l1`・`l2` の import は無い（grep で確認）。L1 の結果を待って赤にする箇所は無い。
- 推論は `asyncio.to_thread(next, results, None)` でスレッドに出ていて、ループ上で動くのは `on_result` 以降だけ。重い CoreML 推論が配信と ping を止めない。
- 2 フレームで ON、1.5 秒で OFF は `judge.py` の規則のまま。差分は `estimate_distance_m` を `interpolate_distance_m`（丸めない）と丸める版に分けただけで、`distanceM` は従来と同じ整数。判定ロジックの変更は無い。
- `L0Stage.update` は `judge.update` を先に呼び、トラッカーは `try/except` の中。例外でも判定の戻り値は変わらない（RULE-1b・1c のテストが固定）。
- B2-6: 距離は距離表の補間、横位置はピンホールの式、TTC は距離差÷時間。どれも決定的なコードで、モデルに推定させていない。

## Warning（3 件）

### W1. トラッカーの更新が `sender` より前に走る（約 0.1〜0.4 ms を frame→sent に足す）

`hub.py:70` の `self._l0.update()` が判定とトラッカーの両方を終えてから `_emit` に進む。
トラッカーは判定の結果を変えないので、赤の送信はトラッカーの計算ぶんだけ遅れる。仕様 R5 は「判定→トラッカー→返す→送信」と明記していて、実装は仕様どおり。
`t_sent` は `_emit` の `wall = self._wall()`（`sender` の直前）で取るため、トラッカー分は frame→sent に含まれる。`_track_fields`（指標の計算）は `sender` の後なので含まれない。

手元の再計測（Python 3.x、`tracker.update` だけ、`perf_counter`）:

| 入力                                                                                   | 中央値  | p95     | 最大                                    |
| -------------------------------------------------------------------------------------- | ------- | ------- | --------------------------------------- |
| 検出 10 件、位置が連続（500 フレーム）                                                 | 0.12 ms | 0.38 ms | 5.1 ms（1 回。初回・GC 由来と見られる） |
| 検出 10 件、毎フレームランダムに飛ぶ（300 フレーム。トラックが 38 本まで増える最悪側） | 0.43 ms | 1.02 ms | 8.3 ms                                  |

「約 0.18 ms」という手元の値と同程度（連続位置の中央値 0.12 ms）。ch6 の予算（合計 p95 500 ms 未満）に対しては 0.1% 以下で、実害は無い。
ただし仕様の非機能「1 フレーム 1 ms 未満（検出 10 件まで）」は、ランダムに飛ぶ最悪側の p95 で 1.02 ms と境目に乗る。実走行では検出が連続するので通常は 0.1 ms 台だが、スパイク（5〜8 ms）は GC か初回呼び出しと見られ、原因までは切り分けていない。
直し方（どちらでも）: (a) `update` の戻り値を `hub` が先に `_emit` してから、トラッカーを更新する（`L0Stage.update` を 2 段に分ける）。この場合 `flag.sent` に載る指標は「同じフレームまで」でなく「1 つ前まで」になり、RULE-1f の仕様を変える。(b) 今のままにして、走行ログの `frame→sent` の p95 で確かめる。数字が出るまでは (b) で足りる。

### W2. TTC の接近速度が最初と最後の 2 点だけで決まる（ノイズに弱い）

`tracker.py` の `metrics()` は `first` と `last` の距離差で接近速度を出す。最短 `MIN_SPAN_S = 0.2` 秒（10 fps で 2 フレーム）から TTC を出す。
ボックスの高さが 5% 揺れるだけで、16 m 付近では約 0.8 m の距離の揺れになり、0.2 秒で割ると約 4 m/s の見かけの接近になる。止まっている鹿に TTC が数秒で出る可能性がある。
L1 はこの値を材料にするため、edge-l1 の前に直しておきたい。赤の判定には影響しない（ログのみ）。
直し方: 履歴全体の最小二乗の傾きにする、または `MIN_SPAN_S` を 0.4〜0.5 秒に上げる。調査走行（Day 4）の実データで揺れ幅を見て決める。仕様 R4 は「最初の点との差」と書いているので、仕様側の更新も要る。

### W3. `l0.tracker_reset` のログに間引きが無い

`tracker.py` の `update` は、`t_frame` が 1.0 秒より大きく戻るたびに `logger.warning("l0.tracker_reset")` を出す。`tracker_failed` は 1 秒に 1 回までだが、こちらは無制限。
壁時計が揺れ続ける状況（NTP の補正を繰り返す）では警告が毎フレーム出る。走行ログがあふれて `t_frame` / `t_sent` の行を押し出すことは無いが、読みにくくなる。
直し方: `stage.py` の `_failed` と同じく 1 秒 1 回に絞る。

## Info（4 件）

### I1. 距離・横速度・TTC の定義と縮退は仕様どおり

- 距離: 表の近い側は端から反比例で外挿（`track_distance_m`）。表の遠い側は端で止める。
- 横位置: `(cx − 0.5) × 2 × tan(hfov/2) × 距離`。`lateralMps` の符号は、その点の `side` が L なら右向きが正、R なら左向きが正。最初の点と 0.2 秒未満なら 0.0。
- TTC: 接近速度が 0.5 m/s 以下・0.2 秒未満・点が 1 つなら `None`。
- 主トラック: 最新の時刻に見えた中で最も高いボックス、同じなら確信度、さらに ID の小さい順。見えていなければ最後に見た時刻が新しいもの。
- NaN・無限大は `_usable` で高さを検査して入れない。`track_points` は丸めた float のみ。
- 縮退: トラッカーが例外 → 判定と送信は続き、トラッカーを作り直す（ID は続きから）。生きたトラックが無いとき `flag.sent` の 3 項目は `null`。
- `tracks` は `max_age_s` 内（1.0 秒）のものだけが残り、10 fps・検出 10 件でも最大約 100 本で上限がある。メモリは増え続けない。

### I2. CoreML の compute units

- 既定は `cpu_and_ne`（`ComputeUnit.CPU_AND_NE`）。`MLModel(path, compute_units=unit)` で読み込み時に固定。値の検証は設定読み込みで行い、一覧外・型違いは `ConfigError`。
- `cpu_and_gpu`・`all` を選べるが、選んでも警告が出ない。L1（MLX）と GPU を奪い合う設定なので、起動時に `coreml.gpu_selected` を 1 回 warning で残すと、走行ログから原因をたどれる（任意）。
- `names` に `deer` が無いモデルは読み込みで `ConfigError`。黙って全部捨てて見逃し続けることは無い。
- 画像の前処理（BGR→RGB、最近傍で引き伸ばし、PIL 変換）は推論スレッド側で毎フレーム走る。ループは止めないが、`infer_ms` に含まれる。実機の `infer_ms` で確かめる（Deferred 済み）。
- 設定ファイルは `config.yaml` でなく TOML（`config.example.toml`）。仕様 R1 の判断（pyyaml を足さない）として記録済み。ここでは指摘にしない。

### I3. fps の間引き

- `pipeline.target_fps` は 5〜10 に範囲検査され、既定は 10。全フレーム推論にはならない（`FrameThrottle`、`config.py` の `MIN_TARGET_FPS`・`MAX_TARGET_FPS`）。

### I4. Deferred（仕様に記載済み。ここでは再掲のみ）

- 実機の ANE fps と、NMS に焼き込まれた `confidenceThreshold`（Ultralytics 既定 0.25）が `min_conf`・`threshold` 以下であること。
- 水平画角 70° と車線の半幅 1.75 m は暫定。

## 測れなかったこと

- `t_frame` → `t_sent` → `t_shown` の中央値・p95: 走行ログ（`edge/detector/logs/*.jsonl`）も PWA の ack ログも無い。edge-judge の `flag.sent` と `ack` の形（`t_frame`・`t_sent`・`t_shown`・`since_frame_ms`）は揃っているので、走行すれば集計できる。実走行のあと、本レビューを再実行する。
- 実機の ANE での L0 fps、`infer_ms`（CoreML 実モデル）。偽ローダでの検証のみ。
- L1 の `latencyMs`・`alert_level`・`conf`・`overrode`、および L1 併走時の L0 fps 低下: L1 未実装のため対象外。
- PWA 側（`t_shown` の記録、再接続の 5 秒、未接続帯）: この差分に含まれないため見ていない。
