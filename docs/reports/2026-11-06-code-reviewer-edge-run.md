# code-reviewer: edge-run（claude/edge-run、未コミットの変更）

対象: `edge/detector/src/detector/app.py`・`__main__.py`・`sources.py`（close）・`bench.py`（`run_yolo_alone` / `_main_yolo`）、
テスト `test_app.py`・`test_app_acceptance.py`・`test_bench_yolo.py`・`app_fakes.py`・`test_sources.py` 末尾、`pyproject.toml`・`config.example.toml`。
仕様 `docs/specs/edge-run/functional.md` と突き合わせた。コードは読んだだけで、テスト・ruff は実行していない（この環境に Bash が無い）。
行番号は `app.py` は今回読んだ版。`runbook` と `scripts/bench_l1.py` の差分は読んでいない。

## レビュー結果

### Critical（修正必須）

なし。ログに絶対パス・スタック・受信の本文を出さない決まり、forced のときにカメラを解放しない設計、`os._exit` での抜け方は、コードとテスト（AC-1 の `str(tmp_path) not in whole`、STUCK のサブプロセス）で裏付けがある。

### Warning（推奨）

1. [app.py:381-395] 片付けの各段が独立していない。`service.close()` だけ try で守られていて、`await server.stop()`（389）が例外を出すと `source.close()`（391）が走らずカメラが開いたまま残る。
   → 段ごとに守る。`contextlib.AsyncExitStack` か、段ごとの try/except（型名だけ `logger.error`）にする。

   ```python
   async def _shutdown(service, server, source, *, release_camera: bool) -> None:
       if service is not None:
           await _guard("capture.close_failed", asyncio.to_thread, service.close)
       if server is not None:
           await _guard("server.stop_failed", server.stop)
       if release_camera:
           source.close()
   ```

   `service.close()` は同期でスレッドの join（最大 2 秒）をするので、`asyncio.to_thread` に出すと、その間も 2 回目の Ctrl-C を受けられる。

2. [app.py:334-337, 233] モデルの読み込み（CoreML の初回のコンパイル、数十秒）と `open_camera`（macOS のカメラ許可ダイアログで止まる）が、イベントループを同期でブロックする。
   `add_signal_handler` のハンドラはループが回るまで動かないので、その間は (a)「止めています」が出ない、(b) 2 回目の Ctrl-C も読み込みの後まで効かない（旗が溜まり、読み込みが終わった直後に 130）。さらに待っている間、端末には何も出ない。仕様 S-6 の「旗に残る」は満たすが、手順書の読者（実機でハングに見える）には厳しい。
   → `await asyncio.to_thread(_detector, config, deps)` と `await asyncio.to_thread(_source, config, deps)` にし、直前に `_say("detector: モデルを読み込んでいます（初回は数十秒）")` を 1 行出す。os._exit(130) はスレッドが動いていても効く。テストは `slow_load` の `control.request()` が別スレッドから呼ばれることになるので、`StopControl` が `threading.Event` なのは今のままで足りる。

3. [app.py:425-457, 579-586] `--check` の推論（`detector.detect`、456）や `resize_frame` 以外の例外が `StartupError` に変換されない。`main` の `--check` 分岐は `try/except StartupError` だけで、`RuntimeError`（CoreML の predict 失敗）はそのまま素のトレースバック（絶対パス入り）と exit 1 になる。仕様 R6 は「起動できない = exit 2」。`--check` はまさに実機で最初に叩くコマンドなので、ここが一番ありそう。
   → `detect` の呼び出しを `try/except (OSError, RuntimeError, ValueError) as exc: raise StartupError(f"推論に失敗: {type(exc).__name__}") from exc` で包む。テストを 1 本足す（`detect` が `RuntimeError` を出す偽の L0 → exit 2、stderr に型名）。`--check` 中の Ctrl-C（KeyboardInterrupt）も `main` で拾って 130 にすると、コンパイル中の中断が静かに終わる。

4. [app.py:325-395] `serve` が 70 行・try の入れ子 3 段（外側 try → server の try / capture の try）で、起動・組み立て・待機・片付けを 1 関数で持つ。読むのに時間がかかり、1. のような片付けの穴が見えにくくなっている。
   → 起動を `_start_server(config, hub) -> AlertServer`、`_start_capture(config, deps) -> tuple[CaptureService | None, int | None]`（`StartupError` への変換を中に閉じる）に出し、`serve` は「開く → 待つ → 閉じる」の 3 段にする。`reason` の初期値 `"startup"`（344）が「forced かどうか」の判定（390）に混ざっているのも、外へ出すと消える。

5. [app.py:233-237 と 132-142] 閉じる処理が重複し、動きも違う。`StoppableSource.close` は失敗を `camera.close_failed` で残すが、`_close_quietly`（`--check` 用）は `contextlib.suppress(Exception)` で黙って飲む。`ports.FrameSource` に `close` が無いため、`getattr(x, "close", None)` が `app.py` に 2 箇所、`runner.py`・`capture/service.py` にもある。
   → `ports.py` に `class ClosableSource(FrameSource, Protocol): def close(self) -> None` を足すか、`FrameSource` に `close` を足す（`ArrayFrameSource` に no-op）。`check` も `StoppableSource` で包めば `_close_quietly` は要らない。

6. [app.py:298-301, 257-258] 「絶対パス・受信の本文を出さない」の保証が、`websockets` と `detector.websockets` の 2 つの logger を列挙して INFO に落とすことだけに依存している。`--log-level DEBUG` ではルートが DEBUG になるので、それ以外のサードパーティ（`asyncio`・`PIL`・`coremltools` など）の DEBUG が、ファイルにそのまま書かれる。`_NoStack` は `exc_info` だけを消し、`%s` で文言に入った例外・パスは消さない。
   → 許可リスト方式にする。ファイルの handler に「`detector.*` は level 以上、それ以外は WARNING 以上」の Filter を付ける（`_QUIET` が要らなくなる）。DEBUG で実際にパスが出るかは今回確かめていない。

7. [app.py:283-288] 「同じ秒に 2 回起動しても上書きしない」を `path.exists()` → `FileHandler(path)`（既定は追記モード `a`）で実装していて、確認と作成が別の動作（TOCTOU）。2 つ同時に起動すると同じファイルへ混ぜて書く。
   → `logging.FileHandler(path, mode="x", encoding="utf-8")` を `try/except FileExistsError` のループにする（存在確認が要らなくなる）。

8. [app.py:307-322, 154-157] 終了の理由が `str`（`"signal"`・`"eof"`・`"forced"`・`"error"`…）で、`_drive`・`serve`・`RunResult`・テストに散っている。仕様に 8 種類あり、タイプミスが型で見つからない。
   → `class StopReason(StrEnum)` か `Literal[...]` にする。JSON ログの値は `StrEnum` ならそのまま `"signal"` で出る。

9. [app.py:425-475] `check` が 50 行で、ポート確認・モデル・1 枚の取得・縮小・推論・JSON の組み立てを 1 関数で持つ（マジックナンバー `range(2)`・`1000.0`・`round(..., 3)` も）。
   → `_grab_raw(config, deps, image)`・`_infer_twice(detector, resized)` に分け、`INFER_REPEATS = 2` を名前にする。3. の例外変換も `_infer_twice` の中に置くと 1 箇所で済む。

10. [tests/test_app_acceptance.py:140-144] `for line in proc.stderr:` に時間切れが無い。起動しない・出力しないプロセスだとテストが CI で永遠に待つ。他の `wait` は timeout がある。
    → 読み取りを別スレッドにして `queue.get(timeout=…)`、または `selectors` で期限を付ける。

11. [tests/test_app.py:350-366] `AlertServer.stop` をクラスごと手で差し替えて `finally` で戻している。`monkeypatch.setattr(AlertServer, "stop", stop)` にすれば戻し忘れ・並列実行のテストへの漏れがなくなる。同じテストの `camera.close = lambda: ...`・`service.close = lambda: ...` も `monkeypatch.setattr(obj, "close", ...)` に揃える。

12. [tests/app_fakes.py:107-122 と app.py:299-300] `RestoreLogging` はルートの handler とレベルしか戻さない。`setup_logging` が変える `websockets`・`detector.websockets` の logger のレベルは戻らず、後続のテスト（`caplog` で websockets の DEBUG を見るもの）に漏れる。
    → `__enter__` で `_QUIET` の各 logger のレベルも保存して戻す。

13. [tests/test_app.py:286] `getattr(calls["observer"], "__name__", "") == "on_l1_answer"` は名前の文字列に頼っていて、メソッド名を変えると意味なく落ち、別の関数が同名でも通る。
    → `capture` の偽でサービスを保持し、`calls["observer"] == service.on_l1_answer`（束縛メソッドの等価）で比べる。

### Info（参考）

- [app.py:375, 539-541] forced（カメラの `read()` が戻らず上限で取り消した停止）が exit 0。仕様 R1 で決めた通りだが、launchd の `KeepAlive/SuccessfulExit` 型の監視（自動起動 feature）では「ハングしたのに正常終了」に見える。自動起動を作るときに、`run.stopped.reason = forced` で区別するか別コードを割り当てるかを決める余地がある。
- [app.py:309-316] `_drive` は 50 ms ごとのポーリング。`StopControl` が `threading.Event` なので `await` できないための選択と理解した。`request()` をループ上のハンドラからだけ呼ぶなら `asyncio.Event` で足りる（テストは `control.request()` をループ上から呼んでいる）。動作に問題は無いので、直さなくてよい。
- [app.py:390-395] 「forced なら解放しない」の判定が `reason` の文字列に依存する。外から `CancelledError` が来て `_drive` を抜けると `reason == "startup"` のまま `source.close()` が走り、別スレッドが `read()` の中にいれば仕様 C1 の落ちる条件になる。実機では通常起きないが、`StoppableSource` が「read 中」のフラグを持ち、`close()` が読み中なら解放しない、と自分で守るほうが堅い。
- [app.py:593] `_say(f"detector: 走行ログ {log_path}")` は端末に絶対パスを出す。人が読む行で、走行ログのファイルには入らないので決まり（R5）には反しない。ただし `--log-dir` の相対パスは cwd から、`--config` 内のパスは設定のディレクトリから解決される。手順書に 1 行書くと迷わない。
- [app.py:529] `_announce` は `config.server.host` をそのまま出す。`0.0.0.0` で待ち受けると `ws://0.0.0.0:8765/…` と出て、スマホに打てるアドレスではない。実機の手順書は LAN のアドレスを書かせているので問題は小さい。
- [app.py:55-75] `EXIT_KILLED` が `__all__` に無い（テストは `130` を直書き）。入れておくとテストが定数を使える。
- [app.py:203-204] `Deps.start_l1: Callable[..., ...]` は引数が不明で、`environ` は L1 だけに使うのに名前が一般的。`l1_environ` にするか、`Callable[[Config, AlertHub], ...]` の Protocol にすると型検査が効く。
- [app.py:334-336, 486-488] ruff format が括弧の中に入れたコメント（`detector = _detector(\n config, deps\n)  # CoreML…`）と、`def _hard_exit(\n code: int,\n) -> None:  # pragma: no cover …` の形が読みにくい。コメントを直前の行に移すと整う。
- [bench.py:381-398] `once()` が `nonlocal errors, last_error, i` の 3 変数を触る入れ子関数で、`warm_ok += ms is not None` は bool の足し算で意図が読みにくい。小さな `_Counter` dataclass か、計測と判定（`verdict`）を分ける純関数 `judge_yolo(samples, errors, ...)` に出すと、判定の境界値（p95 = 100.0 ちょうど、fps = target ちょうど）を時計なしでテストできる。今のテストは時計を注入してあり十分動くが、境界値のテストは無い。
- [bench.py:420, 441] `# type: ignore[operator]` が 2 箇所。`summarize_ms` の返り値が `dict[str, object]` のため。`TypedDict`（`n`・`p50_ms`・`p95_ms`…）にすると ignore が消える。
- [bench.py:816] `_fail(f"{type(exc).__name__}: {exc}")` は例外の文言（パスが入りうる）をそのまま出す。開発者が叩く計測 CLI なので許容だが、app.py の「型名だけ」の方針とは違う。
- [pyproject.toml:15, 20] `opencv-python>=4.9` が `camera` と `run` の両方にある。版を上げるときに片方だけ直す事故が起きうる。`run = ["antler-detector[camera]", …]` のように自己参照にすると 1 箇所で済む。ファイル冒頭のコメント（「YOLOv8 CoreML」）は yolo26n の運用と合わなくなっている。
- [tests/test_bench_yolo.py] `yolo_not_ready`（`fps`・`first_ms` が `None` になる）のときの `render_table` と JSON 出力（`allow_nan=False`）の組み合わせは、`run_yolo_alone` までしか見ていない。`_r` が nan を `None` にするので落ちないはずだが、表の側は今回読んでおらず未確認。1 本足すと確実。
- [tests/test_app.py:423-445] `os.kill(os.getpid(), SIGINT)` を pytest 本体に向ける。ハンドラの取り付けに失敗すると pytest 自体が止まる。`finally: remove()` と終了時の `getsignal` の確認があり、今のところ妥当。

### 良い点

- 差し替え口 `Deps`（偽のカメラ・偽の L0・`environ`・`capture`）と、`ready` コールバックで実ポートを返す作りが、テストしやすい。実機・CoreML・opencv なしで、本物の WebSocket クライアントまで通す受け入れ（AC-1）が書けている。
- 止め方の設計が丁寧。1 回目は旗、上限で取り消し、forced ではカメラを解放せず `camera.left_open` を残し、`os._exit` で抜ける。サブプロセスのテストで Ctrl-C から上限の秒数、2 回目で 130 を確かめている。
- ログの扱い（`_NoStack` で型名だけ、`run.started` にモデルのファイル名だけ、モデルのパスの親ディレクトリを出さないメッセージ）が一貫していて、`str(tmp_path) not in whole` で走行ログ全体を検査している。
- `CameraSource.close` / `VideoFileSource.close` は冪等で、`camera.lost` 後・EOF 後の再 close もテスト済み。`StoppableSource` の `_lock` で二重解放を避けている。
- `bench` の `--no-l1` は L1 側の部品が呼ばれたら落ちる `never` を渡す検査で、「L1 に触れない」を直接確かめている。予算 100 ms / 目標 50 ms を設定でなく定数で持ち、`meets_ch6` に 50 ms を含めない仕様どおりの判定になっている。
- テスト名・コメントの `# RUN-*` が Test List と 1 対 1 で追える。

## 対応（2026-11-06、メインセッション）

- 直した: 片付けの独立（`server.stop()` の失敗でもカメラを閉じる。`server.stop_failed`）、`--check` の推論の失敗を exit 2（型名だけ）、受け入れテストの stderr の読み取りに 30 秒の時間切れ。あわせて、`main()` を通すテストの設定に空きポートを書く（手元の偽 edge が 8765 を使っていて落ちた）
- 次に回す: 起動中のイベントループの停止（`to_thread`）、ログの allowlist 化、ログファイル名の `mode="x"`、`serve`・`check` の分割、終了理由の列挙型、`RestoreLogging` の logger レベル、`AlertServer.stop` の monkeypatch 化、Info の各項目
