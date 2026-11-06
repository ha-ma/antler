---
feature: record
target_paths:
  - packages/trip/src/record/
  - apps/api/src/domain/record/
  - apps/api/src/application/ports/repositories/record.repository.ts
  - apps/api/src/application/usecases/record/
  - apps/api/src/infrastructure/repositories/drizzle-record.repository.ts
  - apps/api/src/infrastructure/http/routes/record.routes.ts
  - apps/api/src/infrastructure/http/schemas/record.schema.ts
  - apps/api/src/infrastructure/http/views/
  - apps/sim/src/features/record/
  - apps/sim/src/app/DriveRoute.tsx
spec_confirmed_at: 7435a29
tier: 2
---

# 仕様: record（A-7 旅の記録・走行の記録・記録ページ・削除）

**og-font（2026-11-06）での変更**: OG 画像（`/t/:id/og.png`）は同梱の Noto Sans JP / TC / KR（OFL）で描く（`docs/specs/og-font/functional.md`）。この feature の挙動は変わらない。

## 概要

旅の記録 A-7 を作る。1 日の運転（走行）が終わるたびに、その要約（走行の記録 = run）を api に残し、旅の記録ページ `/t/{id}` で集計して見せる。
記録 URL はログインなしで開け（A7-1）、共有したときのカード（OG 画像）にしおりを描く。旅をつくった端末からは記録を削除できる（ch6）。

- sim の `/t/:id`（デザインの対応表の A7_Record）: 本物の A-7。リンクのコピー・しおりの PNG 保存・アラート OFF で挑戦・B への導線・削除
- api の `GET /t/:id`: 共有用の SSR ページ（JS なしで読める記録と OG の meta）。`GET /t/:id/og.png`: しおりを描いた PNG（OG 画像と A7-4 の保存に同じものを使う）
- 走行の記録 `POST /api/trips/:id/runs` と削除 `DELETE /api/trips/:id` は旅の所有者トークン（plan-trip R7）で照合する

要件: ch3 A7-1〜A7-4、A5-6（完走で A-7）・A5-7（アラート→ブレーキ・最接近）、ch7 `GET /t/{id}`（SSR・OG 画像）、ch6（記録作成のレート制限 10/分/IP、記録 URL は推測困難な 8 文字、削除リンクを A-7 に置く、`requestAnimationFrame` の計測を A-7 に記録）、ch5（4 言語）、付録 A #9（登録なしで最後まで・4 言語が欠けない）、plan-trip R7（所有者トークン）・R10（ON / OFF は走行の記録の側）。
画面の正: UI キャンバス v2 の A7_Record。

**Tier 2**: 認可（所有者トークンでの書き込み・削除）、永続化スキーマ（表 `trip_runs` を足す）、外部への公開（SSR ページ・OG 画像）に触れる。

**deploy-a（2026-11-05）での変更**: Vercel では sim と api が同じオリジンになり、`/t/:id` を api（SSR）に書き換える。共有ページの「EZO ROAD で開く」は `${SIM_PUBLIC_URL}/t/{id}?app=1`（クエリ `app` があると sim の A-7 が開く。UC-7b のテストを更新）。sim の `recordShareUrl`・`recordImageUrl` は `VITE_API_BASE_URL` が空ならページのオリジンを付けた絶対の URL（UC-9a は今までどおり）。レート制限（R12）の枠は名前（`record.writes`・`record.reads`・`record.og`）で、書き込み・読み出しをそれぞれ route で分け合うのは今までどおり。詳しくは docs/specs/deploy-a/。

**範囲外**: drive の中の変更（運転の終わりは drive-link の `onFinish(DriveResult)` を app 層の `DriveRoute` で受けてつなぐ。R11）、A-6 喪失の画面（loss。衝突の run は DriveRoute が残す）、出来事の時系列 `POST /api/trips/:id/events`（stop-events）、楽しみの写真の実物（Day 6）、Claude が書く「今日の鹿レポート」（付録 A #10、deer-report）、同意のチェックと Capture（capture）、保持期間による自動削除（Deferred）。

> 2026-11-06 drive-crash-spot（`docs/specs/drive-crash-spot/functional.md` R4）が run に省略できる `spotting`（`{ appeared, found, early }`、early ≤ found ≤ appeared）を足し、集計に省略できる `totals.spotting`（その日の結果の run がすべて `spotting` を持つときだけ合計）と、A-7 の 1 行（`RecordView.spotting`）を足した。足す前の run・記録はそのまま通る。運転の結果の `spotting` が範囲外なら run から欄ごと外して送る（`toDriveRun`、UC-4i）。
>
> 2026-11-06 performance（`docs/specs/performance/functional.md` R1）が記録の `frames` に省略できる `dropped`・`counted` を足した（R2 に書いた）。両方あるか両方無いかで、`dropped` は `counted` 以下。足す前の run はそのまま通る。`drive-run.test.ts` の UC-9f のテストが performance UC-1f も兼ねる（名前に印を付けた）。検証の文は利用者に出ないので英語。

## Example Map

Story: 自分で描いた旅を最後まで走った旅行者として、守れた楽しみと鹿との出会いを 1 枚の記録で見返し、URL で人に見せたい。見せたくなくなったら消したい。

- R1 記録の ID と URL: 記録 URL の id は旅の id（plan-trip R7 の暗号論的乱数の英数 8 文字）。別の ID を作らない（推奨で決定。ch7 の TripPlan の例と UI キャンバスの URL が旅の id）
  - 共有する URL は api の `/t/{id}`（OG の meta を出せるのはサーバーだけ）。sim の A-7 はこの URL（`VITE_API_BASE_URL` + `/t/{id}`）を表示・コピーする
  - api が og:url・og:image・リンクに書く公開 URL は env だけから作る（`PUBLIC_API_URL`・`SIM_PUBLIC_URL`・`PWA_PUBLIC_URL`。既定は開発の `http://localhost:8787`・`5173`・`5174`）。要求の `Host` ヘッダは使わない（偽の og:url を返さない。spec-adversary [4]）。`PUBLIC_API_URL` と `VITE_API_BASE_URL` は同じ公開の api を指す（.env.example に書く）
- R2 走行の記録（run）: 1 日の運転 1 回の要約。`POST /api/trips/:id/runs` に `Authorization: Bearer <ownerToken>` を付けて送る
  - 欄: `runId`（UUID）・`day`（1〜日数）・`alertEnabled`・`outcome`（completed | collided）・`zonePasses`（入った鹿ゾーンの区間の数 0〜50）・`encounters`（最大 50。`pattern`・`at`（ゲーム内の時刻 ISO、赤が出ていなければ null）・`alertToBrakeMs`（0〜60,000 か null）・`closestM`（0〜500）・`outcome`（avoided | collided））・`frames`（fps の中央値・5 パーセンタイル・枚数・落ちたフレームの数 `dropped` と数えたフレームの数 `counted`（どちらも走行の全体の 0 以上の整数。performance R1 で足した。省略できるので、足す前に保存した run も読める）、無ければ null）
  - 1 つの旅の 1 日に 20 件まで（21 件目は 409 `RUN_LIMIT`。旅全体だと、やり直しを重ねた日のせいでほかの日が残せなくなるため日ごと。spec-adversary [2]）
  - body は 16 KB まで（超えたら 413 `PAYLOAD_TOO_LARGE`。zod の前に読む量を抑える）
  - 同じ `runId` の再送は保存せずに既存を 200 で返す（冪等。中身が違っても上書きしない）
  - トークンが無い・形が違う → 401。違う → 403。旅が無い → 404。日が日数を超える・欄の形が違う → 400
  - 所有者トークンを要求する（推奨で決定）: 記録は公開で、トークンなしで書けると URL を知る人が他人の記録に偽の走行を差し込める。トークンの無い端末（別の端末で開いた旅など）の運転は保存しない
  - ON / OFF は run の `alertEnabled` に持つ。`plan.alertEnabled` は見ない（plan-trip R10）
- R3 集計（純粋関数 `summarizeRecord`）: 日ごとに **鹿アラート ON の最新の run**（保存順で最後）をその日の結果にする。ON の run が無い日だけ OFF の最新を使う
  - 理由: A7-4 の「アラート OFF で挑戦」は遊び。ON で完走した日を OFF の衝突で上書きすると、挑戦を勧めた画面が本人の記録を壊す（spec-adversary [2]）。OFF の挑戦の結果は日ごとに `offResult`（OFF の最新の run の結果、無ければ null）として別に出す
  - 日の結果: completed | collided | not-driven（run が無い）。旅の状態: 全日 completed → completed、run が 1 件も無い → not-started、それ以外 → partial
  - 走った日の最大 `furthestDay`（結果が not-driven でない日の最大。無ければ 0）。見出しの「D{n} まで走った。」の n
  - 守れた楽しみ: その日の結果が completed の日の `stops`（楽しみの id）。分母は全日の `stops`。同じ id が 2 日にあれば最初の日の 1 つとして数える
  - ゾーン通過回数 = 各日の結果にした run の `zonePasses` の和。遭遇 = その run の `encounters` の数、回避 = そのうち avoided
  - アラート→ブレーキの平均 = その run の遭遇のうち `alertToBrakeMs` がある分の平均（無ければ null で「—」）
  - ゾーンでの各回のログ: 日 → 時刻（null は後ろ）の順。最接近 5 m 以下の回避は「間一髪」（推奨で決定）
  - 最後に走った日 `lastDay` = 保存順で最後の run の日（run が無ければ 1）。「アラート OFF で挑戦」の行き先
- R4 記録の読み出し `GET /api/trips/:id/record`: `{ trip, record }`。認証なし（ID を知る人が読める。brief-map と同じ）
  - `trip` は画面に出す欄だけの `RecordTrip`（id・lang・title・出発と返却の日時と場所・人数・各日の from / to / stops / stay）。予算・seed・リスク・楽しみの重さ・TripDetails は返さない（記録の URL は SNS で広く共有されるため、見せる分だけにする。spec-adversary [7]）
  - 同じ ID で brief-map の `GET /api/trips/:id/day/:n` は旅を丸ごと返す（A-6 のやり直し・別の端末からの運転に要る。brief-map の判断のまま）。旅の ID と記録の ID を分けるのはハッカソン後の課題として threat.md に残す
  - 保存した行（ownerTokenHash・runId）は返さない
- R5 A-7 の画面（sim `/t/:id`、デザイン A7_Record）
  - 上部: ブランド・記録 URL（読み取り専用の入力）・「リンクをコピー」・「しおりを画像で保存」
  - 本文: eyebrow「TRIP RECORD ・ 出発日 – 返却日」（日付は `Asia/Tokyo` で書く。端末・サーバーの TZ に依らない）、状態の見出し（完走「守りきった。」・途中「D{n} まで走った。」（n = `furthestDay`）・未走行「まだ走っていません。」）、しおりのタイトル、人数・日数・ゾーン通過・遭遇・回避の 1 文
  - StatTile 4 つ: 楽しみ 達成 `n / N`・鹿ゾーン通過 `n 回`・鹿 遭遇 / 回避 `n / n`・アラート→ブレーキ 平均 `n.n s`（数値は `num-l`、単位は 40 %）
  - 「守れたもの」: 守れた楽しみのカード（写真のプレースホルダ＋日・名前・補足）。無ければ「まだ守れた楽しみはありません」
  - 「鹿ゾーンでの n 回」: 各回の日・時刻・出方・最接近・アラート→ブレーキ・結果（回避 `spruce`、間一髪 `clay-deep`、衝突 `clay-deep`）。無ければ「鹿には出会いませんでした」
  - しおり: 各日の行に ✓（完走）・✕（衝突）・—（未走行）。その日の結果が OFF の run なら「OFF」の印。OFF の挑戦があれば「OFF ✓」「OFF ✕」を添える（`offResult`）
  - 言語は `plan.lang`。文言の表は 4 言語とも空欄なし（#9）
- R6 しおりの PNG と OG 画像 `GET /t/:id/og.png`: 1200×630 の PNG。タイトル・日程・各日の行と ✓ / ✕ / —・守れた楽しみ `n / N`・ブランド
  - SVG を組み立て、`@resvg/resvg-js` で PNG にする（追加の依存。MPL-2.0、CREDITS.md）。文字は同梱のフォント（Noto Sans JP / TC / KR の Bold。og-font、2026-11-06）。`OG_FONT_FILES` があればそのファイルを使う
  - タイトルは 2 行で切って末尾を「…」、日の行は 7 行までで、それより多ければ「ほか n 日」。制御文字（U+0000〜U+001F・U+007F）は取り除いてから XML エスケープする（spec-adversary [6]）
  - 描いた PNG をプロセスのメモリに 100 枚まで持つ（鍵は旅の id・run の数・最後の seq。run が増えれば鍵が変わり描き直す）。読み出しは毎回 DB を引いてから鍵を作るので、削除のあとは 404 で、持っている画像を返さない。持っている画像を返すときは描画の枠を使わない（spec-adversary [5]）
  - 同時に描くのは 2 枚まで（超えたら 503 `OG_BUSY`）
  - sim の「しおりを画像で保存」はこの PNG を取得して `ezo-road-{id}.png` で保存する（推奨で決定。ブラウザでもう 1 つ描画を持たない）
- R7 共有用の SSR ページ `GET /t/:id`: JS なしで記録が読める HTML
  - `og:title`（しおりのタイトル）・`og:description`（状態と StatTile の 1 文）・`og:image`（R6 の絶対 URL）・`og:url`・`twitter:card=summary_large_image`
  - 本文は R5 と同じ順の読み取り専用（StatTile・守れたもの・ログ・しおり・B の導線）。「EZO ROAD で開く」（sim の `/t/:id`）と「自分の旅をつくる」（sim の `/plan`）
  - スクリプトを持たない。CSP は `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  - 検索エンジンに載せない（`X-Robots-Tag: noindex` と meta robots。推奨で決定）
  - 無い id・形の違う id・削除済み → 404 の HTML（「この記録は見つかりません。削除されたか、URL が違います」）
- R8 B への導線（A7-3）: 夜テーマのブロック「実際の旅にも、同じアラートを」と箇条書き 3 つ、「車載アラートについて →」で PWA（B-0）へ（`VITE_PWA_URL` / `PWA_PUBLIC_URL`）
- R9 アラート OFF で挑戦（A7-4）: 最後に走った日の A-2 へ `alert=off` で（`/trip/{id}/brief?day={n}&alert=off`。brief-map R7 の合図）。「別の旅をつくる」は `/plan`
  - この端末に所有者トークンが無いときは、挑戦のリンクの下に「この端末での運転は、この記録には残りません」を出す（隠さない。共有リンクから来た人・アプリ内ブラウザで開いた本人。spec-adversary [1]）
- R10 削除（ch6）: `DELETE /api/trips/:id` に `Authorization: Bearer <ownerToken>`
  - 照合: トークンの SHA-256 と保存したハッシュを長さ一定の比較で比べる。無い・形が違う → 401、違う → 403、旅が無い → 404、成功 → 204
  - 消すもの: 旅（TripPlan・TripDetails・所有者のハッシュ）・その旅の run・その旅を指す冪等キーの行を 1 つのトランザクションで（冪等キーの行を残すと、同じキーの再送が「指す旅が無い」500 になる）
  - stop-events の出来事の束（`stop_decks`）とイベントログ（`trip_events`）の行も消す（2026-11-04、stop-events のマージで足した。下の Deferred を解消。events の runId は run と同じ値で、A-7 の集計は run だけを使う。stop-events functional.md R10）
  - 消した直後から `/t/:id`・`og.png`・`/api/trips/:id/record`・`/api/trips/:id/day/:n` は 404（キャッシュしない。`Cache-Control: no-store`）
  - 消すもの（表）は「`trip_id` の列を持つすべての表」を基準にし、テストで `sqlite_master` を列挙して確かめる（後から表が増えて削除に足し忘れれば落ちる。spec-adversary [3]）
  - sim: 所有者トークンがこの端末にあるときだけ「この記録を削除」を出す。押すと確認（「削除すると、この記録の URL は誰も開けなくなります。元に戻せません。共有先に表示されたカードは残ることがあります」・「削除する」・「やめる」）→ 成功で端末のトークンを消し「削除しました」と A-1 へのリンク。無い端末には「削除は、この旅をつくった端末（同じブラウザ）からできます」
  - UI キャンバスの A7_Record には削除が無い。ch6 に従い、B の導線の下に足す（モックからの差分）
- R11 走行の保存の hook（barrel）: `useSaveRun()` は旅の id の所有者トークンを読み、あれば POST、無ければ保存しない（`not-owner` を返す）。`recordHref(id)` は `/t/{id}`
  - 呼び出し側（drive・loss）との約束: `not-owner` のときは `/t/:id` へ移らず、その運転の結果をその場で見せる（記録に移ると、自分の運転が消えたように見える）
  - 配線（app 層の `DriveRoute`、drive-link マージ後に追加）: drive の `onFinish(DriveResult)` を `toDriveRun` で run にして保存。旅の場面だけ（見本の場面は残さない）。完走して残せたら `/t/:id` へ（A5-6）、衝突は終了の帯のまま（A-6 は loss）
    - 2026-11-04 loss の取り込み（PR #31）: 衝突は run を残したうえで、同じ `DriveRoute` が loss の `lossReportFromDrive`・`lossHref` で A-6（`/loss/:id?…`）へ移る（保存の結果は待たない。トークンの無い端末でも移る）。A-6 から A-7 へは「この旅の記録を見る」のリンク（`recordHref`）。旅の削除は A-6 の喪失文（`trip_losses`）も消す。record の保存と完走の挙動は変わらない
  - `toDriveRun`: pending の遭遇は送らない、遭遇の時刻は `alertClockAt`（drive-link。移動の始まりで時計を進めるので startAt + alertAt ではない）、範囲はスキーマの上限に丸める、runId は運転ごとに新しい UUID（推奨で決定）
- R12 レート制限（IP あたり 1 分）: 書き込み（runs・DELETE）10 件（ch6 の記録作成）、読み出し（record・`/t/:id`）60 件、`og.png` 20 件

推奨で決定（CLAUDE.md の方針。PR にも書く）: R1 の記録 id = 旅の id と公開 URL は env だけ、R2 の所有者トークンの要求・欄・1 日 20 件・16 KB・冪等の扱い、R3 の「ON の最新」と間一髪 5 m、R4 の見せる欄、R6 の resvg とフォントの扱い・切り詰め・メモリの 100 枚・PNG の保存は api の画像、R7 の noindex と CSP、R9 の挑戦の日と案内、R10 の削除の範囲とステータス、R12 の件数。spec-adversary の 7 件（docs/reports/2026-11-04-spec-adversary-record.md）はすべて推奨案で取り込んだ。

## API エンドポイント

### POST /api/trips/:id/runs

- 認証: `Authorization: Bearer <ownerToken>`（16 進 64 文字）
- body: R2 の欄（`DriveRunInputSchema`、strict。知らない欄は 400）
- 201 `{ run: { runId, day, alertEnabled, outcome, createdAt } }`。同じ runId の再送は 200 で同じ形

### GET /api/trips/:id/record

- 200 `{ trip, record }`（`RecordTripSchema`・`TripRecordSchema`）。`Cache-Control: no-store`

### DELETE /api/trips/:id

- 認証: `Authorization: Bearer <ownerToken>`。204（本文なし）

### GET /t/:id ・ GET /t/:id/og.png

- 200 `text/html; charset=utf-8` ／ 200 `image/png`。どちらも `Cache-Control: no-store`・`X-Robots-Tag: noindex`

## ユースケース

### UC-1: 走行の記録の形（R2）

- **Given**: drive が渡す 1 日の運転の要約
- **When**: `DriveRunInputSchema` で確かめる
- **Then**: 範囲と列挙に合うものだけが通る

### UC-2: 集計（R3）

- **Given**: 旅と保存した run の列
- **When**: `summarizeRecord`
- **Then**: 日ごとの最新の run から、状態・守れた楽しみ・回数・平均・ログが決まる

### UC-3: 走行の保存（R2・R12）

- **Given**: 所有者トークンと run
- **When**: `POST /api/trips/:id/runs`
- **Then**: 照合が通れば保存し、再送は冪等、上限・形・日数を守る

### UC-4: 記録の読み出し（R4）

- **Given**: 旅の id
- **When**: `GET /api/trips/:id/record`
- **Then**: 集計を返し、所有者の印を出さない

### UC-5: 削除（R10）

- **Given**: 所有者トークン
- **When**: `DELETE /api/trips/:id`
- **Then**: 旅・run・冪等キーの行が消え、以後の読み出しはすべて 404

### UC-6: OG 画像（R6）

- **Given**: 旅と集計
- **When**: `GET /t/:id/og.png`
- **Then**: 1200×630 の PNG（しおりを描いた SVG を変換）

### UC-7: SSR ページ（R7・R8）

- **Given**: 旅の id
- **When**: `GET /t/:id`
- **Then**: OG の meta と、JS なしで読める記録

### UC-8: A-7 の画面（R5・R8・R9）

- **Given**: `/t/:id`
- **When**: 開く
- **Then**: 記録の各欄・導線・言語

### UC-9: 画面のコピー・保存・削除（R5・R6・R10・R11）

- **Given**: A-7 の画面
- **When**: コピー・保存・削除を押す
- **Then**: それぞれの結果と失敗の案内

## エラーパターン

| 状況                                  | api                        | 画面                                                                |
| ------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| id の形が違う / 旅が無い / 削除済み   | 404 `TRIP_NOT_FOUND`       | 「この記録は見つかりません。削除されたか、URL が違います」＋ A-1 へ |
| 所有者トークンが無い・形が違う        | 401 `OWNER_TOKEN_REQUIRED` | （画面はトークンが無ければ送らない）                                |
| 所有者トークンが違う                  | 403 `NOT_OWNER`            | 削除: 「この端末の鍵では削除できません」                            |
| run の欄の形が違う / 日が日数を超える | 400 `INVALID_INPUT`        | （drive が作るので通常は起きない。保存の失敗として記録に出さない）  |
| その日の run が 20 件ある             | 409 `RUN_LIMIT`            | 保存の失敗（記録は今までの分で出る）                                |
| run の body が 16 KB を超える         | 413 `PAYLOAD_TOO_LARGE`    | 保存の失敗                                                          |
| OG の描画が混んでいる                 | 503 `OG_BUSY`              | 「画像を作れませんでした。もう一度」                                |
| レート制限                            | 429 `RATE_LIMITED`         | 「少し待ってもう一度」                                              |
| 予期しない例外                        | 500 `INTERNAL_ERROR`       | 「読み込めませんでした」＋「もう一度」                              |
| api に届かない                        | —                          | 読み込み: 「もう一度」／削除: 「つながりません。もう一度」          |

### 例外 → ステータスコードマッピング

| 例外                           | コード                 | HTTP |
| ------------------------------ | ---------------------- | ---- |
| `TripNotFoundError`            | `TRIP_NOT_FOUND`       | 404  |
| `OwnerTokenRequiredError`      | `OWNER_TOKEN_REQUIRED` | 401  |
| `NotOwnerError`                | `NOT_OWNER`            | 403  |
| `RunDayOutOfRangeError`        | `INVALID_INPUT`        | 400  |
| `RunLimitError`                | `RUN_LIMIT`            | 409  |
| `OgImageBusyError`             | `OG_BUSY`              | 503  |
| zod の検証エラー（パス・body） | `INVALID_INPUT`        | 400  |

## ビジネスルール

- 記録は日ごとの鹿アラート ON の最新の run で決まる（ON が無い日は OFF の最新）。同じ日を ON でやり直せば（A6-4）最新の結果に置き換わり、OFF の挑戦（A7-4）は別の印で並べる。古い run は消さない（1 日 20 件）
- 鹿アラートの ON / OFF は run にあり、TripPlan は変えない（plan-trip R10）
- 統計の実数（6,705 件など）をこの画面に出さない（出すのは A-6）。色は tokens.json だけ。`alert-danger` を使わない（衝突の ✕ も `clay-deep`。CLAUDE.md「alert-danger は鹿検知専用」）
- 記録のどこにも氏名・端末識別子・緯度経度を持たない（run は回数・時間・距離だけ）

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー / 期日=2026-11-06 / 暫定挙動=消さない] 旅と run の保持期間（plan-trip の Deferred と同じ行。Capture の保持期間と一緒に決める）
- [Deferred: 担当=人 A / 期日=2026-11-08（Day 6）/ 暫定挙動=写真のプレースホルダ（`photo-placeholder` に名前）] 守れた楽しみの写真の実物

## Test List（Canon TDD Step 1）

### 受け入れ（外側ループ）

- [x] AC-1: 旅をつくって（api のフェイクの Claude）、2 日目を完走・1 日目を衝突のあと完走の run をトークン付きで送ると、`GET /api/trips/:id/record` が 2 日ぶんの completed・守れた楽しみ・ゾーン通過の和・遭遇と回避・平均を返し、`GET /t/:id` が 200 の HTML（og:image が `/t/:id/og.png`）、`og.png` が PNG。トークン付きの DELETE で 204、そのあと 4 つとも 404
- [x] AC-2: A-7 の画面をペルソナの記録（api はフェイク）で開くと、状態の見出し・StatTile 4 つ・守れたもの・ゾーンのログ・しおりの ✓・B の導線・挑戦のリンク（`alert=off`）が出て、所有者トークンのある端末では削除を確かめて送ると「削除しました」になり、トークンが消える

### UC-1: 走行の記録の形

- [x] UC-1a: 正しい run が通る。`runId` が UUID でない・`day` 0・`outcome` が pending・`encounters` 51 件・`closestM` 501・知らない欄 → 通らない
- [x] UC-1b: `at` は +09:00 の ISO か null、`alertToBrakeMs` は 0〜60,000 か null、`frames` は null を許す

### UC-2: 集計

- [x] UC-2a: run が無い → not-started、全日 not-driven、守れた楽しみ 0 / N、平均 null、最後に走った日 1、furthestDay 0
- [x] UC-2b: 同じ日の run が 2 件（衝突 → 完走）→ その日は completed（最新）。ゾーン通過・遭遇は最新の run だけを数える
- [x] UC-2g: ON で完走した日のあとに OFF で衝突 → その日は completed のまま、`offResult` が collided。OFF の run しか無い日は OFF の最新が結果
- [x] UC-2h: furthestDay は走った日の最大（D1 ✓・D2 ✓・D3 ✕ のあと D1 を走り直しても 3）。同じ楽しみが 2 日にあっても 1 つとして数える
- [x] UC-2c: 全日 completed → completed。1 日でも collided か not-driven → partial
- [x] UC-2d: 守れた楽しみは completed の日の stops、分母は全日の stops の数
- [x] UC-2e: 平均は `alertToBrakeMs` がある遭遇だけ。ログは日 → 時刻の順（null は後ろ）、5 m 以下の回避は間一髪、6 m は普通の回避
- [x] UC-2f: 日ごとの `alertEnabled`（OFF の日が分かる）と、最後に走った日は保存順で最後の run の日

### UC-3: 走行の保存

- [x] UC-3a: 正しいトークンで POST → 201、保存され、記録に出る
- [x] UC-3b: 同じ runId を 2 回 → 2 回目は 200、行は 1 つ、中身が違っても最初のまま
- [x] UC-3c: `day` が日数を超える → 400 `INVALID_INPUT`、保存しない
- [x] UC-3d: その日に 20 件ある旅に 21 件目 → 409 `RUN_LIMIT`。別の日は残せる
- [x] UC-3e: 1 分に 11 回 → 429
- [x] UC-3f: 16 KB を超える body → 413 `PAYLOAD_TOO_LARGE`

### UC-4: 記録の読み出し

- [x] UC-4a: 200 `{ trip, record }` が `RecordTripSchema`・`TripRecordSchema` を通り、応答に `ownerTokenHash`・`runId`・予算・seed が無い。`Cache-Control: no-store`
- [x] UC-4b: 無い id・形の違う id → 404 `TRIP_NOT_FOUND`

### UC-5: 削除

- [x] UC-5a: 正しいトークン → 204。`trip_id`（trips は `id`）の列を持つすべての表（`sqlite_master` を列挙）でその旅の行が 0 件、ほかの旅の行は残る
- [x] UC-5b: 削除のあと、同じ冪等キーで POST /api/trips を再送しても 500 にならない（新しい旅として作り直す）

### UC-6: OG 画像

- [x] UC-6a: しおりの SVG にタイトル・日ごとの行と記号・`n / N` が入り、文字は XML のエスケープ済み（`<` `&` を含むタイトル）
- [x] UC-6b: `GET /t/:id/og.png` → 200 `image/png`、PNG の先頭 8 バイト、幅 1200・高さ 630
- [x] UC-6c: 同時に 3 枚目 → 503 `OG_BUSY`
- [x] UC-6d: タイトルが長いと 2 行で「…」、8 日以上の旅は 7 行と「ほか n 日」、制御文字は取り除く
- [x] UC-6e: 同じ記録の 2 回目は描かない（メモリの画像）。run が増えると描き直す。削除のあとは 404

### UC-7: SSR ページ

- [x] UC-7a: 200 の HTML に og:title（タイトル）・og:description・og:image（絶対 URL の `/t/:id/og.png`）・twitter:card、`noindex`、CSP、`<script` が無い
- [x] UC-7b: 本文に StatTile 4 つの値・守れたもの・ログ・しおり・B の導線（`PWA_PUBLIC_URL`）・sim の `/t/:id` と `/plan` へのリンク
- [x] UC-7c: タイトルの `<script>` は文字としてエスケープされる
- [x] UC-7d: 無い id → 404 の HTML（「見つかりません」）
- [x] UC-7e: `Host: evil.example` で要求しても og:url・og:image は `PUBLIC_API_URL`。日付は Asia/Tokyo

### UC-8: A-7 の画面

- [x] UC-8a: 読み込み中・404（「見つかりません」と A-1 へ）・500（もう一度で読み直す）
- [x] UC-8b: 完走・途中・未走行の見出し、StatTile 4 つ（平均が無ければ「—」）
- [x] UC-8c: 守れたもの（無ければ空の案内）、ゾーンのログ（間一髪・衝突の表記、無ければ空の案内）
- [x] UC-8d: しおりの各日に ✓ / ✕ / — と OFF の印
- [x] UC-8e: B の導線のリンク先が PWA、挑戦のリンクが最後に走った日の `alert=off`、「別の旅をつくる」が `/plan`
- [x] UC-8f: 言語は `plan.lang`。文言の表は 4 言語とも空欄が無い
- [x] UC-8g: 所有者トークンの無い端末では、挑戦のリンクの下に「この端末での運転は、この記録には残りません」

### UC-9: コピー・保存・削除

- [x] UC-9a: 記録 URL は `VITE_API_BASE_URL` + `/t/{id}`。コピーで clipboard に入り「コピーしました」
- [x] UC-9b: 「しおりを画像で保存」で `og.png` を取得し `ezo-road-{id}.png` で保存。失敗は「画像を作れませんでした」
- [x] UC-9c: トークンのある端末だけに削除。確かめずに消えない（「やめる」で戻る）。確認の文に「共有先に表示されたカードは残ることがあります」
- [x] UC-9d: 削除の成功で「削除しました」とトークンの消去。403 は「この端末の鍵では削除できません」、通信の失敗は「つながりません」
- [x] UC-9e: `useSaveRun` はトークンがあれば Bearer 付きで POST、無ければ送らずに `not-owner`
- [x] UC-9f: 旅の場面を完走 → run を残して `/t/:id` へ。衝突は残すが移らない、トークンの無い端末は送らず移らない、見本の場面は残さない。`toDriveRun` は pending を落とし、時刻は `alertClockAt`、範囲を丸める

### 認可（threat.md）

- [x] AUTH-1: POST runs にトークンなし → 401、形の違うトークン → 401、保存しない
- [x] AUTH-2: POST runs に別の旅のトークン → 403、保存しない
- [x] AUTH-3: DELETE にトークンなし → 401、違うトークン → 403、何も消えない
- [x] AUTH-4: DELETE の成功のあと、同じトークンでもう一度 DELETE・POST runs → 404
- [x] AUTH-5: 記録の JSON・SSR・OG はトークンなしで読める（ID を知る人に公開）
- [x] IDOR-1: 旅 A のトークンで旅 B を DELETE → 403、旅 B の行は残る
- [x] IDOR-2: 応答（record の JSON・SSR の HTML）に ownerTokenHash・runId・トークンが無い
- [x] MASS-1: run の body に `tripId`・`createdAt`・`seed`・知らない欄 → 400、保存しない
- [x] SEC-1: `isOwnerTokenHash` は長さの違い・1 文字違いで false、同じで true（長さ一定の比較）
- [x] SEC-2: SSR の HTML に CSP（`default-src 'none'`・`frame-ancestors 'none'`）と noindex、`<script` が無い

### 障害耐性（resilience.md）

- [x] FAIL-1: 保存した run の 1 件が壊れている → その run を飛ばして集計し、warn を出す
- [x] FAIL-2: 削除の途中の失敗でトランザクションが戻る（run を消したあとに例外 → 旅も run も残る）
- [x] FAIL-3: sim の記録の読み出しが 500 → 「もう一度」で読み直して出る。形の違う応答 → 失敗の表示（白い画面にならない）
- [x] FAIL-4: 削除が通信の失敗 → 「つながりません」、トークンは残る
- [x] FAIL-5: clipboard が使えない → 「コピーできませんでした」の案内
- [x] IDEM-1: 同じ runId の POST を 2 回 → 行は 1 つ、2 回目は 200
- [x] CONC-1: 削除した旅への POST runs → 404、run は残らない

## Rule → ドメイン語彙対応

| Rule                     | 語彙（コード上の名前）                                                                                  | 置き場所                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| R2                       | `DriveRunInputSchema`、`DriveRunInput`、`MAX_RUNS_PER_DAY`                                              | `packages/trip/src/record/run.ts`                                     |
| R3・R4                   | `summarizeRecord`、`TripRecordSchema`、`TripRecord`、`CLOSE_CALL_M`、`recordTripOf`、`RecordTripSchema` | `packages/trip/src/record/summary.ts`                                 |
| R2・R10                  | `isOwnerTokenHash`（長さ一定の比較）                                                                    | `apps/api/src/domain/record/policies/owner-policy.ts`                 |
| R2                       | `SaveRunUseCase`                                                                                        | `apps/api/src/application/usecases/record/save-run.usecase.ts`        |
| R4・R6・R7               | `GetTripRecordUseCase`                                                                                  | `apps/api/src/application/usecases/record/get-trip-record.usecase.ts` |
| R10                      | `DeleteTripUseCase`                                                                                     | `apps/api/src/application/usecases/record/delete-trip.usecase.ts`     |
| R6                       | `buildShioriSvg`、`OgImageRenderer`                                                                     | `apps/api/src/infrastructure/http/views/`                             |
| R7・R8                   | `renderRecordPage`、`renderNotFoundPage`                                                                | `apps/api/src/infrastructure/http/views/record-page.ts`               |
| R2・R4・R6・R7・R10・R12 | `recordRoutes`                                                                                          | `apps/api/src/infrastructure/http/routes/record.routes.ts`            |
| R5・R8・R9               | `RecordPage`、`useTripRecord`                                                                           | `apps/sim/src/features/record/`                                       |
| R10・R11                 | `useDeleteTrip`、`useSaveRun`、`recordHref`                                                             | `apps/sim/src/features/record/hooks/`                                 |
| R11                      | `toDriveRun`                                                                                            | `apps/sim/src/features/record/utils/drive-run.ts`                     |
| R11                      | `DriveRoute`                                                                                            | `apps/sim/src/app/DriveRoute.tsx`                                     |

## 受け入れ基準

- AC-1・AC-2 が Green、Test List がすべて済み
- `python .claude/hooks/sfad-done.py record` が exit 0
- code-reviewer・layer-guard・component-guard・accessibility-checker・security-auditor の Critical が 0
- CREDITS.md に `@resvg/resvg-js`（MPL-2.0）
