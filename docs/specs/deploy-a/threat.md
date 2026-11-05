# 脅威: deploy-a（Vercel・Turso・Vercel Blob）

この feature は API の口を増やさない。変わるのは「どこで動くか」と「どこに置くか」: 関数（Vercel）・DB（Turso）・画像（Vercel Blob 非公開）・レート制限の数え（Turso）・利用者の IP の取り方（Vercel のヘッダ）。
認可（所有者トークン・登録なし）は plan-trip・record・stop-events・loss・edge-capture のまま。

関数に書き換えるルート（コードにある全部。認可は各 feature の threat.md が正）:

| ルート                               | 正の仕様     | 関数での変化                                       |
| ------------------------------------ | ------------ | -------------------------------------------------- |
| POST /api/trips                      | plan-trip    | レート制限の数えが Turso。1 日の上限は今までどおり |
| GET /api/trips/:id/day/:n            | brief-map    | レート制限の数えが Turso                           |
| POST /api/trips/:id/day/:n/stop-deck | stop-events  | レート制限の数えが Turso                           |
| POST /api/trips/:id/events           | stop-events  | レート制限の数えが Turso                           |
| POST /api/trips/:id/losses           | loss         | レート制限の数えが Turso                           |
| POST /api/trips/:id/runs             | record       | レート制限の数えが Turso                           |
| GET /api/trips/:id/record            | record       | レート制限の数えが Turso                           |
| DELETE /api/trips/:id                | record       | レート制限の数えが Turso                           |
| GET /t/:id                           | record       | クエリ `app` があるときは SPA（R2）                |
| GET /t/:id/og.png                    | record       | フォントは Deferred                                |
| POST /api/captures                   | edge-capture | 保存先が Turso の行と Blob の画像                  |

## Authorization Matrix

| 操作                                                      | 利用者（匿名のブラウザ・スクリプト）                                                             | 運用者（Vercel・Turso のダッシュボードと CLI）                 | 関数（内部）                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------ |
| ヘッダを偽ってレート制限の枠を増やす                      | ❌ Vercel がつけた `x-vercel-forwarded-for` を先に読む。左側の値は使わない（AUTH-1）             | N/A: 枠を数える側ではない                                      | ✅ ヘッダの右端を鍵にする                        |
| レート制限・Capture の表から利用者の IP を読む            | ❌ 表に IP を置かない（HMAC の鍵だけ）（AUTH-2）                                                 | ❌ 表に IP が無いので読めない。鍵から IP を戻せない（AUTH-7）  | N/A: 書くのは鍵だけ                              |
| Capture の画像を読む・一覧する・消す                      | ❌ 読み出し・一覧・削除の HTTP の口が無い。Blob は非公開（AUTH-3）                               | ✅ Blob のダッシュボード・CLI（dataset の取り込みは Deferred） | ✅ 置く（put）と、負けた側の自分の画像を消すだけ |
| 表を作る・作り直す（マイグレーション）                    | ❌ HTTP の口が無い。入口は表を作らない（AUTH-4）                                                 | ✅ `npm run db:migrate`（手元から。トークンが要る）            | N/A: 起動時に作らない                            |
| 起動の失敗の理由（env の名前・値・例外）を読む            | ❌ 503 `UNAVAILABLE` だけ（AUTH-5）                                                              | ✅ Vercel の Runtime Logs                                      | ✅ ログに名前とメッセージ（値は出さない）        |
| `/health/ready` から DB の場所・エラーの文を読む          | ❌ 検査の名前と `unavailable` だけ（AUTH-6）                                                     | ✅ Runtime Logs                                                | ✅ 検査を回す                                    |
| Preview の関数から Production の DB・Blob に書く          | N/A: 利用者は環境を選べない                                                                      | ✅ env を環境ごとに分ける（手順書）                            | N/A: 自分の環境の env だけを読む                 |
| 秘密（Turso・Blob・Anthropic のトークン）をブラウザで読む | N/A: `VITE_` で始まる変数だけがブラウザに出る。秘密は `VITE_` にしない（手順書・`.env.example`） | ✅ Vercel の env（Sensitive）                                  | ✅ `process.env` から読む                        |

<!-- AUTH-1〜7 は functional.md の Test List にある（❌ 7 セル）。 -->

## IDOR / Mass Assignment チェック

### Capture（Blob と Turso）

- [ ] 画像の名前はサーバーが決める（`captures/images/{key}-{sha256}.{ext}`）。利用者の値（ファイル名・パス）を名前に使わない。key は `^cap_[a-z0-9]+$` を通してから使う（CAP-6e）
- [ ] 行に入れるのは「サーバーが決めた形」の Capture（edge-capture の A4。`image` は論理のパス・`consent: true`）。本文の余分な項目は schema の strict で拒否済み
- N/A: IDOR — 読み出し・削除の口が無い（ID で資源を指す操作が無い）

### レート制限の表

- [ ] 鍵は HMAC（秘密は `OWNER_TOKEN_SECRET` から派生）。scope と IP の枠から作り、利用者は鍵を選べない
- N/A: Mass Assignment — 利用者の本文を表に入れない

## Data Classification

| データ                                   | 分類                                                                              | 保存場所                                                                                  | 配信方法                            | 削除タイミング                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| 利用者の IP                              | 個人に結びつきうる                                                                | アプリは保存しない（関数のメモリで HMAC にするだけ）。Vercel の基盤のログには接続元が残る | N/A: 配信しない                     | アプリは保存しない。Vercel のログは Vercel の保持期間     |
| レート制限の鍵（HMAC）と回数             | 内部（DB だけでは IP に戻せない。秘密と DB の両方を持つ運用者は総当たりで戻せる） | Turso の `rate_limit_hits`                                                                | N/A: 配信しない                     | 窓が過ぎたら 1 分に 1 回まで消す                          |
| Capture の本文（roadSegment に丸めた形） | 内部（同意済み・個人を特定しない）                                                | Turso の `captures`                                                                       | N/A: 配信しない（読み出しの口なし） | Deferred（edge-capture と同じ。dataset の取り込みのあと） |
| Capture の画像（車外の検知フレーム）     | 内部（同意済み。車内は写さない）                                                  | Vercel Blob（非公開）                                                                     | N/A: 配信しない                     | Deferred（edge-capture と同じ）                           |
| 旅・走行の記録（今までのもの）           | 各 feature のまま                                                                 | Turso（Production と Preview で別の DB）                                                  | 各 feature のまま                   | 各 feature のまま（record の削除）                        |
| 秘密（Turso・Blob・Anthropic・HMAC）     | 秘密                                                                              | Vercel の env（Sensitive）・手元の `.env.*`                                               | N/A: 配信しない                     | 漏れたら作り直す（手順書）                                |

## 認可の失効

| 失効イベント                        | 発生源           | 反映までの許容時間              | 反映されるまでの挙動                       | 検証                              |
| ----------------------------------- | ---------------- | ------------------------------- | ------------------------------------------ | --------------------------------- |
| Turso のトークンを作り直す          | 運用者（Turso）  | 次のデプロイまで                | 古いトークンの関数は DB に届かず 500 / 503 | 手順書の確かめ（`/health/ready`） |
| Blob の読み書きのトークンを作り直す | 運用者（Vercel） | 次のデプロイまで（OIDC は自動） | 古いトークンの関数は Capture が 500        | 手順書の確かめ（Capture の 201）  |
| N/A: 利用者のログイン・ロールは無い | N/A: 該当なし    | N/A: 該当なし                   | N/A: 該当なし                              | N/A: 該当なし                     |

## 横断的セキュリティチェック

- [ ] CORS: 同じオリジン。`CORS_ORIGINS` の既定は自分のオリジン 1 つ（`*` は env の検査で拒否のまま）
- [ ] CSP: sim は `connect-src 'self'`（`VITE_API_BASE_URL` は空）。SSR のページは record の CSP のまま
- [ ] レートリミット: 数えは Turso でインスタンスをまたぐ。Turso に届かないときは、インスタンスのメモリで数える（上限なしにしない）。Claude の 1 日の上限は DB、同時呼び出しはインスタンスごと。費用の最後の守りは Anthropic のコンソールの支出の上限（手順書）
- [ ] エラーメッセージ: 起動の失敗は 503 `UNAVAILABLE` だけ。`exposeErrorDetails` は `NODE_ENV=development` だけのまま（Vercel では production）
- [ ] ログマスキング: env の値・トークン・IP・Capture の本文を出さない
- [ ] 秘密: リポジトリに書かない。`.env.*` は gitignore 済み。Vercel では Sensitive の env にする（手順書）
- [ ] Blob: 非公開のストア（`access: 'private'`）。資格は OIDC（Vercel が自動で付ける）を優先。`BLOB_READ_WRITE_TOKEN` は手元から使うときだけ
- [ ] Preview: Preview の URL（ブランチの URL）は推測できる。**Deployment Protection（Vercel Authentication。Preview を Vercel のチームの人だけにする）を必須**にする（手順書で有効を確かめる）。Git Fork Protection を有効のままにする。Preview は別の DB・別の Anthropic のキー・小さい 1 日の上限（50）
- [ ] 書き込みの量: 上限を超えた鍵は窓の終わりまでメモリで 429（Turso に書かない）。Vercel Firewall のレート制限のルールを、使えるプランなら手順書で足す
