# code-reviewer: edge-l1-calibration（feat/edge-l1-calibration）

対象: `edge/detector/src/detector/l1/calibrate.py`、`dataset/export_l1_labels.py`、各テスト、`dataset/pyproject.toml`・`local_ci_checks.toml`、`.claude/sfad.json`
仕様: `docs/specs/edge-l1-calibration/functional.md`（R1〜R10）。読み込み側 `calibration.py`・`fusion.conclude` と突き合わせた。
範囲: 静的な読解のみ（テスト・ruff は実行していない）。

## 良い点

- 学習の式が読み込み側と一致している。noul は `clip(EPS)` → logit → `β·z`、choice は `β·log(clip(p))` の softmax で、`Calibration.noul` / `choice` と同じ。FIT-1b が `Calibration.apply` と NLL を突き合わせている。
- 黄金分割の更新式は正しい（`hi, b, fb = b, a, fa` と `lo, a, fa = a, b, fb` は右辺を先に評価する）。NLL は β について凸なので、log β 上でも片側ずつ単調になり単峰として扱える。
- 「疑わしいときは書かない」が一貫している。片クラス・T<0.25・別名・合成・混在モデルを拒否し、行の検証は全体拒否で行番号つき。NaN/Infinity は `parse_constant` で拒否している。
- 書き出しは一時ファイル → `load_calibration` で読み戻し → `replace` → `finally` で unlink。部分書き込みが読み込み側に見えない。
- 分割は `sha256(traceId)` で乱数を使わず決定的。合成トレースは `default_rng([seed, index])` で i 番目が (seed, i) だけで決まる。
- `fusion.conclude` を降格判定にそのまま再利用しており、ゲートと実行時の定義がずれにくい。

## Critical（修正必須）

### C1. 安全ゲートの閾値を CLI / 引数で緩められる（`calibrate.py:515, 543, 593-603, 641`）

- `--override-conf` は 0.9〜1.0 を受け付ける。ゲートの `override_metrics(..., override_conf)` はこの値で降格を数えるので、`--override-conf 1.0` なら校正後の確率が 1.0 以上にならない限り降格が 0 件になり、危険な鹿を降格する温度でもゲートを通る。
- 実行時の `L1Config().override_conf` は 0.9 のまま（または設定で 0.9〜）なので、書かれた温度は実行時に降格を起こす。
- 降格は閾値が低いほど増える（単調）。実行時に取り得る最小値の 0.9 でゲートをかければ、それより高い閾値も包含できる。
- AUTH-6 のテスト（`test_l1_calibrate.py:396-413`）は 0.8（下げる向き）しか確かめていない。上げる向きは未テスト。
- ライブラリ関数 `calibrate()` 自体も `override_conf`・`min_samples`・`holdout` を無検証で受ける（CLI の `type=` にしか検査がない）。Python から呼べば `override_conf=1.5` や `min_samples=1` が通る。

修正案: ゲートの閾値は固定にする。`--override-conf` は報告用（precision の見積もり）に残してよいが、ゲートには使わない。

```python
GATE_OVERRIDE_CONF: Final = OVERRIDE_CONF_RANGE[0]  # B2-5 の下限。実行時に取り得る最も降格しやすい値

gate = override_metrics([s.answer for s in used], used, GATE_OVERRIDE_CONF)
```

あわせて `calibrate()` の先頭で `override_conf`・`holdout`・`min_samples` を `OVERRIDE_CONF_RANGE`・`HOLDOUT_RANGE`・`DEFAULT_MIN_SAMPLES` の範囲に検査する（外れたら `ValueError`、または `CalibrationRefused`）。検査を CLI の `type=` からライブラリ側へ移し、CLI は同じ関数を呼ぶ。「上げる向き」のテストを足す（`--override-conf 1.0` でも、危険な鹿を降格する答えなら書かない）。

### C2. 検証用に危険な鹿が 0〜数件でもゲートが通る（`calibrate.py:529-549`, `496-506`）

- `_check_classes` は学習用だけを見る。検証用は「別々のトレースが 30 以上」しか見ない。
- 検証用に正解 `danger` の行が 0 件だと `gate.danger_downgraded == 0` が自明に成り立ち、「危険な鹿を降格しない」の証拠がない状態で書く。
- 件数が少ないときも同様に弱い。誤り 0 件でも、n 件の 95% 上限は約 3/n（n=10 なら 30%）。
- 30 トレースで danger が 2 件なら、danger の降格 0 件は何も保証しない。
- 実データでは danger は少数クラスになりやすく、この経路は現実に起こる。

修正案: 検証用にも danger の最小件数と、降格の判定対象になる「本物の鹿」の最小件数を要求する。

```python
MIN_VALIDATION_DANGER: Final = 10

n_danger = sum(1 for s in valid if s.labels.alert_level == "danger")
if n_danger < MIN_VALIDATION_DANGER:
    msg = f"検証用の正解 danger が {n_danger} 件（{MIN_VALIDATION_DANGER} 以上が要る）"
    raise CalibrationRefused(msg)
```

要約に `validationDanger`（件数）と、誤り 0 件のときの上限（rule of three: `3 / n_danger`）を出す。テスト `scenario()` は danger が十分あるので、danger が少ない / 0 件の分割で拒否するテストを足す。

### C3. 「合成を含む」の判定が自由文字列の完全一致で、すり抜けられる（`calibrate.py:519`）

- `s.source == SYNTHETIC`（`"synthetic"` ちょうど）だけを見る deny-list。答えのファイルのパーサは `meta.source` を空でない文字列として受け入れるだけで、語彙を検査しない（`_parse_row`、`calibrate.py:200-201`）。
- `"Synthetic"`、`"synth"`、`"sim_synthetic"`、`"synthetic "` はすべて通り、合成で学んだ温度に実体のモデル名が付いて書かれる。仕様の S-1 / AUTH-4 が防ぎたい経路そのもの。
- 答えのファイルは `bench_l1.py`（未実装）が `meta` をコピーして作るので、手編集・変換スクリプト・別ツールを通る可能性がある。

修正案: 許可リスト方式にする。

```python
REAL_SOURCES: Final = frozenset({"sim"})  # 実機の答えを足すときはここに足す

if not allow_synthetic and any(s.source not in REAL_SOURCES for s in samples):
    msg = "sim 以外のデータ（合成を含む）。実機に置く温度は実機の答えで学ぶ"
    raise CalibrationRefused(msg)
```

（`--allow-synthetic` ありのときだけ `synthetic` / `sim` を許す。パーサ側でも `meta.source` を `{"sim", "synthetic"}` の語彙で検査して、`export_l1_labels.SOURCES` と揃える。）`meta.traceId` が `syn-` で始まるものも拒否すると二重に守れる。

## Warning（推奨）

### W1. 降格の「誤り」が正解 danger だけで、本物の鹿を「鹿ではない」と降格する誤りを数えない（`calibrate.py:403-412`）

- `reason == "false_positive"` の降格は「これは鹿ではない」という主張。正解が `false_positive == False`（本物の鹿）で `alert_level == zone`（路肩の遠い鹿）の答えを降格しても、`right += 1`（正しい降格）に数えられる。
- 仕様 R7-4 は意図して danger だけにしているが、今回の目的は「L1 で L0 の赤（本物の鹿）を降格してよいか」。`reason == "false_positive"` かつ本物の鹿の降格は、alert_level が zone でも道路脇の鹿を「鹿ではない」と言って消す動作で、後から danger になる鹿（動き出す前の鹿）を取りこぼす。
- 修正案: ゲートの誤りを「`deer and (labels.alert_level == "danger" or reason == "false_positive")`」にするか、少なくとも `wrongFalsePositive`（本物の鹿を false_positive で降格した件数）を `OverrideStats` に足して要約に出す（ゲートにするかは仕様で決める。ch9 の判断に近いので、確認事項として PR に書く）。

### W2. 校正が検証用で悪化していないかを見ない（`calibrate.py:551-558`）

- `before` と `after` は計算するが比較しない。反相関のデータ（T が上限 20 に張り付く）や過学習で、検証用の NLL / ECE が校正なしより悪くなっても書く。
- 修正案: 質問ごとに `after.nll <= before.nll + 1e-9` を確かめ、悪化していたら `CalibrationRefused`（または要約に警告）。少なくとも `false_positive` と `alert_level` は必須にする。

### W3. `fit` の `--report` の書き込みが `calibration.json` の置き換えのあとで、失敗の意味が紛らわしい（`calibrate.py:668-673, 702-703`）

- 先に `write_calibration` が完了し、そのあと `args.report.write_text` が `OSError` を出すと、`main` が「入出力の失敗」で exit 2 を返す。校正は置き換わっているのに、呼び出し側（スクリプト・CI）には失敗に見える。stdout の要約も出ない。
- `report.write_text` は原子的でもない。
- 修正案: レポートを先に（`calibrate()` の直後に）一時ファイル経由で書く。または、レポートの書き込み失敗は警告にして exit 0 にし、`written` を先に標準出力へ出す。`export_l1_labels._write_jsonl` と同じ「一時ファイル → replace」の関数を共有する（W9）。

### W4. 範囲外の `--seed` が traceback になる（`export_l1_labels.py:419, 511, 700, 764`）

- `np.random.default_rng([seed, ...])` は負の整数で `ValueError`。`--seed -1` は `main` のどの `except` にも掛からず、traceback で落ちる（exit 1 になり、`EXIT_SHORT` と区別がつかない）。
- 修正案: `--seed` に `type=_non_negative_int` を付ける。`--min-per-question` も 1 以上にする（0 や負だと空のファイルを成功として書く、`main:818`）。

### W5. `label_at` の `soon` が速さ 0 のとき danger を出さない（`export_l1_labels.py:626-630`）

- `--context actual` で `speed_kmh == 0` なら `soon == False` になり、車線上の鹿でも `zone`（またはゾーン外で `none`）のラベルになる。停止中の車に車線上の鹿は「危険」として扱うのが安全側。
- 修正案: `v_ref <= 0` のときは `soon = True`（`in_lane` または `enters` の鹿は danger）にするか、速さ 0 の問い合わせを `build_example` で捨てる。どちらにするかを spec に書く（既定の固定値 60 km/h では起きないので Warning）。

### W6. `toward` の符号が `lateral == 0` で不定（`export_l1_labels.py:618`）

- `toward = -lateral_v if tick.lateral > 0 else lateral_v` は `lateral == 0`（車線の中央、立ちすくみの位置）で左側の式を使う。車線の中央にいる鹿は `in_lane` なので `on_roadway` は真になり結果には影響しないが、式の意図（近づく向きが正）が `lateral == 0` では意味を持たない。
- 修正案: `side = _side(tick.lateral)` を使い、`track_at` の `lateral_mps` と同じ規則に揃える（R の場合に反転）。可読性のため。

### W7. 重複した引数の検査関数（`calibrate.py:593-628`）

- `_override_conf`・`_holdout`・`_positive_int` は同じ「parse → 範囲 → ArgumentTypeError」の繰り返し（DRY）。`_positive_int` は名前が実態と違う（`DEFAULT_MIN_SAMPLES` 以上かを見ている）。
- 修正案: `_bounded_float(lo, hi, label)` と `_at_least(minimum)` の小さなファクトリにする。C1 でライブラリ側へ検査を移すなら、同じ検査関数を CLI から呼べばよい。

### W8. 型の不整合（`calibrate.py:579`）

- `payload` が `dict[str, object]` なので、`Calibration(payload["model"], payload["temperatures"])` は `object` を `str` / `dict[str, float]` に渡す形になり、型チェッカ（pyright / mypy）を入れると落ちる。実行時は問題ない。
- 修正案: `expected = Calibration(calibration.model, {q: round(...) for q in QUESTION_IDS})` を先に作り、`payload` は `expected` から作る。

### W9. 一時ファイル → 置き換えが 2 か所に重複（`calibrate.py:564-587`, `export_l1_labels.py:741-753`）

- どちらも `.{name}.tmp` + `replace` + `finally unlink`。名前が固定なので、同じ出力先への同時実行で衝突する（`tempfile.NamedTemporaryFile(dir=...)` や PID 付きの名前にする）。
- どちらも `fsync` しない。電源断で空ファイルが rename される可能性があるが、`load_calibration` が壊れたファイルを None（降格しない）にするので安全側に倒れる。校正を失うだけで、危険はない。

## Info（参考）

- `calibrate.py:582-584`: `except (OSError, ValueError)` のうち `CalibrationWriteError`（自前で raise）は捕まらずにそのまま上がるので、設計どおり。`finally` の unlink は置き換え後も安全（`missing_ok=True`）。
- `calibrate.py:538`: 上限の判定が `MAX_T * (1 - 1e-3)` で、下限側（T<0.25 は拒否）と非対称だが、仕様 R7 どおり。上限に張り付いた温度は確率を 0.5 に寄せるので降格を減らす向き（安全側）。
- 既存の `calibration.json` は、新しい `fit` が拒否しても残る（S-2 / AUTH-2 の仕様どおり）。古い緩い校正が有効なまま残るので、拒否時に「前の校正は有効のまま」と標準エラーに出すと運用で気づきやすい。
- `export_l1_labels.py:73`: `QUERY_INTERVAL_MS = round(1000 / rate_hz)` は `rate_hz > 10` で 0 になり `query_times` の `on_beat` がゼロ除算。`L1Config` に上限があるなら問題ない（未確認）。
- `export_l1_labels.py:559`: `track_at` は `pts` が空だと `pts[0]` で IndexError。呼び出しが候補（`conf >= RED_THRESHOLD`）なので、`TrackerConfig().min_conf <= RED_THRESHOLD` が成り立つ限り起きない。前提を `assert` かモジュール読み込み時の検査で明示するとよい。
- `export_l1_labels.py:822-824`: `--write-traces` の説明は「使った」だが、書くのは読んだ全トレース（捨てたものを含む）。また `--traces` 指定時は黙って無視する。
- `export_l1_labels.py:790-791`: `tracked()` 内で `traces.append` する副作用つきジェネレータより、`export` が使ったトレースを返す方が読みやすい。
- `export_l1_labels.py:816-820`: 要約を標準出力へ出してから最小件数を検査する（書かないときも要約が出る）。診断には都合がよい。
- ラベル規則 R5 の確認: `enters` の `k.gap > 0.0`（車が物を追い越す前）と先読み 6 秒、`in_lane` の `|objD − carD| ≤ 1.75`、`static_shoulder` の `enters` 除外は仕様どおり。`track_at` の窓・途切れ・`lateralMps` / TTC の式は `Tracker` と一致している（`MIN_SPAN_S`・`MIN_CLOSING_MPS` を import している）。`request.model_dump(mode="json")` は生成モデルの欄名が camelCase なので、`by_alias` は不要で正しい。
- `dataset/pyproject.toml` の `--cov=export_l1_labels`、`local_ci_checks.toml` の `required` / `ci` 削除、`sfad.json` の test_command は仕様 R10 どおり。`needs_probe` が `import detector` なので、edge をインストールしていない環境ではスキップされる（CI が入れる前提）。
- テストの穴: C1（`--override-conf` を上げる向き）、C2（検証用の danger が 0 / 少数）、C3（`source` の表記ゆれ）、W2（校正で悪化）を足すとよい。

## メインセッションの取り込み（2026-11-03）

- C1 → 直した。`fit` の検証の降格の閾値は 0.9 固定（`GATE_CONF`）。`fit` から `--override-conf` を外し、`calibrate()` も `min_samples` 100 未満・`holdout` の範囲外を ValueError（FIT-1j、AUTH-6 に `--override-conf 1.0`）
- C2 → 直した。学習用・検証用それぞれで正解 danger の別々のトレースが 10 未満なら書かない。要約に `dangerRows` と「danger を降格する割合」の Wilson の上限（FIT-1i）
- C3 → 直した。`source` は許可リスト（`sim`、`--allow-synthetic` のときだけ `synthetic`）。合成から書く温度のモデル名は `synthetic:<model>`（実機の答えに当たらない。edge-latency-reviewer W2 と同じ対処）
- W3 → 直した（報告を先に書く）。W4 → 直した（`--seed` は 0 以上）
- 次に回す: W1（降格の誤りの定義。deer:false は GPS の琥珀に戻るので、正解 zone の鹿の降格は誤りに数えない仕様のまま）、W2（検証用で校正が悪化したら書かない）、W5〜W9
