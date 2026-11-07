---
feature: pwa-https
target_paths:
  - apps/pwa/csp.ts
  - apps/pwa/vite.config.ts
  - apps/pwa/src/shared/lib/edge-hosts.ts
  - apps/pwa/src/features/connect/lib/edge-url.ts
  - apps/pwa/src/features/capture/lib/capture-url.ts
  - apps/pwa/scripts/fake-edge.mjs
  - edge/detector/src/detector/tls.py
  - edge/detector/src/detector/pwa_server.py
  - edge/detector/scripts/make_tls.py
  - edge/detector/src/detector/app.py
spec_confirmed_at: 9b54027
tier: 2
---

# 仕様: pwa-https（スマホの PWA を車内で HTTPS として開く）

> 2026-11-08 rebrand-shikashi（`docs/specs/rebrand-shikashi/functional.md`）: サービス名を SHIKASHI に変えた（A は SHIKASHI SIMULATOR、B は SHIKASHI NAVIGATOR）。この仕様の対象では、設定ページの title・見出し・開くボタンの名前を SHIKASHI NAVIGATOR にした。プロファイルの手順の「EZO ROAD」は CA の名前（subject は替えていない）なので残し、「証明書の名前」と添えた。文中の「EZO ROAD」は旧名。この仕様の規則は変えていない。

## 概要

いまの PWA は Mac mini から http で配る前提で、http は安全なコンテキストではないため、Geolocation（鹿ゾーンの判定・速度）・Wake Lock・Service Worker が使えない（pwa-connect と pwa-drive の最優先の Deferred）。
この feature で、**車ごとのローカル認証局（CA）** を Mac mini で作り、PWA・WebSocket・Capture の HTTP をすべて https / wss で配る。スマホは CA を 1 度だけ信頼に入れる。
要件: ch4 B3-1（AP・QR・インターネット不要）・B4-5（GPS）・B4-6（画面を消さない）、ch6「セキュリティ」（WebSocket は LAN 内のみ）、付録 A #9（B-0 が QR 1 回で終わる）。

### 案の比較（推奨で決定）

| 案                                                                                                   | iOS Safari                                                                                            | Android Chrome                                                                 | 車内に回線が無い                              | ユーザーの手間                                                                | 判断                                                                       |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| (a) Mac mini の車ごとの CA で https・wss・https（Capture）を配る                                     | 通る（構成プロファイルを入れ、「証明書信頼設定」で全面的に信頼）                                      | 通る（CA 証明書を端末に入れる。Chrome はユーザーの CA を信頼する）             | 動く（全部 LAN 内）                           | 1 台につき 1 回、CA を入れる（2〜3 分）。以後は Wi-Fi の QR と URL の QR だけ | **採用（推奨で決定）**                                                     |
| (b) PWA を公開の HTTPS（Vercel など）に置き、edge へ wss                                             | 初回の読み込みに回線が要る。wss の先（`ezoroad.local`）に信頼される証明書が要るので、結局 CA を入れる | 同左。さらに公開サイトから私設 IP への接続に Local Network Access の許可が出る | 初回は動かない（Service Worker を入れるまで） | CA ＋ 許可の 2 段                                                             | 不採用（外部への公開を伴い、CA も要る）                                    |
| (c) Chrome の `unsafely-treat-insecure-origin-as-secure`                                             | 無い                                                                                                  | フラグを端末ごとに手で立てる                                                   | 動く                                          | デモ端末だけ                                                                  | 不採用（iOS で使えない）                                                   |
| (c′) 持っているドメイン＋Let's Encrypt（DNS-01）＋Mac mini の DNS がそのドメインに AP の IP を答える | 通る（CA を入れない）                                                                                 | 通る                                                                           | 動く（更新のときだけ回線）                    | QR だけ                                                                       | Deferred（ドメインの有無と費用はユーザーにしか分からない。下の Questions） |

### 構成（採用した (a)）

```
スマホ（AP の Wi-Fi）
  http://<AP の IP>:8080/          設定ページ（CA の配布・信頼の確認・PWA へ移る）  ← カードの URL の QR
  https://<AP の IP>:8443/         PWA（apps/pwa/dist）                              ← 信頼のあとはここ
  wss://<同じホスト>:8765/alerts   AlertFlag（edge/detector の AlertServer）
  https://<同じホスト>:8767/       Capture の一覧・画像・同意（edge/detector の CaptureServer）
Mac mini: edge/detector/tls/ に ca.crt・ca.key・server.crt・server.key（git に入れない）
```

**範囲外**（ほかの feature / Deferred）:

- Wi-Fi AP そのものの設定と、Wi-Fi の QR（SSID・パスフレーズ）の発行 → edge の AP の feature。この feature は runbook に QR の作り方を書くだけ
- edge を 1 コマンドで起動する入口（AlertServer・CaptureServer・パイプラインをまとめて動かす）→ edge-run（並走中）。この feature は `ssl_context` を受け取れるようにし、渡し方を runbook と共有ノートに書く
- manifest・Service Worker・ホーム画面への追加 → pwa-drive の続き（https が使えるようになったので解禁。Deferred）
- api（インターネット側の `VITE_API_BASE_URL`）への送信。走行後にスマホの回線で送る（edge-capture のまま）

## Example Map

Story: レンタカーの利用者として、最初に 1 回だけ証明書を入れれば、そのあとは Wi-Fi の QR と URL の QR を読むだけで、GPS・画面を消さない・鹿の通知がそろって使えるようにしたい。

- R1: 証明書を作る（`edge/detector/scripts/make_tls.py`。依存を増やさず、OS の `openssl` を呼ぶ）
  - `python edge/detector/scripts/make_tls.py --out edge/detector/tls --ip 192.168.2.1` で、CA（`ca.key`・`ca.crt`）とサーバー証明書（`server.key`・`server.crt`）を作る。`--ip` は複数回指定できる（AP の IP。ほかに `ezoroad.local` は常に入る）
  - CA は車ごとに作る（主体名に乱数の 8 桁を入れて区別する）。RSA 2048 ビット、`basicConstraints=critical,CA:TRUE,pathlen:0`、`keyUsage=critical,keyCertSign,cRLSign`、有効期間 3650 日
  - CA に **名前の制約**（`nameConstraints=critical`）を付け、この車の名前と IP でしか使えないようにする: `DNS:ezoroad.local` と、`--ip` の各 IP（/32。openssl の書き方は `IP:a.b.c.d/255.255.255.255`）。CA の鍵が漏れても、公開のサイトや利用者の家の私設 IP の証明書は作れない（旅行者の端末に CA が残るため。spec-adversary #7）
  - サーバー証明書: RSA 2048 ビット、SAN に `DNS:ezoroad.local` と `--ip` の各 IP、`extendedKeyUsage=serverAuth`、`basicConstraints=critical,CA:FALSE`、有効期間 397 日（Apple の私設 CA の上限 825 日の内側）
  - 鍵（`ca.key`・`server.key`）は 0600、出力のディレクトリは 0700 で作る。一時ディレクトリで作り、`openssl verify` が通ってから `os.replace` で差し替える（途中で落ちても既存を変えない）
  - すでに `ca.key` と `ca.crt` があれば CA は作り直さず、サーバー証明書だけ発行し直す（期限が近い。スマホに入れ直さなくてよい）。CA を作り直すのは `--new-ca` のときだけ。CA の名前の制約に無い IP を足すと検証で失敗するので、`--new-ca` が要ると言って終了コード 2（何も変えない）
  - `ca.crt` だけがあって `ca.key` が無い（鍵を車外へ移した）ときは、鍵を戻すか `--new-ca` を、と言って終了コード 2
  - `--ip` が私設の範囲（10/8・172.16/12・192.168/16・127/8）の IPv4 でなければ、何も書かずに終了コード 2（`127.0.0.1` は開発・テストの Mac の上だけで使う）
  - 最後に、CA の SHA-256 指紋と、設定ページの URL（`http://<各 IP>:8080/`）を表示する。秘密鍵の中身は表示しない
  - `openssl` が無ければ終了コード 2 と、入れ方の 1 行を出す
- R2: TLS の設定（`[tls]`、`detector.config`）
  - キーは `cert`・`key`・`ca_cert`（設定ファイルからの相対パス）。すべて空なら TLS を使わない（いまと同じ ws / http。開発用）
  - `cert` と `key` は両方そろうか、両方空か。片方だけは ConfigError。`ca_cert` だけ書いて `cert`・`key` が空も ConfigError（書き忘れ）
  - `detector.tls.server_context(config)` が `ssl.SSLContext`（サーバー用、TLS 1.2 以上）を作る。TLS を使わない設定なら None を返し、`tls.disabled` を warn に 1 回残す（https の PWA からは届かないことを運用者に見せる。spec-adversary #1）
  - `AlertServer` と `CaptureServer` の `*.listening` のログに `tls`（真偽）を足す
  - ファイルが無い・読めない・鍵と証明書が合わないときは `TlsError`（起動を止める）。**平文に黙って戻らない**（https のつもりの PWA が wss に届かず「未接続」のまま理由が分からなくなるため）。ログには理由の種類だけ（パス・鍵の中身を出さない）
  - 鍵ファイルがグループ・他人に読める（0600 より緩い）ときは `tls.key_permissions` を warn に 1 回残す（起動は止めない。runbook で直す）
- R3: wss（`AlertServer`）と https（`CaptureServer`）
  - `AlertServer(hub, config, ssl_context=None)` に `ssl_context` を足す。渡されたら `websockets` の `serve(..., ssl=..., ssl_handshake_timeout=open_timeout)` で待ち受ける（握手は 3 秒まで。asyncio の既定の 60 秒にしない）。パス・接続数・大きさ・頻度の上限は変えない
  - `CaptureServer(api, config, ssl_context=None)` も同じ。TLS の握手は接続ごとのスレッドで、同時接続の枠（8）を取ってから行う（待ち受けのスレッドで握手しない）。握手も既存の 5 秒（受信 1 回ごと）の打ち切りに入れる。枠が無いとき、TLS の口では 503 を書けない（握手の前）ので、握手せずに閉じる。握手の失敗は `capture.tls_failed` を debug に残して閉じる（ほかの接続に影響しない）
  - `CaptureService.from_config(config)` は `tls.server_context(config)` を CaptureServer に渡す
  - Capture の Origin の検査（`Host` と同じホスト名のオリジンは許す）は https のオリジンでもそのまま効く。`allowed_origins` の既定は空のまま
- R4: PWA の配信と CA の配布（`detector.pwa_server`。別プロセス `python -m detector.pwa_server --config <path>`）
  - 設定は `[pwa_server]`: `host`（既定 `127.0.0.1`。車載では AP の LAN のアドレスか `0.0.0.0`）・`https_port`（既定 8443）・`http_port`（既定 8080）・`dist`（既定 `../../apps/pwa/dist`、設定ファイルからの相対）
  - `[tls]` の `cert`・`key`・`ca_cert` がそろわなければ起動しない（終了コード 2、理由を 1 行）。`dist/index.html` が無い・`dist` が 64 MB を超えるときも同じ
  - 起動時の自己検査（spec-adversary #3。スマホ側では「CA 未信頼」と見分けがつかない食い違いを、Mac mini の前で見つける）:
    - サーバー証明書の期限が切れている → 起動しない（終了コード 2）。30 日未満 → `pwa_server.cert_expiring` を warn
    - `host` が IP リテラル（`0.0.0.0` 以外）で、サーバー証明書の SAN に無い → 起動しない
    - SAN の各 IP について、`dist/index.html` の CSP に `wss://<IP>:8765` が無い → `pwa_server.csp_missing_host` を warn（PWA を `VITE_EDGE_HOSTS` を足してビルドし直す）
    - 証明書を Python で読めない（版の違い）ときは自己検査を飛ばして info に 1 行
  - 2026-11-06 レビューで足した（security-auditor W4・W5、code-reviewer W-1・W-2・W-4・W-5）: 応答に `X-Frame-Options: DENY`、PWA の応答はヘッダの CSP `frame-ancestors 'none'`。dist の `.key`・`.pem`・`.p12`・`.pfx` は配らない。見出しの名前は大文字小文字を問わない。標準に無いメソッド（TRACE など）も 405。途中で切れた接続のエラーは型の名前だけを debug に残す（接続元のアドレスを stderr に出さない。CaptureServer も同じ）。dist は読む前に大きさを足し、読めないファイルは終了コード 2
  - **https の口**（8443）: `dist` の中身を起動時にメモリに読み、GET と HEAD だけに答える。ほかのメソッドは 405
    - 読み込みはシンボリックリンクを辿らず、ドットで始まる名前（`.DS_Store` など）は載せない
    - パスは起動時に読んだファイルの一覧との完全一致で引く（ディスクを辿らない。`..`・`%2e%2e`・絶対パス・バックスラッシュは一致しないので 404）。クエリは無視する
    - 拡張子の無いパス（`/`・`/drive` など）で一覧に無いものは `index.html` を返す（SPA）。拡張子のあるパスで一覧に無いものは 404
    - `Content-Type` は拡張子から（`.html` `.js` `.mjs` `.css` `.json` `.geojson` `.svg` `.png` `.jpg` `.webp` `.ico` `.woff2` `.woff` `.ttf` `.mp3` `.wav` `.ogg` `.webmanifest` `.txt`）。それ以外は `application/octet-stream`
    - `index.html` は `Cache-Control: no-cache`、`/assets/` の下（ハッシュ付きの名前）は `public, max-age=31536000, immutable`、ほかは `no-cache`
    - すべての応答に `X-Content-Type-Options: nosniff`・`Referrer-Policy: no-referrer`。**HSTS は付けない**（同じホストの http の設定ページが開けなくなるため）
    - `/healthz` は 204（設定ページが「証明書が信頼されているか」を確かめる先）
  - **http の口**（8080）: 平文。答えるのは 3 つだけ
    - `GET /`: 設定ページ（HTML）。4 言語（ja・en・zh・ko）を並べる。中身: これは何か、iOS と Android の CA の入れ方、「証明書をダウンロード」（`/ezoroad-ca.crt`）、「EZO ROAD を開く」、CA の SHA-256 指紋、**返却したらプロファイル（CA）を消す手順**、「警告を押し切らずに証明書を入れる」
    - サーバーはページにホストを埋めない。https の URL はページの JS が `location.hostname` で組む（spec-adversary #8）。埋めるのはサーバーが計算した指紋だけ
    - 設定ページは開いたときに `fetch('https://<location.hostname>:8443/healthz', {mode: 'no-cors', cache: 'no-store'})` を確かめる。別オリジンなので no-cors（不透明な応答が返る＝TLS の握手が通った＝CA が信頼されている）。届けば PWA に移る。届かなければ入れ方を見せたまま、前の確認が終わってから 3 秒ごとに確かめ直す（spec-adversary #2）
    - 証明書の警告を押し切った端末（ブラウザによって通り方が違う）はサポートしない。押し切ると PWA は開いても、wss・位置が通らないことがあり、PWA の既存の案内（未接続・この接続では位置情報が使えません）に落ちる
    - `GET /ezoroad-ca.crt`: CA の証明書（PEM）。`Content-Type: application/x-x509-ca-cert`。**CA の鍵は配らない**（読み込むのは `ca_cert` だけ）
    - それ以外のパスは 404。メソッドが GET・HEAD 以外は 405
  - 両方の口で `Host` を IPv4 リテラル・`localhost`・`ezoroad.local` に限る（ポートは問わない。ほかは 421。DNS rebinding。IPv6 は受けない）
  - 同時 16 接続。枠は接続を受けたときにスレッドを作る前に数え、溢れたら握手もせずに閉じる（スレッドが増えない）。握手とリクエストの受信は 1 回ごとに 5 秒で打ち切り、接続は保たない（HTTP/1.0）
  - アクセスのログは残さない（`log_message` を黙らせる）。起動・停止・失敗の種類だけ `detector.pwa_server` に残す
- R5: PWA の接続先（`apps/pwa`）
  - 本番ビルドの接続先のホストは、**ページのホスト名**（`location.hostname`）が許可の一覧にあればそれ、なければ一覧の先頭。スキームはページが `https:` なら `wss:` / `https:`、それ以外は `ws:` / `http:`
  - 許可の一覧はビルドの環境変数 `VITE_EDGE_HOSTS`（カンマ区切り、既定 `ezoroad.local`）。各項目はホスト名（英数字・`.`・`-`、253 文字まで）か IPv4 の形だけを受け、ほかは捨てる。最大 8 件。全部捨てられたら `ezoroad.local`
  - WebSocket は `<スキーム>//<ホスト>:8765/alerts`、Capture は `<スキーム>//<ホスト>:8767`
  - 開発ビルドの `?edge=host[:port]` はいまのまま（host の形の検査も同じ）。スキームだけページに合わせる（開発サーバーは http なので ws のまま）
  - 本番の CSP（`csp.ts`）の `connect-src` は、許可の一覧の各ホストについて `wss://h:8765`・`ws://h:8765`・`https://h:8767`・`http://h:8767`（ほかに `'self'` と api）。`img-src` は `https://h:8767`・`http://h:8767`。一覧はビルドのときに決まる（ページを開いたあとに増えない）
  - ws / http の項目を残すのは、http で開いた場合（`vite preview` や証明書の用意の前）に今と同じに動かすため。https のページから ws / http へはブラウザの混在コンテンツの規則が止める
- R6: 開発用の偽 edge（`apps/pwa/scripts/fake-edge.mjs`）
  - `--tls-cert <path> --tls-key <path>` を足す。両方あれば https / wss で待ち受ける（Node の `https` 標準モジュール。依存を増やさない）。片方だけはエラーで終了
  - シナリオ・パス・上限・ack の出力は変えない
- R7: runbook（`docs/runbooks/2026-11-06-pwa-https.md`）と実機の確かめ
  - Mac mini: AP の IP の確かめ方（`ifconfig bridge100` など。既定を決め打ちしない）、`make_tls.py`、`[tls]`・`[pwa_server]` の書き方、`VITE_EDGE_HOSTS=ezoroad.local,<IP> npm run build -w apps/pwa`、`python -m detector.pwa_server`、カード（Wi-Fi の QR と `http://<IP>:8080/` の QR）の作り方（`qrencode`。任意）
  - iOS: 設定ページ →「証明書をダウンロード」→ 設定 → 一般 → VPN とデバイス管理でプロファイルを入れる → **設定 → 一般 → 情報 → 証明書信頼設定で全面的に信頼をオン**（2 段目を忘れやすい）
  - Android: 設定 → セキュリティ → 暗号化と認証情報 → 証明書をインストール → CA 証明書（画面ロックが要る端末がある）
  - 確かめる: `isSecureContext`、位置の許可が出る、B-0 が「つながっている」、Wake Lock、wss の ack が edge に届く
  - 罠: キャプティブポータルの判定（Mac mini が `captive.apple.com` に答えると iOS が専用の小窓を開き、そこでは位置が使えない。Mac mini に DNS の何でも応答をさせない）、Android の `.local` は引けないことがある（カードの URL は IP にする）、サーバー証明書の期限（397 日。`make_tls.py` を打ち直せば CA はそのまま）、Mac mini の時計（発行は回線のある場所で時計を合わせてから）、AP の IP を変えたら「`--new-ca` で発行・PWA のビルド・pwa_server の再起動・スマホの CA の入れ直し」の 4 つ
  - 鍵の扱い: 発行のあと `ca.key` を車外（運用者の PC など）へ移し、再発行のときだけ戻す。車を手放すときは `tls/` を消す。返却した利用者にはプロファイルの削除を案内する（設定ページにも書く）
  - iOS Simulator で CA を入れ（`xcrun simctl keychain booted add-root-cert`。プロファイル →「全面的に信頼」の画面は通らない）、https の PWA と wss の偽 edge に実際につないで確かめた結果を runbook に残す

## ユースケース

### UC-1: 証明書を作る（R1）

- **Given**: `openssl` がある Mac mini
- **When**: `make_tls.py --out <dir> --ip 192.168.2.1` を打つ
- **Then**: 名前の制約つきの CA と、SAN・EKU・期間が合ったサーバー証明書ができ、鍵は 0600。2 回目は CA を作り直さない

### UC-2: TLS の設定を読む（R2）

- **Given**: `[tls]` の書き方（空・両方・片方・壊れたファイル）
- **When**: 設定を読み、`server_context` を呼ぶ
- **Then**: 空なら None、そろえば SSLContext、片方だけ・壊れていればエラー（平文に戻らない）

### UC-3: wss と https で待ち受ける（R3）

- **Given**: `ssl_context` を渡した AlertServer / CaptureServer
- **When**: CA を信頼したクライアントがつなぐ
- **Then**: wss で AlertFlag が届き、https で Capture の一覧が返る。信頼していないクライアントは握手で失敗し、ほかの接続に影響しない

### UC-4: PWA と CA を配る（R4）

- **Given**: `pwa_server` が `dist` と TLS の設定で起動している
- **When**: https の口と http の口にリクエストが来る
- **Then**: 仕様どおりのファイル・型・キャッシュの見出し・設定ページ・CA が返り、たどり・別ホスト・ほかのメソッドは止まる

### UC-5: PWA が同じホストの edge につなぐ（R5）

- **Given**: ページの URL（スキーム・ホスト名）と `VITE_EDGE_HOSTS`
- **When**: 接続先を決める
- **Then**: 一覧にあるホストならそれ、なければ先頭。https なら wss / https。CSP は一覧の各ホストを入れる

### UC-6: 偽 edge を TLS で動かす（R6）

- **Given**: `--tls-cert` と `--tls-key`
- **When**: 偽 edge を起動して wss でつなぐ
- **Then**: いまと同じフラグが届き、ack が出る

## 状態パターン

### S-1: TLS なし（開発）

- **Given**: `[tls]` が空 → **Then**: AlertServer は ws、CaptureServer は http（今と同じ）。`pwa_server` は起動しない

### S-2: TLS あり・CA を信頼した端末

- **Given**: `[tls]` がそろい、CA を信頼したスマホ → **Then**: 設定ページが PWA に移り、`isSecureContext` が真で、GPS・Wake Lock・wss が使える

### S-3: TLS あり・CA を信頼していない端末

- **Given**: CA を入れていないスマホ → **Then**: 設定ページは入れ方を見せたまま 3 秒ごとに確かめ直す。https を直接開くと証明書の警告（ブラウザの画面）

### S-4: TLS の設定が壊れている

- **Given**: 片方だけ・ファイルが無い・鍵が合わない → **Then**: 起動を止め、理由の種類をログに出す。平文で待ち受けない

## Questions（Deferred のみ残存可）

決着した判断（「推奨で決定」。CLAUDE.md の方針、2026-11-03）:

- 配信の方式は (a) 車ごとのローカル CA → 推奨で決定（上の比較表。回線なしで iOS・Android の両方に通るのは (a) だけ）
- ポートは https 8443・http 8080・wss 8765・https 8767（macOS で 1024 未満は管理者が要る。既存の 8765・8767 は変えない）→ 推奨で決定
- CA に名前の制約を付け、`ezoroad.local` と AP の IP（/32）だけにする → 推奨で決定（外国の利用者に根の証明書を入れてもらう重さを、漏れたときの範囲で下げる。私設の範囲全体にすると利用者の家の機器も対象になる。IP を変えると CA の作り直しになるが、AP の IP は車ごとに固定）
- 設定ページは `/healthz` を no-cors で確かめ、ホストはページの JS が組む → 推奨で決定
- 証明書の警告の押し切りはサポートしない → 推奨で決定（ブラウザで通り方が違い、確かめられない）
- TLS の設定が壊れていたら平文に戻らず起動を止める → 推奨で決定
- PWA の接続先はページと同じホスト（許可の一覧の中だけ）→ 推奨で決定（Android の `.local` の Deferred が IP の URL で解ける）
- CSP は一覧の各ホストを明示する（`'self'` が別ポートの wss に当たるかはブラウザで違うので頼らない）→ 推奨で決定
- 「QR 1 回」（#9）: CA を入れる 1 回（1 台につき 1 度）は避けられない。日々は Wi-Fi の QR と URL の QR の 2 つを 1 枚のカードに並べる → 推奨で決定（正直に書く。(c′) なら CA が要らない）
- HSTS を付けない → 推奨で決定

保留:

- [Deferred: 担当=ユーザー（ドメインの有無・費用。ch9 ③ 予算）/ 期日=2026-11-08 / 暫定挙動=(a) の車ごとの CA。スマホに 1 度 CA を入れる] (c′) 持っているドメインと Let's Encrypt の証明書にすれば CA を入れる手順が消える。Mac mini が AP の DNS でそのドメインに AP の IP を答える必要があり、90 日ごとの更新に回線が要る
- [Deferred: 担当=人 B（pwa-drive の続き）/ 期日=2026-11-08 / 暫定挙動=Safari・Chrome のタブで開く。ホーム画面への追加と、オフラインのキャッシュは無い（Mac mini が常に車内にあるので読み込みは届く）] manifest と Service Worker（https になったので入れられる。古い版が残る危険があるので、更新の方式を決めてから）
- 解決済み（2026-11-07。edge-run が main に入ったので、この feature で `detector.app.serve` が `ssl_context=tls.server_context(config)` を渡すようにした。壊れた `[tls]` は StartupError で終了コード 2。UC-3i。下は元の Deferred）: [Deferred: 担当=edge-run（並走中）/ 期日=2026-11-07 / 暫定挙動=edge の入口が `ssl_context` を渡すまで、AlertServer は ws のまま（`tls.disabled` は `server_context` を呼んだときに出る。`server.listening` の `tls=false` で見分ける）。https の PWA からは「未接続」。runbook と共有ノートに、入口で `ssl_context=tls.server_context(config)` を渡す 1 行を書く] edge を 1 コマンドで起動する入口に TLS をつなぐ
- [Deferred: 担当=人 B とユーザー（実機）/ 期日=2026-11-08 / 暫定挙動=iOS Simulator（CA を keychain に直接入れる）と、Mac の上の受け入れテストで確かめた範囲だけが確か。実機の iOS（プロファイル →「全面的に信頼」）と Android（CA 証明書のインストール）で、ユーザーが入れた根の critical な名前の制約が受け入れられるかは未確認] 実機 iOS 1 台・Android 1 台で runbook の「確かめる」を通す。通らなければ名前の制約を外す案（重さが増す）をユーザーに諮る

## Test List（Canon TDD Step 1）

UC-1 証明書を作る（make_tls.py）:

- [x] UC-1a: CA とサーバー証明書ができ、サーバー証明書は CA で検証が通る（`openssl verify`）
- [x] UC-1b: CA は `CA:TRUE`・`pathlen:0`・`keyCertSign`、名前の制約（`ezoroad.local` と `--ip` の各 IP の /32 だけ。`localhost`・私設の範囲全体は入らない）が critical で付く
- [x] UC-1c: サーバー証明書の SAN に `ezoroad.local` と `--ip` の各 IP、EKU は serverAuth、`CA:FALSE`、期間は 397 日。macOS の LibreSSL と OpenSSL 3 の両方で同じ
- [x] UC-1d: 鍵は 0600、出力のディレクトリは 0700
- [x] UC-1e: 2 回目（CA あり）は CA を変えずにサーバー証明書だけ作り直す。`--new-ca` で CA も変わる。CA の制約に無い IP を足すと終了コード 2 で `--new-ca` を案内し、既存は変わらない
- [x] UC-1f: 私設でない IP・IPv4 でない値は終了コード 2 で、何も書かない。`ca.key` が無く `ca.crt` だけのときも終了コード 2
- [x] UC-1g: 出力に CA の SHA-256 指紋と設定ページの URL が出て、鍵の中身（`PRIVATE KEY`）は出ない

UC-2 TLS の設定:

- [x] UC-2a: `[tls]` が空なら `server_context` は None。既定の設定（セクションなし）も同じ
- [x] UC-2b: `cert` と `key` がそろえば SSLContext（サーバー用、TLS 1.2 以上）。パスは設定ファイルのディレクトリから
- [x] UC-2c: 片方だけは ConfigError
- [x] UC-2d: ファイルが無い・鍵と証明書が合わない → TlsError。メッセージにパスも鍵も出ない
- [x] UC-2e: 鍵ファイルが 0600 より緩いと `tls.key_permissions` の warn が出る（起動は止めない）
- [x] UC-2f: `[pwa_server]` の既定値（127.0.0.1・8443・8080・`../../apps/pwa/dist`）と、ポートの範囲・同じポートの検査
- [x] UC-2g: `ca_cert` だけ書いて `cert`・`key` が空は ConfigError
- [x] UC-2h: TLS なしで `server_context` を呼ぶと `tls.disabled` の warn が 1 回出る。`server.listening`・`capture.listening` に `tls` が出る

UC-3 wss と https:

- [x] UC-3a: `ssl_context` を渡した AlertServer に、CA を信頼したクライアントが wss でつなぎ、AlertFlag を受け取る
- [x] UC-3b: CA を信頼していないクライアントは握手で失敗し、サーバーは止まらず、次の正しいクライアントはつながる
- [x] UC-3c: `ssl_context` を渡さなければ今と同じ ws（既存のテストが通る）
- [x] UC-3d: `ssl_context` を渡した CaptureServer に https で一覧を取れる。平文で話しかけた接続は閉じられ、サーバーは止まらない
- [x] UC-3e: 握手をしないまま黙る接続は 5 秒の打ち切りで閉じ、待ち受けを止めない（ほかの接続は返る）
- [x] UC-3f: `CaptureService.from_config` が `[tls]` の SSLContext を CaptureServer に渡す
- [x] UC-3g: AlertServer は `ssl_handshake_timeout` に `open_timeout`（3 秒）を渡す。握手をしない接続は 3 秒で閉じられ、ほかのクライアントへの配信は続く
- [x] UC-3h: CaptureServer の枠（8）が埋まっているとき、TLS の口は握手せずに閉じる（平文の口は今までどおり 503）
- [x] UC-3i: edge-run（`detector.app.serve`）は `[tls]` があれば AlertServer に TLS を渡し、wss で赤が届き Capture は https。`[tls]` が壊れていれば StartupError（平文で待ち受けない）

UC-4 PWA と CA の配信（pwa_server）:

- [x] UC-4a: `/` と `/assets/x.js` が dist の中身と正しい Content-Type で返る。HEAD は本文なし
- [x] UC-4b: 拡張子の無い知らないパスは index.html、拡張子のある知らないパスは 404
- [x] UC-4c: `/../`・`%2e%2e`・`//etc/passwd`・バックスラッシュは dist の外を返さない（404 か index.html）。dist の中のシンボリックリンクとドットファイルは載らない
- [x] UC-4d: キャッシュの見出し（index は no-cache、`/assets/` は immutable）、nosniff・no-referrer があり、HSTS が無い
- [x] UC-4e: GET・HEAD 以外は 405
- [x] UC-4f: `Host` が IPv4・`localhost`・`ezoroad.local` 以外（別のドメイン・IPv6・`%` 付き・空・無い）なら 421（https と http の両方）
- [x] UC-4g: `/healthz` は 204。設定ページの確認は `mode: 'no-cors'` の fetch で、前の確認が終わってから 3 秒ごと
- [x] UC-4h: http の `/` は 4 言語の設定ページ。指紋・`/ezoroad-ca.crt`・プロファイルの削除の手順を含み、`Host` の値をページに入れない（https の URL はページの JS が `location.hostname` で組む）
- [x] UC-4i: http の `/ezoroad-ca.crt` は CA の PEM を `application/x-x509-ca-cert` で返す。CA の鍵は返さない（どのパスでも `PRIVATE KEY` が出ない）
- [x] UC-4j: http のほかのパスは 404
- [x] UC-4k: TLS の設定がそろわない・`index.html` が無い・dist が上限を超える → 起動しない（終了コード 2）
- [x] UC-4l: 同時接続の上限を超えた接続は、スレッドを作らず握手もせずに閉じる。握手をしない接続は 5 秒で閉じ、ほかの接続は返る
- [x] UC-4m: 起動時の自己検査: 期限切れの証明書は起動しない、30 日未満は `pwa_server.cert_expiring`、`host` の IP が SAN に無ければ起動しない、SAN の IP が index.html の CSP に無ければ `pwa_server.csp_missing_host`

AUTH（threat.md の ❌ の各セル）:

- [x] AUTH-1: 利用者のブラウザ相当のリクエストで dist の外を読めない（UC-4c と同じ入力を https の口で）
- [x] AUTH-2: 生のソケットで送るたどりのパス（正規化しないままの `/../../etc/passwd`）でも dist の外を返さない
- [x] AUTH-3: DNS rebinding の Host（`evil.example`）は https・http の両方で 421
- [x] AUTH-4: どのパスでも応答に `PRIVATE KEY` が出ない（https の口）
- [x] AUTH-5: 鍵のファイル名（`/ca.key`・`/server.key`・`/tls/ca.key`）を http の口で指しても 404 で、鍵が出ない
- [x] AUTH-6: https の口で PUT・POST・DELETE は 405
- [x] AUTH-7: http の口で PUT・POST・DELETE は 405
- [x] AUTH-8: 同時接続の上限と 5 秒の打ち切り（UC-4l と同じ）
- [x] AUTH-9: Host に HTML を入れたリクエストは 421 で、本文に入らない
- [x] AUTH-10: 許された Host でも、設定ページの本文に Host の値が入らない
- [x] AUTH-11: 別の CA の証明書で `ezoroad.local` を名乗る偽のサーバーには、CA を信頼したクライアントが wss でつながらない
- [x] AUTH-12: 漏れた CA の鍵で `example.com`・`8.8.8.8`・制約に無い私設 IP（`192.168.99.1`）の証明書を作っても検証で失敗する
- [x] AUTH-13: `make_tls.py` は私設でない IP を受けない（UC-1f と同じ）
- [x] AUTH-14: TLS の設定が片方だけ・壊れているとき `server_context` は TlsError / ConfigError で、平文の context を返さない
- [x] AUTH-15: pwa_server は TLS がそろわなければ起動しない（UC-4k と同じ）

FAIL（resilience.md の Failure Modes）:

- [x] FAIL-1: `cert` だけ・`key` だけは ConfigError（UC-2c）
- [x] FAIL-2: ファイルが無い・PEM が壊れている・鍵が合わない → TlsError（UC-2d）
- [x] FAIL-3: 鍵の権限が緩いと warn（UC-2e）
- [x] FAIL-4: CA を信頼していない・平文のクライアントは握手で失敗し、ほかの接続は続く（UC-3b・UC-3d）
- [x] FAIL-5: 握手をしない接続は 5 秒で閉じ、待ち受けは詰まらない（UC-3e・UC-4l）
- [x] FAIL-6: AlertServer の握手は 3 秒まで（UC-3g）
- [x] FAIL-7: pwa_server のポートが使用中なら終了コード 2（開いた方の口も閉じる）
- [x] FAIL-8: index.html が無い・上限超え・`ca_cert` が無い → 終了コード 2（UC-4k）
- [x] FAIL-9: 同時接続の上限（UC-4l）
- [x] FAIL-10: 設定ページの確認が失敗し続けても、入れ方を出したまま 3 秒ごとに確かめる（UC-4g。ページの JS の中身をテストで見る）

UC-5 PWA の接続先:

- [x] UC-5a: `https://192.168.2.1:8443` で、一覧に `192.168.2.1` があれば `wss://192.168.2.1:8765/alerts` と `https://192.168.2.1:8767`
- [x] UC-5b: ページのホストが一覧に無ければ一覧の先頭（既定 `ezoroad.local`）
- [x] UC-5c: http のページなら ws / http（今と同じ。既定は `ws://ezoroad.local:8765/alerts`）
- [x] UC-5d: `VITE_EDGE_HOSTS` の不正な項目（パス・スキーム・空・HTML・9 件目以降）は捨て、全部だめなら `ezoroad.local`
- [x] UC-5e: 開発ビルドの `?edge=` は今のまま効き、本番では無視する
- [x] UC-5f: CSP の connect-src と img-src に一覧の各ホストの wss・ws・https・http が入り、一覧に無いホストは入らない

UC-6 偽 edge の TLS:

- [x] UC-6a: `--tls-cert`・`--tls-key` で起動し、CA を信頼した Node の WebSocket で wss にフラグが届く
- [x] UC-6b: 片方だけならエラーで終わる

受け入れテスト:

- [x] AC-1: `make_tls.py` で作った証明書で、AlertServer（wss）・CaptureServer（https）・pwa_server（https と http）を同時に立て、CA を信頼したクライアントで、設定ページ → `/healthz` → PWA の index → wss の AlertFlag → Capture の一覧がすべて通る
- [x] AC-2: iOS Simulator（CA を入れたもの）の Safari で `https://127.0.0.1:<port>/` の PWA を開き、`isSecureContext` が真、B-0 が「つながっている」になる（手で確かめ、runbook に結果を残す）

## 非機能要件

- [x] セキュリティ: CA は名前の制約つき、鍵は 0600 で git に入れない（`.gitignore`）、CA の鍵は配らない、Host の検査、たどりの無い引き方、アクセスログに本文・アドレスを残さない
- [x] 遅延: 赤の経路（推論 → 判定 → 配信）に足すのは TLS の暗号化だけ（握手は接続のときだけ）。フラグ 1 通の暗号化は 1 ms 未満
- [x] 依存パッケージを増やさない（Python は標準の `ssl`・`http.server`、Node は標準の `https`、証明書は OS の `openssl`）
- [x] 4 言語: 設定ページは ja・en・zh・ko を並べる。PWA の文言は増やさない

## 受け入れ基準

- [x] 受け入れテスト AC-1 が Green、AC-2 の結果が runbook にある
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型・ruff）
- [x] security-auditor・code-reviewer・alert-contract-guard の Critical が 0（code-reviewer C-1 を直して 0。`docs/reports/2026-11-06-*-pwa-https.md`）
