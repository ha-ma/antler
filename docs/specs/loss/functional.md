---
feature: loss
target_paths:
  - apps/sim/src/features/loss/
  - apps/api/src/domain/losses/
  - apps/api/src/application/usecases/losses/
  - apps/api/src/application/ports/repositories/loss.repository.ts
  - apps/api/src/application/ports/gateways/loss-writer.gateway.ts
  - apps/api/src/infrastructure/gateways/claude-loss-writer.gateway.ts
  - apps/api/src/infrastructure/repositories/drizzle-loss.repository.ts
  - apps/api/src/infrastructure/http/routes/loss.routes.ts
  - apps/api/src/infrastructure/http/schemas/loss.schema.ts
spec_confirmed_at: pending
tier: 2
---

# 仕様: loss（A-6 喪失・Claude が「失ったもの」を書く）

## 概要

A-3 の運転で鹿と衝突したら、drive は loss の barrel の `lossHref(collision)` で `/loss/:tripId?…` に移る。
A-6 の画面は、保存したしおり（`GET /api/trips/:id/day/:n`、brief-map の既存 API）と衝突の情報（URL）から、しおりの取り消し線・喪失 4 指標・統計カードを端末で決定的に組み立てる。
同時に `POST /api/trips/:id/losses` を呼び、api が Claude に「失ったもの」の文を 4 言語で書かせて保存し、返す。同じ衝突の 2 回目（再読み込み）は保存した文を返し、Claude を呼ばない。

要件: ch3 A6-1〜A6-4、付録 A #1（喪失文を Claude が生成・4 言語）、#3（デモ 30–75 秒「A の回避と OFF での喪失」）、#9（登録なし・4 言語が欠けない）、ch6（レート制限・濫用の抑え）、`docs/design/README.md` の LossCard・StatTile・原則 5（取り消し線と実数・出典付き）。
画面: UI キャンバス v2 の A6_Loss（`/loss/:id`）。night テーマ。

**Tier 2 の理由**: 外部副作用（Claude API の呼び出し。費用と遅延）、永続化（喪失文を保存し、再生・再読み込みで Claude を呼ばない）、並行性（同じ衝突の同時の要求）。

**範囲外**: 運転中に衝突を検出して `lossHref` に移る組み込み（drive-link。drive の feature は編集しない）、「衝突の 3 秒前を見る」の巻き戻し再生（drive の機能。Deferred）、A-7 の記録への喪失の表示（record）、免責・NOC の実額（stats.json の deductible はプレースホルダ）。

## Example Map

Story: 台湾から来た 4 人の代表として、鹿アラートを OFF にして走り、D2 の夕方に鹿と衝突した。A-6 で、しおりのどこから先が消えたか、何をいくら失ったかを実数と出典つきで見て、「アラートを ON にして同じ道をやり直す」を押す。

Questions は 2026-11-04 のラウンドで、すべて推奨で決定した（ユーザーの方針「推奨案のある判断は推奨案で決めて進める」、2026-11-03）。決定は各 Rule に「推奨で決定」と書いた。
spec-adversary の指摘（`docs/reports/2026-11-04-spec-adversary-loss.md`）も推奨で決定して織り込んだ（鍵から時刻を外す・旅ごとの上限・同時の要求を 1 つにまとめる・達成できる楽しみの絞り込み・アラート ON の衝突・画面の失敗状態・前の日の扱い・replay の下限・金額の丸め）。

- R1 入口（barrel の契約）: drive は `lossHref(collision: CollisionReport): string` を呼んで移る。`CollisionReport` は `{ tripId, day, leg, at, speedKmh, light, side, alertEnabled, achievedStops, simMs }`（推奨で決定）
  - `day` は 1 始まりの日、`leg` はその日の移動（`DayPlan.legs`）の添字（0 始まり）、`at` は衝突の時刻（ISO 8601、+09:00）、`speedKmh` は衝突時の速さ（0〜199 の整数に丸める）、`light` は `@antler/zones` の `LightPeriod`、`side` は鹿が出た側 `L` / `R`、`alertEnabled` はその走行のアラート ON / OFF、`achievedStops` はその日に済ませた楽しみの id（A-4 を終えたもの）、`simMs` はシミュレーションの経過（ms。巻き戻し用）
  - 衝突の情報は URL のクエリに持つ（再読み込み・別タブで同じ画面になる。store や location state は使わない）
  - URL が読めない（欠け・範囲外・形の違い）→ 画面は「衝突の情報が読めません」と `/plan` への導線だけを出し、api を呼ばない
  - 範囲: `speedKmh` 0〜199 の整数、`simMs` 0〜86,400,000 の整数、`achievedStops` 10 件まで。しおりを読んだあと、R7 と同じ規則（日・移動・暦日・達成できる楽しみ）に外れたら、同じく「読めません」
  - URL の値（速さ・光・側）はその人のシミュレーションの事実として、事実の 1 文にだけ使う（api には送らない）
- R2 しおりの取り消し線（A6-1、LossCard）: 保存したしおり（`plan.days`）を全日並べ、衝突した日の該当位置に ✕ の行を挿入する
  - 衝突より前の日は**予定どおり済んだとみなす**（A-2 の `?day=n` で途中の日から走れるので、走ったかどうかは見ない。推奨で決定）
  - 衝突より前の日: 達成（✓）。衝突した日: `achievedStops` の楽しみは ✓、その後に ✕「D{day} {時刻} {from} → {to} で衝突」（`alert-danger`）、残りの楽しみと宿は取り消し線。衝突より後の日: すべて取り消し線
  - しおりのタイトル（`details.titles[lang]`）にも取り消し線。カードは −1.5° 回転、`ground`（trip）の紙の面
  - 取り消し線は `<s>` で書き、読み上げ用に「取り消し」の補足を付ける。✓ / ✕ はインライン SVG（stroke）
- R3 喪失 4 指標（A6-2）: 端末の純粋関数 `assessLoss(plan, collision, baseline)` で決定的に計算する。統計の値は `STATS`（`@antler/trip`）から、単価は loss の設定ファイルから読む。コードに数字を埋めない
  - 車両の損害: 基準値 `STATS.vehicleInsurance.averageJPY`（1 件の平均）、併記 `maxJPY`。免責・NOC は `STATS.deductible` がプレースホルダのあいだ「レンタカー会社の規定による（準備中）」と書く
  - キャンセル・払い戻しなし: 失った宿の泊数（衝突した日以降で `stay` が null でない日の数）と失った楽しみの数を数え、`(泊数 × 宿の 1 人 1 泊の単価 ＋ 楽しみの数 × 体験の 1 人の単価) × 人数` を千円単位で切り捨て。単価は `features/loss/data/loss-baseline.json`（`verified:false`）で、画面に「概算」と書く（単価の出典が無いため。推奨で決定、Deferred）。金額は plan-trip の `formatBudget`（固定レートの USD 併記）で出す
  - 失った日数: 衝突した日から最終日まで（`N − day + 1`）。補足に「D{day}〜D{N}」
  - 楽しみの達成: しおりに入った楽しみの数 N のうち、達成した数 n（衝突より前の日の楽しみ ＋ `achievedStops`）。重さの合計も「重さ {達成} / {全体}」で出す。しおりに入らなかった楽しみ（skipped）は N に入れない
  - 金額・件数は `num-*`（IBM Plex Mono）、金額の色は `clay`（`alert-danger` は使わない）
- R4 統計カード（A6-3）: `STATS.deerAccidents`（年・件数・前年・釧路方面）と `STATS.vehicleInsurance`（期間・件数・支払額・平均）を出し、出典名（`source.name`）を必ず書く。`verified:false` の出典には「出典の再照合中」と添える。stats.json に無い数字（停止距離など、アートボードにあるもの）は出さない
- R5 喪失文（付録 A #1）: `POST /api/trips/:id/losses` を画面の表示と同時に呼ぶ。api は保存したしおりと衝突の記述子から材料を作り、Claude に「失ったもの」の文（`story`、1〜3 文）を 4 言語で書かせ、保存して返す
  - Claude に渡すのは、マスターの名前（4 言語）と選択肢由来の値だけ: 主の言語、人数、衝突した日と全日数、衝突した移動の from / to の地名、達成した楽しみ・失った楽しみ・失った宿の町の名前、失った日数、アラートの ON / OFF。自由入力の文字列・統計の数字・金額・道路番号は渡さない
  - 出力の検証は plan-trip の `validateTripWriting` と同じ規則（4 言語がそろい空でない、400 字以下、絵文字なし、3 桁以上の数・「%」・「件」・「円」を含まない、言語ごとの文字種）。外れたら 1 回だけ作り直し、それでも外れたら失敗
  - 書き方（プロンプトの部品「鹿事故の注意喚起の書き方」を流用し、喪失の部品を足す）: 失った楽しみと場所を具体的に挙げる。けが・流血・死を書かない。運転した人を責めない。アラートが衝突を必ず防げたとは書かない（OFF の衝突なら「次は ON で」のような行動の一言はよい。ON のまま衝突したときは「アラートを ON に」と書かせず、速度・ブレーキの一言にする）
  - 文の取得は再試行しない（TanStack Query の `retry: false`。1 回の 502 が裏で何度も Claude を呼ばないように）。「もう一度」は人が押す。429（DAILY_LIMIT・LOSS_LIMIT）は「本日の上限に達しました」とだけ出し、ボタンを出さない
  - しおり（GET day）の読み込みは brief-map と同じ: 読込中は 4 指標の枠を出さずに「しおりを読み込んでいます」、404 →「旅が見つかりません」と `/plan`、409 →「この旅は古い形式です」と `/plan`、5xx・通信 →「もう一度」（自動の再試行は 1 回）
  - モデルは `claude-sonnet-5-5`、決まった形の JSON、出力の上限 1,500 トークン、時間切れ 30 秒（目標 15 秒）
  - Claude が失敗（502）・混雑（503）・上限（429）→ 画面は 4 指標・しおり・統計カードを出したまま、文の欄だけ「文を用意できませんでした」と「もう一度」。代わりの文は作らない（plan-trip の R5 を、喪失の画面では文の欄だけの失敗に読み替える。推奨で決定）
  - 文の欄の上に、衝突の事実の 1 文を端末の定型文で出す（Claude に書かせない）: 「{光の時間帯}、{左/右}から出てきた鹿と、時速 {speed} km で衝突しました。」＋アラート OFF なら「鹿アラートは OFF でした。」＋「車はもう走れません。」
- R6 同じ衝突の再要求（冪等）: 文の材料を決める記述子（`tripId`・`day`・`leg`・`alertEnabled`・並べ替えた `achievedStops`）の正規化 JSON のハッシュを鍵に、保存した文を返す（200）。初回は 201。冪等キーのヘッダは要らない（推奨で決定。内容そのものが鍵）
  - `at` は鍵に入れない（文の材料に入らないので、秒を変えるだけで Claude を呼ばせられないように。spec-adversary 1、推奨で決定）。保存する記述子の `at` は最初の要求のもの
  - 保存は成功したときだけ。失敗は何も残さないので、再要求は Claude を呼び直す
  - 同じ鍵の要求が同時に来たら、プロセスの中で 1 つにまとめる（2 本目は 1 本目の結果を待って同じ応答を受ける。single-flight。1 プロセス前提は同時の枠と同じ）。別のプロセスと保存が衝突したときは、負けた側が保存済みの文を返す（200）
  - 1 つの旅に保存できる喪失は 20 件まで。超えたら Claude を呼ばずに 429 `LOSS_LIMIT`（保存済みの鍵は返せる）
- R7 入力の検証（api）: パスの `id` は英数 4〜16 文字（無い・形が違うは同じ 404）。body は strict（知らない欄は 400）: `day` 1〜その旅の日数、`leg` 0〜その日の移動の数 − 1（移動の無い日は衝突できないので 400）、`at` はタイムゾーン付きの ISO 8601 で、JST の暦日がその日の日付と同じ、`alertEnabled` boolean、`achievedStops` はその日の楽しみの部分集合（重複なし）で、拠点（`base`）がその日の `legs[0..leg]` の出発地のどれかに当たるもの（衝突した移動より先の町の楽しみは達成できない。spec-adversary 3、推奨で決定）
  - `at` は暦日だけを確かめ、移動の時刻（departAt〜arriveAt）とは照合しない（運転の速さ・止まった時間でずれるため。推奨で決定）
- R8 濫用の抑え: `POST /api/trips/:id/losses` は IP あたり 1 分 10 件。Claude の 1 日の上限（`CLAUDE_DAILY_CALL_LIMIT`）と同時呼び出しの枠（`CLAUDE_MAX_CONCURRENT_CALLS`）は plan-trip と**同じ数え上げ・同じ枠**を使う（別に数えると上限が 2 倍になる）。保存済みの文を返すときは数えない
- R9 A6-4 の導線: 主ボタン（1 つだけ大きく、`spruce`）「鹿アラートを ON にして、同じ道をやり直す」→ `/trip/:id/brief?day={day}`（alert のクエリ無し ＝ ON。brief-map の R6）。同じ旅 ＝ 同じ seed なので同じ条件で再生される。アラート ON のまま衝突したときは文言を「同じ道を、もう一度走る」にする（行き先は同じ。推奨で決定）。副: 「衝突の 3 秒前を見る」→ `/drive?trip={id}&day={day}(&alert=off)&replay={max(0, simMs − 3000)}`（巻き戻しは drive の機能。Deferred）、「別の旅をつくる」→ `/plan`
- R10 言語: 画面の文言は `plan.lang`（4 言語）。文言の表は 4 言語の欠けを `text.test.ts` で落とす。画面は音を出さない

## API エンドポイント

### POST /api/trips/:id/losses

- **認証**: 不要（旅の ID を知る人が書ける。threat.md）
- **リクエスト**（strict）: `{ day, leg, at, alertEnabled, achievedStops }`
- **レスポンス 201（新規）/ 200（保存済み）**: `{ loss: { tripId, story: { ja, en, zh, ko }, createdAt } }`

## ユースケース

### UC-1: 入口と URL（R1）

- **Examples**: `lossHref` → `/loss/AbCd1234?day=2&leg=1&at=…&speed=54&light=dusk&side=L&alert=off&stops=red-crowned-crane&t=812345` / 同じ URL を読み直すと同じ CollisionReport / speed が 250・day が 0・light が知らない値 → 読めない

### UC-2: 取り消し線（R2）

- **Examples**: ペルソナの 5 日・D2 の 2 本目の移動で衝突・タンチョウ達成 → D1 ✓、D2 タンチョウ ✓、✕ 行、D2 の宿・D3〜D5 は取り消し線、タイトルにも取り消し線 / D1 の最初の移動で衝突 → ✓ は無く、✕ が先頭

### UC-3: 喪失 4 指標（R3）

- **Examples**: 4 人・5 日（宿は D1〜D4）・楽しみ 3 件・D2 で衝突・1 件達成 → 失った日数 4、達成 1 / 3、重さも、宿 3 泊（D2〜D4）× 4 人と楽しみ 2 件 × 4 人の概算、車両は STATS の平均と最大 / 最終日に衝突 → 失った日数 1、宿 0 泊

### UC-4: 統計カード（R4）

- **Examples**: STATS の件数・平均・出典名が画面に出る / `verified:false` の出典に「再照合中」

### UC-5: 喪失文（R5・R6）

- **Examples**: 初回 → 201、story 4 言語 / 同じ記述子の 2 回目 → 200、Claude を呼ばない / ko が空 → 作り直し → 2 回目も空なら 502・保存しない / 「6,705 件」を含む → 外れ / Claude に渡す材料に道路番号・自由入力・統計の数字が無い

### UC-6: 入力の検証（R7）

- **Examples**: 無い旅 → 404 / day 6（5 日の旅）→ 400 / 移動 2 本の日に leg 2 → 400 / at の暦日が別の日 → 400 / その日に無い楽しみの id → 400 / 知らない欄 → 400

## エラーパターン

| 条件                                     | ステータス | レスポンス                           |
| ---------------------------------------- | ---------- | ------------------------------------ |
| 旅が無い・id の形が違う                  | 404        | `{error:{code:"TRIP_NOT_FOUND"}}`    |
| 入力の形・範囲が違う・知らない欄         | 400        | `{error:{code:"INVALID_INPUT"}}`     |
| 保存したしおりをいまのマスターで作れない | 409        | `{error:{code:"ITINERARY_CHANGED"}}` |
| IP あたりの上限                          | 429        | `{error:{code:"RATE_LIMITED"}}`      |
| 全体の 1 日の上限（Claude の呼び出し）   | 429        | `{error:{code:"DAILY_LIMIT"}}`       |
| 1 つの旅の喪失が 20 件に達した           | 429        | `{error:{code:"LOSS_LIMIT"}}`        |
| 同時の Claude の呼び出しが上限           | 503        | `{error:{code:"WRITER_BUSY"}}`       |
| Claude の失敗・時間切れ・検証で落ちた    | 502        | `{error:{code:"WRITER_FAILED"}}`     |

### 例外 → ステータスコードマッピング

| UseCase/Domain 例外     | HTTP ステータス |
| ----------------------- | --------------- |
| `TripNotFoundError`     | 404             |
| `TripInputError`        | 400             |
| `ItineraryChangedError` | 409             |
| `DailyLimitError`       | 429             |
| `LossLimitError`        | 429             |
| `TripWriterBusyError`   | 503             |
| `LossWriterError`       | 502             |

## ビジネスルール

R1〜R10 のとおり。4 指標・取り消し線（R2・R3）は sim の純粋関数、喪失文の材料と検証（R5）は api の domain の純粋関数。

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（事実確認）/ 期日=2026-11-08（Day 6）/ 暫定挙動=`loss-baseline.json` の宿 1 人 1 泊・体験 1 人の単価を `verified:false` で使い、画面に「概算」と書く（税込かどうかも出典と一緒に決める）] キャンセル額の単価の出典
- [Deferred: 担当=record / 期日=2026-11-06（Day 4）/ 暫定挙動=旅を消しても `trip_losses` の行は残る（読む API が無いので外には出ない）] 旅の削除と一緒に喪失文を消す（cascade）。A-7 に喪失文を出すかも record が決める（ID を知る人が作れる文なので、出すなら threat.md の扱いを引き継ぐ）
- [Deferred: 担当=drive-link / 期日=2026-11-07（Day 5）/ 暫定挙動=`/drive?trip&day(&alert=off)&replay=` を開く。drive が `replay` を読むまでは、その日の最初から走る] 「衝突の 3 秒前を見る」の巻き戻し再生
- [Deferred: 担当=ユーザー / 期日=2026-11-06 / 暫定挙動=消さない（plan-trip の TripPlan と同じ）] 喪失文の保持期間

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: 保存したペルソナの旅に `POST /api/trips/:id/losses`（Claude はフェイク）→ 201、story は 4 言語。同じ body の 2 回目は 200 で同じ story、Claude は 1 回だけ
- [x] AC-2: `/loss/:id?…` を開くと（api はフェイクの fetch）、しおりに ✕ と取り消し線、4 指標（STATS の平均・達成 n/N・失った日数・概算）、統計カードの出典、Claude の文が出て、主ボタンが `/trip/:id/brief?day=n` を指す

UC-1 入口:

- [x] UC-1a: `lossHref` の URL を `parseCollision` で読むと同じ CollisionReport に戻る（alert ON は alert のクエリ無し、stops は空でもよい）
- [x] UC-1b: 欠け・範囲外・知らない値の URL は読めない（null）。画面は「読めません」と `/plan` への導線だけで、fetch しない

UC-2 取り消し線:

- [x] UC-2a: D2 の移動で衝突・タンチョウ達成 → D1 は achieved、D2 のタンチョウは achieved、✕ の行は D2 のタンチョウの後、D2 の宿と D3 以降は lost
- [x] UC-2b: D1 の最初の移動で衝突・達成なし → ✕ が先頭、残りはすべて lost
- [x] UC-2c: LossCard はタイトルに `<s>`、✕ の行に「衝突」の文と時刻、lost の行に読み上げ用の「取り消し」がある

UC-3 4 指標:

- [x] UC-3a: 失った日数は `N − day + 1`、達成 n / N と重さの合計（skipped は N に入れない）
- [x] UC-3b: キャンセルは `(泊数 × 宿単価 ＋ 楽しみ数 × 体験単価) × 人数`。泊数は衝突した日以降で stay のある日
- [x] UC-3c: 車両の損害は STATS の平均と最大、免責・NOC はプレースホルダの文言
- [x] UC-3d: 最終日に衝突 → 失った日数 1、宿 0 泊

UC-4 統計カード:

- [x] UC-4a: 統計カードは STATS の件数（年・全体・前年・釧路方面）と保険の平均を出し、出典名をすべて書く。`verified:false` には再照合中の注記

UC-5 喪失文:

- [x] UC-5a: 材料は名前と選択肢由来の値だけ（道路番号・統計の数字・自由入力が無い）。失った楽しみ・宿の町・達成した楽しみが正しく分かれる
- [x] UC-5b: 検証は 4 言語・空・400 字・絵文字・3 桁以上の数・%・件・円・文字種で外れる
- [x] UC-5c: 1 回目が外れたら作り直し、2 回目が通れば保存して返す。2 回とも外れたら LossWriterError、保存しない
- [x] UC-5d: 画面は文を待つあいだも 4 指標を出し、文の失敗では文の欄だけ「用意できませんでした」と「もう一度」（自動の再試行なし）。429 は「本日の上限」だけでボタンなし
- [x] UC-5e: [ADDED spec-adversary] アラート ON の衝突 → 材料は alertEnabled:true、主ボタンは「同じ道を、もう一度走る」、事実の 1 文に「OFF でした」が無い
- [x] UC-5f: [ADDED spec-adversary] 同じ鍵の同時の 2 要求 → Claude は 1 回、両方に同じ文
- [x] UC-5g: [ADDED spec-adversary] 1 つの旅に 20 件保存したあと、新しい鍵 → 429 LOSS_LIMIT、Claude を呼ばない。保存済みの鍵は 200
- [x] UC-2d: [ADDED spec-adversary] しおりの読み込み中・404・5xx の画面（brief-map と同じ）

UC-6 入力の検証:

- [x] UC-6a: 無い旅・形の違う id → 404（区別しない）
- [x] UC-6b: day が範囲外・leg が範囲外・at の暦日が違う・その日に無い楽しみ・重複・衝突した移動より先の町の楽しみ → 400、Claude を呼ばない
- [x] UC-6c: 知らない欄・読めない JSON → 400

UC-7 文言と導線:

- [x] UC-7a: 画面の文言の表は 4 言語とも全項目が空でない
- [x] UC-7b: 主ボタンは `/trip/:id/brief?day=n`（alert のクエリ無し）、副は `/drive?…&replay=`（alert OFF の衝突なら alert=off、simMs が 3000 未満なら replay=0）と `/plan`

## Rule → ドメイン語彙対応

| Rule           | 語彙                                                      | 置き場所                                          | 証明   |
| -------------- | --------------------------------------------------------- | ------------------------------------------------- | ------ |
| R1: 入口       | `CollisionReport` / `lossHref` / `parseCollision`         | apps/sim/src/features/loss/utils/collision-url.ts | UC-1   |
| R2: 取り消し線 | `strikeItinerary`                                         | apps/sim/src/features/loss/domain/strike.ts       | UC-2   |
| R3: 4 指標     | `assessLoss`                                              | apps/sim/src/features/loss/domain/assess-loss.ts  | UC-3   |
| R5: 喪失文     | `toLossBrief` / `validateLossStory` / `LossWriterGateway` | apps/api/src/domain/losses/policies/              | UC-5   |
| R6: 冪等       | `lossKeyMaterial` / `WriteLossUseCase`                    | apps/api/src/application/usecases/losses/         | IDEM-* |
| R7: 入力の検証 | `checkCollision`                                          | apps/api/src/domain/losses/policies/              | UC-6   |
| R8: 濫用の抑え | `WriteLossUseCase`（共有の枠と数え上げ）                  | apps/api/src/application/usecases/losses/         | FAIL-* |

## 受け入れ基準

- [x] 受け入れテスト AC-1・AC-2 が Green
- [x] 全 UC / 全エラーパターンのテストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型 / 依存方向）
- [x] レビュー（code-reviewer・layer-guard・component-guard・accessibility-checker・security-auditor）の Critical 0
