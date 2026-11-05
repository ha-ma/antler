# code-reviewer: deploy-a（feat/deploy-a）

対象: `docs/specs/deploy-a/functional.md`（R1〜R11・Test List）と `resilience.md`。
読んだもの: 依頼にあった src 一式、`apps/api/package.json`、`rate-limit` を使う routes の name、`decideOnExistingCapture`、`clientIpKey`、`tests/vercel/*.test.ts` と `harness.ts`。
テスト・ビルドは実行していない（コードの読みだけ。実行で確かめた指摘は無い）。

件数: Critical 1 / Warning 9 / Info 12

先に直す順: C1（初回デプロイで全要求が 503 になりうる。要確認）→ W1（`pending` の 200 でキャプチャが静かに失われる。小さい修正）→ W6・W7。それ以外は次に回してよい。

## Critical（修正必須）

### C1. 起動のたびに読む鹿ゾーンの GeoJSON が、Vercel の関数に入る保証が無い

- `apps/api/src/infrastructure/gateways/file-road-catalog.gateway.ts:13-20`、`apps/api/src/di/container.ts:87`、`apps/sim/vercel.json`
- `FileRoadCatalogGateway` は **組み立て（boot）の中で** `createRequire(import.meta.url).resolve('@antler/zones/zones.geojson')` と `readFileSync` を実行する。bundle では `@antler/zones` が `handler.mjs` に入る（インライン）が、この GeoJSON は import 文ではなく実行時の `fs` 読みなので bundle に入らない。Vercel の関数に入るのは、入口から import を辿って（nft）集めたファイルだけで、`createRequire` + `require.resolve` を nft が辿るかは確かめられていない。入らなければ、組み立てが `Cannot find module` で失敗 → **`/health` を含む全要求が 503 `UNAVAILABLE`**（初回デプロイで即座に見える。静かな失敗ではない）。
- `vercel.json` に `includeFiles` が無く、spec の Deferred（実際のデプロイでの確かめ 5 項目）・手順書・`bundle.test.ts` のどれにも出てこない。`bundle.test.ts` は repo の中で動くので `node_modules/@antler/zones` のシンボリックリンクから解決でき、この問題を捕まえられない（`/health` は組み立てを通るので boot の読みは通るが、それは repo の中だから）。
- 確かめ方: `vercel build` を実行して `.vercel/output/functions/api/index.func` の中に `zones.geojson` があるか見る（spec が TS の変換で使った方法と同じ）。無ければ次のどれか:
  1. `vercel.json` に `"functions": { "api/index.mjs": { "maxDuration": 60, "includeFiles": "../../packages/zones/data/zones.geojson" } }`（パスの基準は `vercel build` で確かめる）。ただし `createRequire(import.meta.url)` の解決先は `apps/api/dist/vercel/` から上へ辿った `node_modules/@antler/zones` になるので、関数の中のその位置にファイルが来るかも同じ出力で確かめる。
  2. bundle に入れる: `vite.vercel.config.ts` で `@antler/zones/zones.geojson` を `?raw` で読む alias（Vercel の bundle だけ）にし、`FileRoadCatalogGateway` に GeoJSON の文字列を渡す口を足す（`Platform` に `roadCatalog` を持たせるのが依存の向きとして素直）。nft にも `includeFiles` にも頼らない。
- AC-1 に「`GET /api/trips/:id/day/1` が 200」を足し、子プロセスを **repo の外に置いた bundle のコピー**（`node_modules` のシンボリックリンクが効かない場所）で動かすと、この種の欠落を CI で拾える。
- `vercel build` で入っていると分かれば Warning に下げてよい。

その他、Capture の `pending`→`done`、レート制限、組み立ての記憶、マイグレーションの通常の経路で壊れる箇所は見つからなかった。下の Warning は「まれな経路で静かに間違う」「テストが ID の主張を証明していない」もの。

## Warning（推奨）

### W1. `pending` の再送が 200 になり、`done` にならないまま残る（データの取りこぼし）

- `apps/api/src/infrastructure/repositories/blob-capture.repository.ts:25, 84-87, 116-118`、`submit-capture.usecase.ts:55-59, 71-75`
- 経路: 手順 3（`done` への UPDATE）が Turso の一時障害で失敗 → 500 → クライアントが再送 → 10 分以内なので `find` が `pending` の本文ハッシュを返し、同じ本文なので **200 `Idempotent-Replayed`**。クライアントは成功とみなして送り直さない。行は `pending` のまま、10 分を過ぎても誰も引き継がない。`done` が完成のしるしなので、画像があっても dataset の対象にならない。
- 同じ構造は「同時の同じ id」でも起きる。先に取った要求が画像の put で失敗して行を消すと、負けた側が先に返した 200 は嘘になる。
- `CAP-6i` のテスト（`blob-capture.test.ts:154`）が `exists` を期待していて、この挙動を固定している。spec の「10 分以内の再送は既存（200）」どおりなので仕様違反ではないが、仕様の側の穴。
- **この Warning は Critical ではない（spec どおり。壊れるのは 1 件の Capture）が、「Warning は次に回す」の運用だと、静かな取りこぼしが出荷される。直すなら今が安い（フィールド 1 つと分岐 1 つ）。**
- 修正案:
  1. **（本命）`pending` を呼び出し側に見せ、未完成を 200 にしない。** `ExistingCapture` を `{ bodyHash: string; complete: boolean }` にし（`find` は `status === 'done'` を `complete` に）、`SubmitCaptureUseCase` は、本文ハッシュが同じで `complete === false` のとき、ドメインの例外（例 `CaptureInProgressError`）を投げ、`error-mapper.ts` で 503 + `Retry-After: 30` に対応づける。本文ハッシュが違えば従来どおり 409。`FileCaptureRepository` は常に `complete: true`。edge の送信側が 503 + `Retry-After` を再試行すること（edge-capture の A 系）を確かめる。
  2. 補助: `STALE_PENDING_MS` を関数の `maxDuration`（60 秒）+ 余裕（例 `90_000`）に下げる。関数は 60 秒で止まるので、それより古い `pending` は死んだ要求で、再送がすぐ引き継げる。**これだけでは、90 秒以内の再送が 200 になる穴は塞がらない**（1. が要る）。10 分にした根拠は spec に無い。
  3. `CAP-6i`（`blob-capture.test.ts:154`）の期待を、`exists` から「`exists` + `complete: false`」に直し、use case のテストに「同じハッシュ・未完成 → 再試行可能な例外」を足す。

### W2. 手順 3 の結果を見ていない（引き継がれたのに `created` を返す）

- `blob-capture.repository.ts:107-108`
- `mine` は `updated_at = claimedAt` を条件にしているので、引き継がれた後の UPDATE は 0 行。それでも `{ status: 'created' }`（201）を返す。実際に 60 秒の関数で 10 分の stale に当たることはまず無い（W1 の 1. で閾値を下げると現実的になる）が、「自分が取った」を守る設計なら最後も確かめる。
- 修正案:

```ts
const done = await db.update(storedCaptures).set({ status: 'done', updatedAt: nowMs() }).where(mine)
if (done.rowsAffected === 0) throw new Error('capture claim lost') // 引き継がれた。再送は exists になる
return { status: 'created' }
```

### W3. 取れなかった側の `read` が行を見つけられないと 409 になる

- `blob-capture.repository.ts:84-87` と `capture-identity-policy.ts:67`
- 手順 1 の INSERT が競合して 0 行 → `read` の間に、相手が画像の失敗で行を消すと `existing` は `null` → `existingBodyHash: null` → `decideOnExistingCapture` は `null` を 409（CaptureConflictError）にする。正しい再送が「別の本文」と言われる。
- 修正案: `existing === null` なら INSERT をもう一度試す（1 回だけ）か、例外にして 500（再送で直る）。409 は本文が本当に違うときだけにする。

```ts
if (claimed.length === 0) {
  const existing = await this.read(item.key)
  if (!existing) throw new Error('capture row vanished during claim') // 再送で直る
  return { status: 'exists', existingBodyHash: existing.bodyHash }
}
```

### W4. 同時の同じ id のテストが無い（resilience.md の行に対応するテストが無い）

- `docs/specs/deploy-a/resilience.md:19`（「片方だけが行を取る」）、`tests/vercel/blob-capture.test.ts`
- 順番どおりに呼ぶテストしか無く、`Promise.all` で 2 つ同時に `create` するケースが無い。Test List の ID にも無いが、依頼の重点（pending→done の並行）で、ここが一番壊れやすい。
- 修正案: `FakeImageGateway` に put を止める門（`gate: Promise<void>`）を足し、1 つ目を put で止めたまま 2 つ目を呼ぶ。

```ts
const gate = deferred()
images.holdPut = gate.promise
const first = repo().create(item())
await vi.waitFor(() => expect(images.puts).toBe(1))
expect(await repo().create(item())).toMatchObject({ status: 'exists' })
gate.resolve()
expect(await first).toEqual({ status: 'created' })
expect(images.puts).toBe(1)
```

あわせて `FAIL-3` を HTTP の層でも確かめる（`handler.test.ts` は `FAIL-2` だけ。`done` の UPDATE を失敗させて 500 → 時計を進めて再送 201 → 画像 1 つ）。今は repository 層の `CAP-6i` だけ。

### W5. AC-1 の「ネイティブの libsql が実行の経路に無い」を証明していない

- `apps/api/tests/vercel/bundle.test.ts:43-47, 59-68`
- 静的な正規表現を見ているのは `handler.mjs` だけ（`all` ではなく `handler`）。Rolldown が共有 chunk に `@libsql/client` の静的 import を置いても検出できない。
- 子プロセスの `smoke.mjs` 自身が `import { createClient } from '@libsql/client'` している（61 行）ので、実行時にネイティブの libsql を読んでいても、読んでいないことの証明にならない。
- 修正案: (a) 静的検査を `handler.mjs` と、`local-platform-*.mjs` 以外の全 chunk に広げる。(b) 子プロセスの準備（file の DB）は別の子で済ませ、bundle を読む子は `--import` で `module.register` した hook（`libsql`・`@libsql/client`（`/http` 以外）の解決で例外）を付けて動かす。`/health` が 200 なら実行の経路に無いと言える。

### W6. 動的 import の先（local-platform の chunk）を Vercel の関数のファイル追跡が拾うおそれ

- `apps/api/src/di/container.ts:53-56`、`apps/api/vite.vercel.config.ts:13-22`
- `import('./local-platform.js')` はリテラルの動的 import で、bundle に `local-platform-*.mjs`（`@libsql/client`・`@hono/node-server/conninfo` を静的に import）が出る（テストも `bundle.test.ts:46` でそれを期待している）。Vercel は関数の入口から import を辿って（nft）ファイルを集めるので、実行されなくてもネイティブの `libsql` とその Linux のバイナリが関数に入る可能性がある。サイズの上限（展開後 250 MB）と「ネイティブを避ける」意図（R5）に反しうる。spec の Deferred（実際のデプロイでの確かめ）にも入っていない。
- 修正案: Vercel の bundle ではローカルの部品を別の空の module にする。`vite.vercel.config.ts` に `resolve.alias`（`./local-platform.js` → `src/di/local-platform.stub.ts`、呼ばれたら `throw`）か、`defaultPlatform` を `container.ts` から出して `index.ts` から渡す形（`buildContainer` の `platform` を必須にし、ローカルの入口だけが `createLocalPlatform` を import する）。後者は `container.ts` から動的 import の分岐が消え、依存の向きも素直になる。
- 少なくとも、手順書の「デプロイの確かめ方」に「関数のサイズ・Build Logs にネイティブの libsql が入っていないか」を足す。同じ確かめ事として、`api/index.mjs` が Root Directory（`apps/sim`）の外の `../../api/dist/vercel/handler.mjs` を指すので、"Include files outside the root directory" が有効か（既定は有効）も Deferred に足す。

### W7. `--env-file` が環境にすでにある値に負ける（本番と preview の取り違え）

- `apps/api/src/infrastructure/commands/migrate-db.ts:68-79, 86-88`
- `process.loadEnvFile` は、すでにある環境変数を上書きしない。手元のシェルに `TRIPS_DB_URL`・`TURSO_AUTH_TOKEN` が export されていると（`.env` を source した、前の作業が残っている）、`--env-file .env.turso-production` を付けても別の DB にマイグレーションを流す。ログに宛先（`target`）が出るのは流した後。
- もう 1 つ、`main(argv, source, logger)` は `source` を受けるのに、env ファイルは `process.env` へ書く。`source !== process.env` のとき（テスト）は効かない。`MIG-3d` の `--env-file` のテストは読む関数を差し替えていて、この経路を通っていない。
- 修正案: `util.parseEnv`（Node 22）で読み、**ファイルを優先して** `source` に重ねる。実行の前に宛先を出す。

```ts
const fileEnv = path ? parseEnv(readFileSync(path, 'utf8')) : {}
const merged = { ...source, ...fileEnv } // 明示の引数が環境に勝つ
logger.info('db.migrating', { target: describeTarget(merged.TRIPS_DB_URL ?? '') })
const result = await runMigration(merged)
```

あわせて、`TRIPS_DB_URL` が env にもファイルにもあって値が違うときは警告（または失敗）にする。

### W8. 分単位の窓にそろえたため、実時間のテストが分の境目でまれに落ちる

- `apps/api/tests/vercel/handler.test.ts:132-138, 160-161`（`AC-2`・`IP-5b`）
- `LibsqlRateLimitCounter` の窓は `floor(now / 60_000)`（時計にそろう）で、これらのテストは `Date.now` で 11 回要求する。実行が分の境目をまたぐと 11 回目が 429 にならない（1 回の実行で数 ms〜数十 ms なので確率は 0.1% 未満だが、CI で数百回走れば出る）。メモリの窓（最初の要求から 1 分）では起きなかった種類の不安定。
- 修正案: `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(Date.UTC(2026, 10, 5, 0, 0, 10))`（窓の始まりから 10 秒）にする。`rateLimit` の `now = Date.now` は構築時に参照を取るので、`createVercelHandler` を作る前にタイマーを差し替えること。
- 同じテストの「10 回目までは 400」は `s !== 429` と弱く書かれている（spec は 400）。`toBe(400)` にすれば、本文の検査まで届いた（枠で止まっていない）ことも確かめられる。

### W9. `RL-4c` の route の名前の検査が、数字・下線・大文字の入った名前を見落とす

- `apps/api/tests/vercel/rate-limit.test.ts:99-101`
- 正規表現 `[a-z.-]+` に数字・`_` が入っていない。`trips.v2` のような名前を足すと、検査から静かに外れて重複を見逃す。下限 `>= 9` は現状ちょうど 9 件（`stop-deck.prepare`・`record.writes`・`record.reads`・`record.og`・`trip-events.record`・`captures.submit`・`trips.create`・`losses.write`・`trip-day.read`）で、1 件外れても気づく程度には効くが、2 件目は見えない。
- 修正案: `[\w.-]+` にし、下限を `toBe(9)` にして、増減したらテストを直す形にする（または、名前の登録を 1 か所の定数オブジェクトにして型で重複を許さない）。

## Info（参考）

### 良い点

- 手順 1 を「行を先に取る」にして、行が取れない間は Blob が増えない（`blob-capture.repository.ts:68-93`）。`mine`（`updated_at` 一致）で自分の行だけを消す・`done` にする作りは、引き継ぎ後に他人の行を消さない。画像の名前を中身の sha256 にして上書きを許す設計も、再送の冪等性に効く。
- `createVercelHandler` の記憶（`vercel.ts:33-45`）: Promise を 1 つ共有し、失敗のときだけ `ready === attempt` を確かめて捨てる。後から始まった別の組み立てを消さない。`attempt.catch` で未処理の拒否も出ない。`await boot()` の呼び出し側にも同じ拒否が届くので、二重に処理されない。
- レート制限の数えが 1 文（`INSERT … ON CONFLICT DO UPDATE … RETURNING`）で原子的（`rate-limit-counter.ts:89-94`）。HMAC の鍵・秘密の派生・warn の間引き・`Promise.race` + `clearTimeout` も丁寧。
- `ensureSchema` が 1 バッチ（トランザクション）で、版は `max(version, excluded.version)` で下がらない。`checkSchema` は「より新しい版」を通すので、ロールバックのデプロイが止まらない。
- テスト ID が Test List とそろっていて、`FakeImageGateway` / `openTestDb` の harness が小さい。env の `file:` の抜け道を作らず、DI の口から渡す方針も一貫している。

### I1. 窓の固定とバーストの倍

- `rate-limit-counter.ts:62-63`: 時計にそろえた固定窓なので、窓の境目をまたぐと最大 2 × limit が通る（例: 59 秒に 10 回、61 秒に 10 回）。spec が固定窓と決めていて、`POST /api/trips` の費用は 1 日の上限（DB）が守るので許容でよい。手順書か `rate-limit.ts` のコメントに「境目で最大 2 倍」と 1 行あると、ch6 の「10/分」を読む人が驚かない。

### I2. 上限を超えた鍵の記憶（`blocked`）の追い出しが「入れた順」

- `rate-limit.ts:41-48, 115-119`: 窓が過ぎたものでなく古く入れたものから捨てる。10,000 件を超える異なる IP から短時間に上限を超えさせると、まだ窓の中の鍵が追い出されて Turso に戻る。Vercel の IP が 1 つに決まる前提では現実の攻撃として弱く、Vercel Firewall を勧める（spec W4）で足りる。気づいておく程度。

### I3. 掃除の DELETE が数えのクリティカルパス（2 秒の枠）に入っている

- `rate-limit-counter.ts:80-88`: インスタンスごとに 1 分に 1 回、運の悪い 1 要求だけが DELETE の往復を待つ。DELETE が遅いと INSERT の前に 2 秒を使い切って、その要求は fail-open になる。致命的ではない。`waitUntil`（`@vercel/functions`）で関数の応答の後に回す手もあるが、依存が増えるので今のままでよい。

### I4. `rate-limit.ts` の 2 つの方式を `RateLimitCounter` の実装として揃える案

- `rate-limit.ts:99-129`: 差し込みの有無で分岐し、`entry` が `null` を取りうる。メモリの数えを `RateLimitCounter`（`MemoryRateLimitCounter`）として切り出せば、`rateLimit` は 1 つの経路になり、`entry === null` の枝と `inMemory` の分岐が消える。既存のテスト・`store` の差し込み口を壊さない形でやれるなら次の整理で。今は動いていて、この feature の範囲を超える。

### I5. `retry` の嵐

- `vercel.ts:33-45`: 組み立ての失敗は覚えないので、Turso が落ちている間は要求のたびに（同時のものは 1 つにまとまる）`checkSchema`（2 回の HTTP）を試す。spec どおりで害は小さいが、数秒の短い負のキャッシュ（失敗から 2〜5 秒は同じ失敗を返す）を入れると Turso への圧が減る。503 に `Retry-After: 5` を付けるだけでも、sim の再試行が間引かれる。

### I6. `readSchemaVersion` は 2 回の HTTP

- `migrate.ts:126-133`: `sqlite_master` を見てから `schema_meta` を読む。`/health/ready` と組み立てのたびに 2 往復。`SELECT version FROM schema_meta WHERE id = 1` を 1 回流し、`no such table` を `null` にする形なら 1 往復で済む（Tokyo の RTT でも、組み立ては 1 回だけなので優先度は低い）。

### I7. 重複・使われていないもの

- `vercel-platform.ts:32` の `TURSO_AUTH_TOKEN` の検査は、`loadVercelEnv` がすでに通している（型の絞り込みのためだけ）。`loadVercelEnv` の戻り値を `Env & { TURSO_AUTH_TOKEN: string }` にすれば消せる。
- `CaptureImageGateway.delete` / `VercelBlobImageGateway.delete` は `src` のどこからも呼ばれていない（grep で確認。使っているのはテストだけ）。spec の `CAP-6f` が「`del` は名前で消す」を求めているが、読み出し・削除の口を作らない方針（R9）と合わせて、YAGNI なら外すか、使う場面（W1 の画像の掃除など）が来てから足す。
- `vercel.ts:65` の `export { vercelPlatform }` は本番の入口にテストだけの口。`bundle.test.ts` がそれで DB を差し替える。本番の bundle の公開面を増やすだけなので、`src/vercel.ts`（既定の `export default`）と `src/vercel-handler.ts`（`createVercelHandler` と `vercelPlatform` の輸出）に分ければ、bundle の入口は 1 行になる。

### I8. 失敗の握り潰し

- `blob-capture.repository.ts:99-103`: 画像の失敗後の `pending` の削除の失敗が `.catch(() => undefined)` で完全に消える。spec の意図（消せなくても引き継げる）どおりだが、repository にロガーが無いので記録も無い。運用で「`pending` が溜まる」ことに気づくために、`log?: EventLog` を受けて warn を 1 行出すと追える。

### I9. 名前・読みやすさ

- `container.ts:65`: `await (options.platform ?? (await defaultPlatform()))(env, logger)` は読みにくい。`const makePlatform = options.platform ?? (await defaultPlatform())` と 2 行に分ける。
- `rate-limit-counter.ts:36`: `slice(0, 32)` は名前付きの定数にする（`BUCKET_KEY_HEX_LENGTH`）。
- `remote-connection.ts:40` の例外「file: はこの接続では開かない」は、`wss://`（`isRemoteDbUrl` は通す）でも出て紛らわしい。`libsql:// か https:// で書く` だけにする。

### I11. 公開の URL と `PWA_PUBLIC_URL`

- `vercel-env.ts:27-38` は `PUBLIC_API_URL`・`SIM_PUBLIC_URL`・`CORS_ORIGINS` だけを補い、`PWA_PUBLIC_URL` は既定の `http://localhost:5174` のまま。`container.ts:131-137` が production の起動（コールドスタート）のたびに `record.public_url_is_localhost` を warn する。手順書（`...vercel-turso.md:114`）に「ログに warn」と書いてあり、意図した挙動。ノイズなので、PWA が決まるまでは Vercel のログの絞り込みで除くか、warn の対象を `PUBLIC_API_URL`・`SIM_PUBLIC_URL` だけにするとよい。
- `@antler/zones/src/data.ts:7` の `new URL('../data/zones.geojson', import.meta.url)` は、api が `@antler/zones` の index を通して bundle に入れる。Vite の SSR がこの式をどう出力するか（asset の出力・元のパスのままなど）を `handler.mjs` で一度見ておく。使われなければ無害。
- 手順書は `NODE_ENV` を「書かない」に入れている（`...vercel-turso.md:120`）。`NODE_ENV=production` を Vercel のプロジェクトの env に書くと devDependencies（`vite`・`tsx`）が入らずビルドが落ちる、という本当の理由も 1 行足すと、後で誰かが「production を明示しよう」と書かない。`apps/api/.env.example:6` は `NODE_ENV=development` なので、手順書がこのファイルを丸ごと貼る手順になっていないことだけ確認する。

### I10. テストの主張と弱い点

- `CFG-1e`（`handler.test.ts:292`）の `scripts['build:vercel']).toContain('build:vercel')` はほぼ恒真（sim の script が api の `build:vercel` を呼ぶことは、api 側の名前が含まれるだけで通る）。`toBe('npm run build && npm --prefix ../api run build:vercel')` のほうが、R1 の「sim のビルドの後に api の bundle」を固定できる。
- `FAIL-1`（`handler.test.ts:218-242`）は表を DROP して「Turso に届かない」を模している。SQL のエラーで、ネットワークの失敗や時間切れ（`fetchWithTimeout` の経路）とは別。レート制限が通る・`ready` が 503 は確かめられているが、S-3 の「DB を使う操作は 500」は確かめていない。
- `VH-1b` は成功の同時だけ。「同時の最初の要求 2 つが両方失敗 → 組み立ては 1 回 → 次の要求で 1 回やり直す」を足すと、`ready === attempt` の分岐が守られる。
- `MIG` に「バッチの途中の失敗で全部戻る」（resilience.md:47）のテストが無い。末尾に失敗する文を持つ配列を `client.batch` に渡して、前の表が残らないことを 1 つ確かめられる（Turso の HTTP の `write` バッチでも同じ意味）。
- `sourcemap: true`（`vite.vercel.config.ts:18`）は関数のサイズを増やす。Vercel のログで行番号を出したいなら `node --enable-source-maps` が要り、Vercel は既定でそれを付けない可能性がある。使わないなら `false`。
- `links.ts:19`: `VITE_API_BASE_URL` が空の開発（sim 5173 のみ）だと共有 URL が sim 自身の `/t/:id`（SPA）を指す。以前の相対 URL と同じ誤りで悪化はしていないが、`.env.example` の `VITE_API_BASE_URL=http://localhost:8787` を前提にしている点だけ、`REC-7b` のコメントに書いておくとよい。

## spec の ID と、テストが証明していること（要点）

| ID                     | 判定                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1                   | 一部のみ。ネイティブの libsql が実行の経路に無いことは証明していない（W5）。repo の外で動くか（鹿ゾーンの GeoJSON など実行時に読むファイル）も未証明（C1） |
| REC-7a                 | 証明している（`record.routes.test.ts:284-285` が `${URLS.sim}/t/${id}?app=1`）                                                                             |
| REC-7b                 | 証明している（`apps/sim/src/features/record/utils/links.test.ts:12-20`: 空ならオリジン付き、値があれば従来どおり）                                         |
| AC-2 / IP-5b / AUTH-1  | 証明している。ただし分の境目で不安定（W8）                                                                                                                 |
| AC-3 / AC-4 / VH-1a〜d | 証明している                                                                                                                                               |
| CAP-6a〜6i             | repository 層は証明している。並行（W4）と、`pending` の再送の挙動の妥当性（W1）が残る                                                                      |
| FAIL-2                 | 証明している                                                                                                                                               |
| FAIL-3                 | repository 層のみ。500 の HTTP は未確認（W4）                                                                                                              |
| FAIL-1                 | 一部のみ（Info I10）                                                                                                                                       |
| RL-4a〜4i              | 証明している（`SpyCounter` で `rateLimit` を、実物で `LibsqlRateLimitCounter` を別々に）                                                                   |
| MIG-3b〜3f             | 証明している。`--env-file` の優先順位と `main` の経路は未確認（W7）                                                                                        |
| CFG-1d / CFG-1e        | 1d は証明、1e は弱い（I10）                                                                                                                                |
