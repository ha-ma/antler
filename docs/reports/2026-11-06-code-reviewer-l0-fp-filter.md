# code-reviewer: l0-fp-filter (git diff main...HEAD, edge/detector)

対象: `l0/fp_filter.py`、`l0/inference.py`、`l0/coreml.py`、`config.py`、`config.example.toml`、`tests/test_l0_fp_filter.py`、`tests/test_l0_fp_acceptance.py`、`tests/fp_geometry.py`。仕様は `docs/specs/l0-fp-filter/functional.md`。
テストは実行していない（読みのみ。この環境では実行手段が無い）。

## レビュー結果

### Critical（修正必須）

なし。境界（0.7 ちょうど・8 割ちょうど・IoU 0.3 ちょうど・1.0 秒ちょうど）、状態の更新順（前の枠を取ってから今のフレームを元に足す）、
R4 の失敗時の素通し、R6 の範囲と領域の制約は、仕様どおりに実装され、テストで確かめられている。

### Warning（推奨）

1. [dataset/train_l0.py:860, 1016 / edge/detector/src/detector/bench.py:640] `load_coreml_detector(Config(...))` が、既定で `enabled = true` の後処理を付けるようになった。
   - train_l0 の評価（`_make_detector`）は、無関係な静止画を高速に順に流す。後処理の「続き」は単調時計の 1 秒と直近 12 フレームで覚えるので、画像をまたいで元が漏れる。
     また、面積 0.7 以上の枠は評価から消える。dataset-train の R8 の指標（誤検出・再現率）が、モデルでなく後処理の影響で動く。
   - bench も、行（合成の例）をまたいで状態を持ち越す。
   - 仕様の範囲外（`dataset/`・bench）だが、Deferred「後処理の前後の誤検出を測る」を測る前に決める必要がある。
   - 案: 評価・bench は `replace(config, l0_filter=L0FilterConfig(enabled=False))` で切る。後処理つきで測るなら、画像ごとに `build_box_filter` を作り直す
     （またはフレーム時刻を渡せる形にする）。この PR には「dataset 側の評価は未対応」と書く。
2. [fp_filter.py:93, inference.py:47] 時計が 2 つ（BoxFilter の `clock` と DeerDetector の `clock`）。受け入れテストは両方に同じ偽の時計を渡している。
   取り違えると、片方だけ実時間で動いて 1 秒の判定がずれる。`load_coreml_detector` も既定の `monotonic` を 2 か所に持つ。
   → DeerDetector の `clock` は失敗ログの間引き専用だと docstring に書く。または間引きを BoxFilter 側に寄せる。
3. [inference.py:77] `logging.getLogger("detector.l0")` を失敗のたびに呼んでいる。他の l0 のモジュール（stage.py・tracker.py）はモジュール先頭の `logger`。
   → `_l0_logger = logging.getLogger("detector.l0")` をモジュールの先頭に置く。
4. [fp_filter.py:38] `SEEDS_PER_FRAME` が「元として覚える枠」と「続きを調べる枠」の 2 つの意味で使われている（仕様では別の上限が同じ値）。
   → 値が変わる可能性が出たら別々の定数にする。今は `MAX_BOXES_PER_FRAME` のような名前にして、コメントで 2 つの用途を書く。
5. [fp_filter.py:119-154] `__call__` が、判定・状態の更新・ログの組み立てを 1 つで行っている（約 35 行）。ログの組み立てを `_log(counts, removed, kept)` に出すと、読みやすくなる。
   `_previous(now)` は毎フレーム最大 192 要素のリストを作るが、大きい枠が無いフレームでは使わない。必要になるまで作らない形（遅延）にできる。
6. [tests/test_l0_fp_filter.py:283-301] 時間の閾値（1 ms・2 ms）のテストは、CI の負荷で落ちうる。「いちばん速い組」で抑えているが、仕様は手元の値（0.23 / 0.5 ms）の 4 倍の余裕で、共有ランナーでは安全とは言えない。
   `per_call_s` の `sys.settrace(None)` はカバレッジの `sys.monitoring`（Python 3.12+ の既定の core）には効かない。コメント（「トレースを外す」）が実態と合っているか確かめる。
   さらに、`f._seeds` を直接見ている（301 行）。公開の観測（例: 元の数を返すプロパティ）にする。
7. [tests/test_l0_fp_acceptance.py:44-53] FPA-1 は、赤のまま終わることを `sent` で見ているが、`off_after_s` = 1.5 秒より短い 1〜2 フレームの除外では旗が落ちず、赤の確認は続きの有無に感度が無い。
   感度があるのは `l0.filtered` の assert だが、`area + width == 0` は continued のとき必ず 0（カウントは除いた枠だけ）で意味が薄い。
   → 「至近のフレーム数 ≥ 1 の `continued` が出ている」（`sum(e["continued"]) >= 1`）と、続きを切った対照（`enabled` はそのままで元を入れない）で除かれることを足す。FPA-4（3 秒とどまる）は感度がある。

### Info（参考）

- [config.py:203-240] `_RANGES` は「キー名だけ」で引くが、`max_area`・`max_width`・`min_height_at_max_width`・`region_min_inside`・`region_conf_scale` は既存のキー（`max_age_s`・`max_clients`・`max_per_run`・`max_items`・`min_conf`・`min_interval_s`・`width`）と衝突しない。`enabled` は範囲なし。問題なし。
  ただし今後 `max_width` を別セクションに足すと衝突するので、`_RANGES` のキーは `l0_filter.max_width` のようにセクションつきにする案を ADR 候補にしてよい（今回は不要）。
- [config.py:298-307] 辺に接する判定は `== 0.0` / `== 1.0` の厳密比較（TOML の数値なので問題なし）。面積の許容 `1e-9` と、帯の交わりの厳密な不等号（接するだけは可）が、仕様どおり。良い点。
- [fp_filter.py:34] 浮動小数の許容 `EPS = 1e-9` を、除く側・領域の割合・IoU の 3 か所すべてで境界の側に入れている。0.875×0.8、8 割ちょうど、0.7996 のテストが、許容が広すぎないことまで確かめている。良い点。
- [fp_filter.py:62-82] IoU の前に面積比で飛ばす最適化は、`IoU ≤ 小/大` で正しい。面積 0 の扱いも安全。
- [fp_filter.py:51] 枠が画面の外にはみ出す（`cx - w/2 < 0`）場合は、はみ出した分が領域の外として数えられる。YOLO の出力は画面内に切り詰められるので実害は小さい。仕様に書く価値あり（R2）。
- [fp_filter.py:30] 失敗時（R4）は、その回の通した枠が「続き」の元に入らない。失敗が続くと続きの記憶が切れる。例外は想定外のときだけなので許容。
- [inference.py:66-71] `BoxFilter.__call__` と `DeerDetector.detect` で 2 回ソートしている。後者は 外から渡された任意の `box_filter` の並びを保証するためで、意図は妥当（コメントにすると良い）。
- 仕様との差: R1〜R7、UC-1〜4、S-1・S-2、Test List の全項目に対応する実装とテストがある。差異は無い。ログの `l0.filtered` のフィールドも一致。
- 良い点: 既定は安全側、境界のテスト、幾何の合成（fp_geometry.py）で「2 m 以遠は除かれない」を格子で確かめている、`enabled = false` と後処理なしの同一性、失敗で素通し。
