---
feature: plan-trip
target_paths:
  - packages/trip/
  - packages/schema/src/trip-details.ts
  - apps/api/src/
  - apps/sim/src/features/plan-trip/
spec_confirmed_at: ed3a46f
tier: 2
---

# 仕様: plan-trip（A-1 旅をつくる・Claude がしおりを仕上げる）

## 概要

A-1 の画面で、人数・日程・出発地・楽しみを選ぶと、その場で「旅のしおり」と「この旅が失われるリスク」が組み上がる（端末の中で決定的に計算）。
「この旅を守りに行く」で `POST /api/trips` を呼ぶと、api が同じ計算をやり直し、Claude にタイトルと各日の 1 行説明を 4 言語で書かせて、TripPlan と一緒に保存する。

要件: ch3 A1-1〜A1-6、ch7 TripPlan と `POST /api/trips`、ch6（レート制限 10/分/IP、記録 URL は推測困難な 8 文字、削除リンク）、付録 A #1（Claude が生成・4 言語・Skills で知識を分ける）、#4（ペルソナ）、#9（登録なし・4 言語が欠けない）。
画面: UI キャンバス v2 の A1_Plan（`/plan`）。読み取り結果は `docs/reports/2026-11-03-design-a1-plan.md`。

**Tier 2 の理由**: 外部副作用（Claude API の呼び出し。費用と遅延）、永続化（TripPlan と TripDetails を保存し、後の feature が読む）、並行性（「決める」の二重押し・再送）。

**範囲外**: `GET /api/trips/{id}/day/{n}`・地図（brief-map。`/trip/:id/brief` の仮の画面は brief-map が本物の A-2 に置き換えた。2026-11-03）、`/t/{id}` と削除の画面・API（record）、出来事の文（stop-events）、喪失文（loss）、写真の実物（Day 6）。

## Example Map

Story: 台湾から初めて北海道をレンタカーで旅する 4 人のグループの代表として、人数・日程・出発地・楽しみを選ぶと、その場でしおりとリスクが見え、決めたしおりが Claude の文で仕上がって残る。

Questions は 2026-11-03 のラウンドで 18 問すべて推奨で決定（ユーザー回答「全部推奨で」）。決定は各 Rule に織り込んだ。

- R1 入力（A1-1）: 人数 1〜8、運転できる人 1〜人数、経験 3 択（はじめて / 1〜2 回 / 慣れている）、出発・返却の日時と場所（新千歳 / 釧路空港 / 札幌駅 / 旭川空港 / 函館空港）、予算 1 人 0〜1,000,000 円
  - 日時は日本時間として受ける（画面に「日本時間」と書く）。api はタイムゾーン付きの ISO 8601 を受け、`toJst` で直してから暦日を数える
  - 旅の日数（JST の暦日、両端を含む）は 1〜10 日。出発と返却が同時刻か逆順 → 入力エラー。過去の日付は通す（シミュレーションのため）
  - 楽しみを入れなくても、受け取り 1 時間・返却 1 時間を除いた時間で返却地へ着けない旅 → 入力エラー（2026-11-03、code-reviewer の指摘を推奨で決定。着けない移動を含むしおりを保存しない）
  - 読めない日時は例外にせず入力エラー（api は 500 でなく 400）
  - 初期値はペルソナ（#4）: 4 人・運転 2 人・はじめて・2027-02-14 10:00 新千歳 → 2027-02-18 17:00 新千歳・12 万円・道東・流氷ウォーク重さ 5・タンチョウ重さ 4
  - 予算はしおりの組み立てに使わない。保存し、Claude に参考として渡すだけ
- R2 楽しみ（A1-2・A1-3）: エリアタブ 道東 / 道央、各 12 件以上のマスター（JSON、4 言語の名称と補足、拠点の地点、所要の目安、夜・早朝の印）。写真は当面 `photo-placeholder`
  - 選択はエリアごとに保持し、しおりは表示中のエリアの選択で作る。カウンター「選択 n / 10」はそのエリアの数。10 件選択済みで 11 件目は選べない
  - api は、エリアのマスターに無い id（形は正しい slug。もう一方のエリアの id、存在しない id）を 400 で拒否する
- R3 しおりの組み立て（A1-4）: 入力が変わるたびに端末で作り直す（決定的。Claude は呼ばない）。api も同じ関数で作り直し、端末の値を信じない
  - `days` は 1〜N の連番（N は暦日数）。D1 は出発地から、最終日は返却地へ。出発地と返却地は違ってよい
  - 1 日の活動の枠は 8:00〜18:00（D1 は出発の 1 時間後から、最終日は返却の 1 時間前まで）。重さ w の楽しみは w × 1.6 時間（重さ 5 ＝ 8 時間 ＝ 丸 1 日）
  - 移動時間は地点間の直線距離 × 1.3 ÷ 時速 50 km（目安）。拠点はエリアごとの固定の周回順で回る
  - 入りきらないときは、重さの小さい楽しみから外し（同じ重さなら周回順で後ろのもの）、「入りきらない」として表示し保存する。黙って落とさない
  - `stops` はその日の楽しみの id、`from`・`to`・`stay` は地点の slug。最終日の `stay` は null
  - 楽しみ 0 件 → 移動だけのしおり（決まった形のタイトル）
- R4 リスクスコア（A1-5）: 0〜1 を決定的に計算。根拠文を最大 3 行（4 言語）
  - 式（重みは目安。画面に「重みは目安です」と注記）: 0.20 × エリア（道東 1.0・道央 0.5）＋ 0.10 × 月の係数（zones の月別係数の、旅の日の最大。写しは `packages/trip/data/risk-factors.json`、正は zones.source.json）＋ 0.20 × 日没の早さ（旅の日のうち最も早い日没がエリアの最初の拠点で 16:30 以前なら 1、19:00 以降なら 0、その間は直線）＋ 0.20 × 暗い時間の移動の割合（移動を 15 分ごとに見て、太陽の高さが +6° 未満の時間 ÷ 全移動時間）＋ 0.20 × 経験（はじめて 1.0・1〜2 回 0.6・慣れている 0.3）＋ 0.10 × 夜・早朝の楽しみ（しおりに入ったものにあれば 1）
  - 日没の早さを独立の要素にした（A1-5 が「日没時刻」と「夜間移動」を別に挙げているため。2026-11-03、推奨で決定）
  - 区分: 0.6 以上「高い」、0.4 以上「注意」、それ未満「低め」。デザインどおり語と帯で見せる
  - 根拠文は寄与の大きい順に 3 つ。統計の数字は stats.json（`packages/trip` に移す）と zones の係数から読む
  - 端末と api の値は、小数 2 桁に丸めて一致すれば同じとみなす
- R5 決定と Claude の文（#1）: 「この旅を守りに行く →」で `POST /api/trips`。api が R3・R4 を作り直し、Claude にタイトルと各日の 1 行説明を 4 言語で書かせ、TripPlan と TripDetails を保存して返す
  - Claude に渡すのは選択肢由来の値だけ（自由入力の文字列は無い）
  - 出力の検証: 4 言語がそろい空でない、日ごとの説明の数が日数と同じ、タイトル 200 字以下、絵文字なし、3 桁以上の数・「%」・「件」・「円」を含まない（統計を書かせない）。外れたら 1 回だけ再試行し、それでも外れたら失敗
  - モデルは `claude-sonnet-5-5`、決まった形の JSON で返させる。出力の上限 4,000 トークン、時間切れ 30 秒（目標 20 秒）
  - Claude が失敗 → 保存せずにエラー（502）。画面は入力を残したまま「もう一度」。代わりの文は作らない
  - api につながらない（応答が無い）→ 画面は「サーバーにつながりませんでした」と出し、Claude の失敗とは文言を分ける。「もう一度」は同じ（2026-11-03 ユーザーの報告。api を起動していないときに原因が分からなかった）
  - プロンプトは 2 つの部品（「道東・道央の観光知識」「鹿事故の注意喚起の書き方」）をファイルで持つ
  - 保存したしおりは Claude を呼び直さずに読める
- R6 言語と通貨（A1-6）: ja / en / zh（繁体字）/ ko を切り替え。初期言語はブラウザの言語（zh-TW・zh-HK・zh-Hant → zh、それ以外 → ja、en・ko はそのまま）。予算は ¥ と概算 USD（固定レート、出典と日付を設定に持つ。10 ドル単位に丸める）
- R7 ID・シード・所有者: id は暗号論的乱数の英数 8 文字（衝突したら作り直す）、seed は 0〜2³²−1。作成時に所有者トークンを返し、api はハッシュだけを保存する（削除は record の feature）
- R8 二重押し: 端末は「決める」を押すごとに冪等キーを作る。同じキーの 2 回目は作り終えた旅を返す。処理中なら 409。端末があきらめたあとに生成が終わった旅も保存し、同じキーの再試行で返す
- R9 濫用の抑え: `POST /api/trips` は IP あたり 1 分 10 件（ch6）と、全体の 1 日の上限。超えたら 429 と「本日の生成上限に達しました」。プロキシの IP ヘッダは設定したときだけ信じる（`TRUST_PROXY`）。`ANTHROPIC_API_KEY` と `OWNER_TOKEN_SECRET` は必須（無ければ起動しない）
  - 1 日の上限は **Claude の呼び出しの数**で数える（`CLAUDE_DAILY_CALL_LIMIT`、既定 400 回 ≒ 旅 200 件）。作り直し・時間切れ・検証の外れも数える。保存した旅の数で数えると、失敗させ続ける濫用を止められないため（security-auditor W1、推奨で決定）
  - SDK の通信の再試行（1 回）は数に入らないので、実際の HTTP の呼び出しは最大で上限の 2 倍になる
  - 同時に走る Claude の呼び出しは `CLAUDE_MAX_CONCURRENT_CALLS`（既定 4）まで。超えたら 503 `WRITER_BUSY`
  - `Idempotency-Key` は UUID v4 だけを受ける。IPv6 は /64 で 1 つの枠にする
- R10 TripPlan は作成後に変えない。`alertEnabled` は作成時の初期値（true）。A-6・A-7 の ON / OFF は走行の記録の側に持つ

## API エンドポイント

### POST /api/trips

- **認証**: 不要（#9 登録なし）。詳細は threat.md
- **ヘッダ**: `Idempotency-Key`（必須。UUID）
- **リクエスト**（strict。これ以外の欄は 400）: `lang`、`party{size, drivers, experience}`、`depart{at, place}`、`return{at, place}`、`budgetPerPersonJPY`、`area`、`pleasures[{id, weight}]`
- **レスポンス 201**: `{ plan: TripPlan, details: TripDetails, ownerToken: string }`
  - `TripDetails`（`@antler/schema` に追加）: `tripId`、`titles{ja,en,zh,ko}`、`dayNotes[{day, note{ja,en,zh,ko}}]`、`skipped[slug]`、`createdAt`
  - `plan.title` は `titles[plan.lang]`

## ユースケース

### UC-1: 入力の検証（R1）

- **Given**: A-1 の入力
- **When**: 値を変える / `POST /api/trips`
- **Then**: 範囲外は入力エラー（画面）・400（api）。しおりは前の値のまま
- **Examples**: 運転 5 人・人数 4 → エラー / 返却が出発より前 → エラー / 10 日は通り 11 日はエラー / 予算 0 は通り 1,000,001 はエラー / `2027-02-14T23:30+08:00` 出発 → JST では 2/15 なので D1 は 2/15

### UC-2: 楽しみの選択（R2）

- **Examples**: 10 件選択済みで 11 件目 → 選べない / 選択を外す → 重さも消える / 道東で 3 件選んで道央に切り替え → カウンター 0、戻ると 3 件 / api に道央の id を道東として送る → 400

### UC-3: しおりの組み立て（R3）

- **Examples**: ペルソナ（5 日、流氷 5・タンチョウ 4）→ D1〜D5、流氷は丸 1 日 / 楽しみ 0 件 → 移動だけ / 10 件すべて重さ 5 で 3 日 → 入りきらない楽しみが出る / 函館空港発で道東 → D1 は移動だけ / 1 日の旅 → D1 が往路と復路を兼ねる / 同じ入力 → 同じ days

### UC-4: リスクスコア（R4）

- **Examples**: ペルソナ → 「高い」（0.6 以上）/ 7 月・道央・慣れている・夜の楽しみなし → 「低め」（0.4 未満）/ 根拠文は 3 行以下で 4 言語 / 統計の数字は stats.json の値

### UC-5: 決定と Claude の文（R5）

- **Examples**: 正常 → 201、titles 4 言語、dayNotes の数 = days の数 / ko だけ空 → 再試行 → 2 回目も空なら 502・保存しない / 「6,705 件」を含む → 失敗扱い / 説明が 1 日ぶん足りない → 失敗扱い

### UC-6: 言語と通貨（R6）

- **Examples**: ブラウザ zh-TW → 繁体字 / ブラウザ fr → ja / 12 万円 → 「¥120,000（約 $800）」（レートは設定の値）

### UC-7: ID とシード（R7）

- **Examples**: id は英数 8 文字 / 衝突を起こすと別の id で作り直す / seed は 0〜2³²−1 / ownerToken はレスポンスにだけあり、保存されるのはハッシュ

## エラーパターン

| 条件                                   | ステータス | レスポンス                                  |
| -------------------------------------- | ---------- | ------------------------------------------- |
| 入力の形・範囲が違う・知らない欄       | 400        | `{error:{code:"INVALID_INPUT", message}}`   |
| `Idempotency-Key` が無い・形が違う     | 400        | `{error:{code:"IDEMPOTENCY_KEY_REQUIRED"}}` |
| 同じキーで処理中                       | 409        | `{error:{code:"IN_PROGRESS"}}`              |
| 同じキーで body が違う                 | 409        | `{error:{code:"IDEMPOTENCY_MISMATCH"}}`     |
| IP あたりの上限                        | 429        | `{error:{code:"RATE_LIMITED"}}`             |
| 全体の 1 日の上限（Claude の呼び出し） | 429        | `{error:{code:"DAILY_LIMIT"}}`              |
| 同時の Claude の呼び出しが上限         | 503        | `{error:{code:"WRITER_BUSY"}}`              |
| Claude の失敗・時間切れ・検証で落ちた  | 502        | `{error:{code:"WRITER_FAILED"}}`            |

### 例外 → ステータスコードマッピング

| UseCase/Domain 例外   | HTTP ステータス |
| --------------------- | --------------- |
| `TripInputError`      | 400             |
| `TripInProgressError` | 409             |
| `DailyLimitError`     | 429             |
| `TripWriterError`     | 502             |

## ビジネスルール

R1〜R10 のとおり。しおりの組み立て（R3）とリスク（R4）は `packages/trip` の純粋関数で、sim と api が同じものを使う。

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（事実確認）/ 期日=2026-11-06（Day 4）/ 暫定挙動=Claude が下書きしたマスターをそのまま使い、確認状態 `verified:false` を持たせる] 楽しみのマスター 24 件の季節・所要・拠点が正しいか
- [Deferred: 担当=ユーザー / 期日=2026-11-06 / 暫定挙動=消さない] TripPlan と TripDetails の保持期間（Capture の保持期間と一緒に決める）
- [Deferred: 担当=Claude / 期日=2026-11-08（Day 6）/ 暫定挙動=設定の固定レートに `verified:false` を付け、画面は「概算」と書く] USD の換算レートの出典と日付

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: ペルソナの入力で `POST /api/trips`（Claude はフェイク）→ 201。plan は TripPlanSchema を通り、days は 5 日、riskScore は端末の計算と小数 2 桁で一致、details の 4 言語がそろう。保存した旅を repository から読める
- [x] AC-2: A-1 の画面をペルソナの初期値で開くと、右パネルに D1〜D5 と「高い」が出て、楽しみを 1 つ外すとその場でしおりが変わる。「この旅を守りに行く」で api を呼び、成功で `/trip/:id/brief` に移る

UC-1 入力:

- [x] UC-1a: 運転できる人が人数より多い・返却が出発以前・11 日 → エラー。10 日は通る
- [x] UC-1b: 予算 0 は通り、1,000,001 はエラー
- [x] UC-1c: `+08:00` の出発は JST に直して暦日を数える（23:30+08:00 → 翌日）
- [x] UC-1d: api は知らない欄（id・seed・title・days・riskScore）を含む body を 400 で拒否する
- [x] UC-1e: [ADDED code-reviewer] 移動だけでも返却の 1 時間前に着けない旅（新千歳 10:00 出発・釧路空港 11:30 返却）は入力エラー
- [x] UC-1f: [ADDED code-reviewer] 読めない日時は例外にせず入力エラー

UC-2 楽しみ:

- [x] UC-2a: マスターは道東・道央とも 12 件以上で、4 言語の名称と補足がそろい、id が重複しない
- [x] UC-2b: 10 件選択済みで 11 件目は選べない。外すと重さも消える
- [x] UC-2c: 選択はエリアごとに保持し、カウンターは表示中のエリアの数
- [x] UC-2d: api はエリアのマスターに無い id を 400 で拒否する

UC-3 しおり:

- [x] UC-3a: ペルソナ → D1〜D5、`day` は 1〜5 の連番、流氷ウォーク（重さ 5）は 1 日を占める
- [x] UC-3b: 楽しみ 0 件 → 移動だけの days と決まった形のタイトル
- [x] UC-3c: 入りきらない → 重さの小さいものから外れ、skipped に入る
- [x] UC-3d: 函館空港発で道東 → D1 は移動だけ。出発地と返却地が違ってもよい
- [x] UC-3e: 1 日の旅 → days は 1 件
- [x] UC-3f: 同じ入力 → 同じ days（決定的）

UC-4 リスク:

- [x] UC-4a: ペルソナ → 0.6 以上「高い」。7 月・道央・慣れている・夜の楽しみなし → 0.4 未満「低め」
- [x] UC-4b: 根拠文は 3 行以下、4 言語、統計の数字は stats.json の値と一致
- [x] UC-4c: 夜・早朝の楽しみを足すとスコアが上がる。経験が上がると下がる
- [x] UC-4d: [ADDED code-reviewer] 根拠文の「いちばん多い」は係数が最大の月（10 月）だけ。11 月は「多い時期」
- [x] UC-4e: [ADDED code-reviewer] 区分の境目は 0.6 で「高い」、0.4 で「注意」
- [x] UC-4f: [ADDED code-reviewer] 日没は太陽の高さが 0° を切る時刻（釧路 2/14 は 16:30〜17:00、札幌 7/10 は 19:00 以降）
- [x] UC-4g: [ADDED code-reviewer] 暗い時間の割合は時間で重み付け

UC-5 Claude の文:

- [x] UC-5a: 正常 → titles 4 言語、dayNotes の数 = days の数、plan.title = titles[lang]
- [x] UC-5b: 1 言語だけ空 → 再試行。2 回とも外れたら TripWriterError、保存しない
- [x] UC-5c: 3 桁以上の数・%・件・円・絵文字を含む → 外れとして扱う
- [x] UC-5d: Claude に渡す内容に自由入力の文字列が無い（入力はすべて選択肢由来）

UC-6 言語と通貨:

- [x] UC-6a: ブラウザの言語から初期言語を決める（zh-TW → zh、fr → ja）
- [x] UC-6b: 予算の USD 併記は設定のレートで 10 ドル単位

UC-7 ID:

- [x] UC-7a: id は英数 8 文字、seed は 0〜2³²−1
- [x] UC-7b: id が衝突したら作り直す
- [x] UC-7c: ownerToken はレスポンスにだけあり、保存されるのはハッシュ

認可（threat.md）:

- [x] AUTH-1: 未認証で `POST /api/trips` → 201（意図的な公開が塞がれていない）
- [x] AUTH-2: 1 日の上限に達したあと `POST /api/trips` → 429 DAILY_LIMIT、Claude を呼ばない
- [x] AUTH-3: 同じ IP から 1 分に 11 件目 → 429 RATE_LIMITED
- [x] AUTH-4: 同じ冪等キーで body を変えて送る → 409 IDEMPOTENCY_MISMATCH、最初の旅を返さない
- [x] MASS-1: body に id・seed・title・days・riskScore・alertEnabled・ownerToken を混ぜる → 400、保存しない

障害・冪等・並行（resilience.md）:

- [x] FAIL-1: Claude が時間切れ → 502 WRITER_FAILED、旅も詳細も保存しない、冪等キーは failed
- [x] FAIL-2: Claude の応答が 2 回とも検証で外れる → 502、保存しない（1 回目だけ外れたら 2 回目の結果で 201）
- [x] FAIL-3: max_tokens で切れた応答 → 外れとして扱う
- [x] FAIL-4: 保存のトランザクションが失敗 → 500、旅の行が残らない
- [x] FAIL-5: 1 日の上限（失敗した呼び出しも数える）に達したら Claude を呼ばずに 429
- [x] FAIL-6: `ANTHROPIC_API_KEY` が無いと api が起動しない（env の検証）
- [x] IDEM-1: 同じキー・同じ body で 2 回 → 2 回目は同じ旅を返し、Claude は 1 回だけ
- [x] IDEM-2: 1 回目が失敗（failed）→ 同じキーで再送すると作り直して 201
- [x] IDEM-3: pending が 2 分を過ぎた → 同じキーで作り直せる
- [x] CONC-1: 同じキーの要求が処理中に 2 つ目が来る → 409 IN_PROGRESS
- [x] CONC-2: id の衝突 → 作り直して 201
- [x] MIGR-1: 空のデータファイルから起動すると表が作られ、2 回目の起動でも壊れない

## Rule → ドメイン語彙対応

| Rule            | 語彙                                        | 置き場所                                 | 証明   |
| --------------- | ------------------------------------------- | ---------------------------------------- | ------ |
| R1: 入力        | `TripInputSchema` / `tripDayCount`          | packages/trip/src/input.ts               | UC-1   |
| R2: 楽しみ      | `PLEASURES` / `pleasuresInArea`             | packages/trip/src/pleasures.ts           | UC-2   |
| R3: しおり      | `buildItinerary`                            | packages/trip/src/itinerary.ts           | UC-3   |
| R4: リスク      | `assessRisk`                                | packages/trip/src/risk.ts                | UC-4   |
| R5: Claude の文 | `TripWriterGateway` / `validateTripWriting` | apps/api/src/domain/trips/policies/      | UC-5   |
| R6: 言語と通貨  | `initialLang` / `formatBudget`              | packages/trip/src/locale.ts              | UC-6   |
| R7: ID          | `createTripIdentity`                        | apps/api/src/domain/trips/policies/      | UC-7   |
| R8: 二重押し    | `CreateTripUseCase`                         | apps/api/src/application/usecases/trips/ | IDEM-* |
| R9: 濫用の抑え  | `DailyLimitPolicy`                          | apps/api/src/domain/trips/policies/      | FAIL-* |

## 受け入れ基準

- [x] 受け入れテスト AC-1・AC-2 が Green
- [x] 全 UC / 全エラーパターンのテストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型 / 依存方向）
- [x] alert-contract-guard Critical 0（schema に TripDetails を追加するため）
