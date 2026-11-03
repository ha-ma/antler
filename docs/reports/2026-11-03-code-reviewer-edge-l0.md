# code-reviewer: edge-l0（feat/edge-l0）

対象: `edge/detector/src/detector/l0/{__init__,coreml,tracker,stage,inference}.py`、`detector/inference.py`（互換の入口）、`hub.py`・`config.py`・`judge.py`、`config.example.toml`、`tests/test_l0_*.py`。
仕様: `docs/specs/edge-l0/functional.md`（R1〜R6、LAC-1、TRK/RULE/CU/CFG）。

注意: このレビューは静的な読み取りだけ。Bash が使えず、`pytest` と `ruff check` / `ruff format` は実行していない。静的解析ゲートと既存 180 件の Green は `python scripts/local-ci.py` で別に確かめること。

## 結論

Critical 0 件 / Warning 7 件 / Info 11 件。

仕様の R1〜R6 はコードに対応が取れていて、IoU の貪欲な割り当て、`t_frame` の戻り、距離の外挿、横速度の向き、TTC、CoreML の出力の検査に、仕様と食い違う誤りは見つからなかった。Warning は「赤の経路を守る作りの穴」「設定の整合」「テストが狙いどおりに効いていない箇所」。

## Critical（修正必須）

なし。

確認した点（Critical にしなかった根拠）:

- 赤の判定は `L0Stage.update` の先頭 `self.judge.update(...)`（stage.py:58）で決まり、トラッカーの結果は `changed` に影響しない。`try` は `tracker.update` だけを囲んでいる（stage.py:59-62）。RULE-1b も判定の列が同じことを確かめている。
- `hub.on_result` はコルーチンでなく、赤の経路に await が無い（hub.py:65-71）。
- `t_frame` の戻り: `t <= latest` かつ戻りが 1.0 秒以内なら何もせず（tracker.py:126-128）、1.0 秒を超えると全消去して数え直す（同 129-131）。`next_id` は保たれ、ID は再利用されない。履歴の `t` は `t > latest` のフレームだけが入るので狭義の昇順になる。
- 貪欲な割り当ての整列キーは `(-iou, track_id, j)`（tracker.py:142）。同点は ID の小さい順・検出の順で決定的。`score < iou_threshold` で `break` するのは降順に並べているので正しい。
- 外挿は端で連続（`height == near_h` で `near_m`）。`height > near_h` のときだけ反比例（tracker.py:63-65）。
- 速度は `MIN_SPAN_S` 未満で 0.0 / None（tracker.py:184, 193）。TTC は `closing > 0.5` のときだけ出る。`distance / closing` は有限。
- `track_points` の値は pydantic の `TrackPoint`（StrictFloat、`t <= 0`、`conf` 0〜1、`distanceM >= 0`）の制約を満たす。x・y・w・h は `DeerDetector._valid` で 0〜1 の有限値に限られるので NaN は出ない。

## Warning（推奨）

### W1. [stage.py:77-81] `_failed` が except ブロックの中で例外を出しうる。赤の経路を守る作りに穴が残る

`update` の `except Exception` の中で `_failed` を呼び、その中の `self._factory(self.tracker.next_id)` が例外を出すと、`L0Stage.update` から例外が抜ける。その場合 `hub.on_result` は `_emit` に進めず、そのフレームの赤が送られない。`Tracker.__init__` は検証済みの設定では落ちないが、「トラッカーが何をしても判定と送信は止めない」（R5）を言い切るなら、作り直しも守る。

```python
def _failed(self, exc: Exception, now: float) -> None:
    if self._last_fail_log is None or now - self._last_fail_log >= FAIL_LOG_INTERVAL_S:
        self._last_fail_log = now
        logger.warning("l0.tracker_failed", extra={"error_type": type(exc).__name__})
    next_id = getattr(self.tracker, "next_id", 1)
    try:
        self.tracker = self._factory(next_id)
    except Exception:  # noqa: BLE001  作り直しの失敗でも赤を止めない
        self.tracker = _NullTracker(next_id)  # 何もしない TrackerLike
```

あわせて `primary_metrics`（ログ専用の計算）の失敗でもトラッカーを作り直している（stage.py:73-76）。表示用の計算が壊れただけで追跡の履歴が全部消えるので、作り直すのは `update` の失敗のときだけにし、`primary_metrics` は None を返してログを残すだけにするほうが安全。

### W2. [tracker.py:135-143] 検出の数に上限が無い。トラッカーの計算が赤の送信の前に走る

NFR は「検出 10 件まで 1 ms 未満」だが、コードはそれを守らせていない。`DeerDetector` も件数を絞らない。NMS 付きモデルがノイズで鹿を数十〜数百個返すと、`pairs` は `トラック数 × 検出数` を全部作って整列する（例: 100×100 で 1 万組、整列で数 ms〜数十 ms）。しかも仕様の順序（判定 → トラッカー → 送信、hub.py:70-71）では、この時間がそのまま赤の送信を遅らせる。トラックも上限が無く、unmatched の検出が毎フレーム増える。

```python
MAX_DETECTIONS = 16  # 高いボックス（近い鹿）を優先。NFR の「10 件まで」に余裕を足した値

dets = sorted(
    (d for d in result.detections if _usable(d, self._cfg.min_conf)),
    key=lambda d: (-d.xywh[3], -d.conf),
)[:MAX_DETECTIONS]
```

絞ったことは `l0.tracker_capped` などで 1 秒に 1 回ログに残す。ID の決定性は、整列キーが全順序なら保たれる。あわせて「検出 10 件・トラック 10 本で 1 ms 未満」を確かめるテスト（またはベンチ）が無い。仕様の NFR 遅延のチェックが空のまま（functional.md 216 行）なので、数字で閉じる。

### W3. [config.py:209-217] `tracker.min_conf` が `judge.threshold` より大きい設定を弾かない

`[judge] threshold = 0.3` にすると、赤は 0.3 以上の鹿で鳴るのに、トラッカーは `min_conf` 0.4 未満を入れない（tracker.py:103）。赤が ON なのに `flag.sent` の `track_id` / `ttc_s` / `lateral_mps` が `null` になり、L1 に渡す材料も無くなる。しかも設定は両方とも範囲内なので `ConfigError` にならず、静かにずれる。仕様の意図（トラッカーの閾値は判定より低くてよい）に合わせ、読み込み時に検査する。

```python
if config.tracker.min_conf > config.judge.threshold:
    msg = (
        "tracker.min_conf は judge.threshold 以下にする"
        f"（{config.tracker.min_conf} > {config.judge.threshold}）"
    )
    raise ConfigError(msg)
```

CFG-1c にこの組み合わせのケースを足す。

### W4. [coreml.py:70-74] `parse_names` が `ConfigError` 以外の例外を漏らす

`sorted(value)` はキーに文字列と整数が混ざると `TypeError` になる（例: `"{0: 'deer', 'a': 'x'}"`）。`ast.literal_eval` も `"{[]: 1}"` のようなキーで `TypeError` を出す（except の対象は `ValueError, SyntaxError, MemoryError, RecursionError` だけ）。どちらも起動時に生の `TypeError` が出て、「モデルのメタデータ names を読めない」の分かる形にならない。テスト CU-2c の不正入力にこの 2 種が無い。

```python
except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError) as exc:
    ...
if not isinstance(value, dict) or not all(type(k) is int for k in value):
    raise ConfigError(msg)
if sorted(value) != list(range(len(value))) or ...:
```

`type(k) is int` にすると `{False: 'deer'}` / `{0.0: 'deer'}` が `range` と等しく通ってしまう穴も塞がる。

### W5. [test_l0_tracker.py:50-58] TRK-1b が「IoU の大きい組から貪欲に」を実は確かめていない

コメントは「A は ID1 と大きく重なり」と書いているが、幅 0.1 のボックスで計算すると ID1（0.40: [0.35, 0.45]）と A（0.50: [0.45, 0.55]）は接するだけで IoU 0。実際の組は ID1–B（0.667）と ID2–A（0.667）の 2 つだけで、どの順で結んでも同じ結果になる。実装が「ID 順に先着で結ぶ」に壊れてもこのテストは通る。

貪欲さを区別する入力にする: トラック 1 が検出 X と Y の両方に重なるが、Y のほうが大きく重なり、Y はトラック 2 とも重なるが IoU はトラック 1 より小さい、という配置。期待は「トラック 1 → Y（IoU 最大）、トラック 2 → X には結ばれず新規」となる。コメントも実際の幾何に合わせて直す。

### W6. [stage.py:61, 73 / BLE001 の noqa] noqa 自体は妥当。ただし原因を後から追えない

`# noqa: BLE001` は妥当と判断した。理由: 赤を止めないことが仕様（R5・S-2）で、握りつぶしではなく `l0.tracker_failed` を warning で残している。`pipeline.py:71` の既存の `noqa: BLE001`（`infer.failed`）と同じ型で、ログの決まり（本文を残さない）にも沿う。`Exception` で止まるので `KeyboardInterrupt` / `asyncio.CancelledError` は素通しになる。

ただしログが `error_type` だけで、トラッカーのどこで落ちたかが分からない。実機の調査走行で再現しにくい不具合が出ると、手がかりが無い。個人情報を含まない範囲で、例外の発生位置（関数名と行）を足す。

```python
tb = exc.__traceback__
where = f"{tb.tb_next.tb_frame.f_code.co_name}:{tb.tb_next.tb_lineno}" if tb and tb.tb_next else None
logger.warning("l0.tracker_failed", extra={"error_type": type(exc).__name__, "where": where})
```

### W7. [coreml.py:143] coremltools が無いと生の `ImportError` が出る

`load_with_coremltools` は `import coremltools` が失敗するとそのまま `ImportError` になり、「`pip install -e "edge/detector[coreml]"` が要る」ことが伝わらない。設定の誤りと同じく、起動時に分かる形にする。モデルのパスが存在しない・壊れているときの `MLModel` の例外も同様に包むと、起動時の失敗が `ConfigError` にそろう。

```python
try:
    import coremltools as ct
except ImportError as exc:
    msg = 'coremltools が無い（pip install -e "edge/detector[coreml]"）'
    raise ConfigError(msg) from exc
```

テストは「偽の `coremltools` を差し替える」ものだけで、この経路は無い。

## Info（参考）

- [tracker.py 全体] 良い点: 時刻を `t_frame` だけで扱い、乱数が無く、ID が決定的。履歴の窓・上限・戻りの扱いが仕様の文言と 1 対 1 で、定数（`MIN_SPAN_S`・`MIN_CLOSING_MPS`・`MAX_POINTS`・`RESET_BACK_S`）に名前が付いている。
- [tracker.py:107-222] `Tracker` が「追跡」「指標の計算」「JudgeRequest 用の整形（`track_points`）」の 3 つを持つ。edge-l1 で `JudgeRequest` の組み立てが入ると膨らむので、そのときに `metrics` と `track_points` を別のクラス（または関数）に出す。今は YAGNI で現状維持でよい。
- [tracker.py:95, 202-207] `side`・`pos` が `str`、`"L"` / `"R"` / `"lane"` / `"shoulder"` が文字列のまま散っている。`Literal["L", "R"]` と `Literal["lane", "shoulder"]` の型にするだけで、タイプミスを型検査が拾う。`track_points` が `dict[str, object]` を返すので、`TrackPoint` を直接作って返すと契約が出どころで保証され、テストの `model_validate` も不要になる（今はテストが契約を見ている点は良い）。
- [tracker.py:102 と judge.py:60] `_usable`（有限で高さが正）が二重にある。違いは label と閾値だけ。`judge.py` の関数を `has_valid_height(d)` のように切り出して共有すると、「正しい高さ」の定義が割れない。
- [coreml.py:35-40 と config.py:28] 同じ 4 つの名前が 2 か所にある。`COMPUTE_UNIT_NAMES = {name: name.upper() for name in COMPUTE_UNITS}` にすれば、どちらかだけ直す事故が無い。CU-1b の中で `COMPUTE_UNIT_NAMES.values()` を確かめている行（test_l0_coreml.py:95-96）はパラメータ化の中にあり、毎回同じ確認になる。別のテストに出す。
- [coreml.py:134-137] 行ごとに `argmax` を取るので、`deer 0.45 / car 0.50` のような行は car になり、鹿として捨てられる。NMS 付きエクスポートではクラスごとに別の箱が出るのが普通で、多くは問題にならない。だが 2 クラスが拮抗する箱は鹿を見逃す。実機（Deferred の確認）で、混在する箱が出るかを見る。
- [hub.py:44-51] `l0` を渡すと `tracker` 引数が黙って無視され、`l0` が持つ `JudgeConfig` と `hub._cfg` が別物になりうる（stall だけ `hub._cfg`、判定は `l0.judge`）。`l0` と `tracker` の同時指定を `ValueError` にするか、`l0` から設定を取る。`self._judge`（hub.py:51）は test_server.py:122 のためだけの別名で、テストを `hub.deer_on` に直せば消せる。
- [hub.py:113-124] `snapshot` と `_emit` の読み出しパスが `primary_metrics` 経由でトラッカーを作り直しうる。読み出しに副作用があるのは W1 と同じ理由で避けたい。
- [tracker.py:129-130] `l0.tracker_reset` のログに間引きが無い。2 つの時計の `t_frame` が交互に入る異常があると、毎フレーム出る。`l0.tracker_failed` と同じ 1 秒 1 回の間引きにそろえる。
- [テストの抜け] 次は未確認: (1) `[judge]` と `[tracker]` の閾値の関係（W3）、(2) `parse_names` の型混在キー（W4）、(3) `_factory` 自体の失敗（W1）、(4) `coremltools` が無い場合（W7）、(5) LAC-1 は `ttc_s` の「キーがあること」しか見ていない（test_l0_acceptance.py:69）。近づく鹿の入力なので、少なくとも最後の ON で `ttc_s` が数になることまで確かめられる、(6) トラッカーの再設定が起きても判定が ON のまま続くことの `L0Stage` レベルのテスト、(7) テスト間の私的な参照（`hub._wall`・`hub._last_ok`・`from .test_runner import ListSource`）が内部構造に結び付いている。公開の入口（`clock` / `wall` の注入、共通の fixture を conftest へ）に寄せると壊れにくい。
- [functional.md 213-227] 非機能要件・受け入れ基準のチェックが空のまま。W2 のベンチと、`local-ci.py` の結果で閉じる。

## 既存 API の互換

- `detector.inference` は `DeerDetector`・`Detection`・`Detector`・`ScriptedDetector` を `l0.inference` から出し直しているだけで、既存テスト（test_pipeline・test_runner・test_inference・test_acceptance_camera）の import が変わらない。MV-1 が同一性と `__all__` を確かめている。ログの名前 `detector.inference` も保たれている。
- `AlertHub` の新しい引数 `tracker`・`l0` は末尾に足されていて、位置引数の呼び出しは壊れない。
- `judge.py` は現在の内容だけを読んだ（差分は未確認）。`interpolate_distance_m`・`side_of`・`is_blind` が公開関数として tracker から使われ、`Judge` の `update` / `expire` の形は hub が従来どおり呼べる。

## 決定性

乱数・集合の順序・辞書の順序への依存は無い（`by_id` は ID で引くだけ、`used_*` は存在確認だけ）。整列キーが全順序で、同じ入力列から同じ ID・同じ値になる。TRK-1b の 5 回再実行はこれを確かめているが、W5 のとおり入力が弱い。
