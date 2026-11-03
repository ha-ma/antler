# plan-trip の api（POST /api/trips）— 実装の報告

日付: 2026-11-03 / ブランチ: feat/plan-trip（コミットしていない）/ 書いた範囲: `apps/api/` だけ（packages・apps/sim には触れていない）

## 結果

- `cd apps/api && npx --no-install vitest run` → **14 ファイル・109 件すべて通過**（HMAC への変更後）（カバレッジ: 行 98.6%・分岐 88.2%・関数 98.1%。下限 70%）
- `npx --no-install tsc --noEmit` → エラーなし
- `npx --no-install eslint src/` → エラーなし
- layer-guard → **Critical 0**。Warning のうち `DAY_MS` の重複は直した。残りは下の「未解決の点」に記録した
- Prettier はプロジェクトの設定で `apps/api/src`・`apps/api/tests` に当てた（コミット時の lint-staged と同じ）

## 作ったファイル

domain（純粋 TS。外部パッケージを import しない）

- `src/domain/trips/models/trip-writing.ts`: `TripWriting`・`TripWritingBrief`・`LocalizedText`・`TRIP_LANGS`
- `src/domain/trips/models/trip-request.ts`: 冪等キーの行 `TripRequest`
- `src/domain/trips/rules/trip-rules.ts`: id 8 文字・seed 上限・作り直しの回数・2 分・24 時間・JST
- `src/domain/trips/errors/trip-errors.ts`: `TripInputError`・`TripInProgressError`・`IdempotencyMismatchError`・`DailyLimitError`・`TripWriterError(reason)`・`TripIdCollisionError`
- `src/domain/trips/policies/trip-writing-policy.ts`: `validateTripWriting`（4 言語・空・日数と順・タイトル 200 字・説明 400 字・絵文字・3 桁以上の数・`%％件円`）
- `src/domain/trips/policies/trip-identity-policy.ts`: `createTripIdentity`（棄却法で偏りのない英数 8 文字・seed 0〜2³²−1、乱数は関数で受ける）、`ownerTokenMaterial`・`idempotencyKeyMaterial`・`canonicalJson`
- `src/domain/trips/policies/daily-limit-policy.ts`: `jstDayStartMs`・`ensureWithinDailyLimit`
- `src/domain/trips/policies/idempotency-policy.ts`: `decideOnExistingRequest`（replay / reclaim / 409 の判断）

application

- `src/application/ports/repositories/trip.repository.ts`（`TripRepository`・`StoredTrip`）、`ports/unit-of-work.ts`、`ports/gateways/trip-writer.gateway.ts`、`ports/security/hasher.ts`・`random-source.ts`、`ports/system/clock.ts`・`event-log.ts`
- `src/application/usecases/trips/create-trip.usecase.ts`、`dto.ts`、`writing-brief.ts`（TripInput＋しおり＋リスク → Claude の材料）

infrastructure

- `src/infrastructure/db/schema.ts`・`connection.ts`（`file:` のフォルダを作る）・`migrate.ts`（`CREATE TABLE IF NOT EXISTS` trips / trip_requests）・`drizzle-unit-of-work.ts`
- `src/infrastructure/repositories/drizzle-trip.repository.ts`（衝突は `ON CONFLICT DO NOTHING` の件数で判定、作り直しは status＋updated_at の CAS）
- `src/infrastructure/gateways/claude-trip-writer.gateway.ts`、`gateways/prompts/hokkaido-travel-knowledge.ts`（道東・道央の観光知識）、`gateways/prompts/deer-safety-writing.ts`（鹿事故の注意喚起の書き方）
- `src/infrastructure/security/node-crypto.ts`（乱数・SHA-256）、`src/infrastructure/system/system-clock.ts`
- `src/infrastructure/http/schemas/trip.schema.ts`（body は `@antler/trip` の `TripInputSchema`、ヘッダは `idempotency-key` の UUID）、`routes/trip.routes.ts`、`validation.ts`、`middleware/client-ip.ts`
- テスト用のフェイク: `apps/api/tests/factories/trips.ts`

変更

- `src/infrastructure/config/env.ts`: `ANTHROPIC_API_KEY`（`z.string().min(1)`・既定値なし）、`TRIPS_DAILY_LIMIT`（既定 200）、`TRIPS_DB_URL`（既定 `file:./data/trips.db`）、`TRUST_PROXY`（`true`/`false`、既定 false）
- `src/infrastructure/http/error-mapper.ts`: 400 INVALID_INPUT / IDEMPOTENCY_KEY_REQUIRED、409 IN_PROGRESS / IDEMPOTENCY_MISMATCH、429 DAILY_LIMIT、502 WRITER_FAILED。読めない JSON（Hono の 400）も INVALID_INPUT
- `src/infrastructure/http/app.ts`: `trips` を任意の依存で受けて route を載せる。CORS に `Idempotency-Key` を許可し `Idempotent-Replayed`・`Retry-After` を公開。4xx と 502 のログは warn
- `src/di/container.ts`: **`buildContainer` を async に**（起動時に表を作る）。readiness に sqlite（`SELECT 1`）。`src/index.ts` は top-level await
- `apps/api/tsconfig.json`: `module: ESNext`・`moduleResolution: Bundler`（NodeNext だと `@antler/schema`・`@antler/trip` の拡張子なしの相対 import が型検査で落ちるため。sim と同じ）、`include` に `tests`
- `apps/api/.env.example`: 上の 4 つを追記
- 既存テストの更新: `env.test.ts`（新しい欄）、`container.test.ts`（async・一時ファイルの DB）

## 流れ（create-trip.usecase.ts）

1. 冪等キーは保存しない（`sha256("antler:idempotency-key:v1:"+key)` を主キーに）。body は正規形 JSON（キーを並べ替え）のハッシュ
2. `insertPendingRequest`（主キー違反なら false）→ 既存の行を `decideOnExistingRequest` で判断: 24 時間超は作り直し / body 違い 409 MISMATCH / done は保存済みの旅を返す（`Idempotent-Replayed: true`、201）/ 2 分以内の pending は 409 IN_PROGRESS / 古い pending・failed は CAS で取り直す（取れなければ 409）
3. 1 日の上限（JST の暦日、`trips.created_at` から数える）→ 超えたら 429、Claude を呼ばない
4. `buildItinerary`・`assessRisk`（端末の値を信じない）→ Claude（rejected か検証で外れたら理由のコードを渡して 1 回だけ作り直す。時間切れ・通信・認証の失敗は作り直さない）
5. 1 つのトランザクションで `insertTrip` と `markRequestDone`。id の衝突は最初＋3 回まで作り直し
6. 3〜5 の失敗で冪等キーを failed に（旅の行は残らない）

Claude の gateway: `claude-sonnet-5-5`、`max_tokens: 4000`、`thinking: {type: 'between_tools'}`（思考で max_tokens を食わないように）、`output_config: {effort: 'medium', format: json_schema}`、system はプロンプト 2 部品をつないだ固定文（`cache_control` 付き）、`AbortSignal.timeout(30s)`＋`timeout 30s`＋`maxRetries: 1`。`stop_reason` が `max_tokens` → truncated、`refusal` → refused、JSON の形が違う → malformed。ログは理由とトークン数だけ（本文・キーを出さない）。server-side fallbacks は付けていない（仕様が「代わりの文を作らない」・モデル指定のため）。

## Test List のうち満たした ID（テスト名の先頭に付けた）

- 受け入れ: **AC-1**（`trip.routes.test.ts`。ペルソナで 201、TripPlanSchema・TripDetailsSchema を通る、days 5 日、riskScore が端末の計算と小数 2 桁で一致、4 言語、repository から読める）
- UC-1: **UC-1d**、UC-1a・UC-1b の api 側（運転 5 人・返却が出発と同時・予算 1,000,001 → 400）
- UC-2: **UC-2d**（道央の id・存在しない id → 400）
- UC-5: **UC-5a・UC-5b・UC-5c・UC-5d**（policy・usecase・gateway のテスト）
- UC-7: **UC-7a・UC-7b・UC-7c**
- 認可: **AUTH-1・AUTH-2・AUTH-3・AUTH-4・MASS-1**（入れ子の知らない欄も 400）
- 障害: **FAIL-1・FAIL-2・FAIL-3・FAIL-4・FAIL-5・FAIL-6**
- 冪等・並行: **IDEM-1・IDEM-2・IDEM-3・CONC-1・CONC-2**、**MIGR-1**

（UC-1a〜c・UC-2a〜c・UC-3・UC-4・UC-6・AC-2 は packages/trip と apps/sim の担当）

## 判断したこと（仕様に明記がなかった点）

1. **ownerToken は `HMAC-SHA256(OWNER_TOKEN_SECRET, "antler:owner-token:v1:"+key)`**（2026-11-03 にコーディネーター経由で代案に決定。保存は SHA-256 のハッシュだけ）。port は `application/ports/security/token-signer.ts`、実装は `HmacSha256TokenSigner`（`infrastructure/security/node-crypto.ts`）。env の `OWNER_TOKEN_SECRET` は `z.string().min(32)`・既定値なし。秘密を知らなければキーからトークンを計算できない。秘密を変えると発行済みのトークンはすべて無効になる。以下は、最初に入れた「秘密なしのハッシュ」の判断理由（記録として残す）: 冪等キーから導くR8「端末があきらめたあとの再試行で旅を返す」で、同じキーの再送にも同じトークンを返すため。乱数で作ると再送時に返せない（平文で持つと R7 違反）。キーは端末の UUID で、キーを持つ人＝作った人。キーそのものも DB に残さない。弱点: 端末が推測できるキーを使うとトークンも推測できる（UUID であることはヘッダの検証で確かめる）。ヘッダがプロキシ・CDN のアクセスログに残るとトークンを計算できる。キーの 24 時間の期限はトークンの期限にならない。**代案**: サーバーの秘密を足して `HMAC(OWNER_TOKEN_SECRET, key)` にする（env が 1 つ増える）。どちらにするかはユーザーの判断。record の feature で削除を作るときに、この前提を引き継ぐ
2. **1 日の上限は冪等キーの判断の後**に数える（依頼の順）。resilience.md は「pending の INSERT の前に数える」だが、その順だと上限に達した日に作り終えた旅の再送まで 429 になる。上限で止めたキーは failed にするので、翌日同じキーで作り直せる
3. **TRUST_PROXY のときは X-Forwarded-For の右端**を使う（左側は利用者が書ける）。プロキシが 1 段の前提
4. done の再送は **201** と `Idempotent-Replayed: true`（AC の形と同じ本文）
5. body の上限 16 KB（超えたら 413 INVALID_INPUT）
6. 「件」「円」は文字として禁止（仕様のとおり）。「条件」「円山」も外れになるので、プロンプトで別の言い方を指示した

## 未解決の点

- **最優先: 実際の Claude での確認をしていない**（API キーを使う呼び出しは費用がかかるので未実施）。`thinking: between_tools`＋`output_config.effort`＋`format: json_schema`（`type: integer` を含む）の組み合わせを API が受け付けなければ、gateway は 400 を upstream として扱い、**すべての要求が 502** になる。テストでは捕まらない。PR の前に実キーで 1 回呼んで確かめる。あわせて 4,000 トークンに収まるか、「件」「円」を避けられるかも `trip.writer.invalid` の理由で見る

## sim（useCreateTrip）向けの契約

- ヘッダ `Idempotency-Key` は UUID（`crypto.randomUUID()` でよい）。無い・形が違う → 400 `IDEMPOTENCY_KEY_REQUIRED`
- 同じキーの再送で作り終えていれば **201** と同じ本文、ヘッダ `Idempotent-Replayed: true`。処理中は 409 `IN_PROGRESS`
- body が 16 KB を超える → 413。エラーの本文は常に `{error:{code,message}}`
- 他の人への影響: `buildContainer` が async になった。`apps/api/tsconfig.json` は `module: ESNext`・`moduleResolution: Bundler`
- layer-guard の Warning（直していない）:
  - repository の `markRequestFailed` が `status='pending'` のときだけ更新する（done を failed に戻さない安全柵）。状態遷移の判断として policy に出すかは任意
  - id の衝突が続いたとき・done の行が指す旅が無いときは素の `Error`（500 INTERNAL_ERROR）。resilience.md の「それでも衝突なら 500」には合っている
  - bodyLimit（413）と既存の rate-limit（429）は route / middleware で直接 JSON を返していて、error-mapper を通らない（形は `{error:{code,message}}` でそろえてある）
  - プロンプトの禁止規則と `validateTripWriting` の規則が二重（変えるときは両方）
  - readiness の `SELECT 1` が container にある
- `apps/api/CLAUDE.md` の「application は domain のみ」に対し、usecase が `@antler/trip`・`@antler/schema` を import している（仕様の Rule→語彙対応どおり。ESLint は通る）
- SQLite の同時書き込み（別接続のトランザクション）で `SQLITE_BUSY` の待ちを設定していない。1 プロセス・少量の前提
- 冪等キーの行と旅の行の削除（24 時間後・保持期間）は未実装（Deferred のまま）

## 追記: PR 前のレビュー指摘への対応（docs/reports/2026-11-03-security-plan-trip.md）

vitest 14 ファイル・125 件通過、tsc・eslint エラーなし。コミットしていない。

- **W1（1 日の上限）**: 数えるのを「保存した旅」から「Claude の呼び出し」に変えた。新しい表 `trip_writer_calls(day_start, calls)` に、呼び出しのたびに `UPSERT ... RETURNING` で当日の通し番号を進める（同時でも重ならない）。作り直しの 1 回・時間切れ・検証で外れた呼び出しも数える。番号が上限を超えたら呼ばずに 429 DAILY_LIMIT（作り直しの直前でも）。env は `TRIPS_DAILY_LIMIT` を廃止し、`CLAUDE_DAILY_CALL_LIMIT`（既定 400 = 旅 200 件 × 2 回）にした。同時呼び出しは `CLAUDE_MAX_CONCURRENT_CALLS`（既定 4）で、空きが無ければ数えずに 503 `WRITER_BUSY`（`TripWriterBusyError`、port `ConcurrencyLimiter`、実装 `InProcessConcurrencyLimiter`）。repository の `countTripsCreatedSince` は削除。SDK の自動再試行（maxRetries 1）は 1 回の呼び出しの中なので数に入らない（実際の HTTP 呼び出しは最大で上限の 2 倍）
- **W2**: レート制限の Map を窓ごとに掃除し、鍵の数に上限（既定 10,000、超えたら古いものから忘れる）。`rateLimitBucket` で IPv6 を /64 に、IPv4 を写した IPv6 を IPv4 にまとめる。`.env.example` に TRUST_PROXY の使い分け（プロキシの段数・偽装の危険・real_ip）を書いた
- **W3**: `NODE_ENV` の既定を `production` に。`npm run dev` は `NODE_ENV=development tsx watch src/index.ts`。detail を出すのは `NODE_ENV === 'development'` だけで、未設定・test・production では出ないことを container のテストで確かめた（DB を閉じて 500 を起こす）
- **Info**: `Idempotency-Key` を `z.uuidv4()` に（v1・nil・variant 違いは 400）
- **契約 W-2**: `validateTripWriting` に文字種の検査（code `script`）。ko はハングル、ja はかなか漢字、en は ASCII の英字を含む。zh はかなとハングルを含まない。外れたら他の検証と同じく 1 回だけ作り直す
- 仕様（functional.md R9・resilience.md・threat.md）の env 名と「呼び出しで数える」「503 WRITER_BUSY」の文言は未反映（コーディネーターが直す）
