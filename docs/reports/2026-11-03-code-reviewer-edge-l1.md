## レビュー結果（code-reviewer / edge-l1、ブランチ feat/edge-l1、コミット 9047b47）

範囲: edge/detector の l1/（questions・request・client・calibration・runner・**init**）、fusion.py、hub.py、runner.py、config.py、l0/stage.py、config.example.toml、pyproject.toml、tests/test_l1_*.py・test_fusion.py・l1_fakes.py。仕様は docs/specs/edge-l1/functional.md。

制約（正直に書く）: このレビューには Bash が無く、`git diff`・ruff・pytest は動かしていない。ファイルを直接読んだ静的レビュー。ruff は pyproject の選択（E W F I B UP SIM RUF T20 BLE ANN S PTH）に照らして目で確かめた。ファイル全体を読んだので、差分の外の既存コードに触れる指摘は「既存」と書く。edge-latency-reviewer の同日の報告（2026-11-03-edge-latency-reviewer-edge-l1.md）と重なる点は「重複」と書いた。

件数: Critical 1 / Warning 8 / Info 10（ほかに「良い点」）

---

### Critical（修正必須）

**C1. [l1/runner.py:153] 失敗が 1,024 回続くと `OverflowError` で L1 のタスクが死ぬ（R7「どれでも死なない」に反する）**

```python
delay = min(MAX_BACKOFF_S, interval * 2**failures) if failures else interval
```

- `failures` は成功するまで増え続ける。`2**failures` は Python の int で、`failures >= 1024` になると `interval * 2**failures`（float × int）が `OverflowError: int too large to convert to float` を出す。
- この行は `try` の外（while の直下）にあるので、`except Exception` に拾われず、`run_l1` の外へ出る。
- 現実に起きる条件: local-jev を起動していない・落ちたまま。間隔は 2 秒で頭打ちなので、約 34 分（1,024 × 2 秒）でタスクが死ぬ。以後は local-jev が復帰しても二度と聞かない。`l1_unavailable` のログも出ず、黙って止まる。`pump` は background を監視していない（W1）ので、誰も気づかない。
- 赤は L0 のままなので安全側に倒れるが、仕様の MUST（R7）と、docstring の「何が起きても死なない」に反する。tests は n=4（RUN-1h）までしか確かめていない。

修正案（失敗回数ではなく、次の間隔で持つ）:

```python
backoff = interval          # ループの外
...
# 失敗の節の末尾
backoff = min(MAX_BACKOFF_S, backoff * 2)
# 成功の節
backoff = interval
...
delay = backoff
```

または最小の修正として `interval * 2 ** min(failures, 16)`。テストは `FakeClient([unavailable()])` を 1,100 回回す（fake の sleep で）か、`failures` を直接大きくできる形に切り出して `_next_delay(interval, failures)` の単体テストにする。

---

### Warning（推奨）

**W1. [l1/runner.py:130-152, runner.py:64-68] hub 側の例外が「L1 の失敗」として扱われ、except 節の中の `hub.on_l1_failed()` は無防備。pump は background の死を見ない（重複: edge-latency-reviewer W2）**

- `hub.on_l1(verdict)` と `hub.l1_healthy = True`・`l1.recovered` のログが `try` の中にある。`hub.on_l1` が（バグで）例外を出すと、`l1_unavailable(reason=error)` として数えられ、`on_l1_failed()` で降格まで解かれる。プログラムのバグが「L1 が落ちた」に化ける。
- さらに `on_l1_failed()` が同じ箇所で例外を出すと except 節の外へ漏れてタスクが死ぬ。`AlertServer.broadcast` は `raise_exceptions=False` で守られているので、今は届きにくい。ただし今後 `Fusion` や `_flag` が壊れたときの被害が大きい。
- `pump` の finally は `for t in (task, *others): ... await t` で、`suppress` するのは `CancelledError` だけ。L1 のタスクが例外で終わっていると `await t` がそれを再送出し、(a) 元の例外を覆い、(b) 残りのタスクの待ちが飛ぶ。
- 直し方: (1) 「聞く」部分（`build_request`〜`judge`）だけを try に入れ、hub への通知は別に分ける。hub 通知の例外は `logger.exception("l1.hub_failed")` で残して続ける。(2) `pump` で background に `add_done_callback` を付け、例外で終わったら `logger.error("background.died", ...)` を残す。finally は `suppress(asyncio.CancelledError, Exception)` にして全部を待つ。

**W2. [hub.py:83,120 / fusion.py:109,172,204] 赤の同期経路の中にある fusion の呼び出しが無防備（重複: edge-latency-reviewer W1）**

- `L0Stage` は tracker の例外を守っているが、`Fusion.after_l0`・`refresh`・`l1_field` は `on_result → _sync → _output/_emit` の中にあり、ここで例外が出ると `sender` に届かず赤が出ない。現状のコードでは `red_tracks`・`_pos` が自分で守っているので起きにくい（読んだ範囲に具体的な発生経路は無い）。だが「L1 が壊れても L0 は赤を出す」は feature の核なので、一番外側で守るほうがよい。
- 直し方: `_output` の `self.fusion.refresh(now)` と `_flag` の `l1_field()` を `try/except Exception  # noqa: BLE001` で包み、失敗時は降格なし・`l1` 無しで L0 の state を返す。`logger.error("fusion.failed")` を 1 秒に 1 回まで。

**W3. [l1/runner.py:92-154] `run_l1` が長く、ネストが 5 段（while → try → if → if → if）で、レート制限のコードが重複**

- 「1 秒に 1 回まで」の判定が `last_fail_log` と `last_mismatch_log` で同じ形（`if x is None or now - x >= INTERVAL`）に 2 回出る。`FAIL_LOG_INTERVAL_S` と `MISMATCH_LOG_INTERVAL_S` は同じ値の別定数。`l0/stage.py:26` にも `FAIL_LOG_INTERVAL_S = 1.0` と同じ形がある（既存）。
- 直し方（小さい形）:

```python
class _Throttled:
    """同じ種類のログを interval 秒に 1 回まで通す。"""
    def __init__(self, interval_s: float) -> None:
        self._interval = interval_s
        self._last: float | None = None

    def ready(self, now: float) -> bool:
        if self._last is None or now - self._last >= self._interval:
            self._last = now
            return True
        return False
```

`run_l1` は `_ask_once(...) -> bool`（stale を返す）と `_record_failure(...)` に分け、本体は while の中で 2 段までにする。`run_l1` の引数 6 個はそのままでよい（時計と sleep の注入は良い設計）。

**W4. [fusion.py / l1/calibration.py / hub.py / client.py] 状態・理由・route が文字列のまま、型が緩い**

- `alert_level`（"none"/"zone"/"danger"）、`reason`（"false_positive"/"alert_level"）、`route`（"override" など 5 種）が `str` で、fusion・calibration・hub・runner の 4 箇所に文字列リテラルが散る。綴りの間違いを型が拾えない（例: `best in ("none", "zone")`、`reason == "false_positive"`）。
- 直し方: `Level = Literal["none", "zone", "danger"]`、`Reason = Literal["false_positive", "alert_level"]`、`Route = Literal[...]` を fusion.py に置き、`L1Verdict`・`conclude`・`apply` の型に使う。
- 型の緩い箇所: `hub.py:221` の戻り値 `dict | None`（`dict[str, object] | None` に）。`client.py:138` の `sdk: object, client: object` と `# type: ignore[attr-defined]` が 7 箇所。SDK の使う面だけの `Protocol`（`system_one`・`aclose`）と、例外クラスをまとめた小さな dataclass に包めば ignore が要らない。`start_l1` / `make_client` の `transport: object | None` も同様。

**W5. [hub.py:232-238] `_dumps` の退避先が不正な JSON を書く（テストがそれを固定している）**

```python
except ValueError:
    logger.error("flag.non_finite")
    flag.pop("l1", None)
    return json.dumps(flag)  # L0 の値が壊れていても、deer は届ける（従来どおり）
```

- NaN・Infinity を含む文字列は JSON ではなく、PWA の `JSON.parse` が例外を出す。「deer は届ける」のコメントに反して、赤のフラグごと捨てられる。仕様 R5「NaN・無限大を書かない」にも反する。
- `tests/test_l1_hub.py:156` が `assert "NaN" in AlertHub._dumps({...})` で、この挙動をそのまま固定している。
- 直し方: 退避では非有限の `conf`・`distanceM` を落とす（`deer: true` だけは残す。`AlertFlag` の deer: true で conf が任意かどうかは schema を確かめてから）。例: `{k: v for k, v in flag.items() if not (isinstance(v, float) and not math.isfinite(v))}` に通してから `allow_nan=False`。テストは「出力に NaN が無く、`deer` が true」を確かめる形にする。

**W6. [l1/calibration.py:92,112] `calibration.json` の読み込みが、`ValueError` 以外で起動を落とす**

- `math.isfinite(t)` は 400 桁の整数リテラル（JSON の `1000…0`）で `OverflowError` を出す。ネストの深い JSON は `RecursionError` を出す（`hub.on_client_message` は同じ理由で `RecursionError` を拾っている）。どちらも `except (ValueError, _Invalid)` を抜けて `load_calibration` → `start_l1` が例外で終わる。
- R4「無い・読めない・形が違う → 校正なし」に反し、壊れた校正ファイル 1 つで検知の起動が落ちる。ファイルは運用者が置くので現実の確率は低いが、直すのは 1 行。
- 直し方: `except (ValueError, ArithmeticError, RecursionError, _Invalid)`。テスト（CAL-1b の parametrize）に `'{"version":1,"model":"m","temperatures":{"alert_level":' + "9"*400 + '}}'` と深いネストを足す。
- 同じ型の穴が `client._probability`（`float(value)` の `OverflowError`。runner が `reason=error` として拾うので害は小さい）と、既存の `config._number`（`math.isfinite`。tomllib は大きな整数を通すので `ConfigError` でなく `OverflowError` になる）にもある。

**W7. [tests] 振る舞いを確かめきれていないテストがある**

- `test_hub1f_保留の設定でL1が健全なら150msまで赤を待ち答えで決める`（test_l1_hub.py:111）: 保留中の最初のフラグが `deer: false`（`_out_deer` が None からの最初の送信）なので、`on_l1` のあとの `assert sent[-1]["deer"] is False` は、`on_l1` が保留を解かなくても通る。期限後の tick でも降格が成立して False のままなので、「答えが保留を解く」と「期限で解ける」を区別できない。`on_l1` の直後に `hub._hold_until is None` を見るか、期限前に `sent` の件数が増えた（reason=`l1`）ことを確かめる。
- `test_hub1g`（:147）: `deer(float("nan"))` は上流で捨てられるので、`all("NaN" not in t ...)` は何も確かめていない（W5 のテスト自体も、退避の挙動を固定している）。
- `RUN-1b`（test_l1_runner.py:72）: ログの「1 秒に 1 回」は注入した時計が進まないので「出ない」ことしか見ていない。1 秒進めたら再び出ること（再び武装）が無い。C1 の大きい失敗回数、W1 の「hub 側の例外でも死なない」、pump で background が例外で終わった場合、も無い。
- `FU-1l`（test_fusion.py:243）: `r.fu.refresh(r.now + 2.0)` は `(now + 2.0) - now > 2.0` の浮動小数点の丸め（now は 100 付近、刻みは約 1.4e-14）に依存している。今は通るが、`r.now` の初期値を変えると割れうる。`ttl_s` を使い `r.now + r.fu.ttl_s` と、`+ 0.01` で境界を挟む形にする。
- 内部への依存: `hub._last_ok`（test_l1_hub.py:166）、`hub.l1_healthy` の直接代入。公開の経路（`on_result` に空の結果を流して時計を進める）で作れるならそのほうが壊れにくい。
- `test_run1f`（test_l1_runner.py:165）: `start_l1` が返したコルーチンを `ok.close()` で捨てるので、`client.aclose()` が走らず SDK の httpx クライアントが閉じない（ResourceWarning の元）。`asyncio.run` の中で作って cancel するか、`transport` に MockTransport を渡す。`builtins.__import__` の差し替えは広いので、`monkeypatch.setitem(sys.modules, "typesafe_sdk", None)`（import が ImportError になる）で足りる。
- AC-a〜c（test_l1_acceptance.py）は実時間（`off_after_s=1.5` の expire と 2.5 Hz のタスク）に依存する。CI が遅いと降格の窓（赤が続く約 1.5 秒）に答えが入らず AC-c が落ちうる。今は最初の問い合わせがエピソードより前に出て stale 判定で即時に聞き直す作りなので、窓には入りやすい。それでも `settle_ticks` と時計を注入する形にしておくと安定する（Info 扱いでもよい）。

**W8. [CREDITS.md] local-jev と typesafe-sdk の出所の記載が無い**

- 仕様の「依存」節: 「コミット（64a0b31ff343dca32142496cf9edca5a0174a18d）は `CREDITS.md` と config の見本に書く」。config.example.toml:41 には書いてあるが、CREDITS.md には `jev`・`typesafe` の記載が無い（grep で確認）。ライセンス（MIT）・出所・pin したバージョン（typesafe-sdk==0.7.5）を足す。ch6 のライセンス表（Day 6）でも拾う。

---

### Info（参考）

**良い点**

- 赤の経路: `on_result` に await が無く、`detector.hub` / `detector.fusion` が `detector.l1` を import しない（依存方向が正しい）。`L1` を起動する入口は `start_l1` に一本化されている。
- 時計と sleep を `run_l1` に注入でき、`FakeClient`・`JevServer`（`httpx2.MockTransport` 越しの実物の SDK）で、API の形と HTTP の失敗の写し方（http / connect / timeout / bad_response）を実際に確かめている。偽物だけでは通ってしまう層を実物で確かめている。
- タイムアウトを SDK と `asyncio.timeout` の二重に掛け、リトライを 0 にし、接続先をループバックに限り、`parts.hostname`（userinfo を除く）で判定するので `http://127.0.0.1@evil.com` を弾ける。ログに出す接続先は scheme・host・port だけ。
- 校正の数値: 1e-6 に切り詰めてから logit・softmax を取り、`_sigmoid` を分岐させ、choice は最大値を引いてから exp。T=0.05 でも溢れない。JSON の `NaN` / `Infinity` を `parse_constant` で拒む。
- `Fusion` の 6 条件が `_qualifies` に 1 箇所で読め、`refresh` が「解除は即時、再降格は 1 秒あける」を一手に持つ。テストが FU-1a〜1m と仕様 ID で対応づいている。
- `_wait` は片付け（cancel → await → `suppress`）を finally で確実に行い、wake の取りこぼし（先に set されていた場合）も処理している。

**気づき**

- [fusion.py:216] `has_verdict_for_episode` はどこからも呼ばれていない（grep で確認）。YAGNI で削除。`ttl_s` は tests からしか使われていない（残してよい）。
- [hub.py:110-124 ほか] `_output` が「送る状態を返す」問い合わせなのに、`fusion.refresh`（`_active`・`_released_at`）と `_hold_until` を書き換える。`_emit`・`snapshot`・`_sync` から繰り返し呼ばれても結果が同じ（冪等）なので今は動くが、読み手が気づきにくい。名前を `_resolve_output` にして docstring に副作用を書くか、`refresh` を `_sync` の入口だけにする。
- [hub.py:59] `self._wait`（保留するかの bool）は、l1/runner.py の `_wait`（待つ関数）と紛らわしい。`self._hold_red` などに。
- [hub.py:87,99] `on_result` の出力が fusion の変化（2 頭目が閾値を超えて赤に戻るなど）だけで変わったとき、flag.sent の `reason` が `l1` でなく `change` になる。仕様 R5 は `reason=l1` を求めているのは「答えで降格したとき」だけなので違反ではないが、edge-latency-reviewer が理由で数えるなら、`_sync` が理由を決める形（出力の変化の原因が fusion か L0 か）にしておくとよい。
- [l1/request.py:13, l1/calibration.py:15] `L1Unavailable`・`L1Answer` を client から import している。client が SDK の詳細を持つモジュールなので、request・calibration が client に依存するのは向きが不自然。`l1/types.py`（`L1Unavailable`・`L1Answer`）に出すと、request → types ← client の形になる。`make_verdict`（l1/runner.py:48）も純粋関数なので fusion か `l1/verdict.py` に置ける。
- [l1/runner.py:168] `hub.fusion is None` のときも `l1.disabled` と出る（`enabled = true` なのに `AlertHub` に `l1` を渡し忘れた場合に、誤解を招く）。別のメッセージ（`l1.no_fusion`）に。
- [l1/runner.py:184-188] `start_l1` が返したコルーチンが `pump` に渡らなかった場合（例: 起動の途中で例外）、`client.aclose()` が走らない。入口の feature（CLI）で `pump` と同じ `try/finally` に入れること。
- [l1/calibration.py:84,95] 空白だけでないか見る `model.strip()` の後で、strip していない `model` を保存している。`" llm-qwen "` は `matches` で一致しない。保存も strip するか、前後の空白を形違いにする。`Calibration.temperatures` は frozen dataclass の中の可変 dict（`MappingProxyType` でもよい）。
- [pyproject.toml:28] `dev` の `typesafe-sdk==0.7.5` は `l1` の extra と二重。`antler-detector[l1]` を `dev` に含めると 1 箇所で済む。tests が直接 import する `httpx2` は SDK の推移的な依存で、pin されていない（SDK を更新したとき壊れる。仕様の「依存」節でも `httpx2` は SDK 経由と書いてある）。
- ruff（目視）: `# noqa: BLE001` は `except Exception` の全箇所に付き、`__all__` は並びが RUF022 に沿い、ANN・PTH・S に当たる箇所は見つからなかった。E501 は全角を 2 桁で数えるので、日本語の長い docstring（例: l0/stage.py:88 は幅がちょうど 100）が境界にある。`ruff check` と `ruff format --check` は実行して確かめてほしい。edge-latency-reviewer の報告のとおり、この環境では `typesafe-sdk` が入っておらず test_l1_runner.py・test_l1_acceptance.py が collection error になるので、`pip install -e "edge/detector[dev]"` の後に pytest を通すこと。

## メインセッションの対応（2026-11-03）

- **Critical（バックオフの OverflowError）→ 直した**: `l1/runner.py` の `backoff_s` で指数を 8 で頭打ちにした（`test_run1h_失敗が何千回続いても間隔は2秒で頭打ち`）
- Warning（後始末の例外でタスクが死ぬ）→ 直した: `_failed` が `hub.on_l1_failed()` の例外も捕まえて `l1.release_failed` を残す。`pump` は background の死を `background.died` で残し、片付けで例外を上へ出さない
- Warning（fusion が赤の同期経路で無防備）→ 直した: `AlertHub._after_l0`・`_demoted`・`_serialize` が fusion の例外を捕まえ、降格しない側（L0 の赤）に倒す（`test_hub1j`）
- Warning（`_dumps` の退避が NaN を書く）→ 直した: `AlertHub.dumps_finite`。HUB-1g を書き直した
- Warning（calibration.json の OverflowError / RecursionError）→ 直した。モデル名の前後の空白も形違いにした
- Warning（run_l1 のネスト・ログの間引きの重複）→ 直した: `_ask_once`・`_failed`・`_Throttle` に分けた
- Warning（CREDITS）→ 直した: typesafe-sdk・httpx2・local-jev・Qwen2.5-1.5B を足した
- 次に回す: 文字列の型（Literal 化）、`type: ignore`（SDK を遅れて読むため）、dev の extra の二重、httpx2 の pin
- テスト環境: venv に `pip install -e "edge/detector[dev]"`（typesafe-sdk を含む）で全件 Green、ruff check・format も通過
