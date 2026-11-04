# code-reviewer: pwa-uplink（2026-11-04）

対象: `docs/specs/pwa-uplink/functional.md`（spec_confirmed_at c3bf8f1）と、その target_paths のコード。
範囲: packages/schema（client-message.ts・fixtures・vehicle-message.test.ts）、edge/detector（vehicle.py・hub.py・l1/request.py・l1/runner.py・l1/calibration.py・schema/client_message.py・tests/test_vehicle_*.py）、apps/pwa/src/features/connect（vehicle-report・edge-client・use-gps-zone・use-vehicle-uplink・DriveScreen と各テスト）。

制約: このセッションには Bash が無く、`git diff origin/main...HEAD`・ruff・vitest・pytest は実行していない。差分は spec の target_paths とコミット（c3bf8f1 / 8fba863 / d7e1fb1）から特定し、ファイルを全文読んだ。ruff 100 桁・型は目視のみ（hub.py:39 のコメント行は全角を 2 桁で数えるとちょうど 100 桁で境界。`ruff check` で確認してほしい）。

## 総評

仕様の Rule（R1〜R8）はコードにほぼ漏れなく対応している。Critical は無い。
良い点が多い。

- 位置を送らない保証が「型」と「strict スキーマ」の両方で効いている（`VehicleReport = Omit<VehicleMessage,'type'>`、`z.strictObject`、pydantic `extra='forbid'`）。ログにも本文が出ない。
- TS と Python が同じ見本（fixtures/client-message/vehicle-*）で同じ結果になるテスト（VM-1f）と、生成物が最新かを見るテスト（VM-1e）がある。
- `detector.l1` を hub / fusion / vehicle が import しない境界が、`subprocess` で `sys.modules` を見る振る舞いのテスト（RQ-5j）で守られている。`VehicleReport` → `context_from_report`（l1 側）の依存方向も正しい。
- spec-adversary の Critical（固定値で学習した校正に実値を渡すと降格に寄る）が、`calibration.context` と AUTH-5 / AC-d で回帰テストになっている。
- 時計の注入（hub の `clock`、`performance.now`）と、時計が戻る場合（FAIL-2、EC-3c）のテストがある。

## Critical（修正必須）

なし。

## Warning（推奨。後回し可）

### W-1 `use-vehicle-uplink.ts:9-20` effect の依存が実態と合わず、二重送信の防止が別ファイルの副作用頼み

- `report` は `useGpsZone` が描画のたびに作る新しいオブジェクト（`use-gps-zone.ts:104`）。したがって effect は**毎回の描画**で動く（1 Hz の `now`、edge からのフラグ受信、測位の到着、`setPrevious` の再描画）。`now` を依存に入れる必要は実際には無く、コメント（行 18）の「report は毎回新しい値なので、now と report の両方で動かす」は、前半が正しければ後半が不要という矛盾した説明になっている。
- 二重送信を防いでいるのは hook ではなく `EdgeClient.sendVehicle` の 0.9 秒の間引き（`edge-client.ts:127-132`）。hook 単体の契約は「描画のたびに送ろうとする」で、hook だけを差し替える・別の送り手を渡すと壊れる。
- 副作用として、送信が `now` の 1 秒の刻みではなく描画のタイミングで決まる。例: 前回の送信から 910 ms 後にフラグ受信で再描画 → その場で送信、次の 1 秒の刻みは 0.9 秒未満なので間引かれ、次の送信は約 2 秒後の刻みになる。1 Hz の上限は守られるが、edge の新しさ（ゾーン・光 10 秒、速度 3 秒）に対しては間隔が揺れる。
- 案: `useGpsZone` 側で `useMemo(() => toVehicleReport(...), [track.fix, judgement?.status, now, enabled])` にして報告の同一性を安定させ、hook は `useEffect(() => { if (report) sendVehicle(report) }, [report, sendVehicle])` にして `now` 引数を外す。`sendVehicle` の 0.9 秒の間引きは最後の安全網として残す。
- `apps/pwa/CLAUDE.md` の「useEffect を書く前に代替を確認」: 外部（WebSocket）への送信なので effect 自体は妥当で、eslint-disable のコメント（行 14-15）も理由が書かれている。

### W-2 `DriveUplink.test.tsx:156-167` / UP-3a の Test List とテストのずれ

- Test List の UP-3a は「アンマウントで止まる」「StrictMode の二重の effect でも 1 秒に 1 通」。テストは `<StrictMode>` で包まず、`unmount` もしていない。hook のコメント（`use-vehicle-uplink.ts:7`）は StrictMode を主張しているが、テストでは確かめていない。同じ feature の `ConnectFlow.test.tsx:402,469` には StrictMode のレンダー例があるので、そのまま使える。
- 同テストの `toBeLessThanOrEqual(3)` は「2 秒で最大 3 通」の緩い上限。送信のタイミングが W-1 のとおり描画依存なので、上限でしか書けなくなっている。W-1 の修正後は `toHaveLength` で正確に書ける。
- `DriveUplink.test.tsx:122-143`（AC-c）も 5 通のところを `5〜6` で受けている。同じ理由。
- 「B-0 では送らない」（行 127）は、B-0 では `useGpsZone` が存在せず `watchPosition` が呼ばれない（`r.fix(10)` は何もしない `emit` に当たる）ことで成り立っている。`DriveScreen` が B-0 で送らないことを確かめたというより、構造上そうなる、という弱い確認。動作は正しい。
- 良い点: 座標が文字列として出ないことの確認（行 141-142）、B-0 で送らない確認、ack を邪魔しない確認は振る舞いを見ている。

### W-3 `hub.py:76-80,312-381` hub に車の状態の保持・ログの間引き・古さの判定が入り、責務が膨らんだ

- `AlertHub` に状態 4 つ（`_vehicle`・`_vehicle_key`・`_vehicle_stale_logged`・`_vehicle_logs`）とメソッド 4 つ（`_on_vehicle`・`_vehicle_log_ready`・`_vehicle_log`・`vehicle_report`）が増えた（約 100 行）。hub は配信の規則・保留・降格・ack を持っていて、「PWA から届いた最新の 1 件を持つ」は赤の配信と無関係。
- `vehicle_report()` は名前が getter なのに、`_vehicle_stale_logged` を書き換えてログを出す（行 375-377）。読み取りが状態を変える。
- ログの間引きが hub 内に 3 種類（`_fusion_fail_log`、`_vehicle_logs` の辞書、さらに `l1/runner.py:189` の `_Throttle`、`l0/stage.py:89`）ある。`l1/runner.py` の `_Throttle` は hub が `detector.l1` を import できない（LAC-1）ので使えず、結果として重複した。
- `_vehicle_log(name, now, emit, event, extra)`（行 352-361）は `name` と `event` が同じ情報（`vehicle.` の接頭辞の有無）で、`emit: Callable[..., None]` に logger のメソッドを渡す形は過剰。
- 案: `detector/vehicle.py` に `VehicleInbox`（`receive(raw, now)`・`current(max_age_s, now)`、ログの間引きを持つ）を置き、hub は `self._vehicle = VehicleInbox(...)` に委譲して `on_client_message` の分岐 1 行と `vehicle_report` の 1 行だけにする。`_Throttle` は `detector/log.py` 等の共有に移して l1・l0・vehicle で使う。LAC-1 は vehicle.py が l1 を import しないので保てる。テスト（HV-4）は hub 経由のままで通る。
- 今の形でも動作は仕様どおりで、赤の経路に触れていない（`_on_vehicle` は `on_result`・`tick`・fusion を呼ばない）。後回し可。

### W-4 コメント・docstring が実装より古い（正確さ）

- `hub.py:300` `on_client_message` の docstring「ack と label だけ読む」→ vehicle も読む。
- `l1/request.py:3` 「edge が知らない車の状態は…固定する（…実値は Deferred）」→ いまは `context_from_report` で実値を使う。`VehicleContext` の docstring（行 29）「車の状態の固定値」も、実値で作ることがあるので「既定は固定値」に直す。
- `client-message.ts:4` 「ack と label だけ（ch7…）」→ vehicle を足した。
- `vehicle.py:38-41`「本文は例外に残さない」だが、`raise ValueError(...) from exc`（行 48）は pydantic の `ValidationError`（`input_value` を含む）を `__cause__` に残す。いまは漏れない（`log.py:35-40` が例外の連鎖を出すのは `exc_info` つきのログだけで、grep では `log.py:64` の `process.uncaught` しか使っておらず、hub は `extra` に型名だけを渡す）ので Warning。docstring どおりなら `from None`。
- `use-gps-zone.ts:39-43` hook の説明に、`vehicle` を返す責務（pwa-uplink R2）が書かれていない（`GpsView.vehicle` の型コメントのみ）。
- `test_vehicle_authz.py:1` docstring が「AUTH-1〜4」だが 6・7 もある。
- `functional.md:173` 行末に `''` の混入。Test List（行 189-268）が全部 `[ ]` のまま（実装済みの項目を更新する運用なら更新漏れ）。

### W-5 `hub.py:337` `vehicle.updated` の key に「速度の有無」が入っていて、R7 / HV-4f と挙動が違う

- R7:「zone か light の項目の有無・値が変わったとき」。コードの key は `(zone, light, speed_kmh is not None)`。GPS の `speed` が null と数値を行き来する端末（止まっている・低速のとき）では、ゾーンも光も変わらないのに `vehicle.updated` が 1 秒に 1 回出続ける（間引きはあるが運用ログのノイズ）。
- HV-4f は速度の値だけ違うケースしか見ておらず、`has_speed` だけが切り替わるケースが無い。仕様どおりにするなら key は `(zone, light)`、`has_speed` は出力のフィールドにだけ残す。仕様のほうが「速度が有るか」をログに出す意図なら、R7 を直す（どちらかに揃える）。
- ついでに `_vehicle_key: tuple[object, object, bool]`（行 78）の `object` は `str | None` に。

### W-6 `l1/runner.py:106` と `:154` 「実値を使ってよいか」の規則が 2 か所に別の形で書かれている

- `run_l1` の起動時ログの条件（`vehicle_state == "pwa" and calibration is not None and calibration.context != "real"`）と、`_ask_once` の `live`（`vehicle_state == "pwa" and (calibration is None or calibration.context == "real")`）は同じ規則の表と裏。どちらかだけ直すと、AC-d の「ログは出るが実値で聞く」のような食い違いが起きうる（片方を直したときに検知するテストは RQ-5l/AC-d にあるが、規則の置き場所は 1 つにすべき）。
- 校正と設定は起動後に変わらないのに、`_ask_once` が 2〜3 Hz のたびに評価している。
- 案: `request.py` か `calibration.py` に `def uses_pwa_vehicle(config: L1Config, calibration: Calibration | None) -> bool` を 1 つ置き、`run_l1` で 1 回だけ評価して `_ask_once` に bool を渡す（引数が 1 つ増えるが `calibration` を渡すより意図が明確）。ログは `config.vehicle_state == "pwa" and not live`。
- 型: `Calibration.context: str`（`calibration.py:53`）・`VehicleReport.zone/light: str | None`（`vehicle.py:27-28`）・`L1Verdict.state_source: str`（`fusion.py:70`）・`L1Config.vehicle_state: str`（`config.py:119`）が文字列のまま。`Literal["fixed","real"]` / `Literal["pwa","partial","fixed"]` / `Literal["pwa","fixed"]` にして、`CONTEXTS`・`VEHICLE_STATES` と一本化できる。

### W-7 `test_vehicle_acceptance.py` 受け入れテストが仕様の文言より弱い箇所

- AC-b（行 130-144）: 仕様は「赤の `t_frame`・距離・方向・送信の回数が同じ」。テストは最初の赤の `distanceM` と `side` だけ比べている。`strip()`（行 53）が定義されていて、フラグ列全体の比較に使えるのに使われていない。`t_frame` は `result(150 * i, ...)` で決定的なので、`t_sent` を除いた `reds()` の列全体を比べられるはず（`asyncio.sleep(0.15)` の実時間が絡むため回数が揺れるなら、`deer: true` の最初の 1 通と、`deer` の遷移の列で比べる）。
- AUTH-5（行 165-176）: 仕様は「降格の回数が同じ」。テストは `(demotions(spam) >= 1) == (demotions(plain) >= 1)` の真偽の比較。さらに偽の local-jev は `state` に関係なく同じ答えを返すので、降格の比較はもともと同じになる（実質、行 175-176 の `states == FIXED_STATE` が本質）。それで十分な回帰になっているが、テスト名・コメントの「降格が増えない」は実際には「聞く内容が同じ」を検証していると明記したほうが正確。
- 実時間: `run_case` は 0.15 秒 × 12 フレームの実 sleep。AC-b・AUTH-5 は 2 ケースずつ、AC-d は 3 パラメータなので、合計で十数秒かかり、`wait_for` の待ちもあってマシンが遅いと揺れやすい。`Clock`（conftest）を注入して進める形にできないか、少なくとも `frames` を減らす。
- `test_vehicle_authz.py:90-97`（AUTH-3）: `hub._cfg`・`hub.fusion._cfg`（private）を読み、`hub.fusion` の None を確かめていない（mypy / 将来の変更で `AttributeError` が出る）。そもそも `threshold=` などの余分な項目は strict で拒否されるので、このテストが落ちる実装は「vehicle の中身で設定を書き換える」実装だけで、主張が弱い。`vehicle_state` を含む設定が `load_config` の結果と同じ（`==`）だけで十分。
- `test_vehicle_hub.py:102` `lambda` + `# noqa: E731`。`def strip(...)` にすれば noqa が要らない。

### W-8 `vehicle.py:29,37` `received_at` の既定値 0.0

- `VehicleReport.received_at: float = 0.0` と `parse_vehicle(message, received_at=0.0)` は、本番の呼び出し（`hub._on_vehicle`）が渡し忘れても通る。0.0 は単調時計では「ずっと昔」なので古い扱いに倒れる（安全側）が、バグを黙って隠す。テストが `VehicleReport(speed_kmh=..., zone=..., light=None)` と省略していることが理由なら、テスト側に `received_at=0.0` を書く。

### W-9 `vehicle-report.ts:9` `MAX_SPEED_KMH = 300` の重複

- スキーマ（`client-message.ts:30` の `.max(300)`）と PWA の収める上限が別々のリテラル。どちらかだけ変えると、`sendVehicle` が `vehicle.skipped`（invalid）になり、速度の項目ごと落ちる。`@antler/schema` から `VEHICLE_MAX_SPEED_KMH` を export して両方で使う（凍結 API への「追加」なので、PR に「推奨で決定」を書く）。Python 側は JSON Schema から生成なので自動で揃う。

## Info（参考）

- `edge-client.ts:127` `t >= this.lastVehicleAt` は `performance.now()` が単調なら常に真で、到達しない防御。EC-3c「壁時計を戻しても止まらない」は `Date` を戻すテストで、この分岐を通らない（`performance.now()` を戻すテストは無い）。意図が「念のため」なら残してよいが、コメントに理由を書く。
- `edge-client.ts:98-115` `sendAck` と `:122-148` `sendVehicle` で「検証 → 送信 → 失敗をログ」の形が重複。3 つ目のメッセージ（label、B2-6）が来たら `private sendClient(message, event)` に括る。いまは YAGNI で保留してよい。
- `vehicle-report.ts:13-18` `ReportInput.status` は `ZoneJudgement['status'] | null` と同じ集合。型を借りると judgeZone の変更に追従する。
- `vehicle-report.test.ts:111-114`「緯度経度が数でない測位でも例外にしない」は `not.toThrow` だけで、`light` が項目なしになる（`lightOf` の `catch` が働く）ことを見ていない。`expect(report).toEqual({ speedKmh: 36, zone: 'inside' })` まで確かめると、`lightOf` の try/catch が実際に必要かも分かる。
- VR-2d の後半（「`useGpsZone` が返す `GpsView` にも座標が出ない」）を直接見るテストが無い（`DriveGps.test.tsx` に vehicle の言及なし）。ネットワークに出る文字列は `DriveUplink.test.tsx:141-142` が見ているので、実質の保証はある。
- `toVehicleReport` は負の経過（`age < 0`）を「端末の時計が戻った」として null にするが、`now` が 1 秒の刻みなので、刻みの直後に届いた新しい測位は `fix.timestamp > now` となり、次の刻みまで null になる（W-1 の描画依存と合わせて、実害は「次の刻みで送る」だけ）。許容範囲だが、コメント（R2）に書いておくと誤解されない。
- `hub.py` の `vehicle.error`（行 330-334）は仕様 R7 のログ一覧に無い（FAIL-3 のために足された）。R7 に 1 行足す。
- `request.py:50` `report.zone or default.zone` は空文字も固定値に倒す。スキーマで 2 値に絞られているので実害は無いが、`is None` のほうが意図が明確（`speed` の行 47 と書き方を揃える）。
- `fake-edge.mjs:199-207` は R8 どおり。テストは見つけられなかった（Test List に項目も無い）ので、いまの運用どおり手動で十分。
- 日本語コメントは全体的に「なぜ」を書いていて読みやすい。マジックナンバー（`SPEED_MAX_AGE_S`・`MIN_SPEED_KMH`・`REPORT_FRESH_MS`・`VEHICLE_MIN_INTERVAL_MS`・`VEHICLE_LOG_INTERVAL_S`）は名前付き定数になっている。

## 次に回す順（提案）

1. W-1 と W-2（同じ修正で直る。PWA の効果とテスト）
2. W-5 と W-6（挙動と仕様のずれ・規則の一本化。小さい）
3. W-4・W-8（コメント・既定値。数行）
4. W-3・W-7・W-9（構造の整理。feature の外でもよい）
