# code-reviewer: pwa-https（2026-11-06）

対象: `git diff 0aa0bc1..HEAD` のうち edge/detector（make_tls.py・tls.py・pwa_server.py・config.py・server.py・capture/http.py・capture/service.py・tests/test_tls_*.py・test_pwa_server.py）と apps/pwa（csp.ts・vite.config.ts・fake-edge.mjs・edge-hosts.ts・edge-url.ts・capture-url.ts・services.ts）。
仕様: docs/specs/pwa-https/functional.md・resilience.md。
制約: このレビューでは Bash が使えず、コードは実行していない（静的に読んだ結果。Critical の再現は下に手順を書いた）。コードは変更していない。

件数: Critical 1 / Warning 8 / Info 12

## 良い点

- 「平文に黙って戻らない」が一貫している（config.py:416 の片方だけ検査、tls.py の TlsError、pwa_server.build の起動拒否）。例外の文とログにパス・鍵の中身を出さない作りで、test_uc_2d が `str(tmp_path)` と `PRIVATE KEY` が無いことまで確かめている。
- pwa_server は「パスを一覧との完全一致で引く」ので、たどり・シンボリックリンク・ドットファイルを検査ではなく構造で止めている。route_https / route_http を純粋な関数に切り出してあり、テストしやすい。
- 枠をスレッドを作る前に数える `_BoundedServer`（pwa_server.py:389-417）は、process_request の失敗時の release と process_request_thread の finally release が対になっていて、枠の漏れが無い。
- CA の名前の制約（make_tls.py:69-73）と、漏れた CA の鍵で制約外の証明書が検証で落ちることを確かめる AUTH-12（test_tls_make.py:204）。LibreSSL と OpenSSL 3 の両方で回す fixture 設計も良い。
- csp.ts と接続先の解決が edge-hosts.ts の `parseEdgeHosts` 1 か所を共有していて、CSP と実際の接続先がずれない。
- 偽 edge の TLS 化は、既存の挙動を変えずに `tls` オプションと `parseArgs` を足しただけで小さい。

## Critical（修正必須）

### C-1 [edge/detector/scripts/make_tls.py:164-205] `--out` が相対パスだと、CA がある 2 回目以降の発行（更新）が失敗する

- 証拠: `subprocess.run(..., cwd=self._work)`（138-147）で openssl は一時ディレクトリを cwd にして動く。一方、CA を使い回す分岐（192-193）の `ca_paths = (ca_key, ca_crt)` は `out / "ca.key"` で、`out` は `args.out` のまま（`resolve()` していない）。`--out edge/detector/tls` のような相対パスだと、201-202 の `-CA edge/detector/tls/ca.crt -CAkey edge/detector/tls/ca.key` と 207 の `verify -CAfile` が、cwd=一時ディレクトリから見た相対パスとして解決され、ファイルが見つからず MakeTlsError（終了コード 2）になる。
- さらに Python 3.11（requires-python は >=3.11、pyproject.toml:11）では `tempfile.mkdtemp(dir=相対パス)` が相対パスを返すため、`create_ca` の分岐（191）の `work / "ca.crt"` も cwd=work から二重に解決されて壊れる。つまり 3.11 では初回から失敗しうる。3.12 以降は mkdtemp が絶対パスを返すので初回は通り、2 回目だけ壊れる。
- 影響: 仕様の使用例（make_tls.py:3 の docstring、functional.md R1、runbook 32 行目 `--out tls`）はすべて相対パス。UC-1e の「期限が近いとき CA を変えずにサーバー証明書だけ発行し直す」（397 日後の運用の要）がそのまま壊れる。何も変えずに終了コード 2 になるので破壊はしないが、運用者には「openssl verify が失敗した」ように見え、`--new-ca` を促されて全スマホに CA を入れ直させる誤った道に進みやすい。
- テストが拾えなかった理由: test_tls_make.py と conftest.py のすべてが `tmp_path` 由来の絶対パスで呼んでいる。
- 直し方: `make()` の先頭（168 行目の前）で `out = out.resolve()` を 1 行足す。回帰テストを足す。

```python
def test_uc_1e_relative_out_and_second_run(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    args = ["--out", "tls", "--ip", "192.168.2.1", "--openssl", OPENSSLS[0]]
    assert mk.main(args) == 0
    ca1 = Path("tls/ca.crt").read_bytes()
    assert mk.main(args) == 0          # 2 回目（CA を使い回す）
    assert Path("tls/ca.crt").read_bytes() == ca1
```

## Warning（推奨）

### W-1 [pwa_server.py:457, 174, 313] Host の取り出しが大文字小文字を区別する

`route(self.command, self.path, dict(self.headers.items()))` は素の dict で、キーは送られた綴りのまま。`headers.get("Host")` は `host:`（小文字）で送るクライアントに対して 421 を返す（閉じる側に倒れるので安全だが、正当なクライアントを落とす）。同じ作りの capture/http.py は api 側で小文字化しているため、2 つの口で挙動が食い違う。テストは `http.client` と Node が送る `Host` だけを使うので気づけない。
→ `{k.lower(): v for k, v in self.headers.items()}` にして `headers.get("host")` で引く。小文字の `host:` を生ソケットで送るテストを足す。

### W-2 [pwa_server.py:438-466, 430-436] ハンドラの例外が標準の handle_error に落ち、クライアントのアドレスが stderr に出る

BaseHTTPRequestHandler.handle_one_request が捕まえるのは TimeoutError だけ。握手後の ConnectionResetError・BrokenPipeError（`wfile.write` 465 行目）・`ssl.SSLError`、`setup()` の `wrap_socket` の失敗は、socketserver.BaseServer.handle_error に届き、`Exception occurred during processing of request from <client_address>` とトレースバックを stderr に出す。functional.md R4 の一文「アクセスのログは残さない（`log_message` を黙らせる）」および pwa_server.py:10 の docstring「アクセスのログ（パス・アドレス）は残さない」に反し（実行して確かめていないため Warning のまま。親が昇格を判断してよい）、スマホが Wi-Fi を切るたびにトレースバックが出る。capture/http.py の TLS ハンドラにも同じ穴がある。
→ `_BoundedServer.handle_error` を上書きし、`logger.debug("pwa_server.request_failed", extra={"error_type": type(sys.exc_info()[1]).__name__})` だけ残す。Capture 側も同様。テスト: 応答の途中で RST を送るクライアントで stderr が空であること。

### W-3 [pwa_server.py:430-436, 9] 打ち切りは「受信ごとに 5 秒」で、全体の期限が無い（遅いクライアントが枠を握り続けられる）

`settimeout(5)` は 1 回の recv/send ごと。1 バイトを 4 秒おきに送る接続は握手もヘッダーも終わらせず、16 の枠を無期限に占められる（車内 AP の中でも、ブラウザのバグや回線の不調で現実に起きる）。functional.md R4 は「受信ごとに 5 秒」と書くが、resilience.md:32-33 の表は「5 秒（握手を含む）」で、読み方が割れている。test_uc_4l が確かめるのは「完全に黙る」接続だけ。
→ 仕様を「接続の開始から合計 N 秒（例 15 秒）」に揃え、`handle()` の入口で期限を決めて残りで `settimeout` し直すか、request 読み取りごとに残り時間を確かめる。少なくともどちらの読みかを仕様に書き、「4 秒おきに 1 バイト」のテストを足す。

### W-4 [pwa_server.py:128-132, 570-579] load_dist が上限の検査より先にファイルを丸ごと読む。OSError が終了コード 2 にならない

`path.read_bytes()` のあとで `total > limit` を見るので、dist に巨大なファイルが 1 つあるとメモリに載せてから失敗する。`path.stat().st_size` で先に足し込んで検査する。また `read_bytes()` の PermissionError などは PwaServerError に包まれず、`main()`（596-601）の except に入らずトレースバックで終了コード 1 になる（FAIL-8 は終了コード 2 と書く）。
→ `try: size = path.stat().st_size ... except OSError as exc: raise PwaServerError(...) from exc`。権限のないファイルを dist に置いたテストを足す。

### W-5 [pwa_server.py:176-193, 467] GET・HEAD 以外の「知らないメソッド」が 405 にならない

`do_*` を持たないメソッド（TRACE・CONNECT・任意の `FOO`）は BaseHTTPRequestHandler が 501 の HTML を返す。これは route を通らないので Host の検査も、COMMON_HEADERS（nosniff 等）も付かない。仕様は「GET・HEAD 以外は 405」。テストは route 関数に POST/PUT/DELETE/PATCH/OPTIONS だけを渡している（test_pwa_server.py:141）。
→ `send_error` を上書きして 501 を 405（Allow 付き）に寄せるか、`parse_request` のあとで command を見て `_serve` に流す。生ソケットで `TRACE /` を送るテストを足す。

### W-6 [make_tls.py:178-179, 221-229] 出力ディレクトリの扱いが広すぎる。差し替えが全体としては原子的でない

- 178-179（仕様の問い。コードの欠陥ではない）: resilience.md のトランザクション境界 2 は「あれば権限を 0700 に直す」と明記しており、無条件の `chmod 0o700` は仕様どおり。ただし `--out .` や `--out ~` の打ち間違いで関係のないディレクトリの権限を黙って変える足場にもなる。守るなら仕様側に「`ca.*`・`server.*` 以外のファイルがあるディレクトリは直さず終了コード 2」と足す案を検討する。
- 222-226: `ca.key`・`ca.crt`・`server.key`・`server.crt` を 1 つずつ `replace` するため、途中で落ちると（例: ディスクフル・Ctrl+C）新旧が混ざる（`server.key` だけ新しい等）。このとき pwa_server は TlsError で止まるだけで済むが、docstring の「途中で失敗したら既存のファイルは変えない」とは言い切れない。
- 229: 差し替えのあとで `fingerprint()` を読むので、ここで落ちるとトレースバック（終了コード 1）。
  → chmod はこのスクリプトが作ったディレクトリと、`ca.*`・`server.*` だけが入っているディレクトリに限る（それ以外は終了コード 2 と理由）。指紋は差し替えの前に計算する。混在は「CA を含まない更新では server.crt を最後に replace する」順に直すだけでも窓が狭まる。

### W-7 [テストが仕様の言うことを確かめていない箇所]

- test_pwa_server.py:276-278（`ca_cert` に鍵を指す）: `match="ca_cert"` は「PEM として読めない」側のメッセージ（pwa_server.py:574）にも当たり、576-578 の `PRIVATE KEY` 分岐に届かないまま通る。PEM_cert_to_DER_cert が先に ValueError を出すので、その分岐は実質到達不能（Info I-4）。
- test_tls_servers.py:218-239（UC-3h）: 「握手せずに閉じた」ことは確かめず、`https_get` が SSLError/OSError なら通る。握手の失敗でも通る。また「平文の口は今までどおり 503」の側が、この feature のテストに無い（既存テストにあるなら参照を Test List に書く）。
- test_pwa_server.py:340 以下（UC-4l）は https の口だけ。http の口（8080）の枠・打ち切りは未検証。
- AUTH-3・AUTH-9（Host）は route 関数の直接呼び出しで、ソケット越しの確認は `evil.example` の 1 件だけ（test_pwa_server.py:315）。W-1 のような綴り違いは見えない。
- test_tls_make.py と conftest は絶対パスだけ（C-1）。
  → 上のそれぞれにテストを足す。UC-3h は握手前に閉じたことを `sock.recv` が TLS のバイトを受けずに EOF になることで確かめる。

### W-8 [重複: capture/http.py:340-377 と pwa_server.py:430-454、edge-url.ts:16,22 と capture-url.ts:22,28]

- TLS つきハンドラの `setup`（wrap_socket）・`handle`（do_handshake と例外の握り方）・`finish`（OSError を握り、TLS なら connection.close）が 2 か所にほぼ同じ形である。W-2 の対処も 2 か所に入れることになる。`detector/_tls_http.py` のような小さな mixin に寄せる。
- PWA 側は、`page.protocol === 'https:'` を `resolveEdgeUrl` で 2 回（dev の分岐と本番の分岐）、`resolveEdgeCaptureUrl` でも 2 回判定している。`EdgeTarget.secure` があるので、`resolveEdgeTarget` の結果（または `dev` の分岐でも使う小さな `isSecurePage(page)`）に一本化する。

## Info（参考）

- I-1 [resilience.md:21 と functional.md R4] 枠が溢れたとき、resilience は「503」、functional は「握手もせずに閉じる」と書き、実装は後者。resilience の表を直す。
- I-2 [pwa_server.py:141-155] `host_allowed` はポートの中身を見ない（`127.0.0.1:abc`・`localhost:` が通る）。仕様は「ポートは問わない」なので違反ではないが、`rsplit` ではなく `^[^:]+(:\d{1,5})?$` で形を限るほうがテストしやすい。
- I-3 [pwa_server.py:64, 381] `WS_PORT = 8765` を直書きしていて、`config.server.port` と二重になる。自己検査の CSP 照合は `config.server.port` を渡す。
- I-4 [pwa_server.py:576-578] `"PRIVATE KEY" in ca_text` は、上の `_fingerprint`（`PEM_cert_to_DER_cert` は先頭と末尾を厳密に見る）を通った時点で偽になる。到達しない防御。先に `PRIVATE KEY` を見て、先頭に置けば意味が出る（テストも 576 行目に届く）。
- I-5 [pwa_server.py:347-354] `ssl._ssl._test_decode_cert` は私的な API。仕様が「読めないときは飛ばす」を許すので許容だが、将来の版で自己検査が黙って無効になる。skip の info ログ（`pwa_server.self_check_skipped`）を運用者が見落とさないよう、runbook に書く。
- I-6 [pwa_server.py:134, 138] `load_dist` が Asset を作ってから、キャッシュ値だけ違う Asset に作り直している。最初から `_cache_for(url)` を渡せば 1 回で済む。
- I-7 [pwa_server.py:196-306] 設定ページの色（`#1B2A24` `#FBF8F1` `#1E6F5C` など）が Python に直書きされ、tokens.json の写しになっている。UI の MUST（apps/pwa/src 等）の範囲外で CI は止めないが、tokens の変更で黙ってずれる。tokens.json を読むか、「trip テーマの値の写し」と書く。
- I-8 [pwa_server.py:300] 設定ページの指紋は CA と同じ http で届くので、AP の中で CA ごとすり替えられた場合は気づけない。仕様が許す範囲（WPA2 が信頼の境界）だが、make_tls.py の出力する指紋をカードに印刷し、スマホの「詳細」と見比べる手順を runbook に太字で書くと実効が出る。
- I-9 [make_tls.py:212] `"OK" not in verified` は部分文字列。`verified.strip().endswith(": OK")` にすると誤判定がない。LibreSSL が失敗でも終了コード 0 を返す版への備えは良い。
- I-10 [server.py:68-83] `tls: dict[str, object]` と `# type: ignore` は、`ssl=self._ssl, ssl_handshake_timeout=self._open_timeout if self._ssl else None` と直接渡せば不要になる（`ssl` が None のとき `ssl_handshake_timeout=None` は許される）。
- I-11 [tls.py:53-66] `load_cert_chain` の `ValueError`（パスに NUL が入る等）は TlsError に包まれない。実害は小さい。
- I-12 [fake-edge.mjs:262-265, 305] `listen` が失敗しても `setInterval` が残る（CLI では `process.exit` で消えるがテストからは残る）。`--port abc` は NaN で RangeError。TLS の握手に `handshakeTimeout` を渡していない（開発用の道具なので許容）。

## 仕様との対応で確かめたこと（問題なし）

- R2: cert/key の片方だけ・ca_cert だけは ConfigError（config.py:416-422）。TlsError は reason の種類だけをログに出す。key の権限は warn のみ。
- R3: AlertServer は `ssl_handshake_timeout=open_timeout`（server.py:70）。CaptureServer は wrap_socket と握手を接続ごとのスレッドで行い、枠を取ってから握手する（capture/http.py:340-368）。`*.listening` に `tls` が出る。
- R4: dist はメモリへ、シンボリックリンクとドット名は載せず、HSTS なし、`/healthz` は 204、Host は IPv4・localhost・ezoroad.local のみ、ページに Host を入れない。設定ページの CSP のハッシュは本文のスクリプトと一致し、`unsafe-inline` なし。
- R5: `VITE_EDGE_HOSTS` の検査（形・8 件・全部だめなら既定）と CSP が同じ関数を共有。https のページなら wss/https。
- R6: `--tls-cert`/`--tls-key` は両方か無しか。`tlsClientError` で握手失敗を握る。

## 対応（2026-11-06、メインセッション）

- C-1: 直した（`make()` の先頭で `out.resolve()`。`monkeypatch.chdir` で相対の `--out` を 2 回打つ回帰テスト `test_uc_1e_second_run_with_relative_out` を両方の openssl で）。security-auditor W2 と同じ
- W-1: 直した（見出しの名前を `title()` でそろえる。生ソケットの `host:` のテスト）
- W-2: 直した（`_BoundedServer` と CaptureServer の `_QuietServer` の `handle_error` を上書きし、型の名前だけを debug に）
- W-4: 直した（読む前に `stat().st_size` で上限を見る。OSError は PwaServerError → 終了コード 2）
- W-5: 直した（`send_error(501)` を route に回して 405。TRACE・CONNECT・FOO のソケットのテスト）
- W-3: 受け入れたリスクのまま（threat.md「1 バイトずつ送り続ける接続」）。次に回す
- W-6・W-7・W-8・Info: 次に回す（W-6 の差し替えの順序、W-7 のテストの補強、W-8 の TLS ハンドラの共通化、I-1 の resilience の 503 の記述、I-3 の WS_PORT の二重）
