# code-reviewer: edge-day0（a1696ab, feat/edge-day0）

対象: `edge/detector/src/detector/bench.py`、`edge/detector/scripts/export_yolo_world.py`、`scripts/bench_l1.py`、
各テスト、`edge/detector/pyproject.toml`（extra day0）、`CREDITS.md`。仕様 `docs/specs/edge-day0/functional.md`。
実行はしていない（Bash なし）。コードの読解と、参照先（l0/coreml.py・l1/client.py・l1_fakes.py・export_l1_labels.py・runbook）の突き合わせだけ。コードは直していない。

## 良い点

- `_call` が `L1Unavailable.reason` だけを数え、本文（請求・応答）を JSON にもログにも出さない。YoloLoop の例外も型名だけを残す（R4 に沿う）。
- 併走の判定に「L1 が落ちていると YOLO が負荷なしで回って合格に見える」穴を `valid` / `invalid_reason` で塞いだ。`accuracy` と `accuracy_all` と `coverage` を並べて生存者バイアスを見えるようにしたのも良い。
- 書き出しの検証を l0 自身の `load_coreml_detector`（`loader` の spy）で行い、黒画像で形が見えない弱点を `get_spec` の宣言と `--check-image` で補っている。
- `allow_nan=False` ＋ `_r()` で NaN を JSON に出さない。入口（scripts/bench_l1.py）が薄く、依存注入（`client_factory` / `detector_factory` / `examples_loader`）でテストできる。
- ruff 規約: `print` は無く `sys.stdout.write` / `sys.stderr.write`。`except Exception` は `# noqa: BLE001` に理由つきの 1 箇所だけ。`subprocess` は絶対パス・タイムアウトつき。

## Critical（修正必須）

- [edge/detector/tests/test_export_yolo_world.py:164-167 `test_main_reports_export_failure`] 「ultralytics は dev に無い」を前提にしている。ところが手順書 `docs/runbooks/2026-11-04-mac-mini-day0.md:61,71` は `[dev,l1,day0]` を入れた同じ venv で `python -m pytest -q edge/detector` を打たせる。
  ultralytics が入っていると `main` が本物の `YOLOWorld` で重みの取得・CLIP の取得・CoreML 書き出しを `tmp_path` に走らせる。数分かかり、成功すれば exit 0 でテストが落ち、途中の失敗は traceback になる。「約 30 秒で passed」の期待も崩れ、ネットワーク前提の副作用がテストに入る。
  → 前提をテスト内で作る。`monkeypatch.setitem(sys.modules, "ultralytics", None)` を入れるか、`_yolo_world` を `ImportError` を投げる偽物に差し替える。
  ```python
  def test_main_reports_export_failure(tmp_path, monkeypatch, capsys):
      monkeypatch.setitem(sys.modules, "ultralytics", None)  # day0 を入れた環境でも「無い」を再現
      assert ex.main(["--out-dir", str(tmp_path)]) == 1
  ```
  `test_export_check_image_errors` の `cv2` も同様に `sys.modules` を差し替えているので、同じ流儀に揃えられる。

## Warning（推奨）

- [bench.py:652-653 `main`、`_synthetic_requests`] examples が空でもチェックされない。`--scenarios 0` や、`export_l1_labels.export` が `max_traces=count*50` で 0 件のまま止まった場合、`run_l1` の `requests[i % len(requests)]` が `ZeroDivisionError` の traceback になる（spec S-3 は exit 2）。
  → `main` で `if not examples: return _fail("シナリオが 0 件", EXIT_INPUT)`。`--scenarios` も 1 以上を検証する。
- [bench.py:683, 702-705] `asyncio.run(go())` を包んでいない。計測の途中の想定外の例外（`ValidationError` 以外の SDK の例外、`KeyError`）は traceback になり、計測済みの JSON が失われる。
  また、`args.out.write_text` が失敗（親ディレクトリ無し）すると、stdout への出力より先に `OSError` で落ちて、Mac mini で数分かけた結果が消える。
  → stdout へ先に書き、`--out` の失敗は `_fail(..., EXIT_INPUT)` にとどめる。または `--out` の親を計測前に確かめる。
- [bench.py:393, 359 `_score`] `labels[q]` は `_load_examples` で検証していない（`request` と `labels` のキーの有無だけ）。古い JSONL などで 4 問のどれかが欠けると、全計測が終わった後の集計で `KeyError`。
  → `_load_examples` で `QUESTIONS <= set(row["labels"])` を確かめて exit 2 にする。
- [bench.py:656-657 `_fail(f"{type(exc).__name__}: {exc}")`] `JudgeRequest.model_validate` の `ValidationError`（`ValueError` の子）の文字列には `input_value=...` が入り、請求の中身（track・state）が stderr に出る。R4「本文は出さない」に反する。今は合成・sim のデータなので実害は小さいが、実走行ログを `--labels` に渡す運用になると本文になる。
  → `ValidationError` は `exc.errors(include_input=False)` の `loc` と `msg` だけを出す、または型名と行番号だけにする。
- [scripts/bench_l1.py の rule と export_l1_labels.py:625 の突き合わせ / bench.py:336-349 `rule_answer`] 「閾値ルールのみ」の基準線が、正解ラベルの生成式とほぼ同じ式になっている。
  `static_shoulder` は、ラベルが `deer and not in_lane and abs(lateral_v) < STILL_MPS and not enters`、ルールが `not lane and abs(lateralMps) < STILL_MPS` で、`STILL_MPS` まで共通。`false_positive` は常に False を返す。ルールの正解率が高く出る（`enters` と「鹿でない」例の割合しか差が出ない）ので、L1 が基準線に勝つ・負けるの判断材料としては偏る。docstring に一言あるが、レポートの表からは読めない。
  → 結果の JSON か runbook に「rule はラベル式と同じ閾値を使う上限寄りの基準線」と明記する。または `STILL_MPS` を別の値にしたルールも並べる。
- [export_yolo_world.py:146-161, 184] `--check-image` を渡したのに検出が 0 件（`seen == []`）でも `shape_verified: false` のまま exit 0 で終わる。仕様 ADV-1 は「形は検出の出る画像で確かめる」。鹿の写真でないものを渡した場合も黙って通る。
  → `check_image` があり `seen` が空なら `ExportError("check-image から検出が 0 件。形を確かめられない")`（または stderr に警告）。
- [export_yolo_world.py:186-197 `export`] ultralytics の例外（ネットワーク失敗、CLIP の git 取得失敗、`export` の内部エラー）は `ExportError` に包まれず traceback になる。`main` は `ExportError` しか捕まえず、spec S-2 の「exit 1 で理由を出す」が実機の主な失敗経路（ネットワーク・バージョン）で効かない。
  → `except Exception as exc: raise ExportError(f"{type(exc).__name__}: ...") from exc`（`# noqa: BLE001` に理由つき）で書き出しの 3 呼び出しを包む。
- [export_yolo_world.py:203-210] 既存の `target` を消してから `move` し、その後に検証する。`--force` で再実行して検証が失敗すると、直前まで使えたモデルが失われ、壊れたモデルが `target` に残る（次の実行は `--force` を要求する）。`_ensure_names:101-102` も `rmtree(path)` → `move` の順で、`move` が失敗すると原本が無くなる。
  → いったん `.new.mlpackage` に作って検証し、通ったら入れ替える。
- [tests/test_bench.py:142-153, 156-163 のタイミング依存] 実時間のスリープと 0.3 秒の窓（併走側は L1 の 10 回、約 50〜100 ms）で fps の差を判定している。`test_bench_with_yolo_within_limit` は低下率 20% 以内を実測で判定しており、窓が短くフレーム数が 20〜25 のため、負荷の高い CI（GitHub Actions）では 1〜2 フレームの揺れで 20% を超えて落ちうる。`ContendedDetector` は一度 `delay = 0.02` にすると戻さない（スレッド間の非同期の書き換えでもある）。
  → 時計と検出器を注入する（`YoloLoop` / `fps_between` を `Snapshot` を直接作る単体テストにする）。または `within_limit` の窓を長くし、閾値の余裕を持たせる。
- [tests/test_bench.py:136 `assert alone["answered_by"]`] 真偽だけで、中身を確かめていない。FakeClient の台本からは `{"other": 5}` と決まる（warmup に `answer()` を 1 回使い、2 回目の `unavailable` の後は最後の要素 `answer(model="other")` を繰り返す）ので、`== {"other": 5}` と書ける。形だけの検証になっている。同様に `test_main_with_model_uses_detector_factory` の `"併走" in out` も弱い（`verdict.valid` / `l0_alone.frames > 0` を JSON で確かめる）。
- [bench.py:646] `timeout_ms = args.timeout_ms or config.l1.timeout_ms`。`--timeout-ms 0` が黙って設定値に落ち、負数は検証されない。→ `is None` で分岐し、1 以上を検証する。

## Info（参考）

- [bench.py:310-316, 325] `ready=True` で `fps_alone == 0`（立ち上がり後に止まった）の場合、`drop` が NaN で `valid=True`・`fps_drop_ok=False`、表には「fps の低下 None%: 不合格」と出る。`_problem` が拾わず exit 0。`invalid_reason="yolo_stalled"` を足すと一貫する。
- [bench.py:297-301] `ready=False` でも `yolo_seconds` と L1 の n 回をそのまま測る（最大 60 秒 + 数十秒の無駄）。`wait_ready` が False なら早く返せる。
- [bench.py:205-229 YoloLoop] スレッド安全性は概ね良好（カウンタは Lock の中）。`last_error` は更新が Lock の中、読み出し（`_fps_report`）は Lock の外で、窓ごとではなく全体の最後の値。`stop()` が `join(timeout=10)` で戻っても、CoreML の predict が固まっていればスレッドが生きたまま（daemon なので終了はできるが、終了時に CoreML の呼び出しと競合しうる）。`is_alive()` なら警告を JSON に残すとよい。
- [bench.py:17-21 / 仕様 R3] 仕様には「立ち上がり 0.5 秒は測らない」とあるが、実装は `READY_FRAMES=5` を待つ方式（0.5 秒の除外は無い）。どちらかに揃える。
- [bench.py:50-51] 入力フレームはシード付きの乱数画像。NMS 付きモデルは検出が出ない入力だと NMS 後段のコストが軽く、実走行より fps が良く出る可能性がある。runbook の期待値に注記があるとよい（`--check-image` の写真を巡回させる選択肢）。
- [bench.py:637] `_fail(..., 2)` の `2` は `EXIT_INPUT` に置き換える（定数が既にある）。`main` が約 80 行で `go()` を内側に持つ。計測引数の検証・構築・出力を分けるとテストしやすい。`# type: ignore` が多く、レポートは `TypedDict` / dataclass にすると外せる（規約上は許容）。
- [bench.py:695] `base_url_host` は `split("//")[-1]` で、ユーザー情報つき URL だと資格情報が JSON に入る。ループバックのみ許可なので実害は低い。`urlsplit(...).netloc` から `hostname:port` だけにする。
- [bench.py:112 ece] `c > 1.0`（浮動小数の誤差）はどの bin にも入らず分母にだけ数えられ、ECE が小さく出る。`min(c, 1.0)` で丸めるとよい。
- [export_yolo_world.py:143] `get_spec` が無いモデルでは出力名の確認を黙って飛ばす（fail-open）。本物の `MLModel` には常にあるので、テストの偽物の都合。無ければ `ExportError` のほうが安全。
- [export_yolo_world.py:138] `--classes` の空白（`"Deer "`）は `main` では `strip().lower()` で deer 判定するが、`verify` は `c.lower()` のみで不一致になる。`strip()` を揃える。
- [pyproject.toml day0] `numpy>=1.26,<=2.3.5` は本体の `numpy>=1.26` と重複するが、上限を入れる目的は明確。`coreml` extra（`coremltools>=7.2`）と `day0`（`==9.0`）は併用でき矛盾しない。PyPI での版の実在は本レビューでは確認できていない（仕様は 2026-11-04 に確認済みと記載）。
- [scripts/bench_l1.py:19-20] import 時に `sys.path.insert` する副作用。入口スクリプトなので許容。`dataset/tests/test_bench_l1_entry.py` は `detector` が入っている前提（dataset の検査は `pip install -e "edge/detector[dev]"` が必須と CLAUDE.md にあり、整合している）。
- [CREDITS.md の ライセンス記述] 全体として正確: Ultralytics（コード）と YOLO-World の重み = AGPL-3.0、CLIP = MIT（OpenAI CLIP のフォークと ViT-B/32 の重み）、coremltools = BSD-3-Clause、mlx = MIT は、いずれも私の知る公開情報と一致する。細部の指摘は次のとおり。
  - `coremltools 9.0` の行は extra `coreml` も含めて書いてあるが、`coreml` の版指定は `>=7.2`（9.0 に固定されるのは `day0`）。
  - ultralytics 経由で入る torch（BSD-3-Clause）・opencv-python（Apache-2.0。同梱の FFmpeg は LGPL）は載っていない。配布物に含める段階で足す。
  - AGPL の説明は「ネットワーク提供時はソース開示の義務が及ぶ」と書いてあるが、AGPL §13 は改変版を対象とするので、「改変した場合のネットワーク提供」と書くと正確。車載の Mac mini でローカルに動かすだけなら通常は配布に当たらない。この判断は ch9 に挙げる、と Deferred にあるので、現状の「注意喚起」で足りる。
  - 重みは Ultralytics の公開物（`yolov8s-worldv2.pt`）で AGPL-3.0 とされる。ただしモデルカードの宣言であり、最終確認は実機で取得したときの `LICENSE` を CREDITS の出所に残すとよい。
- [tests/test_export_yolo_world.py:13-16] `importlib.util.spec_from_file_location` でスクリプトを読み込む方式はこのリポジトリの `generate_models.py` のテストと同じ流儀なら問題ない。`sys.modules` には登録されないため、`pickle` やデータクラスの `__module__` 参照が必要になったら破綻する（今は無い）。
