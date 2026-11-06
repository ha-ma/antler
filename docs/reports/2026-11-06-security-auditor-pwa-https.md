# セキュリティ監査: pwa-https（2026-11-06）

対象: `git diff 0aa0bc1..HEAD`。コードは直していない。make_tls.py は一時ディレクトリで実際に 2 回走らせて確かめた。

## 件数

Critical 0 / Warning 5 / Info 7

## Critical（即時対応）

なし。

確かめて問題がなかった点:

- openssl の呼び方は、リスト引数で `shell` を使わない。`--ip` は `ipaddress.IPv4Address` で正規化してから設定ファイルに書くので、改行や `;` は入らない（CWE-78 なし）
- 鍵は umask 077 の一時ディレクトリで作って 0600 にし、成功したときだけ `replace` する。ls で 0600 を確認した。`.gitignore` に `edge/detector/tls/`・`*.key`・`*.pem` がある
- 鍵の混入
  - `build()` は `tls.ca_cert` に `PRIVATE KEY` が入っていたら起動を止める
  - 配るのは、起動時に読んだ dist の一覧と `ca_pem` だけ
  - ログに鍵・パス・アドレス・Host は出ない
- 平文への縮退
  - config.py で cert と key の片方だけは ConfigError
  - tls.py は壊れた設定で TlsError を上げ、平文に戻らない
  - pwa_server は TLS がそろわなければ起動しない
  - 証明書の検証を外すフラグはない
- パスのたどり
  - パスは一覧との完全一致で、ディスクを辿らない
  - `%2e%2e` はデコードしないので、一覧に当たらない
  - シンボリックリンクとドット始まりのファイルは載せない
  - 対象は `os.walk(followlinks=False)` と `is_symlink`
- 設定ページの XSS
  - 文言は固定で、指紋は escape される
  - Host を埋め込まない
  - CSP は script と style をハッシュで許し、`default-src 'none'`
  - リダイレクト先は `location.hostname` で、サーバーが 421 で許したホストだけ

## Warning（早期対応）

### W1. CA を http で配るので、指紋の確認が同じページの中で閉じている（最優先） | CWE-345・CWE-319

- 場所: `edge/detector/src/detector/pwa_server.py:271-306`（設定ページ）、`docs/runbooks/2026-11-06-pwa-https.md:102-113`
- 問題
  - CA は http（8080）で配り、確認用の指紋も同じ http のページに出している。
  - AP の中の中間者（Wi-Fi の QR とパスフレーズは車内のカードにあり、前の借り手は知っている）が証明書と指紋を差し替えても、スマホ側では見分けがつかない。
  - threat.md は「AP の WPA2 が境界」としている。しかしパスフレーズが車のカードで共有されているので、この境界は借り手どうしでは弱い。
- 影響: 差し替えた攻撃者の CA には名前制約がない。その CA を入れた端末は、全サイトの TLS を中間者で読まれうる。受け入れたリスクの表には載っていない。
- 直し方（安い順）
  1. 指紋を車内のカード（印刷物）にも載せ、設定ページには「カードの指紋と一致するか、インストール画面で確かめる」と書く。iOS の証明書の詳細と Android の証明書表示で SHA-256 を見られる。
  2. パスフレーズを借り手ごとに変えるか、AP を借り手ごとに再発行する（別 feature）。
  3. 受け入れるなら、threat.md に「CA の配布は未認証で、AP の中の攻撃者による差し替えは防げない」と明記する。

### W2. 相対パスの `--out` だと、2 回目以降（サーバー証明書の更新）が失敗する | 機能不具合、運用リスク

- 場所: `edge/detector/scripts/make_tls.py:193,201,207`
- 問題
  - openssl は `cwd=work` で走るが、既存 CA のパス `ca_paths = (out/"ca.key", out/"ca.crt")` は `--out` のままで、相対なら work から見て存在しない。
  - 再現: `--out tls` で 1 回目は成功し、2 回目は `Could not open file ... tls/ca.crt` で失敗した。
  - runbook の例は `edge/detector/tls` の相対パス。
- 影響: 更新できず、運用者が `--new-ca` で回避すると全スマホに CA を入れ直させることになる。
- 直し方: `out = out.resolve()`（または `ca_paths` を `.resolve()`）にする。相対 `--out` で 2 回走らせるテストを足す。

### W3. 名前制約の「利用者の家の私設 IP は名乗れない」は、AP の IP が一般的な値だと弱い | CWE-295

- 場所: `edge/detector/scripts/make_tls.py:34-38,69-73`、threat.md（AUTH-12）、runbook:23
- 問題
  - CA が許すのは AP の IP の /32 だけだが、macOS のインターネット共有の既定 `192.168.2.1` は、家庭用ルーターの管理画面の既定でもありうる。
  - さらに CA の有効期間が 10 年（`CA_DAYS = 3650`）。CA が漏れ、利用者が返却後に消し忘れると、同じ IP のルーターへの https を偽装できる。
- 直し方
  - 車の AP を一般的でない範囲（例: `10.73.x.1`）にして runbook の既定にする。
  - CA を短くする（例: 1〜2 年）。または運用でレンタルごとに `--new-ca` する。
  - 少なくとも threat.md に「同じ IP の機器に対しては名前制約は効かない」と書く。

### W4. PWA の https 応答にフレーム禁止の見出しがない（クリックジャッキング） | CWE-1021

- 場所: `edge/detector/src/detector/pwa_server.py:87,189-193`（`COMMON_HEADERS`）、`apps/pwa/csp.ts`
- 問題
  - PWA の CSP は `<meta>` なので `frame-ancestors` が効かない。http の設定ページだけが `frame-ancestors 'none'` を持つ。
  - CA を信頼したスマホで別サイトが PWA を iframe に入れられる。PWA には Capture の同意の操作がある。
- 直し方: `route_https` の応答に `Content-Security-Policy: frame-ancestors 'none'`（または `X-Frame-Options: DENY`）を付ける。あわせて `form-action 'none'` もよい。

### W5. dist に紛れた鍵・秘密ファイルを配らない保証が、ドット始まりを除くだけ | CWE-538

- 場所: `edge/detector/src/detector/pwa_server.py:114-138`
- 問題
  - `pwa_server.dist` は設定値で、読み込むのは「全ファイル（ドット始まり以外）」。
  - `apps/pwa/public/` や dist に `*.key`・`*.pem`・`.map` が混ざる、または dist を誤って広い場所に向けると、そのまま https で配られる。
  - `ca_cert` には `PRIVATE KEY` の検査があるが、dist にはない。
- 直し方
  - `load_dist` で `PRIVATE KEY` を含むファイルがあれば起動を止める（`ca_cert` と同じ検査）。
  - 拡張子 `.key`・`.pem`・`.env` を除く。
  - 起動時に dist が `tls_dir` の祖先を含んでいないか確かめる。

## Info

- I1. `socketserver.handle_error` は、スレッドの中で例外が出ると、標準エラーに接続元アドレスとスタックを書く。
  - 例: 接続直後に切られると `setup` の `wrap_socket` が OSError を上げる。
  - 「アクセスのログにアドレスを残さない」とずれる。
  - `_BoundedServer.handle_error` を上書きして型名だけ debug に出すとよい（`pwa_server.py:389`、`capture/http.py`）。
- I2. `_loose(key)` は鍵が 0644 でも警告だけで起動する（`tls.py:36-47`）。単一ユーザーの Mac mini なら許容できる。ただし `ca.key` が車内に残っている間は、`ca.key` も同じ確認をするとよい。
- I3. `CSP connect-src https:`（設定ページ）は、スクリプトがハッシュ固定なので実害はない。`https://*:8443` のようにはできないので現状のままでよい。PWA 側の CSP（`apps/pwa/csp.ts:37-55`）は各ホストに ws・http も並べる。
  - https ページでは混在コンテンツ規則で効かないため実害はないが、平文の接続先を CSP に出す意味はない。
  - `VITE_EDGE_HOSTS` が増えるたびに広がる。ビルドを https 専用にして削れる。
- I4. AlertServer（8765）には Origin と Host の検査がない（今回の変更ではないが、wss になって他サイトのページから届く）。読めるのは AlertFlag の状態だけで機微は低い。`websockets` の `origins=` に PWA のオリジンを入れると閉じられる。
- I5. `route_https` に渡す `dict(self.headers.items())` はキーの大文字小文字を保つ。クライアントが小文字の `host:` を送ると `headers.get("Host")` が None になり、421 になる。閉じる側に倒れるので安全だが、プロキシ経由では壊れる（`pwa_server.py:457`）。
- I6. `self_check` は `ssl._ssl._test_decode_cert`（非公開 API）に依存し、無ければ検査を飛ばす（info ログ）。Python の更新で黙って検査が無効になるので、起動時のログを見る運用か、`cryptography` なしの代替を検討する。
- I7. `parse_ips` は `127.0.0.0/8` を許すので、名前制約に 127.x の /32 を入れられる。実害はないが、車の AP の IP には要らない。

## 受け入れたリスクの妥当性

- 1 バイトずつ送り続ける接続と、AlertServer の握手の洪水は、WPA2 の中の端末だけが実行できる。16 枠と 5 秒で十分と見てよい。ただし W1 のとおり、PSK が共有されている前提では「AP の中の端末は信頼できる」とまでは言えない。DoS だけなら許容する。
- HSTS を付けない理由（同じホストの http 設定ページ）は妥当。

## 総合評価

- リスクレベル: Medium
- 推奨アクション: W1（指紋をカードに印刷して確認させる）と W2（相対 `--out` で更新が失敗する）を先に直す。W4・W5 は数行で済む。W3 は AP の IP の既定と CA の期間を変える判断をユーザーに諮る。

## 対応（2026-11-06、メインセッション）

- W1: 手順書でカードに CA の指紋を印刷し、設定ページの指紋と見比べさせる。パスフレーズを返却ごとに変える（threat.md の受け入れたリスクに記録）
- W2: 直した（`out.resolve()` と相対パスの回帰テスト。code-reviewer C-1 と同じ）
- W3: 手順書で家庭のルーターと重ならないサブネット（`10.73.x.1` など）を勧める。CA の 10 年は鍵を車外に置く前提で据え置く（threat.md に記録）
- W4: 直した（`X-Frame-Options: DENY` とヘッダの CSP `frame-ancestors 'none'`）
- W5: 直した（dist の `.key`・`.pem`・`.p12`・`.pfx` を配らない）
- Info: 次に回す
