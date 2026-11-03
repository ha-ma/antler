# セキュリティ監査: brief-map（2026-11-03、security-auditor）

対象: `git diff main...HEAD`（a5dea09 まで）と、監査時点の作業ツリー（get-trip-day.usecase.ts・container.ts・BriefPage.tsx・useTripDay.ts に未コミットの変更あり。その状態を読んだ）。
基準: `docs/specs/brief-map/threat.md`、`resilience.md`。コードは直していない。

## 総合

- Critical: 0 件 / High: 0 件 / Medium: 3 件 / Low: 5 件
- 脅威モデルの 4 点（ID を知る人が読める GET、所有者の印を出さない、1 分 60 件 / IP、外部のタイル提供元へ旅の ID を出さない）は、コードで守られていることを確かめた。
- リスクレベル: Medium（Critical / High なし。マージを止める指摘は無い）

## 脅威モデルの確認結果（問題なし）

| 項目                                       | 結果         | 根拠                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 認証なしで読める（AUTH-1）                 | 意図どおり   | `trip-day.routes.ts` に認証 middleware なし                                                                                                                                                                                                                  |
| ownerTokenHash を返さない（AUTH-2）        | 守られている | `get-trip-day.usecase.ts` が `{ plan, details, day }` を明示して返す。`StoredTrip` の `ownerTokenHash` と `createdAtMs` は出ない。`route` も 3 欄だけを `c.json` に渡す                                                                                      |
| 無い id と形の違う id は同じ 404（AUTH-3） | 守られている | `TRIP_ID_PATTERN`（`^[A-Za-z0-9]{4,16}$`）に外れても、`findTrip` が null でも `TripNotFoundError`（TRIP_NOT_FOUND）。zod は `id: z.string()` だけで、形の検査を UseCase に寄せている                                                                         |
| n の検証                                   | 守られている | `^[1-9][0-9]{0,2}$` ＋ `strictObject`。`0`・負数・`1e3`・`01`・小数は 400 の手前で外れる。UseCase でも `Number.isInteger` と `>= 1` を再検査                                                                                                                 |
| レート制限が検証より前                     | 守られている | `rateLimit` → `zValidator` → handler の順。形の違う id の総当たりも枠に数える                                                                                                                                                                                |
| エラーの詳細                               | 守られている | `exposeErrorDetails` は `NODE_ENV === 'development'` のときだけ。`NODE_ENV` の既定は `production`。応答は code と短い文だけ                                                                                                                                  |
| SQL インジェクション                       | 該当なし     | id は正規表現（英数のみ）を通ってから `findTrip` へ                                                                                                                                                                                                          |
| api の実行時の外部通信                     | なし         | `FileRoadCatalogGateway` は同梱の routes.json と zones を起動時に読むだけ                                                                                                                                                                                    |
| XSS                                        | 該当なし     | `brief-map` に `dangerouslySetInnerHTML`・`innerHTML`・MapLibre の Popup は無い。Claude の文（LocalizedText）は React のテキストとして描かれる                                                                                                               |
| 応答の検証（sim 側）                       | 守られている | `useTripDay.ts` が `TripPlanSchema` / `TripDetailsSchema` / `DayPlanSchema` で受けた JSON を検証する                                                                                                                                                         |
| 旅の ID を外へ出さない（AUTH-5）           | 守られている | スタイル URL は `VITE_MAP_STYLE_URL`（ビルド時）で、`mapStyleUrl()` に旅の ID は渡らない。タイルの要求は MapLibre が座標で作る。`index.html` に `<meta name="referrer" content="strict-origin">`。OSM へのリンクは `rel="noreferrer"`（`noopener` も含む）   |
| 新しい依存 maplibre-gl@6.15.0              | 問題なし     | lock に registry.npmjs.org の URL と integrity あり。`npm audit` は moderate 16 件・high/critical 0 件で、すべて eslint / minimatch 系の devDependencies。maplibre-gl とその依存（@mapbox/_、@maplibre/_、kdbush など）に該当なし。ライセンスは BSD-3-Clause |

## Critical

なし（0 件）。

## High

なし（0 件）。

## Medium

### M1. 1 リクエストごとにルート計算をする読み出しに、結果の再利用も全体の上限もない（CWE-770）

- 場所: `apps/api/src/application/usecases/trip-day/get-trip-day.usecase.ts`（`buildDayPlan` を毎回呼ぶ）、`apps/api/src/infrastructure/http/routes/trip-day.routes.ts:12`（60 件 / 分 / IP）
- 影響: 上限は IP ごとだけ。計算は同期処理で、同じ Node のプロセスのイベントループを使う（`SLOW_MS` を 200 ms と置いているので、遅いときは 1 件 200 ms 前後を想定している）。1 IP が上限いっぱい（60 件 / 分）を打つと最大で 12 秒 / 分の CPU を取る。複数 IP（IPv4 を替える、IPv6 は /64 で束ねてあるので /64 を替える）で足し合わせると、health や POST /api/trips の応答も遅れる。ID を知っている人しか 200 を取れないが、`n` が範囲外（DAY_NOT_FOUND）や id が無い場合は計算の前で終わる。計算に入れるのは実在の ID と有効な n を知る人だけなので、実害は「公開した ID を持つ人が複数 IP で叩く」場合に限る。今回の実測はしていない（計算時間は未測定）。
- 修正: (a) `(id, day)` の結果を短い TTL（5〜10 秒）か LRU で持つ。threat.md の「旅の削除は即時に 404」と両立させるため TTL は短くする。または (b) 計算の同時実行を 2〜4 に絞る簡単な semaphore を UseCase に置く。どちらも resilience.md に追記する。

### M2. package-lock.json から esbuild と rolldown のプラットフォーム別パッケージが消えている（CWE-494 / 再現性）

- 場所: `package-lock.json`（`git diff main...HEAD --stat` で 1658 行の変更）
- 影響: main の lock には `node_modules/@esbuild/*` が 26 件あるが、HEAD では 0 件（`esbuild` 本体の `optionalDependencies` には残っている）。`@rolldown/binding-*` も同様に消えている。npm の既知の挙動（別 OS で lock を作り直すと optional の項目が落ちる）で、この状態の lock で Linux の CI が `npm ci` すると、ネイティブバイナリを lock の integrity なしで取りにいくか、esbuild / vite / tsx が動かない。supply chain の観点では「lock が固定していない版を取る」ことになる。brief-map の機能が使う `maplibre-gl` 自体の項目は正しい。
- 修正: main の lock をもとに `npm install maplibre-gl@6.15.0 -w @antler/sim` と `@antler/zones` の追加だけを入れ直す（lock を作り直さない）。または `npm install --package-lock-only --os=linux --cpu=x64 --os=darwin --cpu=arm64` 相当で optional を戻す。直したら CI の `npm ci` が通ることを確かめる。

### M3. レート制限の鍵は TRUST_PROXY の設定に全面的に頼っている（CWE-348 / CWE-770。plan-trip からの既存、この feature も同じ鍵を使う）

- 場所: `apps/api/src/infrastructure/http/middleware/client-ip.ts`、`apps/api/src/di/container.ts:60-72`、`apps/api/src/infrastructure/config/env.ts:39`
- 影響: (a) 逆プロキシの後ろで `TRUST_PROXY=false`（既定）のままだと、全員が接続元＝プロキシの 1 つの枠（60 件 / 分）を共有し、閲覧が全体で 429 になる。(b) `TRUST_PROXY=true` でプロキシが XFF を付け足さない（あるいは直接つながる）構成だと、右端の値も利用者が書けるので、枠を無限に増やせる。(c) `getConnInfo` が失敗すると鍵が `unknown` 1 つになる。コードは正しく、設計どおりの挙動だが、本番の構成（デモ環境でどこに置くか）が決まるまで、どちらかが起きる。
- 修正: デプロイ先を決めたとき、`apps/api/CLAUDE.md` か README に「プロキシの後ろでは必ず TRUST_PROXY=true、プロキシは XFF を上書きまたは末尾に追記する」と書く。起動時に `TRUST_PROXY` と実際のプロキシの有無が合っているか確かめる手順（smoke）を足す。

## Low

### L1. CSP の `worker-src 'self' blob:` は、コメントの「worker-src 'self'」より広い（CWE-693）

- 場所: `apps/sim/vite.config.ts:29`（`"worker-src 'self' blob:"`）、同ファイルのコメントと `load-maplibre.ts` の説明（「blob のワーカーを作らない」）
- 影響: `setWorkerUrl` でバンドルの URL を渡す設計なら `blob:` は要らない。XSS が別に起きた場合の足場を広げる。
- 修正: `blob:` を外して、本番ビルドで地図が出ることを確かめる。出ないなら理由をコメントに書く。

### L2. CSP が `<meta>` なので `frame-ancestors`・`form-action` を書けない（CWE-1021）

- 場所: `apps/sim/vite.config.ts` の `contentSecurityPolicy()`（meta で注入）
- 影響: meta の CSP は `frame-ancestors` を無視する。A-2 は ID を知る人だけが読む公開ページなので、クリックジャックの実害は小さい。なお `form-action` も未設定。
- 修正: 配信側（ホスティング）の HTTP ヘッダで `Content-Security-Policy: frame-ancestors 'none'` と `form-action 'self'` を足す。デプロイ先が決まったときでよい。

### L3. `VITE_MAP_STYLE_URL` の検証が弱い（CWE-20）

- 場所: `apps/sim/vite.config.ts:11-15`（`new URL(style).origin`）、`apps/sim/src/features/brief-map/map/style.ts`
- 影響: ビルド時の値で利用者は触れないので悪用の経路は無い。ただし `http:`・`data:`・`javascript:` 以外のスキームも通り、CSP に `http://` の origin が入りうる。スタイル JSON がタイル・フォントを別の origin に向けると CSP が拒否して背景なしにフォールバックする（機能の劣化であり、セキュリティ上は安全側）。
- 修正: `mapOrigin()` で `https:`（または localhost の http）だけを通し、それ以外はビルドを失敗させる。

### L4. 取得スクリプトは OSRM の応答の「形」しか検証せず、値の範囲と書き出しの検証をしない（CWE-345）

- 場所: `packages/trip/scripts/fetch-routes.ts`（`OsrmResponse`、`writeFileSync`）
- 影響: HTTPS で公式デモサーバーに行き（`OSRM` は `https://router.project-osrm.org/...`）、URL は同梱のマスター（`placeById`）の座標だけで作る。外部入力の混入は無い。ただし (a) 座標の範囲（北海道の外）・距離が直線距離の数倍を超えるなどの異常を見ない、(b) 書き出す前に `RoadCatalogSchema` で parse しない、(c) 1 回の応答の座標数に上限がない。サーバーの不具合や乗っ取りがあると、おかしなルートが routes.json にそのまま入り、PR のレビューが唯一の防御になる（約 37 万バイト、diff で読み切れない）。
- 修正: 書き出す前に `RoadCatalogSchema.parse(file)` と、各道が「両端点から 2 km 以内で始まり終わる」「距離 ≤ 直線距離 × 3」を確かめる。`roads.test.ts` に同じ検査を足す。`fetchedAt` と版は meta に残っていて十分。

### L5. `.env.example` に `NODE_ENV=development` があり、そのままコピーすると本番でエラーの詳細を返す（CWE-209）

- 場所: `apps/api/.env.example:6`、`apps/api/src/di/container.ts:84`（`exposeErrorDetails`）
- 影響: `app.onError` が `error.message` を `detail` に載せる。DB や内部の例外文が出る。既定が `production` なので、`.env.example` を本番にコピーした場合だけ起きる。この feature の GET も、予期しない例外（500）は同じ経路を通る。
- 修正: `.env.example` の該当行に「本番では必ず production（development は detail を返す）」とコメントを足す。

## Info（指摘ではない）

- `GET /api/trips/:id/day/:n` で n が日数を超えると `404 DAY_NOT_FOUND`（旅は存在する）と `404 TRIP_NOT_FOUND` が区別できる。ただし ID を知っていれば `day/1` で全文が読めるので、存在の判別で新たに分かることは無い。threat.md の「404 を区別しない」の対象は「無い id と形の違う id」で、そこは守られている。
- アクセスログの `path` に旅の ID が残る。threat.md が許容している（運用者だけが読む）。応答本文・ownerTokenHash・IP はログに出ていない（`app.ts` の `http.request` / `http.error` は path・status・requestId のみ）。
- 地図の提供元（OpenFreeMap）にはブラウザの IP とタイルの座標・ズームが届く。旅の ID は届かないが、座標からその日のルートの地域は分かる。threat.md の「公開データ・座標だけ」に合う。デモの画面に出所と出す情報を書く。
- `rateLimit` は鍵の上限 10,000 件で古いものから消す。大量の IP から叩くと、他の人の枠が先に消えて数え直しになる。上限を超えるには 1 万の送信元が要るので許容。
- `decodePolyline` は文字列の長さで必ず止まる（無限ループなし）。`RoadCatalogSchema` が起動時に routes.json を検証するため、壊れたファイルは api が起動しない（安全側）。
- 監査時点の作業ツリーに未コミットの変更があった（上記の 4 ファイルと `docs/reports/2026-11-03-component-guard-brief-map.md`）。この変更の中身も読んだが、指摘は上の内容に含めた。

## 推奨アクション（優先順）

1. M2: package-lock.json を main をもとに戻して、追加分だけ入れ直す（CI の `npm ci` が通ることを確かめる。マージの前）。
2. M1: `(id, day)` の短い TTL か同時計算の上限を入れる、または resilience.md に「許容する」と理由を残す（マージは止めない）。
3. M3: デプロイ先が決まったら TRUST_PROXY の構成を文書化する。
4. L1・L3・L4・L5 は次の feature に混ぜてよい。L2 はデプロイ先のヘッダ設定で対応する。
