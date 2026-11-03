# セキュリティ監査: plan-trip（POST /api/trips ほか）

- 日付: 2026-11-03
- 対象: `git diff 5aa3820..HEAD`（ブランチ feat/plan-trip）。apps/api の POST /api/trips、packages/trip、apps/sim の plan-trip
- 参照した仕様: `docs/specs/plan-trip/threat.md`、`resilience.md`
- 方法: 静的レビュー（コードは直していない）。`npm audit --omit=dev`（apps/api）は 0 件。コミット範囲の秘密のパターン検索を実施

## Critical（即時対応）

なし。

## Warning（PR 前に直すか、PR に「仮採用」として明記）

### W1. 1 日の上限が「成功した旅」しか数えない。Claude の費用の濫用を上限が止めない（CWE-770 / CWE-400）

- 場所: `apps/api/src/application/usecases/trips/create-trip.usecase.ts:97`（`countTripsCreatedSince`）、`infrastructure/repositories/drizzle-trip.repository.ts:121`
- 内容: 上限の数え上げは `trips` の行（保存まで終わった旅）だけ。Claude を呼んだが、検証に外れた・時間切れ・拒否・保存失敗のリクエストは数えない。失敗した冪等キーは `failed` になり、同じキーで何度でも作り直せる（`decideOnExistingRequest` の reclaim）。
- 呼び出しの増幅: `write()` が最大 2 回（`MAX_WRITER_ATTEMPTS`）、各回の `messages.create` で `maxRetries: 1`（gateway:150）なので、1 リクエストで最大 4 回の課金される呼び出し。進行中の呼び出し数の上限（同時実行数）もない。
- 影響: 上限（既定 200/日）の外で費用が出る。実質の歯止めは IP あたり 10/分だけで、W2 のとおり IP は増やせる。
- 修正: (1) 上限の対象を `trip_requests`（pending と done。当日に作られたもの）にして、Claude を呼ぶ前に枠を確保する。(2) Claude の同時呼び出し数にセマフォを置く。(3) Anthropic コンソール側にも月額・日額の支出上限を置く（アプリの上限が破れても止まる最後の砦）。
- 補足: resilience.md は「同時の作成で数件超えるのは許す」としているが、それは同時実行の誤差の話で、失敗が数えられない点は書かれていない。

### W2. レート制限の鍵と記憶が、IP の増減・偽装に弱い（CWE-770 / CWE-348）

- 場所: `infrastructure/http/middleware/rate-limit.ts`（`hits` の Map）、`middleware/client-ip.ts`、`di/container.ts`
- (a) `hits` は期限切れの項目を消さない。鍵ごとに項目が残り続けるので、鍵を増やされるとメモリが増え続ける。IPv6 は /64 を持つ攻撃者が 1 リクエストごとに別の鍵にできる（鍵が完全なアドレス）。IPv6 は /64 に丸めて数えるのがよい。
- (b) `TRUST_PROXY=true` で、実際にはプロキシの後ろにいないとき（または最後のプロキシが XFF を付け足さないとき）、右端は攻撃者が書いた値になり、リクエストごとに別の鍵にできる。起動時にこの組み合わせを検知する手段はない。
- (c) 逆向きの失敗: プロキシ（Cloudflare や LB）の後ろで `TRUST_PROXY=false` のままだと、全員がプロキシの IP 1 つの枠（10/分）を共有して、正規の利用者が 429 になる。プロキシが 2 段あるときに `true` だと右端は手前のプロキシの IP になり、同じ問題が出る。
- (d) `remoteAddress` が取れないと鍵が `'unknown'` の 1 つになる（本番の Node では起きにくいが、フォールバックが共有枠なのは意図どおりか確認）。
- 修正: Map の定期掃除（窓が過ぎた項目の削除と件数の上限）。IPv6 は /64 で丸める。デプロイ手順に「プロキシの段数と TRUST_PROXY の対応」を書く。TRUST_PROXY を数（信頼するホップ数）で指定すれば (b)(c) は減らせる。
- 良い点: ヘッダの左側を信じず右端を使う設計、レート制限が body 読み取りより前にあること（`trip.routes.ts` の順序）は妥当。

### W3. `exposeErrorDetails` が本番でも開く既定（CWE-209 / CWE-1188）

- 場所: `di/container.ts` の `exposeErrorDetails: env.NODE_ENV !== 'production'`、`infrastructure/config/env.ts` の `NODE_ENV` の `.default('development')`
- 内容: 本番で `NODE_ENV=production` を付け忘れると、既定の `development` になり、500 などの応答に `detail: error.message` が付く。想定外の例外（libsql のエラーなど）のメッセージが利用者に出る。
- 影響: SQL 文・内部パスなど内部情報の漏えい。threat.md の「Claude の応答・スタックトレースは返さない」は、本番設定が正しいときだけ守られる。
- 修正: 失敗側に倒す。`EXPOSE_ERROR_DETAILS` のような明示の環境変数（既定 false）にするか、`NODE_ENV` の既定を `production` にする。少なくとも `.env.example` と README に「本番は NODE_ENV=production 必須」を書く。
- 補足: 応答のスタックトレースは出ていない（`message` のみ）。

## Info（計画的に・次の feature で）

### I1. 所有者トークンの設計（CWE-330 / CWE-639 の予防）

- 確認できたこと: トークンは `HMAC-SHA256(OWNER_TOKEN_SECRET, "antler:owner-token:v1:" + 冪等キー)`。保存は SHA-256 のハッシュだけ。冪等キーも `keyHash` だけを保存。ログ・エラー応答にトークン・キーは出ない（`http.request` は path のみ、gateway のログは件数・時間のみ）。
- 注意 1: トークンは冪等キーから決まる。同じキーと同じ body を送れば、24 時間以内は誰でも同じトークンを受け取れる（replay 経路は持ち主の確認をしない）。冪等キーは実質「トークンと同じ強さの秘密」で、`z.uuid()` は version を問わない（固定値や連番の UUID を端末が選べる）。`z.uuid({ version: 'v4' })` に絞ることを勧める。
- 注意 2: トークンは旅の id に結び付いていない。24 時間後に同じキーで作り直すと、別の旅に同じトークンが出る。record の feature の削除では「旅ごとのハッシュと照合」するので致命的ではないが、材料に tripId を含められない理由（再送で同じ値を返すため）を `functional.md` R7 に書いておく。
- 注意 3: record の feature で照合するときは `timingSafeEqual` を使う。
- `OWNER_TOKEN_SECRET` は 32 文字以上の検査のみ（エントロピーは見ていない）。`.env.example` に `openssl rand -hex 32` の例がある。許容範囲。

### I2. sim の localStorage に ownerToken を置く妥当性

- 妥当と判断する。理由: トークンの権利は「自分の匿名の旅（個人情報なし）の削除」だけ。cookie にすると CSRF の面が増える。登録なし（付録 A #9）の前提では他の置き場所がない。
- 前提となる条件: XSS が出ないこと。`apps/sim/src` に `dangerouslySetInnerHTML`・`innerHTML` は無い。Claude が書いた文は React のテキストとして描画されるので、エスケープされる。この前提を崩さないこと（Claude の文を HTML として挿入しない）。
- ログ: `logger.error` に入力・キー・トークンを渡していない（`useCreateTrip.ts` のコメントどおり）。
- sessionStorage の `antler.plan-trip.pending` にキーと入力を残し、成功時に消す。成功しなかった場合はタブを閉じるまで残る（トークン自体はここに無い）。許容範囲。
- 将来、サードパーティのスクリプトを sim に入れるなら CSP を検討する（今の `secureHeaders()` は API のレスポンス用で、sim の配信の CSP は別）。

### I3. 冪等キーの行と旅の保持期間

- `trip_requests` の行は「24 時間後に無視」するだけで消さない（threat.md は「行は TripPlan と同時に消す」）。リクエストごとに 1 行増えるので、W2 の経路で増やされるとファイルが膨らむ。日次の掃除（24 時間を過ぎた `done` 以外の行の削除など）を足す。保持期間は Deferred と書かれているので、期限だけ決めておく。

### I4. SQLite の置き場所

- 既定は `file:./data/trips.db`（実行時のカレントディレクトリ基準）。`apps/api/data/` は `.gitignore` 済みで、コミットには入っていない（`git ls-files` で確認）。フォルダは `mkdirSync` が既定の権限で作る。本番では絶対パスで、アプリ専用ユーザーだけが読み書きできる場所にし、DB 内のハッシュ・旅の情報（個人を特定しない）をバックアップ先でも保護する。Web の公開ディレクトリの下に置かない。
- `TRIPS_DB_URL` に `http(s)://`（libsql の遠隔）を許す。使うなら認証トークンの渡し方（今は未対応）を別途決める。

### I5. ログのマスキング

- `http.error` は `serializeError(error)` で message と stack を出す。想定外の例外（libsql など）の message に SQL の値が入る可能性はあるが、保存する値は個人を特定しない旅の入力と、ハッシュ・トークンのハッシュ。冪等キーそのものは保存・ログに出ない。許容範囲だが、将来 `trips` に自由入力を足したら見直す。
- Claude の応答本文はログに出ていない（gateway は stop_reason と件数・時間のみ）。`previousProblems` の `code@path` は検証側が作る構造パスで、Claude の文を含まない（確認済み）。

### I6. プロンプトに利用者の自由入力が入るか

- 入らない。body は `TripInputSchema`（strict）で、`lang`・`area` などは列挙、`pleasures[].id` は `Slug` でさらに `pleasureById` のマスターにあるものだけ、日時は ISO のみ、数値は範囲つき。`toPromptMaterial` に渡るのはマスターの名前（4 言語）と選択肢由来の値。プロンプトインジェクションの経路は見当たらない。
- 出力側: Claude の応答は structured outputs + `WritingResponse`（strict）+ `validateTripWriting`（長さ・絵文字・数字・記号）を通ってから保存される。

### I7. body の検証と 16 KB の上限、エラー応答

- strict 検証で Mass Assignment は拒否される（id・seed・title・days・riskScore・alertEnabled・ownerToken は未知の欄として 400）。`bodyLimit` は 16 KB。超過は 413 だが `code` は `INVALID_INPUT`（意味としては `PAYLOAD_TOO_LARGE` のほうが分かりやすい。機能上の問題ではない）。
- エラー応答は `{error:{code,message}}` のみ。検証エラーの message は「パス: 理由」で、入力値そのものは含まない。`TripWriterError` の message は短い理由コード。

### I8. 秘密と依存

- `.env.example`（apps/api・apps/sim）に本物の値はない。`ANTHROPIC_API_KEY` と `OWNER_TOKEN_SECRET` は空欄で、env.ts は既定値なし（足りなければ起動しない）。`.gitignore` は `.env`・`.env.*`（`.env.example` だけ除外）。
- `git log -p 5aa3820..HEAD` で、API キー・秘密鍵・トークンの形のパターンを検索した。ヒットはテストのダミー（`test-key`、`test-owner-token-secret-...`）のみで、本物の秘密はない。コミットに `.env`・`.db`・`.pem`・`.key` は入っていない。
- `npm audit --omit=dev`（apps/api）: 脆弱性 0 件。追加依存は `@anthropic-ai/sdk`・`@libsql/client`・`drizzle-orm`・`zod`・`hono`。
- 開発バイパス: Claude のフェイクは container に無く、環境変数の切り替えもない（threat.md どおり）。

## 総合評価

- リスクレベル: Medium（Critical なし。Warning 3 件）
- 推奨アクション（優先順）:
  1. W1: 1 日の上限を「Claude を呼ぶ試行」基準にし、同時呼び出しに上限を置く。Anthropic 側の支出上限も設定する。費用の濫用が threat.md の第一の守りなので、PR 前の対応を推奨。
  2. W3: `exposeErrorDetails` を明示の環境変数（既定 false）にする。小さい変更。
  3. W2: レート制限の Map の掃除・IPv6 の丸め・TRUST_PROXY の運用手順を書く。
  4. I1: 冪等キーを UUID v4 に絞る。I3: 古い `trip_requests` の掃除。
- 注意: W1〜W3 を直さない場合は、PR に「未対応: <項目>」として書く。
