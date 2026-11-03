# レビュー: edge-judge（edge/detector）

- 日付: 2026-11-03 / ブランチ: feat/edge-judge（43bd761）
- 対象: `edge/detector/src/detector/{judge,flag,hub,server,runner,config}.py` と `tests/test_{judge,flag,hub,server,runner,config}.py`
- 仕様: `docs/specs/edge-judge/{functional,threat,resilience}.md`。受信側: `docs/specs/pwa-connect/functional.md`、`apps/pwa/src/features/connect/lib/edge-client.ts`、`apps/pwa/scripts/fake-edge.mjs`、`packages/schema/json/*.schema.json`
- 方法: コードの読み取りのみ（テストは実行していない）。ファイルは編集していない。

## レビュー結果

### 良い点

- 判定（`Judge`）は仕様の細部（1.0 秒の連続切れ、1.5 秒ちょうど、`failed` は連続を切らない、方向の 2 フレーム規則、`t_frame` の戻り）を、`t_frame` と単調時計に分けて持つ形で実装している。ON は `update`（フレーム時刻）と `expire`（単調時計）の二重で解く。
- `Judge` / `AlertHub` は同期で、`await` を挟まない。イベントループ上だけで触る前提が `pump` と一致している（`test_conc1_Judgeに触るのはループのスレッドだけ`）。
- AlertFlag は JSON Schema（`packages/schema/json/alert-flag.schema.json`）の ON・OFF の枝と一致し、zod の `strict` に通る形。edge の OFF フラグは PWA の `readAlertFlag` で strict になるので、PWA が「部分的な deer:false」として赤を解けなくなる食い違いは無い。
- ログは型名・件数だけで、クライアントの本文を出さない（`client.ignored`、`ack.invalid`）。アドレスも出さない。
- ハートビート停止（`judge.stalled`）は、PWA の 3 秒無受信による「未接続」帯と組み合わせる設計として筋が良い。ただし Critical 1 の穴がある。

### Critical（修正必須）

#### C1. [hub.py:82-98] `snapshot()` が stall と expire を見ない。「見えていないのに緑」と固定 ON を再接続の経路で作る

`tick()` は、成功フレームが `stall_after_s` 来ていなければハートビートを止める（hub.py:75-79）。ところが新しい接続への `snapshot()` は、その判定を通らず、直近の `JudgeState` を `t_sent=今` で無条件に送る。

1. 停止中（カメラ停止・推論が失敗し続ける）に、PWA は 3 秒無受信で自分で閉じて 1 秒後に再接続する。これは spec 通りの動き（pwa-connect R3）。
2. 再接続した瞬間に `snapshot()` が `deer:false, zone:"outside", t_sent=今` を送る。PWA は `open` になり、読めたフラグを受信したので `armStale` が掛かる。`deriveAlertState` は `zone:"outside"` を信じて緑にする。
3. 「未接続」帯は消え、緑が出る。これを約 4 秒周期（3 秒 + 再接続 1 秒）で繰り返す。edge-judge の R4「見えていないのに緑を作らない」が、再接続の経路で破れる。

固定 ON の経路もある。`pump` が入力の例外で終わると、`finally` で ticker が止まる（runner.py:53-56）。`expire` も走らなくなる。Judge の状態は `deer:true` のまま残る。サーバーは `pump` が止めないので生きたまま。再接続した PWA に `snapshot()` が `deer:true` を `t_sent=今` で送り続ける。PWA の 5 秒保持が毎回延びて、赤が固定される。`test_uc7b` は ticker が片付くことしか見ておらず、この経路を検証していない。

修正案:

```python
def snapshot(self) -> str | None:
    now = self._clock()
    if self._judge.expire(now):          # ticker が止まっていても古い ON を配らない
        self._emit("change")
    state = self._judge.state
    if state is None or self._is_stalled(now):
        return None                      # 見えていないあいだは黙る（tick と同じ条件）
    wall = self._wall()
    text = json.dumps(build_flag(state, wall))
    logger.info("flag.sent", extra={..., "t_sent": format_t_frame(wall), ...})
    return text

def _is_stalled(self, now: float) -> bool:
    return self._last_ok is None or now - self._last_ok >= self._cfg.stall_after_s
```

`tick()` の判定も同じ `_is_stalled` に寄せる（DRY）。`pump` の `finally` で `hub.close()`（状態を「停止」にして snapshot も返さない）を呼ぶ。テストは「stall 中に新しい接続へ何も送らない」「pump 異常終了後の接続に ON を送らない」を足す。

#### C2. [judge.py:69] 壊れた推論結果（全検出が不正）が「健全な鹿なし」になる。固定 OFF（見逃し）で、ハートビートも送り続ける

`pipeline.py:90-100` は、不正な検出を全部捨てたフレームを `invalid_count>0` かつ `detections==[]` の `FrameResult` として渡す（`failed=False`）。コメントは「本物の『鹿なし』と区別し、続くなら degraded に数える」。ところが `Judge.update` が見るのは `result.failed` だけ（judge.py:69）。`AlertHub.on_result` も `failed` だけで `_last_ok` を更新する（hub.py:61-63）。

モデルが NaN や高さ 0 のボックスだけを出し続ける（出力の壊れ）と、Judge は毎フレーム「鹿なし」と判断する。ON は 1.5 秒で解ける。stall 判定にも掛からないので、`deer:false` のハートビートを 1 秒ごとに送る。PWA は緑を出し続ける。鹿は見逃される。障害耐性方針（見逃しを避ける、見えていないのに緑にしない）に反する。

修正案:

```python
# pipeline.FrameResult に置く
@property
def unreliable(self) -> bool:
    return self.failed or (self.invalid_count > 0 and not self.detections)
```

`Judge.update` の `result.failed` と `AlertHub.on_result` の `not result.failed` を `unreliable` に置き換える。テスト（`test_judge`、`test_hub`）に `invalid_count` つきのフレームを足す。

### Warning（推奨）

#### W1. [runner.py:34-37] ticker に例外ガードが無く、死んでも誰も気づかない

`hub.tick()` が例外を出すと（`sender` 経由の `broadcast` など）、ticker タスクは黙って終わる。`pump` の本ループは続く。ハートビートと `expire` が止まる。PWA は 3 秒で「未接続」になるので fail-visible ではあるが、サーバー側は気づかない。`tick()` を try/except で囲んで `logger.exception` を残して続けるか、`pump` が `task.add_done_callback` で例外を拾って `pump.aborted` にする。

#### W2. [runner.py:39-56] `pump` の後始末が仕様より弱い

- 仕様 R7「停止時にタスクもサーバーも片付ける」と FAIL-3「サーバーとハートビートが片付く」。`pump` はサーバーを持たない。`test_uc7b` はサーバーを作らず、ticker の片付けだけを確かめている。サーバーを止める責務をどこが持つか、仕様か実装のどちらかを直す。
- `results`（`process_frames` の生成器）を `close()` しないので、`pipeline.summary` とカメラの解放が GC 任せ。
- キャンセルされたとき `asyncio.to_thread(next, ...)` のスレッドは動き続ける。`asyncio.run` の終了がカメラの次の読み取りまで待たされうる。

`finally` で `await asyncio.to_thread(results.close)`（生成器が実行中でなければ）か、`pump` の呼び出し側で `contextlib.closing` を使う。起動の統合（`main`）がまだ無いので、`AlertServer.stop()` を呼ぶ責務を `pump` の docstring に明記する。

#### W3. [server.py:106-112] 接続枠の数え方に穴があり、枠の占有に弱い

- `_process_request` の `len(self._clients) >= max_clients` は、ハンドシェイク中の接続を数えない。`_clients` に入るのは `_handle` の先頭。同時に多数がつなぐと、全員が検査を通って上限（16）を超える。`max_clients` が「上限」として効かない。
- 接続あたりの制限（5 通/秒）はあるが、送信元ごとの接続数の上限が無い。1 台（またはスマホのブラウザで開いたページ）が 16 本つないで ping に答え続けると、枠が埋まって PWA は 503 で入れない（ping は「死んだ接続」しか外さない）。Origin も見ない。LAN 内を信頼する前提（threat.md）の内側でも、PWA の可用性（B 可用性）を一つの端末が落とせる。
- 満杯のあいだの `client.rejected` は 1 回ごとに warning を出す。つなぎ直しの連打でログが埋まる。

修正案: 数えるのを `process_request` で「受け付けた数」（`_clients` + 保留）にする。満杯のときは新しい接続を断らず、最も古い接続を切って入れる方針も検討（再接続してくる PWA のほうが新しい）。`client.rejected` と `client.connected` は 1 秒に 1 回までに間引く。この脅威は threat.md の「N/A: AP に入れない」の外なので、Deferred として threat.md に書くだけでも良い。

#### W4. [config.py:122-136] 設定の検査が「開いた側に倒さない」を守りきれていない

- `server.host = ""`（空文字）が通る。`websockets.serve` は空の host を全インターフェースの待ち受けにする。R5「開いた側に倒さない」に反する。`ipaddress` か `socket.getaddrinfo` で検査するか、少なくとも空を `ConfigError` にする。
- `stall_after_s` の上限が 30 秒。PWA は 3 秒無受信で「未接続」、`deer:true` を 5 秒保持する。edge の stall が 30 秒だと、最大 30 秒は緑のハートビートを流しうる。上限は 3〜5 秒程度にする（spec の範囲 1〜30 を見直す）。
- `off_after_s` > `stall_after_s` などの相互の関係を検査していない。
- `JudgeConfig(...)` を直接作ると検査を通らない（tests はこれを使っている）。`__post_init__` に不変条件を置くと、`load_config` を通らない経路も守れる。

#### W5. [hub.py:100-137] 悪意のある（または壊れた）ack で接続が落ちる。仕様は「無視」

- `json.loads` が拾うのは `ValueError` だけ。64 KB の `[[[[...` は `RecursionError`（`RuntimeError` の子）になり、`on_client_message` の外へ出る。`_handle` の `except Exception` が受けて `client.error` を残して接続を閉じる。サーバーは落ちないが、R5「壊れた JSON → 無視」と違う。
- `datetime.fromisoformat("9999-12-31T23:59:59+00:00")` は通り、`format_t_frame` の `astimezone(JST)` が `OverflowError` を出す。同じく接続が閉じる。

`except (ValueError, RecursionError)` と、`_on_ack` 内で `OverflowError` を `ack.invalid` に回す。`test_uc6b` に両方のケースを足す。

#### W6. [judge.py:85] `t_frame` が後ろへ戻ったあと、`state.t_frame` が古い最大値に固定される

`_last_hit_t = max(_last_hit_t, t)` なので、壁時計が後ろへ大きく戻ると（NTP の補正など）、以後の ON フラグの `t_frame` は戻る前の最大値のまま。`update` 側の OFF 判定（`t - _last_hit_t` は負 → 0）も効かない。ON は単調時計の `expire` だけで解ける。ON が終わるまで遅延の計測（`t_sent - t_frame`、`since_frame_ms`）が壊れる。`t < _last_hit_t - 数秒` を「時計が跳んだ」として `_last_hit_t = t` にリセットし、`judge.clock_jump` を warning で残す案。

また `expire()` が作る OFF は `t_frame` が最後に鹿を見たフレームのまま（hub.py の OFF フラグ）。PWA の B-0 は `t_sent − t_frame` を「エッジ内の遅延」として出す（edge-client.ts の `delayOf`）。OFF フラグ、とくに expire の OFF は 1.5 秒前後の「遅延」を出す。計測の意味が崩れる（Info も参照）。

#### W7. [server.py:42-45] 死んだ接続が外れるまでの上限が 5.0 秒ちょうどで余裕が無い

1.5（ping 間隔）+ 2.5（応答待ち）+ 1.0（閉じる待ち）= 5.0 秒は最悪値の合計で、スケジューリングの遅れを含まない。`test_uc5h` は `server._ping` などの私有属性を読むだけで、既定値で本当に 5 秒以内に外れるかは見ていない。`test_uc5g` は短縮した値だけ。ping 間隔 1.0・応答 2.0 にして余裕を持つか、実時間で測るテストを 1 本足す。

#### W8. [server.py:114-121] snapshot を送る `await` の前にクライアントを `_clients` へ入れている

`_clients.add` のあと `await connection.send(snapshot)`。送信が詰まって中断した場合、その間に `broadcast()` が新しいフラグを先に書き、古い snapshot があとから届く順序逆転の可能性がある（ON→OFF の OFF のあとに古い ON が届くと、PWA は最大 1 秒ハートビートまで赤）。通常は `send` が中断せず問題は出ないが、`CONC-1` の「順序が逆転しない」は保証されない。`snapshot` は同期で作ってから、`_clients.add` と最初の書き込みをまとめて行う（`connection.send` の前に add しない）。

#### W9. [tests] 形だけ（実質的に何も確かめない）テスト

- `test_server.py` `test_uc5b`: `assert (await recv_json(a))["deer"] is False or True` は常に真。
- `test_uc5e`: `assert got[0] == got[1] or got[0]["deer"] in (True, False)` も常に真。`assert lazy is not None` も無意味。「読まないクライアントがいても他への配信が遅れない」（UC-5e の主張）は、書き込みバッファが溜まる量を送っていないので検証していない。CONC-2 の `churn` は配信が走っていない（`hub.tick()` は状態が無いと何も送らない）ので、集合の反復と変更の競合は起きない。
- `test_fail1` は偽の `transport` で `broadcast` の分岐だけを見る。実際の詰まった接続は検証していない。
- `test_conc1`（test_server.py）は同期の交互呼び出しで、並行ではない。`states[on_at:].index(False) > 0` は常に真に近い。
- `test_uc5d` の `server._cfg.port == 0`、`hub._cfg.threshold == 0.4` は、凍結 dataclass の自明な確認（AUTH-6 の本体ではない）。
- `test_uc2a`: 期待値を `round((33 + 16) / 2)` と実装と同じ `round` で計算している（銀行丸めで 24.5 → 24）。
- `test_ac2`（test_runner.py）: 名前と仕様が言う「ハートビートの `t_frame` は古いまま」を一切 assert していない。実時間 0.5 秒の sleep に依存し、WebSocket も使わない。
- AC-1 は `off_after_s=0.5` の `fast_hub`（仕様の 1.5 秒ではない）。`since_frame_ms` の値は見ていない。ack の非同期な処理が `await task` の後に間に合うことに依存している。
- 足りないテスト: C1（stall 中の snapshot）、C2（`invalid_count`）、W5（深いネスト・年 9999）、ticker の例外、`_ack_t_frame` が 2 回目の ON で更新されること、クライアント 0 のときのフラグ数（`clients: 0`）。

#### W10. [hub.py:82-98] snapshot のログが実際に送った値とずれる

`self._wall()` を 2 回呼ぶので、ログの `t_sent` が実際のフラグの `t_sent` と違う。edge-latency-reviewer が `flag.sent` の `t_sent` を使うので、1 回にまとめる（上の修正案のとおり）。`clients: 1` は固定値で、実際に書けたかは分からない。`server.broadcast` の戻り値（`len(live)`）も、閉じつつある接続を含む。

### Info（参考）

- **PWA との食い違い（確認結果）**: メッセージの形（`type`・`v`・`t_frame`・`t_sent`・`zone`・OFF に `conf` 系なし・ON に `frameJpegB64:null`）、`ack` の形、`/alerts` の 404/503、64 KB は fake-edge と一致。edge の OFF は PWA で strict になるので、赤を解ける。
- **既知の Deferred の影響**: edge が `zone:"outside"` を常に送るため、GPS を渡すまでは PWA が鹿ゾーン内でも緑になる。これに加えて C1 と C2 は、緑が「見えていない」状態で出るので、Deferred の範囲外の別問題。
- **再接続したときの ack**: snapshot が `deer:true` を送ると PWA は danger を「表示し始めた」と見て ack を返す。edge の `_ack_t_frame` は元の ON の `t_frame` のままなので、`since_frame_ms` が実際より大きく出る。計測の注釈（edge-latency-reviewer への申し送り）に書く。
- **B-0 の遅延表示**: ハートビートの OFF の `t_frame` は最後に処理したフレームで、1 秒近く古いことがある。PWA の「エッジ内の遅延」は変化時のフラグ以外では実遅延にならない。`flag.sent` のログ側の計測を正とする。
- **ack の検証**: edge は `fromisoformat` で読むので、`ClientMessageSchema`（JSON Schema の `pattern`）が拒否する形も受ける。受け口が寛容な分には安全側だが、仕様の「`@antler/schema` の ClientMessage」とは厳密には違う。
- **丸め**: `round()` は偶数丸め（12.5 → 12）。距離表の較正（調査走行）のときに知っておく。
- **`threshold=0.0`** は仕様の範囲内だが、すべての検出が鹿になる。車載の設定ファイルのレビュー項目。
- **ハンドシェイク**: `open_timeout=3` はあるが、保留中の接続数に上限が無い（W3 と同じ根）。
- **`start()` の二重呼び出し**でサーバーが二重にできる。`stop()` は冪等だが `start()` は冪等でない。
- **`hub.sender` への代入**で結合しているため、1 つの hub に 1 つのサーバーしかつなげない。YAGNI としては妥当。コンストラクタ注入のほうがテストしやすい。
- **起動の統合（`main`）が無い**: `load_config` → `AlertHub` → `AlertServer` → `pump` をつなぐ入口が見当たらない（起動の自動化は範囲外）。C1・W2 の「誰がサーバーを止めるか」は、この入口を作るときに決める。
- **`host` の既定は `127.0.0.1`**。車載で設定を忘れると PWA から見えず、サーバー側は黙って待つ。`server.listening` のログに host が出るので気づけるが、loopback のときは warning を出すと親切。

## 優先順位（提案）

1. C1・C2 を直し、それぞれ失敗するテストを先に書く（Canon TDD）。
2. W5・W9 の弱いテストを作り直す。
3. W1〜W4・W6〜W8 は edge-latency-reviewer の前に直せるものから。W3 の方針（古い接続を切るか）はユーザー判断が要るなら Deferred に書く。
