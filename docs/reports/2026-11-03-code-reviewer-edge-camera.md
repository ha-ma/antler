# code-reviewer レビュー: edge-camera（2026-11-03）

対象: `edge/detector/src/detector/` の pipeline・sources・throttle・frame・inference・config・ports（log.py は参照のみ）と `edge/detector/tests/`。
仕様: `docs/specs/edge-camera/functional.md`。
方法: 静読のみ。このレビューでは Bash が無く、pytest・ruff は実行していない（Green かどうかは未確認）。ソースとテストは編集していない。

## Critical（修正必須）

### C-1. 不正な検出を捨てるだけなので、壊れたモデルが「鹿なし」（緑）に見える

- `inference.py:36-43`、`pipeline.py:99-109`
- `DeerDetector` は conf が NaN・範囲外、または xywh が範囲外の deer を捨てて `detection.invalid` を warn するだけ。
  その結果 `failed=False`・`detections=[]`・`deer_count=0` になり、本物の「鹿なし」と区別できない。
- モデルや変換が壊れて全フレームで NaN や 1.2 を返すと、次のことが起きる。
  - 走行中ずっと「鹿なし」が返る。
  - `infer.degraded`（例外だけを数える）に届かない。
  - warn は出るが `seq` / `t_frame` が無く、後段からは見えない。
- 仕様 R4 は「後段が失敗を鹿なしと読んで緑にしない」ために `failed` を作った。同じ意図が、この経路では守られていない。
- float32 由来の `1.0000001` のような誤差でも、本物の鹿が捨てられる。
- 修正案（どちらか、または併用）:
  1. `DeerDetector` が「deer ラベルの検出があったのに全部不正」のときは例外（`InvalidOutputError`）を投げる。パイプラインが `failed=True` として扱う。
  2. `FrameResult` と `frame.processed` に `invalid_count` を足す。連続して不正が出たら `infer.degraded` と同じ扱いにする。
  3. 範囲チェックに微小な許容（`-1e-6 <= v <= 1 + 1e-6`）を入れ、クリップして通す。
- 仕様 R4 が「その検出だけ捨てる」と書いているので、仕様側も 1 行直すこと（ユーザー判断の対象）。

### C-2. `SourceError` 以外の例外で `ended` が "closed" と記録され、`pipeline.aborted` も出ない

- `pipeline.py:50-61`、`sources.py:94-104`
- `source.read()` は `SourceError` だけを `ended="error"` にして critical を出す。次のような例外は素通りする。
  - `CameraSource.read` が作る `Frame(...)` の `ValueError`。カメラが 2 次元や 4 チャンネルの画像を返したとき。
  - `capture.read()` 自体の `cv2.error`。
  - `VideoFileSource` の naive な `start` による `ValueError`。
- これらが起きると、`pipeline.summary` は `ended="closed"` になる。ユーザーが閉じたのか、例外で落ちたのか、後から区別できない。
- `pipeline.aborted` が無く、走行ログには critical が残らない。検知が止まったことを、ログの読み手が summary の "closed" から誤読する。
- 実機で、ドライバが 1 フレームだけ壊れた絵を返すだけで検知ループ全体が落ちる。
- 修正案:
  ```python
  except SourceError: ended = "error"; logger.critical("pipeline.aborted"); raise
  except Exception as exc:  # noqa: BLE001
      ended = "error"
      logger.critical("pipeline.aborted", extra={"error_type": type(exc).__name__})
      raise
  ```
  - `CameraSource.read` では `Frame(...)` の `ValueError` と `cv2.error` を `SourceError` に包む。ただし `from None` で本文は出さない。
  - 1 枚だけ壊れた絵は捨てて続ける選択肢もある。ただしこれは仕様判断。
- このケースのテストが無い（W-6 も参照）。

## Warning（推奨）

### W-1. 設定ファイルが UTF-8 でないと `ConfigError` にならず `UnicodeDecodeError` が出る

- `config.py:79-82`
- `read_text(encoding="utf-8")` の `UnicodeDecodeError` は `ValueError` 系。`except (OSError, tomllib.TOMLDecodeError)` に入らない。
- 仕様 R7「TOML でない → ConfigError」に反する。
- 修正案: `except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError)`。バイナリのファイルで `ConfigError` になるテストも足す。

### W-2. `open_video_file` が fps 不正のとき capture を release しない

- `sources.py:125-129`
- `_open` で開けたあと `VideoFileSource(...)` が `SourceError`（fps 0・NaN）を投げると、`capture` は開いたまま。
- この経路は `camera.open_failed` のログも出ない。
- 修正案: `try: ... except SourceError: capture.release(); logger.error("camera.open_failed", extra={"target": ..., "reason": "fps"}); raise`。
- テストは `FakeCapture.released` を一度も assert していない。EOF 時の release・`camera.lost` 時の release も同様。

### W-3. 間引きの基準が「直前に通した時刻」なので、割り切れない fps で実効 fps が大きく下がる

- `throttle.py:49-51`
- 入力 11 fps・target 10 のとき、1 枚目は 90.9 ms で `95 ms` 未満のため捨て、2 枚目（181.8 ms）で通す。実効は約 5.5 fps。
- 15 fps → 10 は 7.5 fps、12 fps → 10 は 6 fps。ちょうど 5 fps の下限（B2-1）に近づく。
- 実カメラは 60 fps を要求しても 24〜30 fps や可変で来ることがある。
- 修正案: 通した時刻ではなく「次の期限」を持つ（`due += interval`、遅れたら `due = t`）。揺れ許容は期限との比較にする。
- テストは 60 / 30 / 5 fps だけ（割り切れる値）。11・15・24 fps のテストを足す。

### W-4. 壁時計の `t_frame` が 1 秒以内に戻ると、最大 1 秒ぶんの検知が空白になる

- `throttle.py:36-48`、`sources.py:96`
- `CameraSource` は `datetime.now(UTC)`（非単調）。NTP の補正で最大 1 秒戻ると、その間のフレームはすべて `out_of_order` で捨てられる。
- `FrameResult` が 1 つも返らず、後段（edge-judge）から見ると「結果が来ない」だけ。
- 60 fps なら最大 59 行の warn が出る。ログも溢れる。
- 修正案: `CameraSource` は開いた時点の壁時計 ＋ 単調時計の差で `t_frame` を作る（戻らない）。
  最低限、`frame.out_of_order` の連続回数を summary に入れる。
- Deferred の「カメラの撮影時刻」とあわせて扱ってよい。

### W-5. パイプラインが `DeerDetector` を強制しないので、素の `Detector` だと deer 以外も数える

- `pipeline.py:105-106`
- `process_frames` は渡された `Detector` の戻りをそのまま `deer_count` / `max_conf` にする。
- 素の YOLO アダプタを直接渡すと、cow・person や不正な値が入る。`FrameResult` の名前（鹿）と中身が合わなくなる。
- 修正案: 配線する CLI 側（別 feature）で `DeerDetector` を必ず包む。`process_frames` の docstring に「渡す Detector は deer だけを返す前提」と書く。
- あわせて、`detect` の戻りが list でなかった場合の `len()` / `max()` はいまは try の外。例外で落ちる。try の内側に寄せるか、戻りを検証する。

### W-6. テストが形だけを見ている・境界を見ていない

- `test_pipeline.py::test_ac2`: `assert out, source` だけ。
  - 実際には、カメラは `clock=lambda: T0` で全フレームが同じ時刻になり、2 枚目以降が `out_of_order` で捨てられる。
  - 動画も 3 枚（0 / 33 / 67 ms）で 1 枚しか通らない。
  - 1 件でも結果があれば通る。中身（seq・t_frame・detections）を見ていない。
  - 修正案: 3 入力それぞれで、期待する seq と `t_frame` の列を assert する。時計は進むものを使う。
- `test_pipeline.py::test_uc5h_単調時計…`: `StepClock` を注入しているので、本物の `perf_counter` を使っているかは確かめない。
  - 既定値を `time.time` にしても通る。`t_frame` の年を変えても `infer_ms` と無関係で、実質は恒真。
  - 修正案: `monkeypatch` で `detector.pipeline.perf_counter` が呼ばれることを確かめる。または既定引数が `perf_counter` であることを assert する。
- `test_uc5g`: 35 回失敗で `degraded` が 1 回、というだけで、境界を見ていない。
  - 29 回失敗では出ないこと、30 回目で出ること、回復後に再び 30 回失敗すると再度出ることを足す。
  - `DEGRADED_AFTER` を 1 にしても、31 にしても通ってしまう。
- `test_uc6d`: `"lat" not in text.replace("latency", "")` は部分文字列の判定で壊れやすい（将来 "relative" / "platform" を含むイベント名が入ると誤検出）。キーと値を再帰的に走査する。
- 仕様 R5 の KeyboardInterrupt のテストが無い。`ended` の値は仕様では eof / error / closed の 3 つだが、KeyboardInterrupt が何になるかは決まっていない（実装は "closed" になる）。
- `UC-3f` の境界（ちょうど 1 秒戻る）と、時刻が大きく進む場合のテストが無い。

### W-7. プライバシーの「許可リスト」が実装されていない

- 仕様 NFR「ログは項目の許可リスト（seq・t_frame・infer_ms・deer_count・max_conf）だけ」。
- 実際は `JsonFormatter` が `extra` に入ったものをすべて出す。守っているのは呼び出し側の慣習だけ。
- `log.py:35-41`: `exc_info` つきのログは `str(error)` とスタックを出す。`process.uncaught`（`install_excepthook`）経由で、C-2 のような素通りの例外が出ると、メッセージ・絶対パスが漏れる。R6「例外は型名だけ」と食い違う。
- 修正案: パイプライン系の logger にだけ項目の許可リストを適用する。`install_excepthook` のスタックにはパスのマスクをかける。

## Info（参考）

- 良い点:
  - Protocol で差し込み口を分け、パイプラインは具体クラスを import しない。UC-8a が実際に import 文を見て確かめている。
  - `t_frame` を `seq / fps` から計算していて累積誤差が無い。再生しても同じ値になる（UC-1h）。
  - `infer_ms` を `perf_counter` の差にし、時計を注入できる。
  - `infer.failed` を型名だけにして、例外本文（numpy の repr）を漏らさない。テストで確かめている。
  - 失敗を `failed=True` で返し、鹿なしと区別する設計。`finally` で summary を 1 回だけ出す。
  - `resize_frame` が新しい配列を作り、元を変えない。
  - テストが偽 cv2 で実機なしに回る。
- `Frame` は `frozen=True` の dataclass だが、`image` が numpy 配列なので `==` が `ValueError`（真偽値が曖昧）になり、ハッシュも使えない。`@dataclass(frozen=True, eq=False)` にするのが安全（`frame.py:15`）。
- `FrameResult.detections` は frozen でも中身は変更できる list。`tuple` にすると明示的。
- `sources.py` の `Capture` Protocol は `packages/schema` の `Capture`（教師データ）と名前がぶつかる。`VideoCaptureLike` などに変える。
- `_open` / `open_*` の `# type: ignore[attr-defined]` が 5 か所。cv2 モジュールの最小 Protocol を作ると、型を効かせたままテストの偽物にも使える。
- `config.py` の `_RANGES` はキー名だけで引くので、別セクションに同名のキーが増えると衝突する（現状は `fps` と `target_fps` で別）。`device` の上限 64 はマジックナンバー。
- `ArrayFrameSource` は `fps` を検証しない（0 で `ZeroDivisionError`）。`VideoFileSource` は `start` が naive でも作れて、最初の `read()` で `ValueError` になる。構築時に検証すると早く見つかる。
- 動画の途中の読み取り失敗が EOF と同じ扱い（仕様どおり）。壊れた動画の途中終了を `ended="eof"` と区別できない。
- summary の `dropped` は、間引きと `out_of_order` の両方を含む。分けて持つと、W-4 の兆候が summary で見える。
- `max_conf` に NaN が入ると `json.dumps` が不正な JSON（`NaN`）を出す。`DeerDetector` を通る限りは起きない（W-5）。
