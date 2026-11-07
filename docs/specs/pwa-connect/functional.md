---
feature: pwa-connect
target_paths:
  - apps/pwa/src/features/connect/
  - apps/pwa/src/app/
  - apps/pwa/scripts/fake-edge.mjs
spec_confirmed_at: a138fb0
tier: 1
---

# 仕様: pwa-connect（スマホ PWA が車載の検知につながり、3 状態を出す）

> 2026-11-08 rebrand-shikashi（`docs/specs/rebrand-shikashi/functional.md`）: サービス名を SHIKASHI に変えた（A は SHIKASHI SIMULATOR、B は SHIKASHI NAVIGATOR）。この仕様の対象では、接続画面の見出しをロゴ＋NAVIGATOR＋4 言語の一語（文言 `tagline` を追加）にし、文言の `title` を SHIKASHI NAVIGATOR にした。文中の「EZO ROAD」は旧名。この仕様の規則は変えていない。

> 2026-11-06 i18n（`docs/specs/i18n/functional.md`）で 描画が壊れたときのエラー画面を 4 言語を並べる形にした（先頭はブラウザの言語＝`resolveLang`、各行に `lang`）。この仕様のルールは変えていない。

## 概要

スマホの PWA が Mac Mini の WebSocket（`ws://ezoroad.local:8765/alerts`）につながり、AlertFlag を受け、`@antler/alert-ui` の `AlertState` で 3 状態を表示する。
B-0（接続・音の解除・出発）と B-1（走行中の表示）、切断時のグレーの「未接続」帯、5 秒以内の再接続、ack（`t_shown`）の返信までを作る。
実機の edge がまだ無いので、開発用の偽 edge サーバー（`apps/pwa/scripts/fake-edge.mjs`）にシナリオを再生させてつなぐ。
要件: ch4 B3-1〜B3-3・B4-1・B4-2・B4-5〜B4-7、ch5（3 状態・音・多言語・アクセシビリティ）、ch6（B 遅延・B 可用性・セキュリティ）、ch7（AlertFlag と B WebSocket）、
付録 A #9「B-0 が QR 1 回で終わる・Wi-Fi 切断で未接続」、roadmap「後の feature に持ち越す決まり」の位置の許可の案内。

**範囲外**（ほかの feature）:

- GPS × 鹿ゾーンの判定、ゾーン内の残り km、`verifyZoneHash`、`zones.geojson` の同梱 → pwa-drive（B-2・B-3）。この feature では GPS を `unknown` のまま渡す（起動直後は琥珀。alert-ui C-1）
- Wake Lock・画面の回転ロック（B4-6）、manifest と Service Worker、フォントの同梱 → pwa-drive
- Wi-Fi AP と QR（SSID・パスフレーズ）の発行、PWA の配信元（Mac Mini の静的配信）→ edge 側の feature。PWA は「QR で Wi-Fi に入り、ブラウザで開く」ところから始まる
- WebSocket サーバー本体（edge/detector）、`label`（B2-6、MAY）の送信、JPEG（B3-3）の表示（表示しない）
- 走行ログの保存・Capture のアップロードと同意の画面（走行終了後。dataset / edge-report）

## Example Map

Story: ドライバー（同乗者）として、QR で Wi-Fi に入ったあと 1 回だけ画面を押せば、鹿の検知がスマホに出て音が鳴るようにしたい。Wi-Fi が切れたら黙らず「未接続」と分かりたい。

- R1: 接続先は `ws://ezoroad.local:8765/alerts` 固定（ch7）
  - **2026-11-06 pwa-https R5 で改めた**: 本番ビルドの接続先は、ページのホスト名がビルドの環境変数 `VITE_EDGE_HOSTS`（既定 `ezoroad.local`、最大 8 件）にあればそのホスト、なければ一覧の先頭。ページが https なら `wss://`（http なら今までどおり `ws://`）。既定のビルドを http で開いたときは `ws://ezoroad.local:8765/alerts` のまま
  - 開発ビルド（`import.meta.env.DEV`）だけ、`?edge=host:port` で接続先を変えられる。本番ビルドでは無視する
  - `?edge=` の値は `host` か `host:port` の形（英数字・`.`・`-`・`:`）だけ受ける。パスや `ws://` の形・空・ポート範囲外は無視して既定に戻す
  - CSP の `connect-src` は `ws://ezoroad.local:8765` のみ（本番ビルド。vite.config.ts）。変えない
    - **2026-11-06 pwa-https R5 で改めた**: `VITE_EDGE_HOSTS` の各ホストについて `wss://h:8765`・`ws://h:8765`（と edge-capture の 8767）を並べる。一覧に無いホストは入らない（一覧はビルドのときに決まる）
  - 信頼の境界（仮定）: WPA2 の AP に入れるのは QR を渡された人だけで、AP 上の `ezoroad.local` に答えるのは Mac Mini だけ。LAN 内の悪意ある端末は想定しない。ただし受信の洪水で描画が詰まらないよう、1 秒あたり 20 件を超えた分は捨てる（`logger.warn('flag.flood')`）
- R2: 受信は `readAlertFlag`（ゆるい受信）を通し、読めたフラグと**受信した時刻**（端末の `Date.now()`）を保持する
  - `deer` が真偽値で読めれば、ほかの項目が壊れていても使う（見逃しを減らす。ch6）。`conf` で間引かない
  - 読めない JSON・`flag` でないメッセージ・`deer` が真偽値でないもの → 捨てる。直前のフラグは消さない。`logger.warn` に理由だけを残し、受け取った本文は残さない
  - 文字列でないメッセージ（バイナリ）・256 KB を超える文字列 → 捨てる（`frameJpegB64` は 320 px の JPEG で十分小さい）。大きさを理由に切断はしない
  - 一部が壊れた `deer:false`（partial）は、赤を解く根拠にしない。直前のフラグと受信時刻を変えない（生存の印にはなる）。壊れた `deer:true` は赤に上げる（見逃しを減らす向きにだけ効かせる）
  - `frameJpegB64` は表示にも保存にも使わない（B3-3）
- R3: 切断の検知と再接続（ch6「B 可用性」: 走行中に Wi-Fi が切れたら 5 秒以内に再接続）
  - 状態は `connecting`（接続を試みている）/ `open`（つながっている）/ `closed`（切れている）の 3 つ
  - エッジはフラグを少なくとも 1 秒ごとに送る（B3-2 のハートビート）。3 秒間なにも受け取らなければ、半開き（Wi-Fi が切れたのに close が来ない）とみなして閉じ、`closed` にして再接続する
  - `close` / `error` が来たら即 `closed`。1 秒後に再接続を試す（間隔は 1 秒固定。バックオフしない。車内で電波が戻った時点で 5 秒以内に再接続するため）
  - 1 回の接続の試行は 3 秒で諦めて閉じ、次の試行へ（接続待ちのまま固まらない）
  - 再接続しても、切れる前のフラグを新しいものとして扱わない（受信時刻は元のまま。`deriveAlertState` が 5 秒で古いと見なす）
  - 生きている印になるのは「`readAlertFlag` がフラグを返した受信」だけ。壊れたメッセージ・バイナリだけが届き続けても、3 秒で切れとみなす
  - 接続ごとに別の socket として扱い、message / open / close / error とタイマー（試行・半開き・再接続）は現在の socket のときだけ効く。古い socket の遅れた close で再接続が二重にならない
  - 画面が見える状態に戻ったとき（`visibilitychange`。iOS は背景で socket を止める）、つながっていなければ待たずに再接続し、`open` でも 3 秒以上受信が無ければ作り直す
  - 画面から外れたとき（アンマウント）は閉じて、再接続のタイマーも止める。StrictMode の二重マウントで接続が二重に残らない
- R4: ack（クライアント → サーバー）は `{"type":"ack","t_shown":...}` だけを自動で送る（ch7）
  - 送るのは、画面が **danger を表示し始めたとき**（danger でなかったのが danger になった描画の直後）の 1 回。danger のあいだ毎秒は送らない
  - 「始めたとき」は、B-1 の描画のあとに danger だった最初の 1 回。deer:true の最中に出発して B-1 がいきなり danger で出た場合も 1 回。B-0 のプレビューでは送らない。StrictMode の二重の effect でも 1 回（送った danger の区切りを ref で覚える）
  - ack は凍結した形のまま（フレームの ID は持たない）。edge は「最後に送った `deer:true` の最初の `t_frame`」と組にして `t_shown − t_frame` を出す（決定）
  - `t_shown` は端末の時計を JST（`+09:00`、ミリ秒つき）にしたもの（`toJst`）。送る前に `ClientMessageSchema` で検証する
  - 接続が `open` でないときは送らない（溜めない、あとで送らない。古い `t_shown` は遅延の計測を壊す）
  - `label` は送らない（B2-6、MAY。この feature の範囲外）
  - クライアントがサーバーに AlertFlag を送ることはない（`ClientMessage` の型に無い）
  - `vehicle`（速度・ゾーン・光。座標なし）は docs/specs/pwa-uplink が追加した。ack の送信・条件は変えない
- R5: 表示する状態は `deriveAlertState` に任せる（アプリ側で状態を決めない）
  - 入力: 最新のフラグと受信時刻、`gps: {status:'unknown'}`、現在時刻、前回の結果
  - 起動直後でフラグも無い → 琥珀（zone）。距離は「--」（alert-ui C-1）。緑は、フラグの `zone:'outside'` を受けたときだけ
  - フラグが `deer:true` → 赤（danger）。方向と距離 m をそのまま。受信から 5 秒を超えて次が来なければ danger を解く（切断中でも、最後の `deer:true` から 5 秒は赤のまま。危険側に倒す）
  - 切断中もゾーン表示は続ける（ch6）。最後に分かっていた inside / outside を保つ（pwa-drive で変更: GPS も使えないときは、edge のフラグが古くなる 5 秒で琥珀に倒す。docs/specs/pwa-drive R2b）
  - 時刻の進みで再計算するため、フラグが届かなくても 1 秒ごとに描画を更新する（5 秒の経過で赤が解けるように）
- R6: 「未接続」帯（#9）
  - 接続が `open` でないあいだ、画面の上端にグレーの帯「未接続」を出す。帯は 4 言語で、アクセシビリティ上は `role="status"`（スクリーンリーダーに知らせる）
  - 起動してから最初の接続が成功するまでの短い間も、`open` でないので帯は出る（「接続中」の文言に切り替えない。ユーザーには同じ「未接続」でよい）
  - 帯は色だけでなく文字で示す。赤（alert-danger）と琥珀・緑を使わない（`ink-muted` と `surface-sunken`）
  - 帯が出ても、`AlertState` の面（色・形・数値・点滅）は変えない。帯は面の上端に重ねず、面の上に並べる（面が縮んでも 3 状態の形は欠けない）
- R7: B-0 画面（B4-1）は次を縦に並べる
  - 接続状況: つながっている / 接続中 / 未接続 の文言と、色だけに頼らないアイコン（インライン SVG）
  - カメラ受信: 直近 5 秒に受け取ったフラグの 1 秒あたりの数（fps ではなく「受信/秒」。フラグはカメラのフレームごとではなくハートビート込みなので）と、直近のフラグの `t_sent − t_frame`（エッジ内の遅延。端末の時計に左右されない）の ms。何も受け取っていないあいだは「--」
  - 音量: 「音量を最大にしてください」の案内（OS のメディア音量。ch5）
  - 3 表示のプレビュー: 緑・琥珀・赤の `AlertState`（`compact`、`muted`）を並べる。操作できない。支援技術には読ませない（`aria-hidden`・`inert`。赤のプレビューが誤警報として読まれるのを防ぐ）。小さい画面・拡大で折り返し、数値が切れない高さにする（accessibility-checker）
  - 位置: 位置の許可の状態の案内（R9）
  - 「テスト音を鳴らして出発」ボタン 1 つ。これが B-0 の唯一の操作（44 px 以上）。つながっていなくても押せる（Mac Mini が無くても B-1・B-2 は動く。B4-5）
- R8: 音の解除と出発
  - ボタンを押したら `AlertSoundController.unlock()` を呼ぶ（ユーザー操作の中。ブラウザの自動再生の制限）。成功したらテスト音（チャイム）を 1 回鳴らす
  - iOS は読み上げもユーザー操作の中で 1 度 `speak` しないと、あとで黙る。ボタンの中で空の発話を 1 回流して解除する（使えなければ無視）
  - B-1 は 1 秒ごとの再計算で `canPlay` を読み直す。走行中に AudioContext が止まるなどで鳴らせなくなったら、「音が出ません」を出す
  - 音の解除が 3 秒たっても決着しなければ（AudioContext や音源の読み込みが保留）、音が出ないものとして知らせる
  - B-1 は `main`（aria-label はタイトル）。出発でボタンが消えるので、フォーカスをこの領域へ移す。「未接続」帯と「音が出ません」「位置情報なし」は、ライブリージョン（`role="status"`）を常に置いて中身を入れ替える
  - 成功しても失敗しても B-1 へ進む。音が出せない場合、B-1 の上部に「音が出ません」の小さな表示を常に出す（画面だけで警告は続く）
  - 二度押し（連打）でも unlock は 1 回、B-1 への移行も 1 回（B-1 に戻る操作は無いので、押しても何も起きない）
  - B-1 から B-0 に戻るボタンは置かない（B4-6: 走行中に押すボタンを置かない）。戻るのはページの再読み込み（そのときは音の解除からやり直し）
  - 開発中（`npm run dev`）は既定で無音の出力先を使い、解除は成功扱いにして画面の流れだけを本番と同じに進める。鳴らすのは `VITE_ALERT_SOUND=on` のときだけ。本番ビルドは常に鳴らす（2026-11-03 ユーザーの依頼。内蔵ブラウザでの確認のたびに音が聞こえるため）
  - `AlertSoundController` は `AlertSoundContext.Provider` で `AlertState` に渡す。アンマウントで `dispose`
- R9: 位置の許可の案内（roadmap の持ち越し）
  - B-0 で `navigator.permissions.query({name:'geolocation'})` の状態を読み、`granted` / `prompt` / `denied` / 判定できない（API が無い・例外）を文言で出す
  - `prompt`: 「出発を押すと位置の許可を求めます」。`denied`: 「位置の許可がありません。鹿ゾーンの判定ができないため、琥珀のままです。設定でこのサイトの位置情報を許可してください」。`granted`: 「位置情報は使えます」
  - 安全なコンテキストでない（`isSecureContext` が偽。http で開いた）か Geolocation が無いときは「この接続では位置情報が使えません」と案内する。許可の設定では直らないので、「設定で許可してください」とは書かない
  - 許可の状態の変化（`PermissionStatus.onchange`）を購読し、B-0 と B-1 の表示に反映する
  - 出発のボタンを押したとき、状態が `prompt` か判定できない（API が無い）なら、Geolocation があれば `navigator.geolocation.getCurrentPosition` を 1 回呼んで許可を求める（結果の座標は読まない・保存しない・ログに出さない。pwa-drive が `watchPosition` で使う）
  - B-1 でも、許可が `denied` のあいだは「位置情報なし」の小さな表示を常に出す（緑にならない理由を画面で示す）
- R10: 言語（B4-7、ch5 多言語）
  - 主文の言語は `navigator.languages` を `resolveLang` に通す（zh-TW → zh）。画面の固定文言は ja / en / zh / ko の辞書に置き、全キー・全言語が埋まっていることをテストで確かめる（#9 の機械検査の入口）
  - 辞書にない言語は `resolveLang` の既定（en）。端末の言語の一覧（`navigator.languages`）を渡す
- R11: 偽 edge サーバー（`apps/pwa/scripts/fake-edge.mjs`。依存パッケージを増やさず、Node の標準モジュールだけで WebSocket の最小実装を持つ）
  - `node apps/pwa/scripts/fake-edge.mjs --scenario deer --port 8765` で起動。シナリオ: `calm`（outside で次のゾーンまでの km が減る）/ `zone`（inside で残り km が減る）/ `deer`（zone → 鹿 6 秒 → 解除。方向 L→R）/ `drop`（10 秒ごとに全接続を切る）/ `silent`（5 秒後から何も送らず、接続は閉じない。半開きの再現）
  - 送るフラグは `@antler/schema` の `AlertFlag` の形（`t_frame`・`t_sent`・JST）。1 Hz のハートビートと、変化時の即時送信
  - 受け取った ack を標準出力に 1 行の JSON で出す。`t_shown − t_frame` を ms で併記する
  - `/alerts` 以外のパスは 404。受け取るクライアントのメッセージは 64 KB まで（超えたら切る）。サーバーは `127.0.0.1` と LAN のどちらに待ち受けるか `--host` で選ぶ（既定 `127.0.0.1`）
  - 実機の edge ではない。edge/detector には触れない
- R12: ログ（ch6「計測」: B はローカルログ）
  - `logger.warn` に出すのは `ws.closed`・`ws.stale`・`flag.invalid`・`flag.partial`・`flag.oversize`・`ack.skipped` とその理由だけ。受け取った本文・位置・端末の識別子は出さない。外部には送らない

## ユースケース

### UC-1: 接続して受信する（R1・R2・R12）

- **Given**: 偽 edge（または偽の WebSocket）が AlertFlag を送る
- **When**: `EdgeClient` を開始する
- **Then**: `connecting` → `open`。受け取ったフラグと受信時刻が最新として保持される。読めないものは捨てて、直前のフラグを残す

### UC-2: 切れたら 5 秒以内に再接続する（R3）

- **Given**: つながっている
- **When**: close / error が来る、または 3 秒なにも受信しない
- **Then**: `closed` になり、1 秒後に再接続を試す。サーバーが戻れば 5 秒以内に `open`。停止・アンマウントでタイマーも接続も残らない

### UC-3: danger のときだけ ack を返す（R4）

- **Given**: `open` で、表示が danger になった
- **When**: danger を表示し始めた
- **Then**: `ack`（`t_shown` が JST）を 1 回送る。danger の間は再送しない。`open` でなければ送らない

### UC-4: 表示を決める（R5・R6）

- **Given**: 最新のフラグ・受信時刻・接続状態・現在時刻
- **When**: 画面を描く（1 秒ごとに再計算）
- **Then**: `deriveAlertState` の結果を `AlertState` で出す。`open` でなければ「未接続」帯を上に出す。面は変えない

### UC-5: B-0 を表示する（R7・R10）

- **Given**: 接続状態・直近の受信（受信/秒と遅延）・位置の許可の状態
- **When**: B-0 を開く
- **Then**: 接続状況・カメラ受信・音量の案内・3 表示のプレビュー・位置の案内・「テスト音を鳴らして出発」が、端末の言語で並ぶ

### UC-6: 出発する（R8・R9）

- **Given**: B-0
- **When**: 「テスト音を鳴らして出発」を押す
- **Then**: 音を解除してテスト音を鳴らし、位置の許可を（`prompt` なら）求め、B-1 に進む。音が出せなくても進み、「音が出ません」を出す

### UC-7: 偽 edge サーバー（R11）

- **Given**: `fake-edge.mjs` をシナリオ付きで起動する
- **When**: クライアントがつなぐ
- **Then**: 仕様どおりのフラグが 1 Hz とシナリオの変化で届き、ack が標準出力に出る。`drop` では切れ、`silent` では黙る

## 状態パターン

### S-1: 接続中（起動直後）

- **Given**: まだ一度も `open` になっていない → **Then**: B-0 は「接続中」、B-1 は琥珀（距離「--」）に「未接続」帯

### S-2: つながっている・フラグが来ている

- **Given**: `open`、フラグ受信中 → **Then**: 帯なし。フラグどおりの 3 状態

### S-3: 切断中

- **Given**: `closed` → **Then**: 帯「未接続」。最後の inside / outside を保つ。最後が `deer:true` なら受信から 5 秒は赤のまま、そのあと解く

### S-4: 位置の許可なし

- **Given**: 許可が `denied` → **Then**: B-0 に案内、B-1 に「位置情報なし」の小さな表示。琥珀のまま（緑にならない）

### S-5: 音が出せない

- **Given**: `unlock()` が false → **Then**: B-1 に「音が出ません」。画面は通常どおり

## Questions（Deferred のみ残存可）

決着した判断（「推奨で決定」。CLAUDE.md の方針、2026-11-03）:

- 接続先は既定固定、`?edge=` は開発ビルドだけ → 推奨で決定
- 切れの検知 3 秒、再接続の間隔 1 秒固定 → 推奨で決定（5 秒以内を満たす最小の構成）
- 切断中の danger は `deriveAlertState` の 5 秒保持に従う → 推奨で決定
- 未接続でも出発できる、音が出せなくても出発できる → 推奨で決定（B4-5、安全側）
- B-1 から B-0 に戻るボタンを置かない → 推奨で決定（B4-6）
- Wake Lock・manifest・Service Worker は pwa-drive → 推奨で決定

保留:

- 解決済み（2026-11-06 pwa-https。案 (a) 車ごとの CA で Mac mini が https・wss・https（Capture）を配る、を推奨で決定。実機の iPhone・Android は pwa-https の Deferred。下は元の Deferred）: [Deferred: 担当=人 B（edge の feature）とユーザー / 期日=2026-11-05 / 暫定挙動=PWA は http で配り `ws://` につなぐ。http は安全なコンテキストでないため、Geolocation・Wake Lock・Service Worker が使えない（B4-5 の GPS 判定が成り立たない）。B-0 は「この接続では位置情報が使えません」と案内する。解決案: Mac Mini が自己署名の https/wss で配る（端末に証明書の信頼が要る）か、Chrome の insecure-origin 例外を使う（デモ端末のみ）] PWA の配信元の安全なコンテキスト。**pwa-drive の前提なので最優先**
- 解決済み（2026-11-06 pwa-https R5。`VITE_EDGE_HOSTS=ezoroad.local,<AP の IP>` でビルドし、ページを開いたホストにつなぐ。下は元の Deferred）: [Deferred: 担当=人 B（edge の feature） / 期日=2026-11-05 / 暫定挙動=接続先は `ws://ezoroad.local:8765/alerts` 固定。Android で mDNS が引けない場合は未接続のまま] AP の固定 IP を併記して CSP と接続先に入れるか
- [Deferred: 担当=人 B（edge-latency） / 期日=2026-11-06 / 暫定挙動=ack の `t_shown` は端末の時計をそのまま JST にして送る。端末と Mac Mini の時計のずれは補正しない] Wi-Fi AP には NTP が無いため、端末と Mac Mini の時計のずれが遅延の計測を歪める

## Test List（Canon TDD Step 1）

UC-1 接続・受信:

- [x] UC-1a: 接続すると connecting → open になり、受け取った AlertFlag と受信時刻が最新になる
- [x] UC-1b: 接続先は既定で `ws://ezoroad.local:8765/alerts`
- [x] UC-1c: 開発ビルドでは `?edge=192.168.4.1:8765` が使われる。本番ビルドでは無視する
- [x] UC-1d: `?edge=` の不正な値（パス付き・`ws://` 付き・空・ポート 0 と 70000・HTML）は無視して既定
- [x] UC-1e: 壊れた JSON・`flag` でない・`deer` が真偽値でない → 捨てて直前のフラグを残す
- [x] UC-1f: `deer:true` で他の項目が壊れていても deer は読む（partial）
- [x] UC-1g: バイナリ・256 KB 超の文字列は捨てる（切断しない）
- [x] UC-1h: ログに受け取った本文を出さない
- [x] UC-1i: [ADDED spec-adversary] partial の `deer:false` は直前のフラグと受信時刻を変えない（生存の印にはなる）。partial の `deer:true` は赤に上げる
- [x] UC-1j: [ADDED spec-adversary] 1 秒あたり 20 件を超えた分は捨てる

UC-2 再接続:

- [x] UC-2a: close が来たら closed になり、1 秒後に再接続して open に戻る
- [x] UC-2b: error も同じ
- [x] UC-2c: 3 秒なにも受信しなければ半開きとみなして閉じ、再接続する
- [x] UC-2d: 接続の試行が 3 秒で終わらなければ諦めて次の試行へ
- [x] UC-2e: サーバーが戻ってから 5 秒以内に open になる（偽の時計）
- [x] UC-2f: 停止・アンマウントで接続もタイマーも残らず、StrictMode の二重マウントで接続が 1 本
- [x] UC-2g: 再接続しても、前のフラグの受信時刻は変わらない
- [x] UC-2h: 切断中に届いた古い socket のイベントは無視する（新しい socket の状態を壊さない）

- [x] UC-2i: [ADDED spec-adversary] 壊れたメッセージ・バイナリだけが届き続けても 3 秒で切れとみなす
- [x] UC-2j: [ADDED spec-adversary] 画面が見える状態に戻ったとき、closed なら待たずに再接続、受信が 3 秒以上無い open は作り直す

UC-3 ack:

- [x] UC-3a: danger の表示を始めたとき ack が 1 回送られ、`t_shown` は JST で `ClientMessageSchema` を通る
- [x] UC-3b: danger の間は再送しない。解除してまた danger になったら 1 回送る
- [x] UC-3c: open でないときは送らず、あとから送り直さない
- [x] UC-3d: safe・zone では送らない
- [x] UC-3e: [ADDED spec-adversary] B-1 がいきなり danger で出ても 1 回。StrictMode の二重 effect でも 1 回。B-0 のプレビューでは送らない

UC-4 表示:

- [x] UC-4a: 起動直後（フラグ無し・GPS unknown）は琥珀で距離「--」
- [x] UC-4b: `zone:'outside'` のフラグで緑、距離は `zoneDistanceKm`
- [x] UC-4c: `deer:true` で赤、方向と距離 m が出る
- [x] UC-4d: 切断しても最後の inside / outside を保つ
- [x] UC-4e: 最後が `deer:true` のまま切れても、受信から 5 秒は赤、超えたら解ける（フラグが来なくても 1 秒ごとの再計算で）
- [x] UC-4f: open でないあいだ「未接続」帯（`role="status"`）が出て、open で消える。面の色・形は変わらない
- [x] UC-4g: 帯の色は alert-* を使わない（CSS 変数が `ink-muted` / `surface-sunken`）
- [x] UC-4h: 走行中の画面に操作要素（button・link・input）が無い

UC-5 B-0:

- [x] UC-5a: 接続状況が open / connecting / closed で文言とアイコンが変わる
- [x] UC-5b: 直近 5 秒の受信/秒と遅延（t_sent − t_frame）が出る。受信が無いと「--」
- [x] UC-5c: 音量の案内と、緑・琥珀・赤の 3 つのプレビューが出る（muted。AlertSoundContext の Provider の外では鳴らない）
- [x] UC-5d: 固定文言の辞書は ja / en / zh / ko の全キーが空でない（#9）
- [x] UC-5e: `navigator.languages` が `zh-TW` なら主文が zh、未知の言語は en

UC-6 出発:

- [x] UC-6a: ボタンを押すと unlock が呼ばれ、成功したらテスト音（チャイム）が鳴り、B-1 に進む
- [x] UC-6b: unlock が失敗しても B-1 に進み、「音が出ません」が出る
- [x] UC-6c: 連打しても unlock・移行は 1 回
- [x] UC-6d: 未接続でも押せる
- [x] UC-6e: 位置の許可が prompt のとき getCurrentPosition を 1 回呼ぶ。座標は読まない（ログにも出ない）。granted・denied では呼ばない
- [x] UC-6f: denied のとき B-0 に案内、B-1 に「位置情報なし」が出る。permissions API が無い・例外でも落ちず「判定できない」の案内になる
- [x] UC-6i: [ADDED spec-adversary] 安全なコンテキストでない・Geolocation が無いときは「この接続では位置情報が使えません」（許可の設定を促さない）。許可の変化（onchange）が表示に反映される。API が無くても Geolocation があれば出発で getCurrentPosition を 1 回呼ぶ
- [x] UC-6j: [ADDED spec-adversary] 出発の中で空の発話を 1 回流す（使えなくても落ちない）。走行中に canPlay が偽になったら「音が出ません」が出る
- [x] UC-6k: [ADDED alert-contract-guard] 音の解除が 3 秒たっても決着しなければ「音が出ません」が出る
- [x] UC-5f: [ADDED accessibility-checker] プレビューは aria-hidden・inert。出発のあと、フォーカスは走行画面の main に移る
- [x] UC-6g: ボタンは 44 px 以上（min-height のスタイル）で、アクセシブルな名前を持つ
- [x] UC-6h: B-1 に B-0 へ戻る操作が無い

UC-7 偽 edge:

- [x] UC-7a: calm・zone・deer のシナリオが AlertFlag の形（`readAlertFlag` が strict で通る）で届く
- [x] UC-7b: 1 Hz のハートビートと、変化時の即時送信
- [x] UC-7c: クライアントの ack を標準出力に出す
- [x] UC-7d: `/alerts` 以外は 404。64 KB 超のクライアントメッセージで切る
- [x] UC-7e: drop で全接続が切れ、silent で送信が止まる（接続は閉じない）
- [x] UC-7f: 既定は 127.0.0.1 に待ち受ける
- [x] UC-7g: [ADDED spec-adversary] ack は「最後に送った deer:true の最初の t_frame」と組にして t_shown − t_frame を出す

受け入れテスト:

- [x] AC-1: 偽 edge（deer シナリオ）に `EdgeClient` をつなぐと、calm → deer:true で danger になり ack が届き、解除で戻る（Node の WebSocket で実際につなぐ）
- [x] AC-2: ConnectFlow を描画し、B-0 → 出発 → B-1 で 3 状態が出る。偽の WebSocket を切ると「未接続」帯が出て、戻すと消える

## 非機能要件

- [x] アクセシビリティ: 文字 4.5:1（トークンのみ）、タッチターゲット 44 px、アイコンのみのものに aria-label、点滅は alert-ui の 1 Hz のみ。ステータスの変化は `role="status"`
- [x] 遅延: 受信 → 描画は同期で 50 ms 以内（setState 一発。ポーリングしない）。受信側のロジックは非同期の待ちを挟まない
- [x] セキュリティ: 接続先は固定（開発のみ上書き、形を検証）。受信はサイズ上限と型検査。ログに本文・位置を出さない。外部のサービスに送らない
- [x] 色は tokens の CSS 変数だけ。絵文字を使わない。アイコンはインライン SVG
- [x] 依存パッケージを増やさない（偽 edge も Node 標準モジュールだけ）

## 受け入れ基準

- [x] 受け入れテスト AC-1・AC-2 が Green
- [x] 全 UC / 全状態パターンのテストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型）
- [x] alert-contract-guard の Critical が 0
