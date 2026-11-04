# セキュリティ監査: pwa-uplink（2026-11-04）

対象: `git diff origin/main...HEAD`（56 ファイル）。仕様と脅威は `docs/specs/pwa-uplink/{functional,threat,resilience}.md`。
方法: コードの読み取りと、`parse_vehicle` への悪意ある入力の実行確認（読み取りのみ。コードは直していない）。

## 総合

- リスクレベル: Medium（Critical なし）
- 位置（緯度経度）は PWA の端末の外に出ない。`vehicle` の型・検証・ログに位置の席が無い。
- 悪意ある入力で edge が落ちる・任意コードが動く経路は見つからなかった。
- 残るのは「AP に入った端末が `vehicle` をなりすませる」ことの設計上の残余リスク（Warning）。

## Critical

なし。

## Warning

### W-1 L1 の降格を AP 内の端末が誘導できる余地が残る（CWE-345 / CWE-807、AUTH-5 の主張が強すぎる）

- `edge/detector/src/detector/l1/runner.py:154` — 校正の `context` が `real`（本番で想定する状態）だと、`vehicle` の実値が L1 の state に入る。
- `edge/detector/src/detector/hub.py:318-335` — `vehicle` は接続ごとではなく 1 つの共有の状態を、AP の誰からでも置き換えられる。10 秒は新しい値を送り続ければ保てる。
- 攻撃者が `zone=outside`・`light=day`・`speedKmh<=30`（edge が 30 に持ち上げる）を送ると、校正の学習範囲の中でいちばん「誤検知寄り」の state で L1 に聞かせられる。これは範囲外の入力ではなく学習済みの正規の state なので、30 km/h の下限（`request.py:47`）では防げない。
- `threat.md` の「偽の `zone=outside`・`speed=0` で降格が増えない」は、固定値の校正（`context != real`）のときだけ成り立つ。`real` のときは、正規の outside/day と区別できない。
- 影響: L0 の赤を L1 が下げる（見逃し）確率が上がりうる。ただし降格の既存の条件（校正後 0.9 以上、今のエピソード、`lane` でない、2.0 秒以内）は変わらない。攻撃には AP（WPA2）への参加が要る。
- 修正案（どれか）: (a) `threat.md` の AUTH-5 の文言を「`real` のときは正規の state と区別できない。残余リスク」に直す、(b) pwa 由来の state で降格したときは `l1.result` に `state_source=pwa` が残る（既に実装済み）ので、評価で `pwa` と `fixed` の降格率を比べる、(c) 赤の最中（`fusion.episode` が開いている間）は直前の値でなく、エピソード開始前に受けた値だけを使う、(d) `zone=outside` のとき `known==3` でも降格の確信度の下限を上げる。

### W-2 WebSocket の Origin を見ない（CWE-1385）

- `edge/detector/src/detector/server.py:65-73` — `serve(...)` に `origins=` が無い。`vehicle` で、これまでの ack/label より影響の大きい書き込み経路（L1 の入力）が初めてクライアントから開く。
- 端末のブラウザが AP に入っている状態で、悪意あるページの JS から `ws://<edge>:8765/alerts` に `vehicle` を送れる（https のページは mixed content で止まるのが通常だが、http のページ・ネイティブ・ブラウザの設定次第では通る）。
- `threat.md` は「WebSocket の Origin は見ない」と明記して受け入れている。影響は W-1 と同じ。
- 修正案: PWA の配信元の Origin を設定（`[server] origins`）に持たせ、`serve(..., origins=[...])` で絞る。Origin を送らない非ブラウザのクライアントを許すか（`None` を含めるか）は別途決める。

## Info

- I-1 `vehicle` の検証コストは、仕様の「数マイクロ秒」（`functional.md:91`）・「1 ms 未満」（`functional.md:286`）ではない。64 KB の余分な項目（約 6,500 キー）で、`json.loads` 約 2 ms ＋ `parse_vehicle` 約 1.5〜4.5 ms を同期で asyncio のループ上で払う（`hub.py:318`、実測。正規の 64 バイトのメッセージは 0.06 ms で問題なし）。1 接続 5 通/秒 × 最大 16 接続（`server.py:30`、`config.py:80`）だと最悪 0.3〜0.5 秒/秒ほどループを使いうる（websockets の 64 KB の UTF-8 検証と、スロットルで捨てる分の受信は含めていない）。赤の送信の遅れにつながる程度ではないが、仕様の文言（`hub.py` の docstring「数マイクロ秒」）は直すか、悪意ある入力では ms 級と書く。軽くするなら `parse_vehicle` の前に `len(message) <= 8` のようにキー数で打ち切る。
- I-2 校正の実値の速度は `dataset/export_l1_labels.py:321` の `CAR_KMH = (30, 80)`。下限は持ち上げているが（`request.py:24`）、上限 80 km/h は切っていない。北海道では 80〜100 km/h が普通なので、実走行の速度は学習の範囲外になりうる（降格に寄るか寄らないかは未検証）。`MAX_SPEED_KMH` を校正の範囲に合わせるか、評価で確かめる。
- I-3 `apps/pwa/scripts/fake-edge.mjs:199-208` — 開発用。`zone`・`light` を型の確認だけで長さ・列挙を見ずにログへ出す（`JSON.stringify` されるのでログの改行注入にはならない）。既定は 127.0.0.1 バインド（`:102`）、64 KB 上限（`:17`）あり。実害なし。
- I-4 位置の経路（確認済み・指摘なし）: `use-gps-zone.ts` は座標を state の中だけで使い、`toVehicleReport` は速度・内外・光の 3 項目だけを返す（`vehicle-report.ts:35-44`）。`edge-client.ts:130-137` は送る前に `ClientMessageSchema.parse`（strict）を通すので、型を迂回して位置が混ざっても送られない。`logger` の呼び出し（`vehicle.skipped` は `reason` のみ）、storage/fetch/sendBeacon の新規利用は無し。`lightOf` の例外は握りつぶして出さない。光の区分は位置と時刻から作る派生値で、粗い位置の手がかりにしかならない。
- I-5 検証の確認（実行）: `NaN`・`1e999`・`true`・`null`・4,300 桁超の整数・余分なキー（`__proto__` を含む）は `ValueError`、文字列・配列の速度も拒否。整数 `50` は受理（Zod と同じ）。同じキーが 2 回あるときは後勝ち（`JSON.parse` と同じ）。深い入れ子は `RecursionError` を `on_client_message` が捕まえる（`hub.py:299-305`）。本文はログに出ない（`vehicle.invalid` は空の extra、`vehicle.updated` は zone・light・速度の有無だけ、1 秒に 1 回まで）。
- I-6 `generate_models.py`: 入力・出力名は定数の `TARGETS` だけから作り（`dict(TARGETS)[name]`）、外部の入力でパスは変わらない。`subprocess` は配列で渡しシェルを使わない。任意コード・パスの問題なし。生成物 `client_message.py` の `TShown1` に `model_config` が 2 回あり後のものが勝つが、`RootModel[str]` で NaN の問題は無関係。
- I-7 `client.ignored`（`hub.py:313-315`）は未知の type を 32 文字まで未スロットルで出す（既存。最大 80 件/秒）。`vehicle` 側のログは 1 秒に 1 回に絞られていて、この点は今回の追加で悪化していない。
