---
feature: pwa-uplink
target_paths:
  - packages/schema/src/client-message.ts
  - packages/schema/src/vehicle-message.test.ts
  - packages/schema/fixtures/client-message/
  - packages/schema/json/client-message.schema.json
  - edge/detector/scripts/generate_models.py
  - edge/detector/src/detector/schema/
  - edge/detector/src/detector/vehicle.py
  - edge/detector/src/detector/hub.py
  - edge/detector/src/detector/fusion.py
  - edge/detector/src/detector/config.py
  - edge/detector/src/detector/l1/request.py
  - edge/detector/src/detector/l1/calibration.py
  - edge/detector/src/detector/l1/runner.py
  - edge/detector/config.example.toml
  - edge/detector/tests/test_vehicle_message.py
  - edge/detector/tests/test_vehicle_hub.py
  - edge/detector/tests/test_vehicle_l1.py
  - edge/detector/tests/test_vehicle_acceptance.py
  - edge/detector/tests/test_vehicle_authz.py
  - apps/pwa/src/features/connect/lib/vehicle-report.ts
  - apps/pwa/src/features/connect/lib/edge-client.ts
  - apps/pwa/src/features/connect/hooks/use-gps-zone.ts
  - apps/pwa/src/features/connect/hooks/use-vehicle-uplink.ts
  - apps/pwa/src/features/connect/components/DriveScreen.tsx
  - apps/pwa/scripts/fake-edge.mjs
spec_confirmed_at: ef4ced1
tier: 2
---

# 仕様: pwa-uplink（スマホ PWA の速度・ゾーン・光を edge の L1 に返す）

**l0-fp-filter（2026-11-06）での変更**: `edge/detector/src/detector/config.py` に `[l0_filter]` のセクションを足した。この feature の設定（`[l1] vehicle_state`・`vehicle_max_age_s`）と挙動は変わらない。

## 概要

edge の L1 は JudgeRequest の `state`（`speedKmh`・`zone`・`light`・`headlight`）を固定値（60 km/h・inside・night・low）で送っている（edge-l1 R2。実値は Deferred だった）。
スマホ PWA は GPS を持っている。PWA が GPS から**速度・ゾーンの内外・光の区分**だけを作り、WebSocket で 1 Hz に edge へ返す。edge はそれを L1 の問い合わせの `state` に使う。
位置（緯度経度）・精度・時刻・端末の識別子は送らない。古い値・分からない値は、固定値に戻す。
ただし**校正（`calibration.json`）が固定値で学習したものである間は、実値を使わず固定値で聞く**（実値は降格＝見逃しの向きに寄るため。spec-adversary Critical）。実値で学習した校正（`context: "real"`）か、校正なしのときに実値を使う。
ヘッドライトは PWA に分からないので、光からの推定（昼は `off`、それ以外は `low`。校正の実値のモードと同じ規則）で、固定値のときは `low`。

要件: ch4 B3（通信）、ch5・ch6 プライバシー（精密な位置を送らない・保存しない）、ch7（B WebSocket。クライアント → サーバーは ack と label だった。**追加だけ**で足す）。
契約: docs/specs/schema-judge（`JudgeRequest.state`）、docs/specs/edge-l1 R2（固定値）、docs/specs/pwa-drive（`judgeZone`・座標は hook の中だけ）、docs/specs/pwa-connect（`EdgeClient`・ack）、docs/specs/edge-judge（`on_client_message`・1 秒 5 通の上限）。
背景: `docs/changes/2026-11-03-b-l1-local-jev.md` §3.3（State を実値にする）。ch7 の原本は ack と label だけを書いている。原本が直るまで、この仕様が正（`docs/changes/2026-11-04-pwa-uplink.md`）。

**範囲外**（別 feature / Deferred）:

- ヘッドライトの実値（PWA には分からない。光からの推定にとどめる）。車の速度の「平滑化」や加速度
- `calibration.json` の再学習（実値で学習し直す。`dataset/export_l1_labels.py` は実値のモードを持っている。このセッションの担当外）
- 位置・ルート・ゾーンの残り km を edge へ送ること（L1 の入力に無い。要らない）
- `label`（B2-6、MAY）の送信、edge の Capture（edge-capture）、sim・api
- 複数の端末の突き合わせ（最後に届いた値を使う。R4）

**Tier 2 の根拠**: ネットワークから届く新しい入力が、L1 の降格（赤を下げる判断）の材料になる。認可マトリクスに行が増える（threat.md）。永続化スキーマは足さない。

## Example Map

Story: ドライバー（同乗者）として、いま何 km/h で、鹿ゾーンの中か外か、昼か夜かを L1 に伝えて、L1 が車の状況に合った判断をしてほしい。
ただし位置は車の外に出したくない。PWA が止まったり、GPS が使えなくなったりしても、L1 はそれまでと同じ固定値で動き続けてほしい。

- R1: メッセージ（`@antler/schema` の `ClientMessage` への**追加**。推奨で決定）
  - `{"type":"vehicle", "speedKmh"?: number, "zone"?: "inside"|"outside", "light"?: "dawn"|"day"|"dusk"|"night"}`
  - 3 項目はすべて任意。**無い項目は「分からない」**。`zone: "unknown"` や `null` の値は作らない（JudgeRequest.state に「分からない」の席が無いので、edge が固定値で埋める）
  - `speedKmh` は有限の数で 0 以上 300 以下。`light` は `Light`（common.ts）、`zone` は JudgeRequest と同じ 2 値
  - strict（余分な項目は拒否）。緯度経度・精度・時刻・端末の識別子の項目は無く、足せない（MASS-1）
  - **時刻の項目を持たない**: 新しさは edge が受け取った時刻（単調時計）で測る。端末の時計のずれに左右されない
  - 各メッセージは**全部を置き換える**（前のメッセージの項目を引き継がない）。項目が無ければ、その項目は分からない
  - 既存の `ack`・`label` の形・検証は変えない（ack と label の見本が同じ結果になるテストで確かめる）。JSON Schema（`packages/schema/json/client-message.schema.json`）を再生成する
  - Python 側（pydantic）は JSON Schema から `generate_models.py` で作る。同じ見本で TS と Python が同じ結果になる
- R2: PWA が作る値（`useGpsZone` の中。座標は hook の外に出さない）
  - 3 項目とも、**測位が 5 秒以内**（`0 ≤ now − fix.timestamp ≤ 5000`）のときだけ作る。古い・**負（端末の時計が戻った）**は古い扱いで、3 項目とも無し
  - `zone`: `judgeZone` の結果が `inside` / `outside` ならそれ。`unknown`・判定なし → 項目なし
  - `speedKmh`: `speedMps` が有限で 0 以上 → `round(speedMps × 3.6)` を 300 までに収める。速さが無い（`speed: null`。止まっているときや端末による）・負・NaN → 項目なし（**負を 0 にして「停止」にしない**）
  - `light`: `zone` が分かるとき `lightPeriod(now, 測位の位置)`（`@antler/zones`）。それ以外 → 項目なし。**光は edge ではなく PWA で決める**（edge は位置を持たず、持たせない。推奨で決定）。光は端末の時計に依存する（時計が大きくずれた端末は光を間違える。測位の時刻も同じ時計なので検出できない。L1 の入力が変わるだけで赤は変わらない）
  - メッセージに載るのは上の 3 項目だけ。緯度経度・精度・時刻を載せない。ログにも出さない
  - 3 項目とも無い（位置の許可なし・GPS なし・測位が古い）→ **`vehicle` を送らない**（空のメッセージで、ほかの端末の実値を固定値に入れ替えない。edge は最後の値を古さの規則で自然に固定値へ戻す）
- R3: PWA の送信（`EdgeClient.sendVehicle`・`useVehicleUplink`）
  - 送るのは B-1（走行中の画面。`DriveScreen`）のあいだだけ。B-0 のプレビューでは送らない。ack と同じ条件
  - 1 秒ごと（既存の `now` の 1 Hz の更新に乗る）に 1 通。前のと同じ内容でも送る（edge の新しさの時計を進めるため）。0.9 秒以内の再送はしない（StrictMode の二重の effect・再描画で 2 通にならない）。この間隔は `performance.now()`（単調）で測る（壁時計が戻っても止まらない）
  - 3 項目とも無いときは送らない（R2）
  - 接続が `open` でないときは送らない。溜めない・あとで送らない（古い値を出さない）。再接続したら次の 1 秒の更新で送る
  - 送る前に `ClientMessageSchema` で検証する。通らなければ送らない（`vehicle.skipped`）
  - 1 秒に 1 通は、edge の「1 接続 1 秒 5 通」（ack と合わせても 2 通以下）の内側
  - ack の送信・danger の表示・音には触らない
- R4: edge の受信（`AlertHub.on_client_message`）
  - `type == "vehicle"` のメッセージを、生成した pydantic の `VehicleMessage` で検証する。通れば `VehicleReport(speed_kmh, zone, light, received_at)` として**置き換えて**保持する（`received_at` は hub の単調時計。注入できる）
  - 検証に通らない（範囲外・NaN・文字列の数・余分な項目・bool）→ 捨てる。**前の値を残す**（壊れたメッセージで、すでにある値が消えることも、書き換わることもない。新しさは進めない）。`vehicle.invalid` を 1 秒に 1 回まで warning（本文は残さない）
  - 複数の端末がつながっていても区別しない。**最後に届いた有効なメッセージが勝つ**（どの端末か分からない。AP に入れるのは QR を渡された人だけ。edge-judge の threat.md と同じ前提）
  - ack・label・未知の型の扱いは変えない（`label` は無視、未知の型は `client.ignored`）
  - **赤の経路に触れない**: 受信の処理は同期で数マイクロ秒（辞書を見る・pydantic の検証・代入だけ）。`on_result`・`tick`・`_output`・fusion を呼ばない。受信が何をしても、L0 の赤は変わらない
  - 1 秒 5 通の上限・64 KB の上限は edge-judge のまま（vehicle もその数に入る）
- R5: edge が L1 に使う（`l1/request.py`・`l1/runner.py`・`l1/calibration.py`）
  - **実値を使ってよいのは、校正と同じ状態の分布で聞くときだけ**（spec-adversary Critical。推奨で決定）。`calibration.json` は固定値（60 km/h・inside・night・low）で学習したもので、実値（低速・ゾーン外・昼）は学習に無い入力。正解ラベルは「低速・ゾーン外 → 危険でない」と教えているので、そのまま実値を渡すと降格（見逃しの向き）に寄る
    - `calibration.json` に任意の `"context": "fixed" | "real"` を足す（既定・無い場合は `"fixed"`。ほかの値・型違いは形が違う扱い）。`real` は `dataset/export_l1_labels.py` の実値のモードで学習したことの宣言（人 B が再学習のあとに書く。Deferred）
    - 使うのは `vehicle_state = "pwa"` かつ（校正なし、または `context == "real"`）のとき。校正が `fixed` なら、`vehicle` が届いていても**全部固定値**（`state_source = "fixed"`）で、起動時に `l1.vehicle_ignored`（`reason=calibration_fixed`）を 1 回残す。校正なしは降格が起きないので実値を使ってよい（ログと確率の記録のため）
  - 使うとき（`_ask_once`）は `hub.vehicle_report(max_age)`（hub 自身の単調時計で測る）を読む。項目ごとに: **速度は 3 秒以内**、**zone と light は `vehicle_max_age_s`（既定 10 秒）以内**のものだけ実値。古い項目・無い項目は固定値。ちょうど期限は新しい扱い、超えたら古い
  - 固定値は edge-l1 R2 のまま: `speedKmh=60.0`・`zone="inside"`・`light="night"`。`VehicleContext()` の引数なしの既定は変えない（`dataset/export_l1_labels.py` が使っている）
  - **速度は学習の範囲の下限で持ち上げる**: 実値は `max(実値, 30.0)` で渡す（学習は 30〜80 km/h。0〜29 km/h は学習に無く、降格に寄る側）。上は 300 まで（高いほど危険側）
  - **ヘッドライト**: 実値を使うとき、校正の実値のモードと同じ規則にする: 実値の `light` が `day` なら `off`、それ以外（夜・夕・朝・光が分からない）は `low`。固定値のときは常に `low`。PWA に車のライトは分からないので、これは光からの推定（Deferred）
  - `vehicle_state = "fixed"`（設定）なら、メッセージを受けても常に固定値。既定は `"pwa"`
  - hub は `detector.l1` を import しない（edge-l0 の LAC-1）。hub は L1 を知らない `VehicleReport` だけを持ち、`VehicleContext` に直すのは `l1/request.py`
  - ログ: `l1.result` に `state_source` を足す: `pwa`（speed・zone・light の 3 つとも実値）/ `partial`（一部が実値）/ `fixed`（全部固定値）。校正の分析と edge-latency-reviewer が固定値の答えと実値の答えを分けられるようにする
  - **降格の条件は変えない**（edge-l1 R5 のまま）。実値は L1 への入力を変えるだけで、校正後 0.9 以上・今のエピソード・赤の候補 1 つ・`pos` が lane でない・2.0 秒以内、のすべてが要る。メッセージだけで赤は下がらず、上がりもしない
- R6: 設定（`[l1]` に足す。TOML）
  - `vehicle_state`（既定 `"pwa"`、`"pwa"` か `"fixed"`）、`vehicle_max_age_s`（既定 10.0、1〜60）。範囲外・型違い → `ConfigError`（キー名つき）
  - `config.example.toml` に書き、テストで読める・既定値と一致する
- R7: ログとプライバシー
  - PWA: 速度・ゾーン・光・位置を `logger` に出さない。出すのは `vehicle.skipped` と理由だけ
  - edge: `vehicle.updated`（zone か light の項目の有無・値が変わったとき、1 秒に 1 回まで。ゾーンと光の値と、速度が有るかだけ。速度の値は出さない）、`vehicle.invalid`、`vehicle.stale`（`hub.vehicle_report` を読んだとき、保持している値が `vehicle_max_age_s` を超えていたら 1 回。次に新しい値が来るまで繰り返さない。読むのは L1 の問い合わせのときだけで、`tick`（赤の経路）には足さない）。メッセージの本文・クライアントのアドレスを出さない
  - 緯度経度は PWA の端末の外に出ない（ネットワーク・ログ・storage）。送るのは 3 項目の派生値だけ。Capture の規約（位置を `roadSegment` に丸める）と同じ考え方
- R8: 偽 edge（`apps/pwa/scripts/fake-edge.mjs`、pwa-connect R11）
  - `vehicle` を受けたら、ack と同じ 1 行の JSON（`event: "vehicle"` と 3 項目）を標準出力に出す。そのほかのメッセージの扱いは変えない

## ユースケース

### UC-1: メッセージの形（R1）

- **Given**: TS の `ClientMessageSchema` と、JSON Schema から作った Python のモデル
- **When**: `vehicle` のメッセージを検証する
- **Then**: R1 の形だけ通る。範囲外・余分な項目（緯度経度など）・知らない値は拒否。ack・label は今までどおり。TS と Python が同じ見本で同じ結果になる

### UC-2: PWA が値を作る（R2）

- **Given**: 測位（Fix）・`judgeZone` の結果・現在時刻
- **When**: `vehicle` の値を作る
- **Then**: R2 のとおり。古い・分からない項目は無い。座標は出ない

### UC-3: PWA が送る（R3）

- **Given**: `EdgeClient`（偽の socket）と `DriveScreen`
- **When**: 1 秒ごとの更新が起きる
- **Then**: open のときだけ、B-1 のときだけ、1 秒に 1 通、検証してから送る

### UC-4: edge が受ける（R4）

- **Given**: `AlertHub`
- **When**: `vehicle` のメッセージが届く
- **Then**: 有効なら置き換えて保持、無効なら捨てて前の値を残す。赤の送信は変わらない

### UC-5: edge が L1 に使う（R5）

- **Given**: `VehicleReport` と L1 の対象のトラック
- **When**: 問い合わせを作る
- **Then**: 新しければ項目ごとに実値、古い・無い・`fixed` 設定なら固定値。`JudgeRequest` に通る。`state_source` がログに出る

### UC-6: 設定（R6）

- **Given**: TOML
- **When**: `load_config`
- **Then**: R6 のとおり

## 状態パターン

### S-1: PWA が GPS を使えない

- **Given**: 位置の許可なし → **Then**: `vehicle` は送られない。L1 は固定値で動く（今までどおり）。ほかの端末の実値を空のメッセージで消さない

### S-2: PWA が止まる・切れる

- **Given**: 10 秒、`vehicle` が届かない → **Then**: 固定値に戻る（`vehicle.stale` が 1 回）。再接続して新しい値が来れば実値に戻る

### S-3: 壊れた `vehicle` が届く

- **Given**: 範囲外・NaN・余分な項目 → **Then**: 捨てる。前の値が残る。赤は変わらない

## Questions（Deferred のみ残存可）

決着済み（2026-11-04、推奨で決定。PR にも書く）:

- 光の区分は edge か PWA か → **PWA**。`lightPeriod` は位置が要る。edge は位置を持たない（持たせない）。位置は `useGpsZone` の中だけで使う
- 「分からない」の表し方 → 項目を送らない。`zone: "unknown"`・`null` は作らない（JudgeRequest に席が無い）。edge が固定値で埋める
- 新しさの測り方 → edge が受け取った時刻（単調時計）。メッセージに時刻を持たせない。PWA は測位が 5 秒より古い（または経過が負）なら 3 項目とも送らない。edge は速度を 3 秒、ゾーンと光を 10 秒で固定値へ戻す（最悪でゾーンと光は約 15 秒古い）。古い `outside` は固定値の `inside` に倒れる（降格に寄る値が残らない向き）
- 実値は降格に寄るか（spec-adversary Critical）→ 寄る。校正（`calibration.json`）は固定値で学習したもので、低速・ゾーン外・昼は学習に無い。**校正が `context: "fixed"`（既定）のあいだは実値を使わない**。`context: "real"` と宣言された校正のとき（または校正なし）だけ実値を使い、速度は学習の下限 30 km/h で持ち上げる。ユーザーの「既定は pwa」はそのまま（設定の既定は `pwa`。実際に使うかは校正の宣言しだい）
- 部分更新か置き換えか → 置き換え（無い項目は分からない）。速度だけ古い値が残り続けない
- 残り km・ゾーン ID・路線名を送るか → 送らない（L1 の入力に無い。位置の手がかりを減らす）
- 複数端末 → 最後に届いた有効なメッセージ
- 空の `vehicle` → 送らない。2 台目の端末が実値と固定値を入れ替えない（spec-adversary W）
- ヘッドライト → 実値のとき光からの推定（昼は off、それ以外は low）。校正の実値のモードと同じ規則。固定値のときは low
- 実値の既定 → `vehicle_state = "pwa"`（ユーザーの指示）。校正のずれに備えて `"fixed"` で切り離せる
- ch9 ④（B の判断モデル）は推奨（local-jev＋Qwen2.5-1.5B、L1 を赤の経路に入れない）を**仮採用**中

- [Deferred: 担当=人 B（edge-l1-calibration の続き。実値のモードで `dataset/export_l1_labels.py` を回し、`calibrate.py` で温度を学習し直して、`calibration.json` に `"context": "real"` を足す。`calibrate.py` の書き出しに `--context` を足すのもここ。注意: エクスポートの実値のモードの名前は `actual`、校正側は `"real"` で綴りが違う。合成 trace の zone は常に `inside` なので、合成だけで学習したものに `"real"` を付けない。ゾーン外・低速・昼を含む実走行・sim のトレースで学習したときだけ付ける）/ 期日=2026-11-06 / 暫定挙動=`calibration.json` は固定値の状態で学習したもの（`context` が無い = `fixed`）。そのあいだ edge は `vehicle` が届いても固定値で L1 に聞く（`state_source=fixed`、`l1.vehicle_ignored` を 1 回）。校正なしのあいだは実値で聞く（降格は起きない）] 実値での温度の再学習
- [Deferred: 担当=人 B（実機の調査走行）/ 期日=2026-11-07 / 暫定挙動=`headlight` は PWA に分からないので、光からの推定（昼は `off`、それ以外は `low`）。固定値のときは `low`。車の実際のライトは未確認] ヘッドライトの実値
- [Deferred: 担当=ユーザー（Mac mini とスマホの実機）/ 期日=2026-11-07 / 暫定挙動=実機のスマホの GPS の `speed` が `null` の端末では速度は固定値の 60 のまま。偽 edge と単体テストで確かめた。実機の速度の取れ方は未確認] 実機の速度の取得

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-a: 校正なしの構成で、本物の WebSocket クライアントが `vehicle`（outside・45 km/h・day）を送ると、次の L1 の問い合わせ（偽の local-jev）の `state` が `zone=outside`・`speedKmh=45.0`・`light=day`・`headlight=off`。注入した時計を 10 秒進めると固定値（60・inside・night・low）に戻り、`vehicle.stale` が 1 回残る
- [x] AC-d: 固定値で学習した校正（`context` なし）の構成では、`vehicle` を送っても問い合わせの `state` が `vehicle` を送らないときと同じ（固定値）で、`l1.vehicle_ignored` が 1 回残り、`state_source=fixed`。`context: "real"` の校正に差し替えると実値になる
- [x] AC-b: `vehicle` を送り続けても、L0 の赤の `t_frame`・距離・方向・送信の回数は、`vehicle` を送らない場合と同じ（赤の経路に触れない）。校正なしの L1 が false_positive 0.99 と答え、`vehicle` が outside・0 km/h でも赤は下がらない
- [x] AC-c: PWA の `DriveScreen` を 1 Hz で 5 秒回すと、偽 socket に `vehicle` が 5 通届き、どれも `ClientMessageSchema` に通り、緯度経度・精度・時刻の項目が無い。測位が 5 秒より古くなると送られなくなる

UC-1 メッセージの形（packages/schema・Python）:

- [x] VM-1a: 3 項目すべて・一部・空（`{"type":"vehicle"}`）が通る（見本 valid）
- [x] VM-1b: 範囲外の速度（-1・301）・NaN・Infinity・文字列の数・bool・`zone: "unknown"`・`zone: null`・`light: "noon"`・知らない型 → 拒否（見本 invalid）
- [x] VM-1c: [MASS] `lat`・`lon`・`accuracy`・`timestamp`・`t_shown`・`deviceId`・`remainingKm` を足すと拒否
- [x] VM-1d: ack・label の見本の通る・通らないが今までと同じ。flag の形はクライアント → サーバーで拒否のまま
- [x] VM-1e: 書き出した JSON Schema が定義から作り直したものと一致する（UC-1i）。Python のモデルが最新（`generate_models.py --check`）。`judge_request.py` のバイト列は変わらない
- [x] VM-1f: Python のモデルが、同じ見本で TS と同じ結果。JSON の整数（`60`）の速度を通す。NaN を拒否

UC-2 PWA が値を作る:

- [x] VR-2a: `speedMps` 10 → 36。0 → 0。`speedMps` が無い・負・NaN → 項目なし（0 にしない）。301 km/h 以上 → 300 に収める
- [x] VR-2f: 測位が 5 秒より古い、または 5 秒ちょうどまでは新しい、端末の時計が戻って経過が負 → 3 項目とも無し（`null` の報告）。空のときは `useVehicleUplink` が送らない
- [x] VR-2b: `judgeZone` が inside / outside → `zone` に入る。unknown・判定なし → 項目なし
- [x] VR-2c: `light` は `lightPeriod` の結果（昼・夕・夜・朝の測位で確かめる）。`zone` が分からないとき → 項目なし
- [x] VR-2d: 出力に座標・精度・時刻が出ない（キーは 3 つ以内）。`useGpsZone` が返す `GpsView` にも座標が出ない
- [x] VR-2e: 位置の許可なし・GPS なし → 空の報告（送られない）

UC-3 PWA が送る:

- [x] EC-3a: `sendVehicle` は open のときだけ socket に送る。connecting・closed では送らず、溜めない
- [x] EC-3b: 送る文字列は `ClientMessageSchema` に通る。通らない値（NaN など）は送らず `vehicle.skipped`
- [x] EC-3c: 0.9 秒以内の 2 回目は送らない。1 秒後はまた送る。間隔は `performance.now()` で測り、壁時計を戻しても送り続ける
- [x] UP-3a: `DriveScreen` が 1 Hz で送る。B-0 では送らない。アンマウントで止まる。StrictMode の二重の effect でも 1 秒に 1 通
- [x] UP-3b: 再接続したら、次の更新で送る（切れているあいだの分は送らない）
- [x] UP-3c: ack は今までどおり danger を表示し始めたときに 1 回（vehicle が ack を邪魔しない・数えない）

UC-4 edge が受ける:

- [x] HV-4a: 有効な `vehicle` を保持する。次の `vehicle` が全部を置き換える（前の速度が残らない）
- [x] HV-4b: 無効（範囲外・NaN・余分な項目・bool）→ 前の値が残り、`vehicle.invalid` が 1 秒に 1 回まで。本文がログに出ない
- [x] HV-4c: 2 つの接続から交互に届く → 最後の有効なものが勝つ
- [x] HV-4d: `ack`・`label`・未知の型の扱いが今までと同じ（既存のテストが Green）
- [x] HV-4e: `vehicle` の受信で `sender` が呼ばれない・fusion の状態が変わらない（赤の経路に触れない）
- [x] HV-4f: `vehicle.updated` は zone / light が変わったときだけ。速度の値を出さない

UC-5 edge が L1 に使う:

- [x] RQ-5a: 新しい報告（校正なし）→ 3 項目の実値（速度は下限 30 で持ち上げ）。`JudgeRequest` に通る
- [x] RQ-5b: 一部の項目だけ有る → 有る項目は実値、無い項目は固定値。`state_source=partial`
- [x] RQ-5c: `received_at` から `vehicle_max_age_s` を超えた → 全部固定値、`state_source=fixed`、`vehicle.stale` は 1 回
- [x] RQ-5d: 境界: ちょうど `vehicle_max_age_s`（速度は 3 秒）は新しい扱い、それを超えたら古い
- [x] RQ-5e: `vehicle_state = "fixed"` → 実値が届いていても固定値
- [x] RQ-5f: 報告が無い（一度も届かない）→ 固定値。今までの L1 のテストが Green
- [x] RQ-5g: 実値の速度は 30 km/h で持ち上げる（0 → 30.0、12 → 30.0、45 → 45.0、300 → 300.0）。60 に戻さない
- [x] RQ-5k: 速度が 3 秒より古く、zone と light は 10 秒以内 → 速度だけ固定値の 60（`state_source=partial`）
- [x] RQ-5l: 校正が `context` なし（fixed）→ `vehicle` が届いていても全部固定値、`state_source=fixed`、起動時に `l1.vehicle_ignored` を 1 回。`context: "real"` → 実値。校正なし → 実値
- [x] RQ-5m: 実値のとき `headlight` は `light=day` で `off`、それ以外で `low`。光が分からない（固定値の night）なら `low`
- [x] CAL-5n: `calibration.json` の `context` は無い → `fixed`、`"real"`・`"fixed"` → その値、ほかの値・型違い → 形が違う（校正なし）。既存の校正のテストが Green のまま
- [x] RQ-5h: `l1.result` に `state_source` が出る（`pwa` / `partial` / `fixed`）
- [x] RQ-5i: `VehicleContext()` の引数なしの既定は 60・inside・night・low のまま
- [x] RQ-5j: `detector.hub` と `detector.fusion` が `detector.l1` を import しない（LAC-1 のテストが Green）

UC-6 設定:

- [x] CFG-6a: 空の TOML で `vehicle_state="pwa"`・`vehicle_max_age_s=10.0`
- [x] CFG-6b: 指定した値が読める
- [x] CFG-6c: `vehicle_state` の値違い・`vehicle_max_age_s` が 0.9 / 60.1・型違い → `ConfigError`（キー名つき）
- [x] CFG-6d: `config.example.toml` が読め、既定値と一致する

認可（threat.md の ❌ セル）:

- [x] AUTH-1: `vehicle` だけでは赤にならない・赤が解けない・L1 の降格が起きない（校正なし・前のエピソード・赤の候補でないトラックのままなら降格しない）
- [x] AUTH-6: 古い `vehicle`（端末の時刻つきの偽の新しさを含む）を使い続けさせられない。edge が受け取った時刻から 10 秒で固定値に戻る
- [x] AUTH-7: `vehicle` の値（速度・光）は配信するフラグにも snapshot にも載らない
- [x] AUTH-5: 固定値で学習した校正のもとで、降格する答えを返す偽の L1 に、`vehicle`（outside・0 km/h・day）を送り続けても、降格の回数が `vehicle` を送らない場合と同じ（実値が降格を増やさない。spec-adversary Critical の回帰）
- [x] AUTH-2: `vehicle` に緯度経度・端末識別子の項目があっても、保持も記録もしない（拒否して前の値を残す）
- [x] AUTH-3: `vehicle` のメッセージで設定・閾値・校正は変わらない
- [x] AUTH-4: 64 KB を超える `vehicle`・1 秒 5 通を超える `vehicle` は edge-judge の上限で捨てられ、赤の送信は止まらない

障害（resilience.md の失敗モード）:

- [x] FAIL-1: 送れなかった `vehicle`（socket が閉じかけ）で例外が出ても、ack・描画・再接続は止まらない
- [x] FAIL-2: 時計が後ろへ戻る → 報告は新しいまま扱い、負の経過で例外を出さない
- [x] FAIL-3: 報告の保持で例外が出ても、`on_client_message` が例外を外へ出さない（接続を落とさない）

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule             | 語彙                                       | 置き場所                                            | 証明 |
| ---------------- | ------------------------------------------ | --------------------------------------------------- | ---- |
| R1: メッセージ   | VehicleMessageSchema / VehicleMessage      | packages/schema/src/client-message.ts               | UC-1 |
| R2: PWA が作る値 | toVehicleReport / VehicleReport            | apps/pwa/src/features/connect/lib/vehicle-report.ts | UC-2 |
| R3: PWA の送信   | EdgeClient.sendVehicle / useVehicleUplink  | apps/pwa/src/features/connect/lib/edge-client.ts    | UC-3 |
| R4: edge の受信  | AlertHub.on_client_message / VehicleReport | edge/detector/src/detector/hub.py                   | UC-4 |
| R5: L1 に使う    | context_from_report / state_source         | edge/detector/src/detector/l1/request.py            | UC-5 |
| R6: 設定         | L1Config.vehicle_state / vehicle_max_age_s | edge/detector/src/detector/config.py                | UC-6 |
| R8: 偽 edge      | fake-edge の vehicle                       | apps/pwa/scripts/fake-edge.mjs                      | UC-3 |

## 非機能要件

- [x] 遅延: 受信の処理は同期で 1 ms 未満。赤の送信経路（`on_result`）に await・処理を足さない。PWA の送信は 1 通 約 100 バイト
- [x] プライバシー: 位置（緯度経度）は端末の外に出ない。メッセージ・ログ・storage のどこにも出ない
- [x] 凍結 API: `@antler/schema` の既存の型（ack・label・flag・Capture・TripPlan・JudgeRequest）を変えない。追加だけ
- [x] 決定性: 乱数を使わない。時計は注入できる
- [x] 既存のテストが Green のまま（edge pytest・schema・pwa の vitest）。カバレッジ 70% 以上
