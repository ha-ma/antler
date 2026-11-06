---
feature: edge-judge
target_paths:
  - edge/detector/src/detector/
  - edge/detector/tests/
tier: 2
---

# 仕様: edge-judge（鹿の判定とフラグ配信）

**edge-run（2026-11-06）での変更**: 下の Deferred「起動の入口」を edge-run で回収した。`python -m detector --config ...`（`app.py`）が server・hub・pump を組み立て、走行ログをファイル（`logs/run-*.jsonl`）に書き、Ctrl-C で片付ける（`docs/specs/edge-run/functional.md`）。`sources.py` に `close()` を足した。判定と配信の挙動は変わらない。

## 概要

edge-camera の推論結果（`FrameResult`）から「前方に鹿がいる」を判定し、`AlertFlag` を WebSocket（`ws://ezoroad.local:8765/alerts`）でスマホ PWA に配信する。
2 フレーム連続で閾値超えならフラグ ON、1.5 秒検知なしで OFF。距離はボックスの高さから、方向はボックス中心の左右から決める。
フラグ変化時は即時、そのほかは 1 秒ごとのハートビート。クライアントからの `ack`（`t_shown`）を受けて、フレーム時刻からの遅延を走行ログに残す。
要件: ch4-edge.md B2-4・B3-2（B2-3 の「0.8 以上は VLM を待たない」はここでは一次検知だけ。2026-11-03 の変更指示で B2-3 は L0 即時ルールに変わり、edge-l0 が引き継いだ）、ch6-nfr.md「B 遅延」「B 可用性」「セキュリティ」「計測」、ch7-data.md（AlertFlag と B WebSocket）、
docs/specs/pwa-connect/functional.md（受信側の決まりと `apps/pwa/scripts/fake-edge.mjs`）。

**範囲外**（別 feature）: L1（ローカル jev 互換の非同期の降格、edge-l1）と L2（任意の Claude Vision、edge-l2）。旧 B2-3 の二次確認 VLM は 2026-11-03 の変更指示で削除。判定（Judge）は edge-l0 で L0 の即時ルールとして `L0Stage` の中で使う（docs/specs/edge-l0/functional.md）、JPEG（B3-3、SHOULD。`frameJpegB64` は常に null。画像を作らず保存もしない）、Wi-Fi AP・QR・mDNS（`ezoroad.local` の名前解決）、
起動の自動化（B1-1）、`label`（B2-6、MAY。受け取って無視する）、実機での距離表の較正（調査走行）、Capture の保存（edge-capture）、`apps/pwa/`（別セッション）。

**Tier 2 の根拠**: 外部副作用（ネットワークの待ち受け）と並行性（非同期の配信・複数クライアント）に触れる。認可は「LAN 内のみ」を境界とし、threat.md に書く。

## Example Map

Story: B の検知システムとして、鹿が写ったらためらわず、写らなくなったら 1.5 秒で解除し、スマホに 1 秒未満で伝えたい。誤検知よりも見逃しを避ける。

- R1: 判定（`Judge`）。入力は通ったフレームごとの `FrameResult`
  - 閾値（既定 0.8。edge-judge では 0.4 だったが、2026-11-03 のユーザー判断で edge-l0 が変更指示 B2-3 どおり 0.8 にした。0.4〜0.8 は赤にしない）以上の鹿が **2 フレーム連続**（間の通ったフレームに鹿なしが無い）で ON。1 枚だけ → ON にならない。確信度 0.8 以上でも 2 フレームを待つ（B2-3 の「VLM を待たない」は二次確認を待たないという意味で、一次の 2 フレームは省かない。1 枚の誤検知で赤を出さないため。推奨で決定。2026-11-03 の変更指示で B2-3 は「L0 即時ルール、L1 を待たない」になった。規則は同じ）
  - 2 枚の `t_frame` の間隔が 1.0 秒を超える（止まっていた）→ 連続とは数えず、新しく数え直す
  - ON のあと、最後に閾値以上の鹿を見たフレームの `t_frame` から 1.5 秒（既定。設定）以上 経ったフレームで OFF。1.5 秒ちょうどで OFF、1.499 秒では ON のまま
  - ON 中に鹿を見るたびに最後に見た時刻を更新する。1 枚欠けても（0.1 秒）ON のまま
  - 閾値未満（0.79）の検出は鹿なしと同じ。閾値ちょうど（0.8）は鹿あり（edge-l0 で 0.4 から変更）
  - 推論が失敗したフレーム（`failed`）は連続を切らず、鹿ありにも数えない。時刻だけ進める（失敗が続いて 1.5 秒過ぎれば OFF。止まったモデルで ON を固定しない）
  - 鹿が複数 → 距離と方向は、ボックスの高さが最大（いちばん近い）閾値以上の検出で決める。`conf` もその検出のもの
  - ON 中の距離は、鹿を見た最新のフレームの値に更新する。OFF のときは持たない
  - 方向は、ON になった時点の値から、**新しい方向が 2 フレーム連続で続いたとき**だけ変える（中心 x が 0.5 の前後で揺れても矢印が L/R を点滅しない。推奨で決定）
- R2: 距離と方向
  - 距離（m）= 設定の距離表（ボックス高さ → m の点の列）を線形補間して整数に丸める。表の外は端の値で止める。表は高さが増えるほど距離が減る列で、2 点以上
  - 既定の表は暫定（高さ 0.03→55 m、0.05→33、0.10→16、0.20→8、0.40→4）。実機の較正は調査走行（Deferred）
  - 方向 = ボックス中心 x が 0.5 未満なら `L`、0.5 以上なら `R`
  - 高さ 0 以下・NaN の検出は距離を計算できない → その検出は鹿として使わない（推論側で弾かれている想定。二重に守る）
- R3: フラグ（`AlertFlag`、`@antler/schema` の形）
  - ON: `deer: true`・`conf`・`distanceM`・`side`・`zone: "outside"`・`t_frame`（最新の鹿ありフレーム）・`t_sent`（送る瞬間）・`type: "flag"`・`v: 1`・`frameJpegB64: null`
  - OFF: `deer: false`・`zone: "outside"`・`t_frame`（OFF を決めたフレーム）・`t_sent`。`conf`・`distanceM`・`side` は付けない
  - `zone` は常に `"outside"` で `zoneDistanceKm` は付けない（edge は GPS を持たない。ゾーンの判定は PWA が GPS で行う。B4-5。推奨で決定）
  - `side` は ON 時の方向（切り替えは R1 の 2 フレーム規則）
  - 時刻は JST（+09:00）・ミリ秒。作ったフラグは `packages/schema` の JSON Schema で検証して通ること（ON・OFF・ハートビートとも）
- R4: 配信の規則（`AlertHub`）
  - 変化（ON↔OFF、`side` の変化）は判定したその場で全クライアントへ。ON 中の距離の更新と変化なしはハートビート（1 秒ごと）で運ぶ（B3-2）
  - ハートビートは現在の判定（ON 中は最新の鹿ありフレームの距離と `t_frame`）を、`t_sent` だけ新しくして送る
  - **見えていない間はハートビートを止める**: 推論が成功したフレームが 3 秒（`stall_after_s`）来ていない（カメラ停止・パイプライン固着・推論が失敗し続けている）あいだ、ハートビートを送らない。PWA は 3 秒受信が無いと「未接続」帯を出すので、「見えていないのに緑」を作らない（edge-camera の Deferred「検知停止の通知」をここで受ける。推奨で決定）。ON だった鹿は 1.5 秒で OFF のフラグを 1 回送ってから黙る。成功したフレームが戻れば再開する
  - 判定がまだ一度も無いあいだは何も送らない（作り話の「鹿なし」を送らない）
  - 新しくつないだクライアントには、直近の判定を 1 回すぐに送る（あれば）。ただし、先に `expire` を回し、見えていない（成功フレームが 3 秒来ていない）ときは送らない（停止中の再接続で「鹿なし」も古い「鹿あり」も配らない。code-reviewer C1）
  - 推論の出力が全部不正で捨てられたフレーム（`invalid_count > 0` で鹿 0 件）は、失敗と同じく「見えていない」に数える（ハートビートを支えない。code-reviewer C2）
  - フレームが来なくなって（入力が止まって）いても、ON の鹿は `expire(now)` で、最後に見た時刻から 1.5 秒後に OFF にする。`now` は **単調時計**（壁時計が跳んでも ON を早く解かない・遅らせない。注入できる）。`update` 側の 1.5 秒は `t_frame` の差で測り、`t_frame` が戻った（負の経過）ときは 0 として扱う
  - Judge と Hub はイベントループの上だけで触る（`pump` が結果をスレッドから渡す）。OFF にしたあとに遅れて届いた鹿ありフレームも受け入れる（見逃しを避ける。2 フレーム連続の規則からやり直し）
- R5: WebSocket サーバー
  - 待ち受けは `ws://<host>:8765/alerts`（host・port・最大接続数は設定。既定は host `127.0.0.1`・port 8765・16 接続。開いた側に倒さない。車載では設定ファイルで AP の LAN のアドレス（`0.0.0.0` 可）にする。推奨で決定）
  - `/alerts` 以外のパス → 404。接続数が上限 → 503
  - サーバー → クライアントは AlertFlag の JSON だけ（1 メッセージ 1 フラグのテキスト）
  - クライアント → サーバーは 64 KB まで（超えたら切る）。受け取るのは `ack` と `label` だけ（`@antler/schema` の ClientMessage）。それ以外・壊れた JSON → 無視して `client.ignored`（型名だけ。本文は残さない）
  - 遅いクライアントや切れかけたクライアントが、ほかのクライアントへの配信と判定を止めない（配信は待たない）
  - 死んだ接続は ping（1.5 秒おき、応答 2.5 秒、閉じる待ち 1 秒）で 5 秒以内に外す。ハンドシェイクは 3 秒で打ち切る。PWA は 3 秒受信が無いと自分で閉じて再接続するため、閉じ損ねた接続が枠（16）を占め続けないようにする
  - 1 接続あたり、1 秒に 5 通を超える受信は読み捨てる（`client.throttled` を 1 秒に 1 回まで）。ログや計測を ack の連打で汚されない。Origin は検査しない（Deferred）
  - クライアントが切れたら `client.disconnected`（接続数つき）。サーバーを止めると全接続を閉じる
- R6: ack と遅延の計測（ch6 B 遅延）
  - `ack`（`t_shown`）を受けたら `ack` を info で 1 行: `t_shown`・`t_frame`・`since_frame_ms`（`t_shown − t_frame`）。`t_frame` は「最後に送った `deer:true` の最初のフラグの `t_frame`」（ON にした 2 枚目のフレーム。pwa-connect R4 の決定と同じ。OFF になっていても残す。まだ ON が無ければ `null` で `since_frame_ms` も `null`）。`t_shown` がタイムゾーン無し・読めない → `ack.invalid`（本文は残さない）
  - フラグを送るたびに `flag.sent` を info: `t_frame`・`t_sent`・`deer`・`reason`（`change` / `heartbeat` / `snapshot`）・`clients`（送った先の数）。edge-latency-reviewer が読む
  - 端末間の時計のずれは補正しない（Deferred。edge-camera と同じ）
- R7: 実行（`pump`）
  - パイプライン（同期の生成器）を別スレッドで進め、結果を Judge に渡す。重い推論がイベントループ（配信・ping）を止めない
  - 入力が尽きたら、鹿を ON のままにせず `expire` に任せる（時計が進めば OFF）。入力の例外は上へ出す
  - ハートビートのタスクは 1 秒ごと。停止時にタスクもサーバーも片付ける
- R8: 設定
  - `[judge]` `threshold`（既定 0.8。edge-l0 で 0.4 から変更、0〜1）・`off_after_s`（既定 1.5、0.5〜10）・`stall_after_s`（既定 3.0、1〜10）・`distance_table`（`[[高さ, m], ...]`）
  - `[server]` `host`・`port`（既定 8765、1〜65535）・`max_clients`（既定 16、1〜64）
  - 不正（型・範囲・表が 2 点未満・高さが増えているのに距離が増える）→ `ConfigError`、メッセージにキー名。既存の edge-camera の設定の規則を踏襲する

Questions は全問、推奨で決定（ユーザー指示。2026-11-03）。決定の根拠は括弧内。保留は下の Deferred。

## ユースケース

### UC-1: 判定（R1）

- **Given**: 通ったフレームごとの `FrameResult`
- **When**: `Judge.update` に順に渡す
- **Then**: 2 連続で ON、1.5 秒で OFF、閾値ちょうど・失敗フレーム・時間の空きの扱いが R1 のとおり

### UC-2: 距離と方向（R2）

- **Given**: 検出のボックス
- **When**: 距離表で補間する
- **Then**: 整数 m と L/R が R2 のとおり

### UC-3: フラグの組み立て（R3）

- **Given**: 判定の状態
- **When**: `build_flag` を呼ぶ
- **Then**: ON・OFF とも JSON Schema を通る形

### UC-4: ハブ（R4）

- **Given**: 配信先（偽）と判定
- **When**: 結果・時間・新しいクライアントが入る
- **Then**: 変化は即時、そのほかは 1 秒ごと、新しい接続は 1 回すぐ

### UC-5: サーバー（R5）

- **Given**: 本物の WebSocket サーバー（ローカル、ポート自動）
- **When**: クライアントがつなぐ・送る・切れる
- **Then**: パス・上限・サイズ・配信が R5 のとおり

### UC-6: ack と計測（R6）

- **Given**: ack を送るクライアント
- **When**: サーバーが受ける
- **Then**: `ack` と `flag.sent` が `t_frame` つきで残る

### UC-7: 実行（R7）

- **Given**: edge-camera のパイプライン（偽の入力と推論）
- **When**: `pump` で回す
- **Then**: 鹿の区間で ON のフラグが届き、区間が終わると OFF になる

### UC-8: 設定（R8）

- **Given**: TOML
- **When**: `load_config`
- **Then**: 既定・指定・不正が R8 のとおり

## 状態パターン

### S-1: 鹿なし（起動直後）

- **Given**: 判定がまだ無い → **Then**: 何も送らない。つないだクライアントにも送らない

### S-2: 鹿あり（ON）

- **Given**: 2 連続で閾値以上 → **Then**: 即時に ON のフラグ。1 秒ごとにハートビート（距離は最新）

### S-3: 解除

- **Given**: 鹿を最後に見てから 1.5 秒 → **Then**: 即時に OFF のフラグ

### S-4: 入力が止まった

- **Given**: ON のままフレームが来ない → **Then**: `expire` が 1.5 秒後に OFF にし、ハートビートの `t_frame` は古いまま

### S-5: クライアントが全員切れた

- **Given**: 接続 0 → **Then**: 判定は続き、ログに残る。再接続したら直近の判定が 1 回届く

## Questions（Deferred のみ残存可）

- [Deferred: 担当=人 B / 期日=2026-11-06（Day 4 の調査走行）/ 暫定挙動=距離表は計算上の暫定値（高さ 0.03→55 m ほか）。実車の画角で測り直す] 距離表の較正
- [Deferred: 担当=人 B（edge-l1）/ 期日=2026-11-05（Day 3）/ 暫定挙動=閾値 0.8 以上（edge-l0 で 0.4 から変更）は L1 を待たず 2 フレームの規則で ON にする（edge-l0 の L0 即時ルール）。L1 による降格（校正後 0.9 以上のときだけ）は未実装で、取り消しはしない。旧 B2-3 の VLM 二次確認は削除（L2・任意）] B2-3 の L1 との合流
- [Deferred: 担当=人 B / 期日=2026-11-05（Day 3 の実機）/ 暫定挙動=`frameJpegB64` は常に null。JPEG の符号化と 320px の縮小は入れない（画像を持ち出さない）] B3-3 の JPEG
- [Deferred: 担当=人 B（pwa-connect 側の ack の送り元）/ 期日=2026-11-05 / 暫定挙動=`since_frame_ms` は Mac とスマホの壁時計の差をそのまま含む。補正しない] 端末間の時計のずれ
- [Deferred: 担当=ユーザー（Wi-Fi AP の feature）/ 期日=2026-11-06 / 暫定挙動=既定は `127.0.0.1`。車載では設定の host で AP 側にする。Origin は検査しない（WPA2 の AP に入れた端末は信頼）] 待ち受けの範囲・Origin の検査・`ezoroad.local` の名前解決
- [Deferred: 担当=人 B / 期日=2026-11-05（Day 3 の実機）/ 暫定挙動=判定の遅延は ON フラグの `t_frame`（2 枚目のフレーム）から測るため、1 枚目を待つ時間（5 fps で約 100 ms）が `flag.sent` に出ない。10 fps 前提では 250 ms 内] 判定区間の測り方（1 枚目の時刻のログ）と停止・復帰の記録（`judge.recovered`）
- [Deferred: 担当=人 B（AP・自動起動の feature）/ 期日=2026-11-06 / 暫定挙動=server・hub・pump を組み立てる起動の入口（CLI）とログのファイル出力は無い。テストの中で組み立てている] 起動の入口
- [Deferred: 担当=人 B（pwa-drive。`apps/pwa/` は別セッション）/ 期日=2026-11-05 / 暫定挙動=edge は凍結済みの schema に従い `zone:"outside"` を常に送る。`deriveAlertState` は GPS が unknown のとき `zone:"outside"` を信じて緑にするため、pwa-drive が GPS を渡すまでは、鹿ゾーン内でも edge 経由では緑になり得る（赤は影響しない）。pwa-drive で GPS の判定を必ず渡す、または edge の zone を無視する] edge の `zone` と PWA の緑の関係

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: 偽の入力・偽の推論（鹿が 6 フレーム写る）で `pump` を回し、本物の WebSocket クライアントが ON のフラグ（距離・L/R つき、JSON Schema に通る）を受け、鹿が消えて 1.5 秒後に OFF を受け、`ack` を返すと `ack` と `flag.sent` が `t_frame` つきでログに残る
- [x] AC-2: ON のまま入力が止まっても、1.5 秒後に OFF のフラグが届き、ハートビートの `t_frame` は古いまま

UC-1 判定:

- [x] UC-1a: 閾値以上の鹿が 2 フレーム連続で ON。1 フレームだけでは ON にならない
- [x] UC-1b: 間に鹿なしが挟まると数え直す。閾値 0.8 ちょうどは鹿あり、0.79 は鹿なし（edge-l0 で 0.4 から変更）
- [x] UC-1c: 2 枚の間隔が 1.0 秒を超えると連続と数えない
- [x] UC-1d: 最後に見てから 1.5 秒ちょうどで OFF、1.499 秒では ON のまま
- [x] UC-1e: ON 中に鹿を見るたびに最後に見た時刻が更新され、1 枚欠けても ON のまま
- [x] UC-1f: `failed` のフレームは連続を切らず、鹿ありにも数えない。失敗が 1.5 秒続けば OFF
- [x] UC-1g: 鹿が複数のとき、最大の高さの検出で距離・方向・`conf` が決まる
- [x] UC-1h: ON 中は最新の鹿を見たフレームの距離に更新される。OFF のときは持たない
- [x] UC-1i: [ADDED adversary] 方向は、新しい方向が 2 フレーム連続で続いたときだけ変わる。L,R,L,R と揺れても変わらない
- [x] UC-1j: [ADDED adversary] 確信度 0.95 の鹿でも 1 フレームだけでは ON にならない
- [x] UC-1k: [ADDED adversary] `t_frame` が戻った（負の経過）フレームで ON を解かない

UC-2 距離と方向:

- [x] UC-2a: 表の点ちょうど・点の間（線形補間、整数に丸め）の距離
- [x] UC-2b: 表の外（高さ 0.01 と 0.9）は端の値で止まる
- [x] UC-2c: 中心 x 0.49 → L、0.5 → R、0.51 → R
- [x] UC-2d: 高さ 0・負・NaN の検出は鹿として使わない

UC-3 フラグ:

- [x] UC-3a: ON のフラグが必要な項目を持ち、`frameJpegB64` は null、`zone` は outside で `zoneDistanceKm` が無い
- [x] UC-3b: OFF のフラグに `conf`・`distanceM`・`side` が無い
- [x] UC-3c: ON・OFF・ハートビートのフラグが JSON Schema（packages/schema/json/alert-flag.schema.json）を通る
- [x] UC-3d: `t_frame` と `t_sent` が +09:00 のミリ秒形式

UC-4 ハブ:

- [x] UC-4a: 判定がまだ無いあいだは何も送らず、つないだクライアントにも送らない
- [x] UC-4b: ON になった瞬間と OFF の瞬間、`side` の変化に即時で送る（`reason=change`）
- [x] UC-4c: 変化なしは 1 秒ごと（`heartbeat`）。距離の更新はハートビートで運ぶ。`t_frame` はそのまま `t_sent` が新しくなる
- [x] UC-4d: 新しくつないだクライアントに直近の判定を 1 回送る（`snapshot`）
- [x] UC-4e: `expire(now)` が最後に見てから 1.5 秒後に OFF を送る（now は単調時計）
- [x] UC-4f: [ADDED adversary] 成功したフレームが 3 秒来ていない間はハートビートを送らない（OFF を 1 回送ってから黙る）。成功したフレームが戻れば再開する。失敗が続く場合も同じ
- [x] UC-4h: [ADDED code-reviewer] 停止中の新しい接続に snapshot を配らない。古い ON は snapshot の前に expire する
- [x] UC-4i: [ADDED code-reviewer] 全部不正で捨てた出力は見えていない扱いで、ハートビートを止め snapshot も配らない
- [x] UC-4g: [ADDED adversary] ハートビートの `t_frame` は状態の `t_frame`（ON 中は最新の鹿ありフレーム）で、`t_sent` だけ新しい

UC-5 サーバー:

- [x] UC-5a: `/alerts` につながり、`/other` は 404
- [x] UC-5b: 接続数が上限を超えると 503
- [x] UC-5c: 64 KB を超えるクライアントのメッセージで切られる。切られてもほかのクライアントは配信を受け続ける
- [x] UC-5d: ack と label 以外・壊れた JSON は無視（`client.ignored`、本文は残さない）。サーバーは落ちない
- [x] UC-5e: 全クライアントに同じフラグが届く。1 つのクライアントが読まなくても、ほかへの配信が遅れない
- [x] UC-5f: クライアントが切れたら `client.disconnected`。サーバーを止めると全接続が閉じる
- [x] UC-5g: 死んだ接続を ping で外す（ping 間隔を短くしたテスト）
- [x] UC-5h: [ADDED adversary] 既定の host は 127.0.0.1。ping は 1.5 秒おき・応答 2.5 秒・閉じる待ち 1 秒、ハンドシェイクは 3 秒の設定になっている
- [x] UC-5i: [ADDED adversary] 1 秒に 5 通を超える受信は読み捨て、`client.throttled` は 1 秒に 1 回まで

UC-6 ack と計測:

- [x] UC-6a: `ack` のログに `t_shown`・`t_frame`・`since_frame_ms`。`t_frame` は最後に送った `deer:true` の最初のフラグの `t_frame`（OFF になっていても同じ）。ON が無ければ null
- [x] UC-6b: `t_shown` がタイムゾーン無し・文字列でない → `ack.invalid`、本文は残さない
- [x] UC-6c: `flag.sent` に `t_frame`・`t_sent`・`deer`・`reason`・`clients`
- [x] UC-6e: [ADDED code-reviewer] 深くネストした JSON と年 9999 の ack で接続が落ちない
- [x] UC-6d: ログの全行に画像・画素・位置情報・クライアントの本文が無い

UC-7 実行:

- [x] UC-7a: `pump` が別スレッドでパイプラインを進め、推論が遅くてもハートビートが 1 秒ごとに出る
- [x] UC-7c: [ADDED code-reviewer] ticker が例外で死なず、終了時にパイプラインの生成器を閉じる
- [x] UC-7b: 入力が尽きたあと `expire` で OFF になる。入力の例外は上へ出て、サーバーとタスクが片付く

UC-8 設定:

- [x] UC-8a: 空の TOML で既定値（threshold 0.8（edge-l0 で 0.4 から変更）・off 1.5・stall 3.0・host 127.0.0.1・port 8765・16）
- [x] UC-8b: 指定した値が読める（距離表を含む）
- [x] UC-8c: 範囲外・型違い・表が 1 点・高さが増えて距離も増える・知らないキー → `ConfigError`（キー名つき）

状態パターン:

- [x] S-1: 起動直後は何も送らない（UC-4a と同じテストで確かめる）
- [x] S-2: 鹿あり中のハートビート（UC-4c と同じテストで確かめる）
- [x] S-3: 解除（UC-1d と UC-4b と同じテストで確かめる）
- [x] S-4: 入力が止まった（AC-2 と同じテストで確かめる）
- [x] S-5: クライアントが 0 でも判定は続き、再接続で snapshot（UC-4d と同じテストで確かめる）

認可（threat.md）:

- [x] AUTH-1: `/alerts` 以外のパスは 404
- [x] AUTH-2: クライアントが flag の形（サーバー → クライアントの型）を送っても無視され、判定に影響しない
- [x] AUTH-3: 接続数の上限を超えた接続は 503 で、既存の接続に影響しない
- [x] AUTH-4: 64 KB 超のメッセージを送った接続だけが切られる
- [x] AUTH-6: どんなクライアントのメッセージ（ack・label・設定のような文字列）を送っても、閾値・距離表・ホストは変わらない
- [x] AUTH-7: クライアントからのどんな要求（ログや内部状態を問う文字列）にも、ログや内部状態を返さない。返すのは AlertFlag だけ
- [x] AUTH-5: 配信するフラグに画像・位置情報・端末識別子が無い（`frameJpegB64` は null、lat/lng/deviceId の項目なし）
- [x] MASS-1: 余分なフィールドのある ack・label も、必要な項目だけを読んで受ける（余分は捨てる。落ちない）

障害耐性（resilience.md）:

- [x] FAIL-1: クライアントへの送信が詰まっても判定と他クライアントへの配信は進む
- [x] FAIL-2: クライアントが送信中に切れても例外でサーバーが落ちない
- [x] FAIL-3: 入力（パイプライン）が例外で止まっても、サーバーとハートビートが片付く
- [x] FAIL-4: ポートが使用中ならサーバーは起動時に分かる例外（`ServerError`）を出し、半端に残らない
- [x] FAIL-5: `t_frame` が後ろへ戻っても ON を早く解かない。`expire` は単調時計なので壁時計の跳びに影響されない
- [x] FAIL-6: `ack` の `t_shown` が未来でも落ちず、`since_frame_ms` が負でもログに出る
- [x] IDEM-1: 同じ判定でハートビートを何度呼んでも、変化の `reason=change` は 1 回だけ
- [x] IDEM-2: サーバーの stop を 2 回呼んでも例外にならない
- [x] CONC-1: 判定の更新とハートビートが同時に走っても、フラグの JSON が壊れず、ON→OFF の順序が逆転しない
- [x] CONC-2: 接続・切断・配信を同時に繰り返しても、配信先の集合の反復で例外が出ない

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule           | 語彙                          | 置き場所                             | 証明 |
| -------------- | ----------------------------- | ------------------------------------ | ---- |
| R1: 判定       | Judge / JudgeState            | edge/detector/src/detector/judge.py  | UC-1 |
| R2: 距離と方向 | estimate_distance_m / side_of | edge/detector/src/detector/judge.py  | UC-2 |
| R3: フラグ     | build_flag                    | edge/detector/src/detector/flag.py   | UC-3 |
| R4: 配信の規則 | AlertHub                      | edge/detector/src/detector/hub.py    | UC-4 |
| R5: サーバー   | AlertServer / ServerError     | edge/detector/src/detector/server.py | UC-5 |
| R6: ack と計測 | AlertHub.on_client_message    | edge/detector/src/detector/hub.py    | UC-6 |
| R7: 実行       | pump                          | edge/detector/src/detector/runner.py | UC-7 |
| R8: 設定       | JudgeConfig / ServerConfig    | edge/detector/src/detector/config.py | UC-8 |

## 非機能要件

- [ ] 遅延: 判定（2 フレーム）≤ 250 ms（10 fps で 100 ms の間隔）、通信 ≤ 50 ms を `flag.sent` の `t_frame` / `t_sent` で測れる。判定とフラグ組み立ては 1 回 1 ms 未満（同期・割り当て最小）
- [ ] 可用性: 切れたクライアントがいても配信と判定が進む。死んだ接続は 5 秒以内に外れる
- [ ] セキュリティ: パス・接続数・メッセージサイズに上限。クライアントの本文をログに出さない。画像は作らない
- [ ] ruff（T20・BLE・ANN・S など）と pytest のカバレッジ 70% 以上

## 受け入れ基準

- [ ] 受け入れテスト AC-1・AC-2 が Green
- [ ] 全 UC / 全状態パターン / AUTH / FAIL / IDEM / CONC のテストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（ruff check・ruff format）
- [ ] edge-latency-reviewer が Critical 0
