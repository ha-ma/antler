# セキュリティ監査: pwa-connect（コミット dc7334b）

対象: `apps/pwa/src/features/connect/**`、`apps/pwa/scripts/fake-edge.mjs`
観点: WebSocket 受信、`?edge=` 上書き、位置の許可、ログ、偽サーバーの手書き WebSocket（DoS・フレーム処理）
方針: コードは直していない。確認できたものだけ載せる。再現ありは「再現済」と書く。

## Critical

なし。本番の PWA 側に、リモートから悪用できる欠陥は見つからなかった。

## Warning

### W1. fake-edge.mjs:126 不正な request-target 1 つでプロセスが落ちる（再現済）| CWE-248 / CWE-20

- `server.on('upgrade')` の最初で `new URL(req.url ?? '/', 'http://localhost')` を try/catch なしで呼ぶ。
- `GET http://[ HTTP/1.1` に Upgrade ヘッダを付けて送ると `TypeError: Invalid URL` が出る。upgrade ハンドラは例外を握らないので、サーバー全体が終了する（Node v22 で確認。`SERVER_DEAD`）。
- 影響: 接続できる相手なら誰でも、偽 edge を 1 パケットで止められる。既定は `127.0.0.1` 待受けなので、通常はローカルだけ。`--host 0.0.0.0` で LAN に出すとデモ中に止められる。テストも `startFakeEdge` を同一プロセスで使うため、テストランナーごと落ちうる。
- 修正: URL の解析を try/catch で囲み、失敗したら 400 で `socket.destroy()`。パスの比較だけなら URL を作らず `req.url.split('?')[0] === '/alerts'` でもよい。
- 関連（未再現・推測）: 404 の分岐（129 行）は `socket.end()` の前に `socket.on('error')` を付けていない。upgrade の経路では Node が既定の error リスナーを外すため、送信中に相手が RST すると未処理の `error` になる可能性がある。最初に `socket.on('error', () => socket.destroy())` を付けるとよい。

### W2. fake-edge.mjs:125-165 接続数・ハンドシェイク・書き込みの上限がない | CWE-770

- `clients` の数に上限がない。受信側のタイムアウトもない（ハンドシェイク後に何も送らない接続を無期限に持つ）。
- `broadcast`（199 行）と pong（155 行）の `socket.write` は戻り値（バックプレッシャ）を見ない。読まない相手に ping（最大 64 KiB）を送り続けると、サーバーのメモリが増える。
- 影響: LAN に出した場合の DoS。ローカル待受けなら開発者の自己責任。
- 修正: `clients.size` に上限（例 8）。ハンドシェイク後のアイドルタイムアウト。`socket.writableLength` が閾値を超えたら destroy。ping の payload は RFC 6455 の 125 バイトまでに制限。

### W3. fake-edge.mjs:125-131 Origin を検査しない（Cross-Site WebSocket Hijacking）| CWE-1385

- 開発者のブラウザで悪意あるページを開くと、そのページから `ws://localhost:8765/alerts` に接続でき、偽の ack をサーバー経由でログに混ぜられる。
- 影響: 流れるのは合成フラグだけなので、情報漏えいはない。ログへの注入と、接続数の消費だけ（W2 と組む）。
- 修正: `Origin` ヘッダがあれば `http://localhost:*` / `127.0.0.1` / 自分の PWA の origin だけ許可する。Origin なし（Node のクライアント、テスト）は許可。

### W4. edge-client.ts / edge-url.ts 本番の接続先が平文 `ws://` で、認証がない | CWE-319 / CWE-345

- `DEFAULT_EDGE_URL = 'ws://ezoroad.local:8765/alerts'`。同じ Wi-Fi（車内ホットスポット）にいる相手が mDNS で `ezoroad.local` を名乗れば、`deer:false` を連続で送って赤を抑え込める。逆に `deer:true` を流して偽の警報も出せる。
- 影響: 安全性に直結する偽装（鹿検知の抑止）。ただし攻撃には車内ネットワークへの接続が必要で、ハッカソンのスコープでは受容できる。
- 追加の注意（セキュリティというより設計の穴）: 位置情報の許可（`isSecureContext`）には PWA が HTTPS で配信される必要がある。HTTPS のページから `ws://`（localhost 以外）への接続は、ブラウザの mixed content で遮断される。`insecure` 状態の表示はあるが、本番で B-1 が成立するかを実機で確認すること。
- 修正（今回は不要）: ペアリングトークン（QR で渡し、`/alerts?token=` か最初のメッセージで照合）。`wss://` が無理なら、少なくとも「未認証の edge である」ことを ch6 に受容リスクとして書く。

## Info

### I1. edge-url.ts `?edge=` の上書き — 問題なし（確認済）

- `import.meta.env.DEV` が false なら無条件で固定の URL を返す。本番ビルドでは Vite が定数に置き換えるため、`?edge=` は効かない。
- 開発ビルドでも、ホストは `[A-Za-z0-9.-]{1,253}`、ポートは 1〜65535 に限る。スキーム・パス・認証情報・クエリは注入できない。`ws://` 固定でパスも `/alerts` 固定。
- 残る点: 開発ビルドでは `?edge=attacker.example` で任意のホストに向けられる。開発者が細工リンクを開く場合だけ（影響は偽フラグの受信）。ホストを `localhost` / プライベート IP / `.local` に絞るとなお良い。優先度は低い。

### I2. edge-client.ts 受信側の検証 — おおむね堅い

- 文字列以外は捨てる、256K 文字の上限、20 件/秒のレート制限、`readAlertFlag` で型を絞る（数値は有限・非負、`conf <= 1`、`side` は列挙）。
- `deer:false` の壊れたフラグは赤を解く根拠にしない（203 行）。偽装・欠損に対して安全側に倒れている。
- 注意: `floodAllowed` が型・サイズの検査より前にあるため、20 件/秒を超える送り手は正規の `deer:true` も落とす。送り手が edge だけなら実害はない。W4 の前提では、攻撃者に抑止の別手段を与えるだけで、新しい脅威ではない。
- `data.length > MAX_MESSAGE_CHARS` はブラウザがすでにメモリに載せた後の検査。ブラウザ側で止める手段はないので許容。
- `innerHTML` / `dangerouslySetInnerHTML` / `eval` は `apps/pwa/src` に無い。受信値は React のテキストで描画される（XSS の経路なし）。

### I3. location.ts 位置の許可 — 問題なし

- 座標は読まない・保存しない・ログに出さない（コールバックは空関数）。`getCurrentPosition` はダイアログを出すためだけに 1 回。`prompt` / `unknown` のときだけ呼ぶ。
- `isSecureContext` が false なら呼ばない。`onchange` の購読は解除される。
- CLAUDE.md の MUST（Capture に位置を書かない）とも矛盾しない。

### I4. ログ — 機密情報なし

- `logger` に渡すのは `reason` / `chars` / `event` 名だけ。フラグの中身、URL、座標、端末識別子は出していない。`console.warn` / `console.error` のみで、外部には送らない（ADR 001 と整合）。
- `logger.error` はスタックトレースを出す。`services.ts` の `onError` 経由で音まわりの例外だけが対象で、機密は含まれない。
- fake-edge のログは `JSON.stringify` で組み立てているため、ログインジェクション（改行）は起きない。ただし ack の `t_shown`（クライアントが送る任意の文字列、最大 64 KiB）がそのまま出る。長さを 64 文字などで切るとよい。

### I5. fake-edge.mjs のフレーム処理

- 良い点: クライアントのフレームは 64 KiB で上限、64 ビット長（127）は拒否、マスクを解く、close に応答、ping に pong、`Sec-WebSocket-Accept` は正しい。待受けは既定 127.0.0.1。`parseArgs` は未知の引数で例外を投げる。
- 弱い点（実害は小さい）: FIN とフラグメント（opcode 0）を扱わない。クライアントのマスク必須を強制しない。RSV ビットを無視する。制御フレームの 125 バイト上限を見ない。`Buffer.concat` を毎チャンクで行うため、小さなチャンクを大量に送ると遅くなる（上限が 64 KiB なので無限には増えない）。
- 開発用ツールなので、`--host` で 0.0.0.0 を指定したら標準エラーに警告を出すだけで足りる。
- 再現を試したが成立しなかったもの: 「65536 バイトの ping でヘッダがあふれる」。2 バイト長で表せる最大は 65535 のため、成立しない。

## 優先順位

1. W1（1 行の try/catch と error リスナー。再現済み）
2. W2・W3（`--host` で LAN に出す前に）
3. W4（受容リスクとして ch6 に書く。mixed content は実機で確認）
4. I1 の絞り込み、I5 の警告表示
