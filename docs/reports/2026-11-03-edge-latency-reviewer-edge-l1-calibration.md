# edge-latency-reviewer: edge-l1-calibration（Step 4、B2-7）

対象: `git diff origin/main...HEAD`（feat/edge-l1-calibration）。観点は §6 の L1。
テスト: edge/detector 408 passed（カバレッジ 97.6%）、dataset 42 passed（98.6%）。

遅延 p95: 測れなかった（走行ログ・`t_shown` の ack が無い。この変更は計測の対象外）
L1 p50/p95: 測れなかった（実機の L1 ログ無し）・上書き 0 件・L0 fps 単独 / L1 併走 測れなかった
Critical: 1 / Warning: 3 / Info: 6

## 観点ごとの結論

1. 赤の経路・L0 の遅延への影響: **無し**。`edge/detector/src` の差分は `l1/calibrate.py` の新規 1 ファイルだけ。
   `git grep` で `detector.l1.calibrate` を import している実行時のコードは無い（pipeline・hub・fusion・runner・ws_server から見えない）。
   `fusion.py`・`l0/tracker.py`・`l1/calibration.py` は未変更。`calibrate.py` はオフラインの CLI（`python -m`）で、検知ループと同じプロセスで走らない。
2. 問い合わせの場面: **おおむね一致**（下の Info 参照）。
3. 降格の安全側: 判定の道具（`fusion.conclude` の再利用、`Calibration.apply` との式の一致、合成の拒否、モデル名の別名拒否、T < 0.25 の拒否、検証用の分離）は良い。ただし**検証用の関門が空振りしうる**（Critical C1）。
4. Step 0・6 の Deferred: 一部不足（Warning W3）。

## Critical

### C1. 検証用に「正解 danger」が 0 件（または数件）でも関門が通り、calibration.json が書かれる

- `edge/detector/src/detector/l1/calibrate.py:529-549`（`calibrate` の検証用の関門）と `:496-506`（`_check_classes`）
- 検証用には「別々のトレース 30 以上」を求めるだけで、**検証用の正解 danger の件数の下限が無い**。学習／検証は `sha256(traceId)` で分かれる。学習用には `_check_classes` が「10 件以上のクラス 2 つ」を求めるので、固定の車の状態では danger ≥ 10 が学習用に入るが、検証用にたまたま danger が 0〜数件しか入らないことが起こる。そのとき `gate.danger_downgraded == 0` は空振りで真になる。
- 確認（再現済み）: 学習用に danger 60 件、検証用（`is_validation` が真のトレース 140 件）に danger 0 件、L1 の alert_level はでたらめ（Dirichlet）のデータを `calibrate()` に通すと、**書き出しが成功**した（T = alert_level 4.74、on_roadway 0.92、static_shoulder 1.00、false_positive 0.75）。スクリプトは scratchpad の `vac2.py`（リポジトリには入れていない）。この例の alert_level の T が大きい（確率を寄せる向き）のは偶然で、関門が検証したわけではない。T < 1 の鋭い側が学習されたデータでも同じ空振りが起こる。
- なぜ Critical: この関門は B2-5「本物の危険な鹿を降格しない」の唯一の検証。実走行データは誤検知が多く danger が少ない見込みで、検証用 3 割に danger が 0〜数件しか入らなければ、検証されていない温度が「降格の精度 1.0」の名前で置かれる。
- 直し方:
  1. **検証用**の正解 danger の別々のトレースが N 件未満（推奨 N = 10）なら `CalibrationRefused`（理由に件数と「`--holdout` を上げるか、danger のデータを足す」）。学習用側の danger の下限（推奨 ≥ 10）も `_check_classes` に足すが、こちらは従。
  2. 要約に検証用の danger 件数（`dangerRows`）を出す。
  3. テスト: 学習用に danger が十分あり、検証用に danger 0 件（トレース id を `is_validation` で選んで作る）→ 書かない。

## Warning

### W1. 関門の検出力が小さい（n=30 トレースで 0 件）

検証用が最小の 30 トレース・danger がその一部なら、「降格 0 件」からいえる誤降格率の上限（95%）は 10% を大きく超える（danger 10 件なら約 26%）。C1 の下限と合わせ、danger の検証用の件数に応じて Wilson 上限（`1 − wilson_lower(danger のうち降格しなかった数, danger の数)` 相当）を要約に出し、上限が閾値（例 15%）を超えたら書かない、または警告（`l1.calibrate.weak_gate`）を残す。

### W2. 合成で学んだ温度を実機に置けてしまう口が `--allow-synthetic` だけ

`calibrate.py:519`。`--allow-synthetic` を付けると、実体のモデル名つきの `calibration.json` が通常の形で書かれ、`load_calibration` は合成由来かどうか区別できない（`_parse` は余分なキーを無視する）。ヘルプ文のみが警告。
直し方（読み込み側を変えずに足せる）: `--allow-synthetic` のときは書くモデル名を `synthetic:<model>` にする（`matches()` が実機の応答のモデル名と一致しなくなり、edge-l1 は降格しない）。**AC-3 の「`matches(答えのモデル)` が真」は「`load_calibration` で読めるが `matches()` は偽」に変わる**（合成の温度を実機で使えないことを確かめる向きに反転する。テストの期待値を変える変更で、通っているテストを壊すものではない）。

### W3. Step 0・6 の Deferred が足りない

`docs/specs/edge-l1-calibration/functional.md:185-190`。

- `scripts/bench_l1.py` はリポジトリに存在しない（`git ls-files` に無い）。Step 0（`--n 100`、YOLO 同時あり／なし）はこれが無いとユーザーが実行できない。Deferred の担当が「ユーザー」だけで、**道具を誰がいつ書くか**（人 B、Step 0 の前日までなど）が無い。edge-l1・edge-l0 の spec でも「Deferred」とだけ書かれ、起票先が無い。
- 実機で測るもの（L1 の p50/p95 ≤ 400 ms、YOLO 併走時の L0 fps 低下 ≤ 20%、上書き件数と正誤、`l1.latencyMs` / `l1.conf` / `l1.overrode` のログ）が、この feature の Deferred に出てこない。校正とは別の行で、担当・期日・暫定挙動（「未測定のあいだ L1 の遅延・併走は仮定で、ch9 ④ の仮採用に『未測定』と書く」）つきで足す。
- 校正データの収集は、固定の車の状態での生の確率だけを想定している。Step 6 の比較（閾値ルール／jev／NLI の正解率・ECE・p50/p95）に、この export の 240 件をそのまま使うか（200 シナリオとの対応）を書く。

## Info

- I0（W2 から降格。ブロックしない）: danger = 道のり ÷ **問い合わせの速さ（固定 60 km/h）** ≤ 6 秒は R5・LBL-1h で決めた設計で、L1 が実際に聞かれる `speedKmh=60` とラベルが揃っている。ここを `max(問い合わせ, 実速)` に変えるとラベルが L1 に見えない情報に依存し、関門が正しく答えた L1 を罰する。実際の危険は実行時の結果で、車が 80 km/h なら車線へ入る鹿が 110 m 先でも 5 秒で着くのに、固定値の 60 km/h では「zone」と聞かれる。これは edge-l1 から持ち越しの Deferred「車の状態の実値」（人 B、PWA から速度・ゾーンを返す feature）が解く問題。`--context actual` の export で固定値との差を測る手順（spec にある）を Step 6 に入れておく。
- I1（場面は一致）: 赤の始まり＝候補 2 tick 連続、conf ≥ `JudgeConfig().threshold`、0.4 秒ごと（`L1Config().rate_hz` 2.5）、窓 1 秒・`max_age_s` 1.0 秒・`MIN_CONF` 0.4・`MAX_POINTS`・`MIN_SPAN_S`・`MIN_CLOSING_MPS`・`lane_half_width_m` を `detector` の定数から取っている。`lateralMps`（窓の最初の点から、L なら右向き正・R なら左向き正）と TTC の式は `Tracker.metrics` / `track_points` と同じ。`recentAlerts30s` ≥ 1（`Fusion.after_l0` が赤の開始時に積む）も一致。固定の `VehicleContext()` も `_ask_once` の `build_request(target, recent, config.model)` と同じ。`target_fps` 既定 10 が sim の 10 Hz tick と同じなので、窓の点の数も揃う（5 fps に落とすと窓の点が半分になり、校正の分布からずれる）。
- I2（実行時との差）: 実行時の距離・横の位置は箱の高さ→距離表と箱の中心から出る（ノイズ・量子化あり）。export は真の座標なので、`distanceM`・`lateralMps`・`pos` が滑らか。実機の raw prob は雑音つきの入力で出るので、温度は実機の bench の分布で学び直す前提（Deferred の実機収集で足りる）。
- I3（実行時との差）: 実行時の L1 は赤でないときも主トラックについて聞くが、その答えは `no_episode` として捨てられる（`Fusion.apply`）。降格に効くのは赤のエピソード中の問い合わせだけなので、export が赤の候補の場面だけを作るのは正しい。ただし export は 1 トレース 1 エピソード目だけ。2 回目以降の赤（`recentAlerts30s` 2〜3）は乱数で与えており、実際の履歴とは対応しない。
- I4（T の下限は alert_level に甘い）: `MIN_SAFE_T = 0.25` の根拠（生の 0.63 → 0.9）は noul の式。choice（3 択 softmax）では T = 0.25 で raw (0.6, 0.3, 0.1) が約 0.94 になる。関門（W1/C1）が実際の守りで、T の下限は補助。コメントに「noul のとき」と書くと誤解が減る。
- I5: `_run_fit` は `calibration.json` を置いた**あと**に `--report` を書く。レポートの書き込みが失敗すると exit 2 だが校正は置かれている。先にレポートを書くか、失敗を exit 1 でなく警告にする。
- 良い点: 合成・別名・混在・空白のモデル名・T < 0.25・片クラス・件数不足は書かない。`load_calibration` で読み戻して一致してから `os.replace`。学習／検証の分割は乱数なしのハッシュ。`--min-samples` を 100 未満にできない、`--override-conf` を 0.9 未満にできない。`print` 無し・新しい依存無し。

## 測れなかったこと

- 実機の L1 の p50/p95、YOLO 併走の L0 fps、上書きの件数と正誤: 走行ログ（`edge/detector/logs/*.jsonl`）が無い。Step 0・6（ユーザーの実機作業、`bench_l1.py` 未作成）の後で再レビュー。
- `t_frame → t_sent` / `t_sent → t_shown` の内訳: ログ無し（この変更は赤の経路を触らないので、前回の値から変わらない）。

## メインセッションの取り込み（2026-11-03）

- C1 → 直した。学習用・検証用それぞれで正解 danger の別々のトレースが 10 未満なら書かない（FIT-1i）。要約に `dangerRows` を出す
- W1 → 直した。要約に「danger を降格する割合」の Wilson の上限（`dangerDowngradeRateWilsonHigh`）
- W2 → 直した。合成を含む答えから書く温度のモデル名は `synthetic:<model>`。AC-3 は「読めるが `matches(実機のモデル)` は偽」に変えた
- W3 → 仕様の Deferred を書き直した（`bench_l1.py` は人 B が書き、ユーザーが Mac mini で回す。Step 6 で測るもの: L1 の p50/p95、L0 の fps 低下 20% 以内、実機の答えでの `fit` の結果、上書きの件数と正誤）
