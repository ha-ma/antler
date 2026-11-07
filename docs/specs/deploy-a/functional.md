---
feature: deploy-a
target_paths:
  - apps/sim/vercel.json
  - apps/sim/api/
  - apps/sim/package.json
  - apps/api/package.json
  - apps/api/vite.vercel.config.ts
  - apps/api/.env.example
  - apps/api/src/vercel.ts
  - apps/api/src/index.ts
  - apps/api/src/di/
  - apps/api/src/infrastructure/config/
  - apps/api/src/infrastructure/db/
  - apps/api/src/infrastructure/commands/
  - apps/api/src/infrastructure/system/rate-limit-counter.ts
  - apps/api/src/infrastructure/http/middleware/rate-limit.ts
  - apps/api/src/infrastructure/http/middleware/vercel-client-ip.ts
  - apps/api/src/infrastructure/http/app.ts
  - apps/api/src/infrastructure/http/routes/
  - apps/api/src/infrastructure/repositories/blob-capture.repository.ts
  - apps/api/src/infrastructure/repositories/vercel-blob-image-store.ts
  - apps/api/src/infrastructure/http/unavailable.ts
  - apps/api/src/domain/captures/policies/capture-claim-policy.ts
  - apps/api/tests/vercel/
spec_confirmed_at: e2d04d2
tier: 2
---

# 仕様: deploy-a（A の sim と api を Vercel に置く準備。DB は Turso、Capture の画像は Vercel Blob）

> 2026-11-07 最初の Preview のデプロイで、Vercel の既定の install が Root Directory（`apps/sim`）の中だけに入れ、`tsc` が無くてビルドが止まった。`apps/sim/vercel.json` に `installCommand: "cd ../.. && npm ci"` を足した（R1）。この仕様のルール（関数・書き換え・env・DB）は変えていない。

> 2026-11-06 i18n（`docs/specs/i18n/functional.md`）で 各 workspace の `package.json` に devDependency `@antler/i18n-check` を足した（テストだけで使う。ビルドの中身は変わらない）。この仕様のルールは変えていない。

> 2026-11-06 drive-tourism で `routes/trip-day.routes.test.ts` に遅いテストの時間の上限を付けたが、main（drive-season）の 20 秒（テストごと）に揃えて外した（テストだけ。ルートは変えていない）。この仕様のルールは変えていない。

**og-font（2026-11-06）での変更**: OG 画像（`/t/:id/og.png`）は同梱の Noto Sans JP / TC / KR（OFL）で描く（`docs/specs/og-font/functional.md`）。この feature の挙動は変わらない。

## 概要

**drive-season（2026-11-06）での変更**: デプロイの形は変えていない。`apps/api/src/infrastructure/http/routes/trip-day.routes.test.ts` の全日のテストの時間切れを 20 秒にしただけ（負荷の高い全体実行で 5 秒を超える既知の問題）（`docs/specs/drive-season/functional.md`）。

A（`apps/sim` の静的配信と `apps/api` の Hono）を、Vercel の 1 つのプロジェクトに載せられるようにする。実際のデプロイ・アカウントの作成・秘密の値の入力はユーザーの作業で、この feature は**リポジトリの側の準備**と**手順書**（`docs/runbooks/2026-11-05-deploy-a-vercel-turso.md`）を作る。

- sim は `apps/sim/dist` を静的に配る。api は同じプロジェクトの関数 1 つ（`apps/sim/api/index.mjs`）で、Hono アプリを呼ぶ
- `/api/*`・`/t/*`（record の SSR・OG 画像）・`/health`・`/health/ready` を関数へ書き換える。同じオリジンなので sim の `VITE_API_BASE_URL` は空のままでよく、CSP の `connect-src 'self'` で足りる
- DB は Turso（ホスティングの libsql）。Drizzle の SQLite 方言と `@libsql/client` をそのまま使う。関数からは HTTP のクライアント（`@libsql/client/http`）でつなぐ
- レート制限の数えは Turso の表（`rate_limit_hits`）。Capture は、画像を Vercel Blob（非公開）、本文と数えは Turso の表（`captures`）に置く
- 表の作成は、デプロイの前に 1 回流すマイグレーション（`npm run db:migrate -w @antler/api`）。ローカルの開発（`file:` の SQLite）と既存のテストは、今までどおり起動時に作る

要件: ch2（A の構成）、ch6（性能・可用性・セキュリティ・プライバシー。A API はレート制限 記録作成 10/分/IP）、ch7（A の API）、ch10（Day 6〜7 のデモ）。
判断: ユーザー判断 2026-11-05（Vercel・Turso・Vercel Blob 非公開。推奨で決定の 4 項目は下の Questions）。
契約: docs/specs/plan-trip（R9 の IP・1 日の上限・MIGR-1）、docs/specs/record（R1・R7 の公開 URL と SSR）、docs/specs/edge-capture（A4〜A6 の保存と上限）。

**範囲外**:

- 実際のデプロイ、Vercel・Turso のアカウントとプロジェクトの作成、秘密の値の入力、独自ドメイン（ユーザーの作業。手順書に書く）
- **B の PWA**（`apps/pwa`）。位置情報に HTTPS が要る一方、車内の edge へ `ws://` でつなぐので、Vercel に置くだけでは車載につながらない（混在コンテンツ）。別 feature で決める
- OG 画像の日本語のフォント（Vercel の関数の Linux には CJK のフォントが無い。下の Deferred）
- `dataset/` が Blob と Turso から Capture を取り込むスクリプト（下の Deferred）
- 監視・アラート・ログの転送（Vercel の Runtime Logs を見る）、Turso のバックアップの設定

**Tier 2 の根拠**: 永続化のスキーマが増える（`rate_limit_hits`・`captures`・`schema_meta`）。外部の保存先（Turso・Blob）への副作用。レート制限の鍵（利用者の IP）の扱いが変わる（メモリだけ → DB に置く）。

## Example Map

Story: ハッカソンの審査員・利用者として、URL 1 つで A（旅の計画 → 3D の運転 → 喪失 → 記録）を最後まで試したい。運営者（人 A）として、Preview（PR ごと）で確かめてから main を Production に出したい。Claude の費用と保存先が、公開しても暴れないようにしたい。

- R1: Vercel のプロジェクトの形（推奨で決定）
  - プロジェクトは 1 つ。Root Directory は `apps/sim`。設定は `apps/sim/vercel.json`（framework `vite`・`buildCommand`・`outputDirectory: dist`・関数・書き換え・region）
  - ビルドは `npm run build:vercel`（sim の `tsc --noEmit && vite build` と、api の bundle `apps/api/vite.vercel.config.ts`）。install は `cd ../.. && npm ci`（リポジトリの直下で npm workspaces を入れる。`vercel.json` の `installCommand`）。Vercel の既定は Root Directory（`apps/sim`）の中だけに入れ、直下の devDependencies（`tsc` など）が無くてビルドが止まる（2026-11-07 の最初の Preview で確かめた）
  - 関数は `apps/sim/api/index.mjs` の 1 つ。中身は api の bundle（`apps/api/dist/vercel/handler.mjs`）の再輸出だけ。**bundle を作る理由**: `@antler/*` は TS のまま（`exports` が `./src/index.ts`、拡張子なしの相対 import）で、Vercel の関数の TS の変換（ファイルごと）では Node の ESM として読めない（`vercel build` で確かめた）
  - bundle は Vite の SSR のビルド。`@antler/*` と `apps/api/src` は bundle に入れ、`node_modules` の依存は外のまま（Vercel が import を辿って関数に入れる。`@resvg/resvg-js` のネイティブもこの経路）
  - 関数の上限時間 `maxDuration` は 60 秒（Claude の呼び出しは 30 秒まで。Hobby の上限 300 秒の内側）。region は `hnd1`（東京。Turso も東京に置く）
  - Node は 22（`apps/sim/package.json` の `engines`）。CI と同じ
- R2: 書き換え（rewrites。上から順に最初に当たったもの。静的なファイルが先に当たる）
  - `/api/(.*)` → 関数。`/health`・`/health/ready` → 関数（デプロイの確かめに使う。推奨で決定）
  - `/t/:id/og.png` → 関数。`/t/:id` は**クエリ `app` が無いときだけ**関数（`missing: [{ "type": "query", "key": "app" }]`）
  - 残り（`/(.*)`）→ `/index.html`（sim の SPA）
  - **`/t/:id` の衝突**（推奨で決定）: sim の A-7（SPA の `/t/:id`）と api の共有ページ（SSR の `/t/:id`）が同じオリジンの同じ URL になる。共有の URL（OG の meta が要る）は SSR に渡し、SSR のページの「EZO ROAD で開く」は `/t/:id?app=1` にする（SPA が開く）。アプリの中の移動（`recordHref` の `/t/:id`）はクライアントの中なので今までどおり A-7。A-7 で再読み込みすると SSR のページになり、「EZO ROAD で開く」で A-7 に戻る
- R3: 関数の入口（`apps/api/src/vercel.ts`）
  - `export default { fetch }`（Vercel の Node の関数の Web 標準の形）。Hono アプリは最初の要求で 1 回だけ組み立てる（同時の最初の要求でも 1 回）
  - 組み立てに失敗（env が不正など）→ 503 `{ error: { code: "UNAVAILABLE" } }`。理由（env の名前・例外のメッセージ）は応答に出さず、ログ（`vercel.boot_failed`、例外の名前とメッセージ）に出す。次の要求でもう一度組み立てる（壊れたまま覚えない）
  - 起動時に表を作らない（R6）。ローカルの入口（`src/index.ts`）は今までどおり作る
  - 組み立ての中で `checkSchema` を流す（spec-adversary W2）。版が古い・表が無い → 組み立ての失敗（上と同じ 503）。**古い版の DB に新しいコードが出たら、すべての要求を止める**（新しい表だけが無い状態で、レート制限が fail-open になり上限なしで通るのを防ぐ）。成功した組み立ては覚え、以後は流さない
- R4: 環境変数（Vercel の上だけの既定と検査。`withVercelDefaults` と `loadVercelEnv`）
  - 公開の URL（`PUBLIC_API_URL`・`SIM_PUBLIC_URL`）と `CORS_ORIGINS` が無いときは、Vercel の値から作る: Production（`VERCEL_ENV=production`）は `https://${VERCEL_PROJECT_PRODUCTION_URL}`、それ以外は `https://${VERCEL_BRANCH_URL}`（無ければ `VERCEL_URL`）。**明示した値が常に勝つ**。Preview の URL はデプロイごとに変わるので、Preview では明示しない
  - `CORS_ORIGINS` の既定は上の 1 つ（同じオリジンの要求は CORS を通らないので、外からの読み取りを増やさない）
  - Vercel の上では `TRIPS_DB_URL` は `libsql://` か `https://` だけ（`file:` は関数の読み取り専用のファイルシステムに書けない）。`TURSO_AUTH_TOKEN` は必須（既定値なし・秘密）
  - Blob の資格は `BLOB_STORE_ID`（Vercel がストアをつなぐと付ける。OIDC の `VERCEL_OIDC_TOKEN` と組で SDK が使う）か `BLOB_READ_WRITE_TOKEN` のどちらかが要る。どちらも無ければ起動しない
  - 検査の失敗は `EnvError`。メッセージに変数の**名前**は出すが、**値**は出さない
  - ローカル（`loadEnv`）にも `TURSO_AUTH_TOKEN`（任意）を足す。`TRIPS_DB_URL` が `libsql://`・`https://` なら必須
- R5: DB の接続
  - ローカル（`file:`）: 今までどおり `@libsql/client`（ネイティブの libsql）。`openDatabase`
  - Turso（`libsql://`・`https://`）: `@libsql/client/http` と `drizzle-orm/libsql/http`（ネイティブを読まない。関数で読めない `libsql` のネイティブの束を避ける）。`openRemoteDatabase({ url, authToken })`。`libsql://` は HTTPS の HTTP クライアントになる
  - 関数の bundle は `@libsql/client` の Node の入口（ネイティブの `libsql` を読む）を**実行時に読まない**（ローカルの組み立ては動的 import の先に置く）
  - Turso への 1 回の HTTP は 10 秒で打ち切る（クライアントに渡す `fetch` に `AbortSignal.timeout`。spec-adversary W3: fetch には既定の時間切れが無く、Turso が固まると関数の 60 秒まで待つ）
- R6: マイグレーション（推奨で決定）
  - 表の定義は `migrate.ts` の `STATEMENTS` 1 か所（`CREATE TABLE IF NOT EXISTS`）。足すのは `rate_limit_hits`・`captures`・`schema_meta`
  - `schema_meta` に版（`SCHEMA_VERSION`、この feature で 2）を書く。`ensureSchema` は表を作ってから版を上げる（下げない）
  - `checkSchema(client)`: 版の表が無い・版が `SCHEMA_VERSION` より古い → 例外（`SchemaOutdatedError`）。Vercel の `/health/ready` の `database` の検査に使う（503 で「マイグレーション前」が分かる）
  - コマンド `npm run db:migrate -w @antler/api -- --env-file <file>`（`src/infrastructure/commands/migrate-db.ts`）: `TRIPS_DB_URL` と `TURSO_AUTH_TOKEN` だけを読み、`ensureSchema` を流して版を出す。秘密の値は出さない。`--env-file` のファイルは `.env.*`（gitignore 済み）に置く
  - 何度流しても壊れない（`IF NOT EXISTS`）。戻すのは表の削除（Turso の DB を作り直す）
  - ローカルの入口とテストは今までどおり起動時に `ensureSchema`（版も書く）
- R7: レート制限の数え先（推奨で決定）
  - `rateLimit` の数えを差し込み口（`RateLimitCounter.hit(bucket, now, windowMs)`）にする。差さなければ今までどおりプロセスのメモリ（既存の掃除・鍵の上限・テストはそのまま）
  - 差し込みはアプリ（`createApp` の `rateLimitCounter`）が要求ごとに Hono の変数に置き、`rateLimit` がそれを読む（route のファイルは変えない）
  - 数えの単位（scope）は `rateLimit` に渡す**名前**（`name`。必須。例: `trips.create`・`record.reads`）。同じ `rateLimit` を 2 つの route で使えば 2 つで共有する（record の `reads` は record と `/t/:id` で共有。今のメモリと同じ意味）。名前は route のファイルに書く（spec-adversary Info: 作った順の番号は、デプロイの切り替えやテストの 2 つのアプリで枠が混ざる・分かれる）
  - Turso の実装 `LibsqlRateLimitCounter`: 固定の窓（`floor(now / windowMs) * windowMs`）ごとに `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` で 1 文で数える。窓の始まりはメモリの実装（最初の要求から 1 分）と違い、時計にそろえる
  - **IP を表に置かない**: 鍵は `HMAC-SHA256(秘密, scope + "\n" + IP の枠)` の先頭 32 桁（16 進）。秘密は `OWNER_TOKEN_SECRET` から HMAC で派生（`"rate-limit"`）。窓が過ぎた行は 1 分に 1 回まで消す。止められるのは「DB だけを読める人」まで（`OWNER_TOKEN_SECRET` と DB の両方を持つ運用者は IPv4 を総当たりで戻せる。実際の守りは「1〜2 分で消える」ことと「秘密を DB と別の場所に置く」こと）
  - **上限を超えた鍵は DB に書かない**（spec-adversary W4）: 数えが上限を超えたら、その scope と鍵を窓の終わりまでプロセスのメモリに覚え（鍵は 10,000 まで）、次からは DB に行かずに 429。連打やクローラで Turso の書き込みの枠を使い切らせない
  - 数えに失敗（Turso に届かない・2 秒で答えない）→ **このインスタンスのメモリで数える**（上限なしにはしない。security-auditor W2。インスタンスごとの上限に落ちる）。`rate_limit.counter_unavailable` を warn（1 分に 1 回まで）。一時的な障害だけが対象（版が古い DB は R3 で全部止まる）。Claude の 1 日の上限は DB で数えていて、ここでは変わらない
  - Claude の同時呼び出しの上限（`InProcessConcurrencyLimiter`）は**インスタンスごと**のまま（推奨で決定）。インスタンスが n 個なら最大 n × `CLAUDE_MAX_CONCURRENT_CALLS`。費用の上限は 1 日の上限（DB）と Anthropic のコンソールの支出の上限で守る
- R8: 利用者の IP（Vercel）
  - Vercel は `x-forwarded-for` を接続元の IP **1 つ**で上書きする（公式の資料「we currently overwrite the X-Forwarded-For header」）。`x-real-ip`・`x-vercel-forwarded-for` も同じ値。だから今の `TRUST_PROXY=true`（右端）は Vercel でも正しい
  - ただし関数は `fetch(Request)` で呼ばれ、Node のソケット（`getConnInfo`）が無い。env の設定に頼らず、Vercel の組み立てが**ヘッダから取る** `remoteAddress` を渡す: `x-vercel-forwarded-for` の右端 → `x-real-ip` → `x-forwarded-for` の右端。どれも無ければ `unknown`（1 つの枠）
  - `TRUST_PROXY` は Vercel では読まない（どちらでも同じ値になる）。IPv6 は今までどおり /64 で 1 つ
  - IP が取れない（`unknown`）ときは `client_ip.missing` を warn（1 分に 1 回まで。パスだけ）。全員が 1 つの枠になるのに気づけるようにする（security-auditor W3）
- R9: Capture の保存先（Vercel。推奨で決定）
  - `CaptureRepository` の新しい実装 `BlobCaptureRepository`。口（`create`・`find`・`stats`）と `SubmitCaptureUseCase` は変えない。ローカルは `FileCaptureRepository` のまま
  - 画像は Vercel Blob（`access: 'private'`）の `captures/images/{key}-{画像の sha256 全 64 桁}.{jpg|png}`。名前が中身のハッシュなので、同じ名前は同じ中身。上書きを許す（`allowOverwrite: true`。同じバイトの上書きは何も変えない）。ランダムな接尾辞は付けない
  - 本文（サーバーが決めた形の Capture）・本文のハッシュ・画像の名前・バイト数・受け取った時刻・状態（`pending` / `done`）は Turso の `captures`（`key` が主キー）。**`done` の行が完成のしるし**
  - 順番（spec-adversary W1。行を先に取る。plan-trip の `trip_requests` と同じ形）:
    1. 行を `pending` で取る（`INSERT … ON CONFLICT(key) DO UPDATE … WHERE status = 'pending' AND updated_at <= 90 秒前 RETURNING`。新しく入れた、または 90 秒より古い `pending` を引き継いだ = 自分のもの）。取れなかった = 既存の本文のハッシュで `exists`。取れなかったのに行が無い（相手が消した直後）→ 例外（409 にしない。再送で直る）
    2. 画像を置く。失敗 → 自分の `pending` の行を消して（失敗は無視。消せなくても 90 秒で引き継げる）例外
    3. 行を `done` にする（自分が取った `updated_at` のときだけ）。失敗 → 例外（画像は残る。90 秒後の再送が引き継いで同じ名前に上書きする）。0 行（引き継がれていた）→ 例外（`created` と言わない）
  - 90 秒（`CAPTURE_STALE_PENDING_MS`。関数の `maxDuration` 60 秒＋余裕）より古い `pending` は、書いた要求が止まったとみなす。判断は domain の純粋関数（`isStalePending`）
  - 画像の置き場所（`CaptureImageStore`、Vercel Blob の実装 `VercelBlobImageStore`）は Capture の永続化の一部（`FileCaptureRepository` が画像を fs に書くのと同じ）なので、Gateway にせず Repository の実装の中に閉じる（layer-guard Critical）
  - 残る穴（code-reviewer W1。docs/reports に残す）: 手順 3 が失敗した直後 90 秒以内に同じ本文を再送すると 200（既存）になり、その行は `done` にならない。未完成を 503 で返すには `ExistingCapture` と edge-capture の契約を変える（別 feature）
  - **行を入れられない間は画像を置かない**（行の INSERT が失敗し続けても Blob が増えない）。`stats` は `pending` も数える（上限が効く）
  - `find`: `done` と 90 秒以内の `pending` は本文のハッシュを返す（同じなら 200、違えば 409）。90 秒より古い `pending` は無い扱い（`create` が引き継ぐ）
  - 負けた側（`exists`）は画像を置いていないので、消すものが無い
  - `find` と `stats`（件数・バイト数の和）は Turso を読む（インスタンスをまたいで正しい）。上限（`CAPTURES_MAX_ITEMS`・`CAPTURES_MAX_BYTES`）は今までどおり。Vercel では小さくする（手順書: Production 5,000 件・1 GiB、Preview 500 件・100 MiB）
  - 読み出し・削除の口は作らない（edge-capture と同じ。IDOR の面を作らない）。Blob の非公開のファイルは Blob の資格が無いと読めない
- R10: 公開の URL（record）
  - sim の共有の URL（`recordShareUrl`・`recordImageUrl`）は、`VITE_API_BASE_URL` が空なら**ページのオリジン**（`window.location.origin`）を前に付けて絶対の URL にする（コピーした URL が相対にならない）
  - api の SSR のページの「EZO ROAD で開く」は `${SIM_PUBLIC_URL}/t/{id}?app=1`（R2）
- R11: 手順書（`docs/runbooks/2026-11-05-deploy-a-vercel-turso.md`）
  - アカウント・プロジェクト・Turso の DB 2 つ（production・preview）とトークン・Blob のストア・環境変数（Production・Preview ごとに必須・既定・秘密の表）・GitHub の連携・最初のマイグレーション・デプロイの確かめ方・Anthropic のコンソールの支出の上限
  - アカウントの作成・支払い・秘密の値の入力はユーザーの作業と明記する。PWA が範囲外であることを 1 行書く
  - Preview と Production は DB を分ける。Preview の `CLAUDE_DAILY_CALL_LIMIT` は 50

## ユースケース

### UC-1: bundle が Node で読める（R1・R3・R5）

- **Given**: `vite.vercel.config.ts` で作った `handler.mjs`
- **When**: Node（22）で import し、Vercel の env で `fetch(new Request(".../health"))`
- **Then**: 200。`@antler/*` は bundle の中、`node_modules` は外。ネイティブの libsql を読まない

### UC-2: 数えが Turso でインスタンスをまたぐ（R7）

- **Given**: 同じ DB を見る 2 つの Hono アプリ（2 つのインスタンス）
- **When**: 同じ IP から交互に要求する
- **Then**: 2 つの和で上限に当たる。表に IP が無い

### UC-3: Capture が Blob と Turso に置かれる（R9）

- **Given**: `BlobCaptureRepository`（偽の画像の置き場所）
- **When**: `POST /api/captures`
- **Then**: 201・行 1 つ・画像 1 つ。同じ再送は 200、違う本文は 409、上限は 503

### UC-4: マイグレーション（R6）

- **Given**: 空の DB
- **When**: `db:migrate` を流す（2 回）
- **Then**: 表と版ができ、2 回目も壊れない。流す前の Vercel の組み立ては失敗（503）、流したあとは 200

## 状態パターン

### S-1: マイグレーション前に出してしまった

- **Given**: 表の無い（または版の古い）Turso → **Then**: 組み立てが失敗し、`/health` も含めすべての要求が 503 `UNAVAILABLE`。ログ `vercel.boot_failed`（`SchemaOutdatedError`）。手順書の確かめ（`/health` が 200）で気づく。マイグレーションを流せば、次の要求から直る

### S-2: env の付け忘れ

- **Given**: `TURSO_AUTH_TOKEN` が無い → **Then**: どの要求も 503 `UNAVAILABLE`。ログ `vercel.boot_failed` に変数の名前。値は出ない

### S-3: Turso が一時的に落ちる

- **Given**: DB に届かない → **Then**: レート制限はインスタンスのメモリで数える（warn）。DB を使う操作は 500。`/health/ready` は 503

## Questions（Deferred のみ残存可）

決着済み（2026-11-05。ユーザー判断と推奨で決定。PR にも書く）:

- ホスティング・DB・画像 → Vercel・Turso・Vercel Blob（非公開）（ユーザー判断）
- プロジェクトの数と形 → 1 つ（Root は `apps/sim`）。sim は静的、api は同じプロジェクトの関数。`/api/*` と `/t/*` を関数へ（推奨で決定）
- レート制限の数え先 → Turso の表。Redis は使わない。同時呼び出しの上限はインスタンスごと（推奨で決定）
- 表の作成 → デプロイの前に 1 回流すマイグレーション。ローカルとテストは今までどおり起動時（推奨で決定）
- Preview と Production → DB を分ける。Preview の 1 日の上限は 50（推奨で決定）
- 関数の TS の変換 → Vercel のファイルごとの変換は使わず、Vite の SSR で bundle（`vercel build` の試しで、`@antler/schema` が拡張子なしの import のまま出ることを確かめた）
- `/t/:id` の衝突 → SSR に渡し、SSR の「EZO ROAD で開く」を `?app=1` にする（推奨で決定）
- `/health` → 関数へ書き換える（推奨で決定）
- IP → Vercel ではヘッダから取る（env に頼らない）。XFF は Vercel が上書きする 1 つの値（公式の資料）
- Capture → 画像は Blob、本文と数えは Turso。名前は画像の sha256 の全桁（推奨で決定）
- レート制限の鍵 → HMAC で表に IP を置かない（plan-trip の threat.md「IP は保存しない」を守る）
- Turso に届かないときのレート制限 → インスタンスのメモリで数える（Turso を待って止めない。上限なしにもしない。推奨で決定。security-auditor W2）。版が古い DB は組み立てで全部止める（spec-adversary W2）
- Capture の順番 → 行を `pending` で先に取り、画像を置いて `done` にする（spec-adversary W1。推奨で決定）
- レート制限の書き込みの量 → 上限を超えた鍵は窓の終わりまでメモリで 429（DB に書かない）。Vercel Firewall のレート制限は手順書で勧める（spec-adversary W4。推奨で決定）
- Preview → Deployment Protection（Vercel のログインの人だけ）を必須にする。Anthropic のキーは Preview と Production で分ける（spec-adversary W。推奨で決定）
- レート制限の scope → route のファイルに名前を書く（必須）
- region → `hnd1`（東京）。Turso も東京（`aws-ap-northeast-1`）（推奨で決定）

- 解決済み（2026-11-06 og-font。ユーザーが OFL の同梱を許可し、Noto Sans JP / TC / KR を同梱した。下は元の Deferred）: [Deferred: 担当=ユーザー（フォントのライセンスの判断。CLAUDE.md のアセットは CC0 / CC-BY / 自作のみ。Noto Sans JP は OFL）/ 期日=2026-11-07（デモの前）/ 暫定挙動=Vercel の関数では `OG_FONT_FILES` が空でシステムのフォントを読む。CJK のフォントが無いので OG 画像（`/t/:id/og.png`）の日本語が四角になりうる。SSR のページ（HTML）と sim の A-7 は端末のフォントで正しく出る] OG 画像の日本語のフォント
- [Deferred: 担当=人 B（dataset）/ 期日=2026-11-08 / 暫定挙動=Vercel で受けた Capture は Turso の `captures` と Blob の `captures/images/` にある。`dataset/` はまだ読まない（ローカルの `CAPTURES_DIR` だけ）。取り込みのスクリプト（行と画像を `CAPTURES_DIR` の形に書き出す）は別 feature] Blob からの Capture の取り込み
- [Deferred: 担当=ユーザー（実際のデプロイ）/ 期日=2026-11-07 / 暫定挙動=次の 5 つは実際のデプロイでしか確かめられない。手順書の「デプロイの確かめ方」で確かめる: (1) `/api/(.*)` → 関数の書き換えのあと、関数の `request.url` が元のパスのままか、Vercel が `export default { fetch }` の形を受けるか（`/health` が 200 なら両方確か。500 は関数の形・読み込み）、(2) `@resvg/resvg-js` の Linux のネイティブが関数に入り動くか（`/t/:id/og.png` が 200 の PNG）、(3) Blob の OIDC の資格で非公開の put が通るか（Capture の 201）、(4) `@libsql/client/http` で Drizzle のトランザクション（`DrizzleUnitOfWork`）が Turso に通るか（`POST /api/trips` を最後まで通して 201）、(5) 利用者が付けた `x-vercel-forwarded-for`・`x-forwarded-for` を Vercel が上書きするか（偽のヘッダを付けて `POST /api/trips` を 11 回 → 11 回目が 429）] 実際のデプロイでの確かめ
- [Deferred: 担当=ユーザー（PO。edge-capture の保持期間と同じ判断）/ 期日=2026-11-08 / 暫定挙動=Vercel で受けた Capture（車外の検知フレーム。他人や車のナンバーが写りうる）は、消す仕組みが無く Blob と Turso に残る。上限（件数・バイト）で増え方だけを止める。消すときは Blob のダッシュボードと `captures` の表から手で消す] Vercel での Capture の保持期間

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: `vite.vercel.config.ts` で bundle を作り、Node で `handler.mjs` を import して Vercel の env（`https://` の Turso の URL・トークン・Blob の資格・`VERCEL_ENV=preview`・`VERCEL_URL`）で `fetch` を呼ぶ: `/health` 200、`/api/nope` 404 の JSON。bundle に `from './common'` のような拡張子なしの相対 import と `@antler/` の import が無く、`libsql` のネイティブの import が実行の経路に無い。build のときの env に入れた目印の秘密が bundle に焼き込まれていない（版の検査は Turso に届かないので、組み立ては DB を差し替えて通す）
- [x] AC-2: 同じ DB（file）を見る 2 つの組み立て（Vercel の組み立て。DB と画像の置き場所は di の差し込み口から file の DB と偽物を渡す。env の `file:` の抜け道は作らない）で、同じ IP（`x-vercel-forwarded-for`）から `POST /api/trips`（10/分）を交互に 11 回 → 11 回目が 429（10 回目までは本文の検査の 400）。別の IP は 429 にならない。`rate_limit_hits` のどの列にも IP の文字列が無い
- [x] AC-3: Vercel の組み立てで `POST /api/captures` → 201、Turso の `captures` に 1 行、画像の置き場所に `captures/images/{key}-{sha256}.jpg` が 1 つ。同じ再送 → 200（`Idempotent-Replayed`）、違う本文 → 409
- [x] AC-4: 空の DB で Vercel の組み立て → `/health` も 503 `UNAVAILABLE`。`runMigration` を流したあと → 次の要求から `/health` 200・`/health/ready` 200

UC-1 入口と bundle:

- [x] VH-1a: 組み立ての失敗 → 503 `UNAVAILABLE`。応答に env の名前・メッセージが無い。ログ `vercel.boot_failed` に名前とメッセージ。次の要求でもう一度組み立てる
- [x] VH-1b: 同時の最初の要求 2 つで組み立ては 1 回
- [x] VH-1c: 入口は表を作らない（空の DB で組み立てても表が増えない）
- [x] VH-1d: 版の古い DB（`schema_meta` の版が 1）→ 組み立ての失敗で全部 503。成功した組み立てのあとは版を見に行かない
- [x] CFG-1d: `apps/sim/vercel.json`: framework `vite`・`buildCommand` `npm run build:vercel`・`outputDirectory` `dist`・関数 `api/index.mjs` の `maxDuration` 60・region `hnd1`・書き換えの順（`/api/(.*)`・`/health`・`/health/ready`・`/t/:id/og.png`・`/t/:id`（`missing` の `app`）・最後に `/(.*)` → `/index.html`）
- [x] CFG-1e: `apps/sim/api/index.mjs` は bundle の再輸出だけ。`apps/sim/package.json` に `build:vercel` と `engines.node` 22

UC-2 環境変数:

- [x] ENV-2a: 公開の URL・`CORS_ORIGINS` の既定: production は `VERCEL_PROJECT_PRODUCTION_URL`、preview は `VERCEL_BRANCH_URL`、無ければ `VERCEL_URL`。明示が勝つ。Vercel の値も明示も無ければ何も足さない
- [x] ENV-2b: Vercel の検査: `file:` の URL・トークンなし・Blob の資格なし → `EnvError`（名前つき・値なし）。`libsql://`・`https://` とトークンと（`BLOB_STORE_ID` か `BLOB_READ_WRITE_TOKEN`）→ 通る
- [x] ENV-2c: ローカルの `loadEnv`: `TURSO_AUTH_TOKEN` は任意。`TRIPS_DB_URL` が `libsql://` でトークンなし → `EnvError`。`file:` は今までどおり

UC-3 DB とマイグレーション:

- [x] DB-3a: `openRemoteDatabase` は `libsql://` を HTTP のクライアント（`protocol` が `http`）で開く。`file:` は拒む。クライアントの `fetch` は 10 秒で打ち切る（答えない fetch が `AbortSignal` で止まる）
- [x] MIG-3f: 版の表が無い今までの手元の DB（`trips` に行がある）に `ensureSchema` → 版 2 になり、既存の行は消えない
- [x] MIG-3b: `ensureSchema` で `rate_limit_hits`・`captures`・`schema_meta` ができ、版が `SCHEMA_VERSION`。2 回流しても壊れない。版は下がらない
- [x] MIG-3c: `checkSchema`: 空の DB・古い版 → `SchemaOutdatedError`。`ensureSchema` のあと → 通る
- [x] MIG-3d: `runMigration`（コマンドの中身）: file の URL で表を作って版を返す。出力にトークンが出ない。`--env-file` を読む
- [x] MIG-3e: ローカルの `buildContainer(source)` は今までどおり起動時に表を作る（版も書く）

UC-4 レート制限:

- [x] RL-4a: 数えを差さなければ今までどおりメモリ（既存の rate-limit のテストが Green）
- [x] RL-4b: 差した数えで数え、上限を超えたら 429 と `Retry-After`（窓の終わりまで）。`RateLimit-Remaining` が出る
- [x] RL-4c: scope は `rateLimit` の名前。同じ `rateLimit` を 2 つの route で使えば共有、別の名前は別に数える。route のファイルの名前がすべて違う（同じ名前で別の上限を持たない）
- [x] RL-4d: 数えが失敗（null）→ このインスタンスのメモリで数える（上限を超えたら 429）。warn は 1 分に 1 回まで
- [x] RL-4e: `LibsqlRateLimitCounter`: 同じ窓で 1・2・3、次の窓で 1。別の鍵は別。`resetAt` は窓の終わり。DB のエラーで null
- [x] RL-4f: 窓が過ぎた行を、1 分に 1 回まで消す
- [x] RL-4g: 鍵は HMAC（同じ IP・同じ scope で同じ値、scope が違えば違う値、秘密が違えば違う値）。表に IP が無い
- [x] RL-4h: 数えが 2 秒で答えない → null（メモリで数える）
- [x] RL-4i: 上限を超えた鍵は、窓の終わりまで数えを呼ばずに 429（`Retry-After` は残りの秒）。窓が過ぎたらまた数えを呼ぶ。覚える鍵は 10,000 まで

UC-5 IP:

- [x] IP-5a: `vercelClientIp`: `x-vercel-forwarded-for` の右端 → `x-real-ip` → `x-forwarded-for` の右端 → 無ければ undefined。空白・空の値を飛ばす
- [x] IP-5b: Vercel の組み立ての鍵は `TRUST_PROXY` に関係なくヘッダから取る。IPv6 は /64 にまとまる

UC-6 Capture（Blob）:

- [x] CAP-6a: `create` → 行を `pending` で取り、画像を `captures/images/{key}-{sha256}.{ext}`（非公開・上書き可）に置き、行を `done` にする。`created`
- [x] CAP-6b: 同じ key が既にある（`done`・90 秒以内の `pending`）→ `exists` と既存の本文のハッシュ。画像は置かない
- [x] CAP-6c: 画像を置けない → 例外。自分の `pending` の行は消える（再送で `created`）
- [x] CAP-6d: `find`（無い → null、`done` と 90 秒以内の `pending` → ハッシュ、90 秒より古い `pending` → null）・`stats`（`pending` も含む件数とバイト数の和。インスタンスをまたいで同じ値）
- [x] CAP-6g: 行を取れない（INSERT が例外）→ 例外。画像は置かない（INSERT が失敗し続けても Blob が増えない）
- [x] CAP-6h: 90 秒より古い `pending` は `create` が引き継ぐ（`created`）。90 秒以内は引き継がない
- [x] CAP-6i: `done` にできない → 例外。画像は残り、行は `pending`
- [x] CAP-6e: 不正な key（`..` など）→ 例外（置き場所の名前に使う前に止める）
- [x] CAP-6f: Vercel Blob の置き場所: `put` に `access: 'private'`・`allowOverwrite: true`・`addRandomSuffix: false`・`contentType` を渡す（消す口は持たない）

UC-7 record の URL:

- [x] REC-7a: SSR のページの「EZO ROAD で開く」が `${SIM_PUBLIC_URL}/t/{id}?app=1`
- [x] REC-7b: sim の `recordShareUrl`・`recordImageUrl` は `VITE_API_BASE_URL` が空ならページのオリジンを付けた絶対の URL。値があれば今までどおり

認可（threat.md の ❌ セル）:

- [x] AUTH-1: ヘッダを偽っても枠を増やせない: Vercel の組み立ては `x-vercel-forwarded-for` を先に読み、利用者が足した `x-forwarded-for` の左側は使わない
- [x] AUTH-2: レート制限の表と Capture の表のどの列にも IP が無い
- [x] AUTH-3: Capture の画像の読み出し・一覧・削除の HTTP の口が無い（`GET /api/captures`・`GET /api/captures/:id`・`DELETE` は 404）
- [x] AUTH-4: マイグレーションの HTTP の口が無い（`POST /api/migrate` などは 404）。入口は表を作らない
- [x] AUTH-5: 起動の失敗の応答に env の名前・値・例外のメッセージが無い
- [x] AUTH-6: `/health/ready` の応答は検査の名前と `unavailable` だけ（DB の URL・エラーの文が無い）
- [x] AUTH-7: 秘密を知らなければ鍵から IP を戻せない: 同じ IP でも秘密が違えば鍵が違い、鍵は IP の文字列を含まない

障害（resilience.md の失敗モード）:

- [x] FAIL-1: Turso に届かない（組み立てのあと）→ レート制限はメモリで数える（11 回目は 429）。`/health/ready` は 503
- [x] FAIL-2: Blob に置けない → Capture は 500（行なし）。再送で 201
- [x] FAIL-3: 行を `done` にできない（画像は置いた）→ 500。90 秒より古くなった `pending` を再送が引き継ぎ、同じ名前の画像を上書きして 201（画像は 1 つ）

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule                 | 語彙                                       | 置き場所                                                            | 証明 |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------- | ---- |
| R1: 形               | vercel.json / build:vercel                 | apps/sim/vercel.json                                                | UC-1 |
| R1: bundle           | vite.vercel.config                         | apps/api/vite.vercel.config.ts                                      | UC-1 |
| R3: 入口             | createVercelHandler                        | apps/api/src/vercel.ts                                              | UC-1 |
| R4: env              | withVercelDefaults / loadVercelEnv         | apps/api/src/infrastructure/config/vercel-env.ts                    | UC-2 |
| R5: 接続             | openRemoteDatabase                         | apps/api/src/infrastructure/db/remote-connection.ts                 | UC-3 |
| R6: マイグレーション | ensureSchema / checkSchema / runMigration  | apps/api/src/infrastructure/db/migrate.ts                           | UC-4 |
| R7: 数え             | RateLimitCounter / LibsqlRateLimitCounter  | apps/api/src/infrastructure/system/rate-limit-counter.ts            | UC-2 |
| R8: IP               | vercelClientIp                             | apps/api/src/infrastructure/http/middleware/vercel-client-ip.ts     | UC-5 |
| R9: Capture          | BlobCaptureRepository                      | apps/api/src/infrastructure/repositories/blob-capture.repository.ts | UC-3 |
| R9: 画像             | VercelBlobImageStore                       | apps/api/src/infrastructure/repositories/vercel-blob-image-store.ts | UC-3 |
| R3・R7・R9: 組み立て | createVercelPlatform / createLocalPlatform | apps/api/src/di/                                                    | UC-1 |

## 非機能要件

- [x] 性能: レート制限の数えは 1 要求に Turso への 1 文（窓の掃除は 1 分に 1 回まで）。関数の region と Turso を東京にそろえる
- [x] 可用性: Turso に届かないとき、レート制限はインスタンスのメモリで数える。起動の失敗は 503 で、次の要求で直る
- [x] セキュリティ: 秘密（`ANTHROPIC_API_KEY`・`OWNER_TOKEN_SECRET`・`TURSO_AUTH_TOKEN`・`BLOB_READ_WRITE_TOKEN`）をリポジトリ・ログ・応答・`VITE_` の変数に出さない
- [x] プライバシー: IP は表に置かない（HMAC）。Capture の規約（位置を `roadSegment` に丸める・同意済みだけ）は edge-capture のまま
- [x] 既存のテストが Green（api・sim）。カバレッジ 70% 以上。ローカルの `npm run dev:api` は今までどおり
