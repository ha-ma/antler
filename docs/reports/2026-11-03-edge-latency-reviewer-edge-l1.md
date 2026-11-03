## edge-latency-reviewer 結果（edge-l1、コミット 9047b47）

遅延 p95: frame→sent 未計測 / sent→shown 未計測 / 合計 未計測（n=0、ログ: なし。edge/detector/logs/ が存在しない）
L1 p50/p95: 未計測 ・ 上書き 未計測（正・誤とも不明）・ L0 fps 単独 未計測 / L1 併走 未計測
Critical: 0 / Warning: 5（コード読みによる。数字の裏づけは無い）

確認できたこと（コード読み）

- 赤の経路: `AlertHub.on_result`（hub.py）は同期。`L0Stage.update` → `Fusion.after_l0` → `_sync` → `_emit` → `sender`（`broadcast` は待たない）まで await が無い。hub.py・fusion.py は `detector.l1` を import しない。新しい赤のエピソードでは `_verdict=None` なので降格は起きず、赤は L1 を待たずに出る（B2-3 OK）。
- 校正なし・モデル違いで降格しない: `make_verdict` が `calibrated=False` のとき `reason=None`、`Fusion._qualifies` も `calibrated` を要求、`l1_field` は校正済みのときだけ。別名モデル・空モデルは `Calibration.matches` で弾く。`override_conf` は config で 0.9〜1 に固定（B2-5 OK）。
- 降格の解除は遅れない: `failed()` は `_verdict=None`、`on_l1_failed` は即 `_sync`。トラック数・位置・エピソードが外れると次の `on_result` で `refresh` が解除する。TTL（3/rate_hz + timeout = 約 2.0 秒）は tick（0.1 秒）が見る。再降格は赤に戻してから 1 秒空ける。
- L1 停止・タイムアウト・例外: `run_l1` は `CancelledError` 以外を捕まえ、`l1_unavailable` を 1 秒 1 回に絞り、`min(2 秒, 間隔×2^n)` で退避する。問い合わせは 1 本のタスクで await してから次なので同時 1 つ。SDK のリトライは 0、`asyncio.timeout` は SDK 側と runner 側の二重。
- URL: `TYPESAFE_BASE_URL` → `l1.base_url` で、ハードコードなし。ループバック以外は `remote_not_allowed`。4 問は `JUDGE_QUESTIONS` を 1 リクエストで送る。
- 保留（B2-8）: 既定 false。true でも `l1_healthy` のときだけ、最大 150 ms（`HOLD_MAX_S`）。答えが来れば即解除、期限は tick が見る。
- ログ: `l1.result` に latency_ms・alert_level・conf・conf_raw・calibrated・route・overrode がある。`flag.sent` の `l1` は schema（alert_level / conf / overrode / latencyMs）と一致する。

### Critical

なし。

### Warning

1. hub.py `on_result` / `_output` — fusion の例外が赤の経路を止めうる。L0 側は `L0Stage` が try/except で守っているが、`Fusion.after_l0`・`refresh`・`_qualifies` は無防備で、`on_result` の同期経路の中にある。ここで例外が出ると `_emit` に届かず赤が出ない。直し方: `_output` で `fusion.refresh` を try/except で包み、失敗時は L0 の state をそのまま返す（降格しない側に倒す）。`after_l0` も同様。
2. l1/runner.py の `except Exception` 節 — `hub.on_l1_failed()` が例外を出すとタスクが死ぬ。`hub.on_l1(verdict)` は try の中にあるので、そこで `_emit` / `_sync` が例外を出す → except で `on_l1_failed()` → 同じ箇所でまた出る、の順で except 節の外へ漏れうる。`pump` は `others` を監視していない（done callback も無い）ので、L1 は黙って止まる。降格は TTL で解けて赤に戻るので安全側だが、`l1_healthy` が True のまま残り、`wait_for_l1_before_red=true` なら以後の赤が毎回 150 ms 遅れる。直し方: except 節内の hub 呼び出しを try で包む。`pump` で background のタスクが終わったら `logger.error` を残し、`l1_healthy=False` にする。
3. hub.py `tick` と保留 — 保留の解除は tick（0.1 秒）頼み。赤は最大 150 ms + 最大 100 ms = 250 ms 遅れうる（resilience.md に書いてあり、1,000 ms には収まる）。既定は false なので影響は無い。true にするなら、`call_later` で期限に直接送るか、実機の frame→sent の p95 に 250 ms を足して判断すること。
4. hub.py `on_l1` の `overrode` ログ — 止まっている（stalled）あいだは `_sync` を呼ばないので、`fusion.active` が古いまま `l1.result.overrode` に出る。§6 の「上書き件数」を `l1.result` から数えると、stalled の間だけずれる。集計は `flag.sent` の `l1.overrode` の遷移を正にするか、`overrode` を `_sync` の後の値と明記すること。
5. fusion.py `after_l0` — 降格したままエピソードが閉じると `_released_at` を更新しない。反転の 1 秒ガードが次のエピソードに引き継がれない。新しい赤は必ず出てから降格するので 1 Hz は超えない（赤 → false の遷移はエピソードごとに 1 回）。ただしエピソードが短く連続すると、赤の点灯が L1 の応答時間ぶんだけ繰り返し見える。優先度は低い。
6. （環境）tests/test_l1_runner.py と tests/test_l1_acceptance.py が、この環境では collection error。`typesafe-sdk`（`[dev]` の extra）が未インストールの可能性が高い。テストの実行結果は確認できていない。`pip install -e "edge/detector[dev]"` の後で再確認すること。

### 測れなかったこと

- frame→sent・sent→shown の p50/p95、`t_shown` の ack: 走行ログが無い（Mac mini 実機は Deferred）。
- L1 の p50/p95、上書き件数と正誤: ログが無い。さらに、PWA からの `label` は hub が捨てており（B2-6 は MAY）、走行後ラベルとの突き合わせ方法が現状ない。正誤を出すには `l1.result` の `episode` と走行後ラベルを結ぶ手段が要る（edge-l1-calibration か dataset の側）。
- L0 の fps 低下（単独と L1 併走）: fps を記録するログ項目が edge/detector に無い。§6 の 20% 判定のために、フレーム処理の間隔（`t_frame` の差）か fps をログに足す必要がある。
- CoreML の `computeUnits`（ANE か GPU か）と間引き 5〜10 fps の実測: このレビューの対象外のため確認していない（`config.example.toml` の `pipeline.target_fps` は throttle.py が 5〜10 に制限している）。
- PWA 側（再接続 5 秒、未接続帯、Wake Lock、num-hero）: この差分は PWA を変えないので見ていない。

## メインセッションの対応（2026-11-03）

- W1（fusion の例外で赤が出ない）→ 直した: hub が fusion の例外を捕まえて L0 の赤を出す（`test_hub1j`）
- W2（後始末の例外で L1 のタスクが死ぬ・l1_healthy が残る）→ 直した: `l1_healthy = False` を先に置き、`on_l1_failed` の例外も捕まえる。`pump` は background の死を `background.died` で残す
- W5（降格のままエピソードが閉じると 1 秒のガードが効かない）→ 直した
- W3（保留の解除が tick 頼みで最大 250 ms）・W4（stalled 中の `l1.result.overrode`）→ 仕様どおり（既定は保留しない）。次に回す
- 環境: typesafe-sdk は `[dev]` に入っている。venv で全件 Green
- fps のログ（§6 の 20% 判定）・走行後ラベルとの突き合わせ → Deferred（Step 4・6 と実機）
