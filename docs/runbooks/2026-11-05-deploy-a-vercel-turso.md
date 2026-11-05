# 手順書: A（sim と api）を Vercel に出す（Turso・Vercel Blob）

A（`apps/sim` の画面と `apps/api` の Hono）を、Vercel の 1 つのプロジェクトに出す手順。上から順に打つ。全体で 40〜60 分。

- 仕様: `docs/specs/deploy-a/functional.md`。決まっていること: ホスティングは Vercel、DB は Turso、Capture の画像は Vercel Blob（非公開）
- **★ が付いた段はユーザーの作業**（アカウントの作成・支払い・秘密の値の入力・外への公開）。Claude は代わりに行わない
- 秘密の値（トークン・API キー）は、チャット・Issue・PR・コミットに貼らない。Vercel の画面と、手元の `.env.*`（gitignore 済み）にだけ置く
- 環境は 2 つ: **Production**（`main`）と **Preview**（PR ごと）。DB・トークン・Anthropic のキーを環境ごとに分ける
- **範囲外: B の PWA（`apps/pwa`）**。位置情報に HTTPS が要る一方で車内の edge へ `ws://` でつなぐので、Vercel に置くだけでは車載につながらない。この手順では出さない

## 0. 前提（1 分）

```sh
node --version   # v22 台
git status       # main を取り込んだきれいな状態
```

手元に入れる道具（どちらも公式の手順で入れる）:

- Vercel の CLI: `npm i -g vercel`（`vercel --version` が通ればよい）
- Turso の CLI: <https://docs.turso.tech/cli/installation>（`turso --version` が通ればよい）

## 1. ★ アカウント（5 分。ユーザーの作業）

1. **Vercel**: <https://vercel.com/signup> で GitHub のアカウントで登録する（Hobby で動く。上限を広げたくなったら Pro）
2. **Turso**: `turso auth signup`（初めて）か `turso auth login`（2 回目から）。ブラウザでログインする
3. **Anthropic**: Console（<https://console.anthropic.com>）で、**Production 用と Preview 用の 2 つの API キー**を作る（名前は `antler-production`・`antler-preview` など）。値はこのあとの 5 で Vercel に入れるまで、どこにも貼らない

## 2. ★ Turso の DB 2 つとトークン（5 分）

東京の近くに 1 つのグループを作り、その中に Production と Preview の DB を作る（関数の region `hnd1` と近くする）。

```sh
turso db locations                       # 一覧から東京（Tokyo）の場所のコードを探す
turso group create antler --location <東京のコード>
turso db create antler-production --group antler
turso db create antler-preview    --group antler
turso db show antler-production --url    # libsql://antler-production-<org>.turso.io
turso db show antler-preview    --url
```

確かめる: 2 つの URL が `libsql://` で始まる。

トークンは**画面に出さずに**手元のファイルへ書く（マイグレーションで使う。ファイルは `.env.*` なのでコミットされない）:

```sh
cd apps/api
printf 'TRIPS_DB_URL=%s\nTURSO_AUTH_TOKEN=%s\n' \
  "$(turso db show antler-production --url)" "$(turso db tokens create antler-production)" > .env.turso-production
printf 'TRIPS_DB_URL=%s\nTURSO_AUTH_TOKEN=%s\n' \
  "$(turso db show antler-preview --url)" "$(turso db tokens create antler-preview)" > .env.turso-preview
chmod 600 .env.turso-production .env.turso-preview
cd ../..
git status --short apps/api   # 2 つのファイルが出てこない（gitignore 済み）こと
```

- 2 つのファイルは、表を変える PR のたびのマイグレーション（3）で使う。使わなくなったら消す（`rm apps/api/.env.turso-*`）。作った日を覚えておき、デモが終わったらトークンを作り直す
- トークンは既定で期限なし・読み書きできる。漏れたら `turso db tokens invalidate <db>` で全部を無効にし、作り直して 5 の値を入れ替える
- Vercel に入れるトークンは、5 でこのファイルの `TURSO_AUTH_TOKEN=` の右側を写す（コピーしたらクリップボードを別の文字で上書きする）

## 3. 最初のマイグレーション（2 分）

表を作るのは、**デプロイの前に手元から 1 回**（関数は表を作らず、版が古ければ全部の要求を 503 にする）。

```sh
npm ci
npm run db:migrate -w @antler/api -- --env-file .env.turso-production
npm run db:migrate -w @antler/api -- --env-file .env.turso-preview
```

確かめる: それぞれ最後の行が `"event":"db.migrated"` で `"version":2`、`"target":"libsql://antler-…turso.io"`。トークンは出ない。
何度流しても壊れない。**表を変える PR（`SCHEMA_VERSION` が上がる）を main に入れる前に、この 2 行をもう一度流す**。

## 4. ★ Vercel のプロジェクトと GitHub の連携（10 分）

1. Vercel の画面で **Add New → Project** → GitHub の `ha-ma/antler` を **Import**（初回は Vercel の GitHub App に、このリポジトリだけへのアクセスを許可する）
2. 設定（**Configure Project**）:
   - **Root Directory**: `apps/sim`（「Include files outside the root directory in the Build Step」は有効のまま。api と packages を使う）
   - **Framework Preset**: Vite（`apps/sim/vercel.json` が `framework`・`buildCommand`・`outputDirectory` を決めるので、ほかは触らない）
   - Node.js のバージョン: `apps/sim/package.json` の `engines`（22.x）が使われる
   - ここでは **Deploy を押さない**（5 の env が無いと、関数は 503 になる）。押してしまったら 5 のあとで Redeploy すればよい
3. **Settings → Git**: Production Branch が `main`。PR ごとに Preview ができる（既定）
4. **Settings → Deployment Protection**: **Vercel Authentication を Preview に効かせる（Standard Protection）**。Preview の URL は推測できるので、Vercel のチームの人だけが開けるようにする（必須）
5. **Settings → Git → Git Fork Protection** が有効のまま（フォークからの PR が秘密の env でビルドされない）

## 5. ★ Blob のストアと環境変数（10 分）

### Blob のストア（非公開）

DB と同じく、Production と Preview で**ストアを分ける**（Preview の関数が Production の Capture に書かない）。

1. プロジェクトの **Storage** タブ → **Create Database** → **Blob** → **Continue**
2. **Access を Private** にする。名前は `antler-captures-production`。region を選べるなら東京に近い場所。つなぐ環境は **Production だけ**
3. もう一度 1〜2 を、名前 `antler-captures-preview`・つなぐ環境 **Preview だけ**で行う
4. つなぐと Vercel が環境ごとの `BLOB_STORE_ID` を env に足す（Settings → Environment Variables で、Production と Preview で値が違うことを確かめる）。関数の SDK は OIDC（Vercel が自動で付ける `VERCEL_OIDC_TOKEN`）で読み書きするので、`BLOB_READ_WRITE_TOKEN` は Vercel の env に要らない（手元から Blob を触るときだけ使う）

### 環境変数（Settings → Environment Variables）

秘密は **Sensitive** にする（あとから値を読めなくなる）。「既定」の行は、書かなければその値になる。

| 変数                          | Production                                                          | Preview                                  | 必須 / 既定                   | 秘密 |
| ----------------------------- | ------------------------------------------------------------------- | ---------------------------------------- | ----------------------------- | ---- |
| `ANTHROPIC_API_KEY`           | Production 用のキー                                                 | **Preview 用の別のキー**                 | 必須                          | 秘密 |
| `OWNER_TOKEN_SECRET`          | `openssl rand -hex 32` の値                                         | **別の** `openssl rand -hex 32` の値     | 必須（32 文字以上）           | 秘密 |
| `TRIPS_DB_URL`                | `libsql://antler-production-<org>.turso.io`                         | `libsql://antler-preview-<org>.turso.io` | 必須                          | なし |
| `TURSO_AUTH_TOKEN`            | `.env.turso-production` の値                                        | `.env.turso-preview` の値                | 必須                          | 秘密 |
| `BLOB_STORE_ID`               | `antler-captures-production` をつなぐと Vercel が付ける             | `antler-captures-preview` の値（自動）   | 必須（自動）                  | なし |
| `CLAUDE_DAILY_CALL_LIMIT`     | `400`                                                               | `50`                                     | 既定 400                      | なし |
| `CLAUDE_MAX_CONCURRENT_CALLS` | `4`                                                                 | `2`                                      | 既定 4（インスタンスごと）    | なし |
| `CAPTURES_MAX_ITEMS`          | `5000`                                                              | `500`                                    | 既定 50000                    | なし |
| `CAPTURES_MAX_BYTES`          | `1073741824`（1 GiB）                                               | `104857600`（100 MiB）                   | 既定 5 GiB                    | なし |
| `PUBLIC_API_URL`              | 独自ドメインがあれば `https://<ドメイン>`、無ければ書かない         | 書かない                                 | 既定: Vercel の URL           | なし |
| `SIM_PUBLIC_URL`              | `PUBLIC_API_URL` と同じ（同じオリジン）、無ければ書かない           | 書かない                                 | 既定: Vercel の URL           | なし |
| `CORS_ORIGINS`                | 書かない                                                            | 書かない                                 | 既定: 自分のオリジン 1 つ     | なし |
| `PWA_PUBLIC_URL`              | PWA の公開先が決まったら（範囲外）                                  | 書かない                                 | 既定 localhost（ログに warn） | なし |
| `LOG_LEVEL`                   | `info`                                                              | `info`                                   | 既定 info                     | なし |
| `OG_FONT_FILES`               | 書かない（OG 画像の日本語のフォントは未決。下の「残っていること」） | 書かない                                 | 既定 空                       | なし |

書かないもの:

- `NODE_ENV`（Vercel の関数は production。エラーの detail を応答に出さない側）、`TRUST_PROXY`（Vercel では読まない）、`CAPTURES_DIR`（Vercel では Blob）、`PORT`
- `VITE_API_BASE_URL`（**空のまま**。同じオリジンの相対の URL で api を呼ぶ。CSP は `connect-src 'self'`）
- **秘密を `VITE_` で始まる名前にしない**（`VITE_` の値はブラウザに公開される）

公開の URL の既定: Production は `https://<VERCEL_PROJECT_PRODUCTION_URL>`、Preview は `https://<VERCEL_BRANCH_URL>`（無ければ `VERCEL_URL`）。Vercel が付ける「System Environment Variables」を使うので、Settings → Environment Variables の「Automatically expose System Environment Variables」を有効のままにする。

## 6. ★ Anthropic のコンソールの支出の上限（2 分）

アプリの上限（1 日の Claude の呼び出しの数）が破れても費用が止まるように、Console の **Settings → Limits** で月の支出の上限を決める（Production と Preview のキーが同じワークスペースなら合計の上限）。金額はユーザーが決める（予算は第 9 章 ③ の要確認の項目）。

## 7. デプロイと確かめ方（10 分）

### デプロイ

- Preview: このブランチの PR を開くと、Vercel のボットが Preview の URL をコメントする（4 の保護で、開くときに Vercel のログインを求められる）
- Production: PR を `main` に入れると、Production にデプロイされる（**外への公開**。入れる判断はユーザー）
- 手元から出すときは `vercel deploy`（Preview）／`vercel deploy --prod`（Production）。どちらもユーザーの作業

### 確かめる（Production の URL を `$U` に入れて上から）

```sh
U=https://<production の URL>
curl -sS "$U/health"            # {"status":"ok"}
curl -sS "$U/health/ready"      # {"status":"ok"}
curl -sS -o /dev/null -w '%{http_code}\n' "$U/api/nope"   # 404（JSON）
curl -sS -o /dev/null -w '%{http_code}\n' "$U/plan"       # 200（sim の index.html）
```

| 見ること                        | 期待                                                                                            | 違ったら                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `/health` が 200                | 書き換えのあとも関数が元のパス（`/health`）で受けている                                         | 503 → Runtime Logs の `vercel.boot_failed`（env・版）。404 → `vercel.json` の書き換え |
| `/health/ready` が 200          | Turso に届き、表の版が 2                                                                        | 503 → 3 のマイグレーション、`TRIPS_DB_URL`・`TURSO_AUTH_TOKEN`                        |
| ブラウザで `$U/plan` → 旅を作る | 201 でしおりが出る（Claude の呼び出しと Drizzle のトランザクションが Turso に通る）             | 500 → Runtime Logs                                                                    |
| 運転を終えて `$U/t/<id>`        | SSR の共有ページ（JS なしで読める）                                                             |                                                                                       |
| `$U/t/<id>/og.png`              | 200 の PNG（`@resvg/resvg-js` の Linux のネイティブが動く）。日本語が四角なら「残っていること」 | 500 → Runtime Logs                                                                    |
| 共有ページの「EZO ROAD で開く」 | `$U/t/<id>?app=1` で sim の A-7（操作できる画面）が開く                                         |                                                                                       |

レート制限（Vercel が `X-Forwarded-For` を上書きすること）を確かめる。本文が空なので Claude は呼ばれない（400）。11 回目が 429 なら、偽のヘッダで枠を増やせていない。**自分の IP が 1 分間 429 になる**:

```sh
for i in $(seq 1 11); do
  curl -sS -o /dev/null -w '%{http_code} ' -X POST "$U/api/trips" \
    -H 'content-type: application/json' -H "x-forwarded-for: 10.0.0.$i" -H "x-vercel-forwarded-for: 10.9.0.$i" -d '{}'
done; echo   # 400 が 10 回のあと 429
```

Capture（Blob の OIDC と非公開の put）を確かめる。テスト用の画像（車外の合成の 320×240）を 1 枚送る:

```sh
ID=cap_runbook$(date +%s)
curl -sS -X POST "$U/api/captures" \
  -F "capture={\"id\":\"$ID\",\"source\":\"vehicle\",\"image\":\"captures/$ID.jpg\",\"imageSize\":[320,240],\"boxes\":[{\"label\":\"deer\",\"xywh\":[0.4,0.3,0.2,0.4],\"by\":\"model\"}],\"conditions\":{\"season\":\"winter\",\"month\":2,\"weather\":\"unknown\",\"surface\":\"unknown\",\"light\":\"dusk\",\"fog\":\"none\",\"traffic\":\"unknown\",\"vehicle\":\"unknown\"},\"distanceM\":42,\"side\":\"R\",\"pose\":\"unknown\",\"reactionMs\":null,\"outcome\":\"avoided\",\"roadSegment\":\"unknown\",\"consent\":true,\"createdAt\":\"2026-02-14T16:30:00.000+09:00\"}" \
  -F "image=@apps/api/tests/fixtures/edge-320x240.jpg;type=image/jpeg"
```

確かめる: `{"id":"cap_runbook…","image":"captures/cap_runbook….jpg"}` が返る（201）。Vercel の Storage → `antler-captures-production` に `captures/images/cap_runbook…-<64 桁>.jpg` が 1 つ。もう一度同じ ID で送ると 200。
消すときは、Blob の画面でそのファイルを消し、`turso db shell antler-production "DELETE FROM captures WHERE key LIKE 'cap_runbook%'"`。

Preview も同じ順に確かめる（保護があるので、ブラウザで Vercel にログインしてから。curl で叩くなら Settings → Deployment Protection の「Protection Bypass for Automation」の値を `x-vercel-protection-bypass` ヘッダで渡す）。

### おかしいとき

- **Runtime Logs**（プロジェクト → Logs）で `vercel.boot_failed`（組み立ての失敗。理由は env の名前か `SchemaOutdatedError`）、`rate_limit.counter_unavailable`（Turso に届かない）、`http.error` を探す
- 前のデプロイに戻す: Deployments → 前の Production → **Instant Rollback**（DB の表は戻らない。表の版を上げた PR を戻すときは注意）
- Turso が落ちているあいだ、レート制限はインスタンスごとのメモリで数える（インスタンスが増えると上限がゆるむ）。費用は 1 日の上限（DB）と 6 の支出の上限で止まる
- `client_ip.missing` が出ていたら、IP のヘッダが届いていない（全員が 1 つの枠になる）。Vercel の前に別のプロキシを置いていないか確かめる

## 8. 任意: Vercel Firewall のレート制限

使えるプランなら、Firewall → Rules に `/api/*` と `/health/ready`（1 回ごとに Turso を読む。レート制限が無い）の IP あたりのレート制限（例: 1 分 120 回）を足す。アプリのレート制限の前で止まり、Turso の読み書きも減る。

## 残っていること（この手順の外）

- **OG 画像の日本語のフォント**: Vercel の関数の Linux には CJK のフォントが無く、`/t/<id>/og.png` の日本語が四角になりうる。フォントのファイルを同梱するかはライセンスの判断（CLAUDE.md のアセットは CC0 / CC-BY / 自作のみ。Noto Sans JP は OFL）。決めたら `OG_FONT_FILES` で渡す
- **Vercel で受けた Capture の取り込み**: `dataset/` はまだ Turso の `captures` と Blob を読まない（別 feature）
- **Capture の保持期間**: 消す仕組みが無い。上限（件数・バイト）で増え方だけを止めている
- **B の PWA の公開**: 範囲外（冒頭）
