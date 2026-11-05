# セキュリティ監査: deploy-a（feat/deploy-a、origin/main...HEAD）

対象: Vercel（sim + api の 1 プロジェクト）・Turso（libsql over HTTP）・非公開 Vercel Blob。確信のある指摘だけを載せる。

## Critical（即時対応）

なし。

## Warning（早期・計画的対応）

### W1 /health/ready が無認証・レート制限なしで毎回 Turso を読む | Medium | CWE-770

- [apps/api/src/infrastructure/http/routes/health.routes.ts:11-22]、[apps/api/src/di/vercel-platform.ts:58]、[apps/sim/vercel.json:12-13]
- `/health/ready` は rewrite で公開され、要求ごとに `checkSchema`（`sqlite_master` と `schema_meta` の 2 クエリ）を Turso へ流す。rateLimit も付いていない。
- 影響: 誰でも Turso の読み取り行数と関数の実行時間を消費させられる（課金・クォータ枯渇。fail-open なので他 route の制限には影響しない）。応答本文は `ok` / `unavailable` だけで情報漏れはない。
- 修正: (a) Vercel の WAF / Firewall で `/health/ready` をレート制限する（手順書に追記）。(b) もしくは readiness の結果をインスタンス内で 10〜30 秒キャッシュする。(c) 外部監視が不要なら Vercel 側では `/health/ready` の rewrite を外す。

### W2 レート制限が fail-open で、Turso 障害時は Claude 呼び出し系の制限がインスタンス内メモリにも戻らない | Medium | CWE-770 / CWE-636

- [apps/api/src/infrastructure/http/middleware/rate-limit.ts:106-114]、[apps/api/src/infrastructure/system/rate-limit-counter.ts:66-71]
- `counter.hit` が null（Turso が落ちている、2 秒で答えない）だと、メモリの数えにも切り替えずに `next()` する。counter がある経路では `inMemory` を一切使わない。
- 影響: 攻撃者が Turso を遅くする必要はなく、Turso 障害と同時に来る要求は無制限になる。ただし、`trip_writer_calls` の日次上限（CLAUDE_DAILY_CALL_LIMIT）も同じ Turso なので、障害中は書き込みもほぼ失敗する。実害はコスト増の窓が障害の間に限られる点。仕様の意図（fail-open）は理解できるので、緩和として扱う。
- 修正: null のときはそのインスタンスのメモリの数え（`inMemory(k, t)`）で数えて 429 判定だけ行う。インスタンスごとの下限として十分で、実装は数行（`entry = counter ? (await counter.hit(...)) ?? inMemory(k, t) : inMemory(k, t)`）。

### W3 クライアント IP が取れないとき全員が `unknown` の 1 つの枠を共有する | Low-Medium | CWE-348

- [apps/api/src/infrastructure/http/middleware/client-ip.ts:82-83]、[apps/api/src/infrastructure/http/middleware/vercel-client-ip.ts:18-24]
- Vercel は 3 つのヘッダを必ず付けるので通常は起きない。ただし、ヘッダが落ちる経路（Vercel の仕様変更、将来の別ホスティング、テスト構成）では、全利用者が `unknown` 1 本の枠に入り、1 人が枠を使い切ると全員が 429（逆に、window 内の攻撃で正規利用者を締め出せる）。
- 修正: Vercel の platform では IP が取れないとき warn を 1 分に 1 回出す（IP は出さない）。または `unknown` に要求ごとの乱数ではなく、`user-agent` 等を足さない代わりに、ヘッダ欠落をメトリクスにして検知する。

### W4 Turso のトークンが期限なし・読み書き全権で、Production と migrate が同じ種類を使う | Low-Medium | CWE-798 / CWE-269

- [docs/runbooks/2026-11-05-deploy-a-vercel-turso.md:48-58]
- 手順書自身が「既定で期限なし・読み書き」と書いている。漏れたときの被害が大きい（trips の `owner_token_hash`、captures の本文）。
- 修正: `turso db tokens create <db> --expiration 90d` のように期限を付ける（更新日を手順書に書く）。マイグレーション用（スキーマ変更が要る）と関数用で分けるのが理想だが、Turso が read-only / full-access の 2 種類なので、少なくとも Production と Preview の分離（既にある）を維持する。`.env.turso-*` は `.gitignore` の `.env.*` に当たるので登録漏れはない。使い終えたら削除する 1 行を手順書に足す。

### W5 bundle に sourcemap を出している | Low | CWE-540

- [apps/api/vite.vercel.config.ts:18]
- `dist/vercel/handler.mjs.map` が関数に入る。静的配信 (`dist`) には入らず公開されないので、直接の漏えいではない。ただし関数のファイルが将来 `public/` 側にコピーされる構成に変わると、ソース全体と threat 関連のコメントが読める。
- 修正: 本番では `sourcemap: false`、スタックの読みやすさが必要なら `--enable-source-maps` 側で扱う。または `hidden` にして bundle.test.ts に「`dist` 配下に `.map` が無い」検査を足す。

## Info（確認できたこと・補足）

- 秘密: コミットされた秘密は無し（`TURSO_AUTH_TOKEN`、`BLOB_*`、OWNER_TOKEN_SECRET は `.env.example` に空か未設定のコメント。`.env.*` と `.vercel/` は `.gitignore` 済み）。`VITE_` に秘密は無く、`VITE_API_BASE_URL` は空。api の bundle は `envDir: false` かつ `define` なしで env を焼き込まない（bundle.test.ts [apps/api/tests/vercel/bundle.test.ts:38] が検査）。
- ログ・応答: boot 失敗の 503 は固定文言の `UNAVAILABLE` のみ（[apps/api/src/vercel.ts:22-24, 58]）。`EnvError` は変数名だけで値を含まない（[apps/api/src/infrastructure/config/vercel-env.ts:41-58]）。ただし、`SchemaOutdatedError` / ドライバ例外のメッセージがそのままログに出る。libsql のエラーが URL を含む可能性があるが、URL にトークンは含まれない（`authToken` は別引数）ので許容。`describeTarget` は host だけ出す（[migrate-db.ts:37-45]）。
- 新しい公開 route は無い。追加は rewrite（`/api/*`・`/health*`・`/t/:id*`）だけで、既存 route への写し。`/t/:id` は `?app=1` が無いときだけ SSR（[apps/sim/vercel.json:15-19]）。
- Blob: `access: 'private'`、サーバー決定の名前 `captures/images/{key}-{sha256 全桁}.{ext}`（sha256 はサーバーが画像のバイトから計算 [submit-capture.usecase.ts:51]。キーは `^cap_[a-z0-9]+$` で検査 [blob-capture.repository.ts:29-32]）なので、`allowOverwrite: true` は「同じ名前 = 同じ中身」で上書き攻撃にならない。DB 行は `done` を引き継がない（`setWhere` が pending かつ 10 分超過のみ）。読み取り・削除の route は無い。`VercelBlobImageGateway.delete` は現在どこからも呼ばれない未使用の口なので、不要なら削除して権限の面を狭める（Info）。
- クライアント IP: `x-vercel-forwarded-for` → `x-real-ip` → `x-forwarded-for` の右端。Vercel が上書きする前提で妥当で、右端を取るので追加された値にも強い。IPv6 は /64 にまとめられる（既存の `rateLimitBucket`）。Vercel は `TRUST_PROXY` を読まない（`trustProxy: false`）ので設定ミスで左端を信じる経路は無い。
- レート制限の HMAC: 鍵は `HMAC(HMAC(OWNER_TOKEN_SECRET,'rate-limit'), scope\nkey)` の先頭 128 bit。表に IP は無く、秘密なしでは逆引きできない。秘密の派生は用途分離できている。`OWNER_TOKEN_SECRET` を回すと数えが切り替わるだけで影響は軽い。ブロック済みキーはメモリで先に弾くので Turso への書き込みを増やされにくい（上限 10,000 キーの LRU）。
- migrate: 値を出さず、`--env-file` のパスは `process.loadEnvFile` で読む。冪等で版を下げない（`max(version, …)`）。関数側は表を作らず版の確認だけ（DDL 権限を使わない）。Turso のトークン自体は DDL できる全権（W4）。
- 公開 URL は env か Vercel の System env から作り、Host ヘッダは使わない（open redirect / ホストヘッダ汚染なし）。Production で `VERCEL_PROJECT_PRODUCTION_URL` が無いと localhost の既定に落ちる（CORS も localhost になるため安全側）。
- Preview デプロイ: Vercel の Deployment Protection（Vercel Authentication）を Preview で有効のままにすること。Preview は別 DB・別トークンだが、公開されると誰でも書き込める API になる。手順書に 1 行ある表現でなければ追記を勧める。

## 優先順位

1. W1（readiness のレート制限か短期キャッシュ）と W2（fail-open 時のメモリ代替）。どちらも小さい変更。
2. W4（トークン期限）と Preview の保護の確認は運用手順の追記だけ。
3. W3・W5 は計画的に。
