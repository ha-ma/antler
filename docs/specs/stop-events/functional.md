---
feature: stop-events
target_paths:
  - apps/api/src/domain/stop-events/
  - apps/api/src/application/usecases/stop-events/
  - apps/api/src/application/ports/gateways/scene-writer.gateway.ts
  - apps/api/src/application/ports/repositories/stop-deck.repository.ts
  - apps/api/src/application/ports/repositories/trip-event.repository.ts
  - apps/api/src/infrastructure/gateways/claude-scene-writer.gateway.ts
  - apps/api/src/infrastructure/repositories/drizzle-stop-deck.repository.ts
  - apps/api/src/infrastructure/repositories/drizzle-trip-event.repository.ts
  - apps/api/src/infrastructure/http/routes/stop-deck.routes.ts
  - apps/api/src/infrastructure/http/routes/trip-event.routes.ts
  - apps/api/src/infrastructure/http/schemas/stop-deck.schema.ts
  - apps/api/src/infrastructure/http/schemas/trip-event.schema.ts
  - apps/sim/src/features/stop-events/
spec_confirmed_at: 527faca
tier: 2
---

# 仕様: stop-events（A-4 観光スポット・車を降りる／Claude が出来事の文を書く／イベントログ）

## 概要

運転の 1 日ぶんの「停車の出来事」（しおりの楽しみに着いたとき＋ランダムな出来事）を、api が旅程から決定的に組み立て、Claude に 4 言語の文と選択肢の言い回しを書かせて保存する（`POST /api/trips/:id/day/:n/stop-deck`）。
sim は A-4 のモーダル（写真・短文・滞在・支出・次の到着予定・選択肢 2〜3）を出し、選んだ結果を `POST /api/trips/:id/events` に残す。イベントログは選択・遭遇・衝突・回避の 4 種を受ける（record・loss・drive-link が使う形をここで決める）。

要件: ch3 A4-1〜A4-3、ch7 `POST /api/trips/{id}/events`、付録 A #1（Claude がイベント文と選択肢を書く。鹿ゾーン通過の時刻つき。4 言語同時。生成結果を保存してシードで再生）、ch5（4 言語・3 状態の色の役割）、ch6（レート制限・ログ）。
画面: UI キャンバス v2 の A4_Stop（PC）・A4_L（スマホ横）。`/drive` の上に出すモーダル。

**Tier 2 の理由**: 外部副作用（Claude API。費用と遅延）、永続化（出来事の束とイベントログの 2 表。record が読む）、認可（ownerToken を書き込みの権利に広げる）、並行性（同じ日の束の同時生成、イベントの再送）。

**範囲外**:

- 運転中に出来事を出す組み込み（観光地への到着の判定、車を止める、選んだ遅れを運転の時計に反映する）。drive-link（`apps/sim/src/features/drive/`）が、この feature の barrel を呼んで作る
- 遭遇・衝突・回避のイベントを実際に送ること（drive-link・loss が送る。この feature は形と保存と送る hook だけを作る）
- イベントログの読み出しの画面と API（record。リポジトリの `listByTrip` までを用意する）
- 保存した束を誰でも読める GET（今は所有者だけが POST で受け取る）
- 写真の実物（Day 6。当面は `photo-placeholder` に名前を載せる）
- A-6 の喪失文（loss）

## Example Map

Story: 台湾から初めての北海道を 4 人で走るドライバーとして、楽しみの地点に着いたら「いま出発するか、もう少しいるか、予定を変えるか」を、それぞれ鹿ゾーンをいつ通るかと失うものを見比べて選びたい。選んだことは旅の記録に残る。

Questions は 2026-11-04 に推奨で決定（CLAUDE.md の方針「推奨案のある判断は推奨案で決めて進める」）。決めたことは各 Rule に「推奨で決定」と書いた。spec-adversary の指摘 15 件と決定は `docs/reports/2026-11-04-spec-adversary-stop-events.md`。

- R1 事実と文の分担（付録 A #1、A4-2）: 時刻・鹿ゾーンの通過・失う金額と重さ・滞在・支出は api が決定的に計算する。Claude は見出し・短文・選択肢の言い回し・結果の一言だけを書く（推奨で決定。数字を Claude に書かせないので、plan-trip と同じ検証で統計の混入を止められる）
  - 束の時刻と光は「しおりどおりに走った場合」の値。遅れを選んだ後の実際の時計で測り直すのは drive-link。記録の行は `plannedLight` として残す
- R2 出来事の束（A4-3）: 1 日ぶんを 1 つの「束」（StopDeck）にまとめ、旅と日の組で 1 回だけ作って保存する。2 回目からは保存した束を返し、Claude を呼ばない（推奨で決定。日ごとに 1 回の呼び出しで、1 日の上限を節約し、文の調子もそろう）
  - 場面（scene）は 2 種: しおりの楽しみ（`pleasure`。確定）と、ランダムな出来事（`fuel` 給油・`traffic` 渋滞・`weather` 天候の変化・`request` 同乗者の要望）
  - 楽しみの場面: その日の `stops` の順に 1 つずつ（楽しみは全部出す）。止まり場所（`beforeLeg`。その場面の後に出発する移動の添字。最後の移動の後なら移動の数）は、前の楽しみの止まり場所から順に、拠点と同じ地点の止まり場所を探して決める。見つからなければ前の楽しみと同じ止まり場所。滞在は重さ × 1.6 時間（plan-trip と同じ）
  - 楽しみの場面の時刻 `at`: その止まり場所に着いた時刻（前の移動の arriveAt）。止まり場所 0（出発前）は最初の移動の出発から、その止まり場所の滞在の合計を引いた時刻。移動の無い日は 8:00（しおりの活動の始まり）。同じ止まり場所の 2 つ目からは、前の楽しみの at ＋ 滞在
  - ランダムな出来事の数: その日の運転時間 ÷ 間隔の切り捨て、最大 3。間隔は経験で決める（はじめて 120 分・1〜2 回 150 分・慣れている 180 分。「2〜3 時間に 1 回」。推奨で決定）。ランダムは「6 − 楽しみの数」の枠まで（楽しみを優先する）
  - ランダムな出来事の位置: 運転時間を数 + 1 等分した時刻に ±20 分の揺らぎ（シード付き乱数。運転の 1 分目〜最後の 1 分前に収める）。その時刻の移動と道のり（km）に置く。鹿ゾーンの中に落ちたら、そのゾーンの入口の 1 km 手前に動かす（0 km で止める。動かした先がまた別のゾーンの中なら、そのゾーンの入口の手前へ繰り返す。ゾーンの中は A-5 の場面）。種類はシード付き乱数で選び、同じ種類を続けない
  - 場面の並び: 時刻の順。同じ時刻なら楽しみが先、ランダムは生成の順
  - 乱数は `seed` と日から作る mulberry32（同じ旅・同じ日は同じ束）
  - 束はそれを作ったデータの版（`data.routes`・`data.zones`）を持つ。保存済みを返すときにいまの DayPlan の版と比べ、違えば作り直す（移動の添字と km がずれないように）
- R3 選択肢（A4-2）: 場面ごとに 2〜3 個。種類ごとに決まった形で、遅れ（分）か「ここで泊まる」を持つ
  - 楽しみ: `leave` いま出発（0 分）／`linger` もう少しいる（+60 分）／`stay` 予定を変えてここに泊まる
  - 給油: `refuel` 給油する（+15 分）／`skip` 寄らずに進む（0 分）
  - 渋滞: `wait` 待つ（+40 分）／`bypass` 迂回する（+25 分）／`turn-back` 引き返して泊まる
  - 天候: `slow` ゆっくり進む（+30 分）／`wait-out` 道の駅で待つ（+90 分）／`turn-back` 引き返して泊まる
  - 同乗者の要望: `accept` 寄り道する（+20 分）／`decline` 断って進む（0 分）
  - 「泊まる」系（`stay`・`turn-back`）は、最終日（返却の日）と、その場面の後に鹿ゾーンを通らない日には出さない（意味のない選択肢を出さない。推奨で決定）。泊まる場所は、楽しみなら楽しみの拠点、ランダムなら今の移動の出発地
  - `turn-back` は、今の移動で既に鹿ゾーンを通った後（その移動のゾーンの出口が場面の km 以下）には出さない（引き返すと同じゾーンをもう一度通るため。推奨で決定）
- R4 鹿ゾーンをいつ通るか（A4-2）: 選択肢ごとに、その場面の後に残る鹿ゾーンのうち一番暗いもの（`night` ＞ `dusk`・`dawn` ＞ `day`。同じ暗さなら早いもの）の入口の時刻（遅れのぶんずらす）と光（`lightPeriod`: 昼 `day`／薄暮 `dusk`／薄明 `dawn`／夜 `night`。ずらした時刻で測り直す）、区間の長さ（km）、道の名前、残りのゾーンの数 `count` を付ける。泊まる系とゾーンが残っていない選択肢は「通らない」（`zone: null`）
  - 画面の言い方: `day` 昼、`dusk` 薄暮、`dawn` 薄明、`night` は束の日付の午前なら「夜明け前」、それ以外は「日没後」。時刻の日付が束の日付より後なら「翌」を付ける（A4-2 の「昼/薄暮/日没後/通らない」に、朝の 2 つを足した）
- R5 失うもの（A4-2）: 選択肢ごとに `lost: { jpy, weight, pleasures, lateReturn }`
  - 泊まる系: その日の残りの楽しみ（この場面の止まり場所より後の止まり場所の stops。同じ止まり場所の楽しみは泊まっても楽しめるので数えない）の重さの合計と id。予約した宿（その日の `stay`）が泊まる場所と違えば、1 日あたりの予算（`budgetPerPersonJPY` × 人数 ÷ 旅の日数（`plan.days.length`）、1,000 円単位に四捨五入）を失う金額にする（宿と食事の予算の 1 日ぶん。画面に「予算からの目安」と書く。予算 0 は ¥0。推奨で決定）
  - 遅れる系・出発: 金額 0・重さ 0（失うのは時刻で、鹿ゾーンの光が変わることで見せる）
  - 最終日: 到着が返却の 1 時間前（しおりの返却の余裕）を過ぎる選択肢は `lateReturn: true`。画面は「返却に遅れる」と出す（推奨で決定）
- R6 場面の数字（A4-1）: 楽しみの場面は、滞在（分）、支出の目安（1 日あたりの予算 × 滞在 ÷ 10 時間、100 円単位に四捨五入。画面に「目安」）、次の到着予定（その日の最後の移動の到着地と時刻。選択肢ごとに遅れを足す。しおりの待ち時間で吸収はしない）。ランダムの場面は滞在・支出なし、次の到着予定だけ
- R7 Claude の文（付録 A #1）: 場面ごとに `headline`（1 行）・`body`（1〜2 文）、選択肢ごとに `label`（行動の言い回し）・`note`（結果の一言）を 4 言語（ja / en / zh 繁体字 / ko）で書かせる
  - 材料は選択肢由来の値だけ（楽しみ・地点の名前、種類、遅れ、光、失う重さ、天候・路面、人数、経験）。自由入力の文字列は無い
  - 検証（plan-trip R5 と同じ考え）: 場面と選択肢の id・数・順が束と同じ、4 言語がそろい空でない、長さ（見出し 120・短文 400・言い回し 100・一言 120。UTF-16 の単位）、絵文字なし、3 桁以上の数・「%」「％」「件」「円」「¥」「$」「元」「圓」「萬」「원」「엔」を含まない、時刻（`16:20`・`16時`・`4點`・`4시`・`午後4時`・`四時`。「1時間」「시간」は除く）を含まない。言い回し（label）と一言（note）は数字を一切含まない（その横に画面が計算値を出すので食い違わせない。推奨で決定）。外れたら 1 回だけ作り直し、それでも外れたら失敗
  - 光や安全を言い切らせない（「明るいうちに抜けられる」「安全」）。束の光は予定の値なので、プロンプトで指示する（検証の禁止語にはしない）
  - モデル `claude-sonnet-5-5`、決まった形の JSON、出力の上限 8,000 トークン、時間切れ 45 秒（推奨で決定。1 日 6 場面 × 4 言語の量）。プロンプトは plan-trip の 2 部品（観光知識・鹿事故の注意喚起の書き方）を使う
  - Claude が失敗 → 保存せずに 502。代わりの文は作らない。sim はその日の A-4 を出さず、運転は続く（drive-link が決める）
- R8 費用の抑え（plan-trip R9 を共有）: 1 日の Claude の呼び出しの上限（`CLAUDE_DAILY_CALL_LIMIT`）と同時呼び出しの上限（`CLAUDE_MAX_CONCURRENT_CALLS`）は plan-trip と同じ数え上げ・同じ枠を使う（2 つの feature で 1 つの予算）。束の POST は IP あたり 1 分 10 件
- R9 書き込みの権利（推奨で決定）: 束の POST とイベントの POST は、旅を作った端末が持つ ownerToken（ヘッダ `X-Owner-Token`）を求める。無い・違う → 403 `OWNER_REQUIRED`（どちらも同じ応答）。旅が無い → 404
  - 理由: 記録 `/t/{id}`（A7-1）はログインなしで共有するので、旅の id は公開の値になる。id だけで書けると、他人の記録に偽の衝突を書けて、Claude の費用も使える
  - ownerToken の役割を「削除の権利」（plan-trip）から「その旅の記録への書き込みの権利」に広げる（record のセッションに PR で知らせる）
  - トークンを持たない端末（共有リンクから開いた人）は、束を受け取れず（A-4 を出さない）、イベントも送らない（hook は何もしない。エラーを出さない）
- R10 イベントログ（ch7 `POST /api/trips/{id}/events`）: 1 回の走行（run）を端末が作る UUID v4（`runId`）で区別し、走行の中の通し番号 `seq`（0 始まり）でイベントを並べる。同じシードのやり直し（A6-4）・アラート OFF の挑戦（A7-4）は新しい run
  - 1 回の POST に 1〜50 件。共通の欄: `seq`、`day`（1〜旅の日数）、`at`（ゲーム内の時刻。タイムゾーン付き ISO 8601）、任意の `leg`（その日の移動の添字）と `km`（その移動の始点からの道のり）。run ごとの欄: `runId`、`alertEnabled`
  - 種類と欄（kind）:
    - `choice`: `sceneId`・`choiceId`。api は保存した束にその場面と選択肢があることを確かめ、束の値（場面の種類、遅れ、泊まるか、光、失う金額と重さ）を行に写して保存する（端末の値を信じない）。その日の束が無い・知らない id → 400
    - `encounter`（遭遇）: `pattern`（`roadside`・`eyeshine`・`crossing`・`herd`・`frozen`。drive の DeerPattern と同じ）、`alerted`（A-5 の赤を出したか）、`alertDistanceM`（赤を出したときの距離。出していなければ null）、`userSpotted`（A5-5 自分でも見つけた）
    - `collision`（衝突）: `pattern`、`speedKmh`（0〜200）
    - `avoidance`（回避。A5-7）: `pattern`、`closestM`（最接近距離 0〜500）、`alertToBrakeMs`（アラートからブレーキまで。アラートが無い・ブレーキを踏まない → null）
  - 位置は `leg`・`km` だけで持ち、緯度経度を受けない（知らない欄は 400）。leg・km の範囲は端末の申告として保存する（record が丸める）
  - 欄どうしの整合（400）: `at` の日本時間の暦日が、その旅の `day` の日付か翌日（深夜の運転）であること。`alerted: false` なら `alertDistanceM` は null。`alertEnabled: false` の run で `alerted: true` は無い
  - 記録は自己申告。choice の値（束から写す）以外は端末が送った値で、所有者は自分の記録を書き換えられる（threat.md）
  - 同じ `(runId, seq)` の再送は、中身が同じなら重複として数えて成功（冪等）。中身が違えば 409 `EVENT_CONFLICT`（その POST の全件を入れない）。1 つの POST の中で seq が重なる → 400
  - 1 つの旅に保存できるのは 5,000 件まで（超える POST → 409 `EVENT_LIMIT`。所有者でも記録を無限に増やせない。推奨で決定）。IP あたり 1 分 60 件
  - 応答 200 `{ accepted, duplicates }`
- R11 A-4 の画面（A4-1・A4-2、デザイン A4_Stop / A4_L）: trip テーマのカード。左に写真の枠（`photo-placeholder` に楽しみの名前。1〜3 枚の点）、右に見出し・短文・数字の 3 枚（滞在／使った／到着予定）、「どうする？」と選択肢のボタン、下にアラートの ON / OFF
  - 選択肢のボタン（ChoiceButton）: 左寄せ、太字の言い回し＋「→ {地点} {時刻} 着」、下の帯は `clay-deep` で「鹿ゾーン（{km} km）を {時刻}〜 {光} に通過」か「鹿ゾーンを通らない」、失うもの「予算からの目安 −¥xx,xxx ・ 楽しみ −重さ n」、Claude の一言。高さ 44px 以上
  - 押したら `onChoose`（選んだ選択肢の計算値つき）を呼び、イベントログに `choice` を送る。モーダルは操作するまで閉じない（Esc・外側のクリックでは閉じない。選ばずに進む道を作らない）。開いたら最初の選択肢にフォーカス
  - 4 言語の切り替えは旅の言語（`plan.lang`）。数字は IBM Plex Mono、色は tokens の CSS 変数だけ。モックの独自色（`#D9D1C0`・`#BFD3E6`）は `line`・`surface-sunken` に寄せ、11px の文字は 12px にする
  - スマホ横（高さ 500px 以下）は写真を左に細く、数字はチップ、選択肢は 1 行（A4_L）
- R12 運転からの入口（barrel）: drive-link が使うものを `@/features/stop-events` から出す
  - `useStopDeck(tripId, day)`（束の取得。所有者トークンが無ければ取りに行かない）
  - `scenesBeforeLeg(deck, leg)`・`roadScenesBetween(deck, leg, fromKm, toKm)`（その場所で出す場面）
  - `StopSceneModal`（props: scene・writing・lang・alertEnabled・dayLabel・onChoose）
  - `useTripEventLog(tripId, { runId, alertEnabled })`（`log(event)` で seq を振って送る）と、イベントの型。runId と seq はメモリにだけ持つ（再読み込みは新しい run。seq が 0 に戻って衝突しない）。`newRunId()` で runId を作る
  - `useStopDeck` は 409 IN_PROGRESS を 5 秒あけて 20 回まで待ち直す（生成の最悪 45 秒 × 2 回より長く待つ）
  - モーダルは body 直下に出し、開いているあいだ背面を inert にする。閉じたら開く前の要素にフォーカスを戻す。lang 属性を付ける（accessibility-checker の Critical）
  - 確認用の画面 `/trip/:id/day/:n/stops`（その日の場面を順に開ける。運転の組み込み前の確認とデモの予備。app の routes に 1 行足す）

## API エンドポイント

### POST /api/trips/:id/day/:n/stop-deck

- **認証**: ownerToken（ヘッダ `X-Owner-Token`、16 進 64 文字）。詳細は threat.md
- **リクエスト**: body なし（送られても読まない）
- **レスポンス 201**（作った）/ **200**（保存済み。ヘッダ `Idempotent-Replayed: true`）: `{ deck: StopDeck, writing: StopWriting }`
  - `StopDeck`: `{ tripId, day, date, dayBudgetJPY, scenes: StopScene[], data: { routes, zones } }`
  - `StopScene`: `{ id, kind, trigger: { kind: 'stop', beforeLeg } | { kind: 'road', leg, km }, at, pleasure: { id, weight, base } | null, stayMin | null, spentJPY | null, arrive: { place, at } | null, choices: SceneChoice[] }`
  - `SceneChoice`: `{ id, kind, delayMin, endsDay, stayAt | null, arrive: { place, at } | null, zone: { entryAt, light, km, roadName, count } | null, lost: { jpy, weight, pleasures[], lateReturn } }`
  - `StopWriting`: `{ scenes: [{ id, headline: L4, body: L4, choices: [{ id, label: L4, note: L4 }] }] }`（L4 は ja / en / zh / ko）
- ch7 は「イベント案」を `GET /api/trips/{id}/day/{n}` に入れているが、brief-map が持つ読み出し（Claude を呼ばない）に費用のかかる生成を混ぜないため、別の POST にした（推奨で決定）

### POST /api/trips/:id/events

- **認証**: ownerToken（`X-Owner-Token`）
- **リクエスト**（strict）: `{ runId, alertEnabled, events: TripEventInput[] (1〜50) }`。TripEventInput は R10
- **レスポンス 200**: `{ accepted: number, duplicates: number }`
- **保存する行**（record が `TripEventRepository.listByTrip` で読む）: `{ tripId, runId, seq, day, kind, at, alertEnabled, leg | null, km | null, receivedAt, data }`。`data` は kind ごと:
  - `choice`: `{ sceneId, choiceId, sceneKind, choiceKind, delayMin, endsDay, plannedLight | null, lostJPY, lostWeight, lostPleasures[], lateReturn }`（束から写した値。光はしおりどおりの予定）
  - `encounter`: `{ pattern, alerted, alertDistanceM, userSpotted }`
  - `collision`: `{ pattern, speedKmh }`
  - `avoidance`: `{ pattern, closestM, alertToBrakeMs }`
  - 並びは run の最初の受信順 → seq

## ユースケース

### UC-1: 束を組み立てる（R2〜R6）

- **Given**: 保存した旅とその日の DayPlan
- **When**: 束の POST
- **Then**: 楽しみの場面がその日の stops の順に並び、ランダムの場面が運転時間と経験で決まった数だけ入る。各場面に 2〜3 の選択肢、選択肢ごとに鹿ゾーンの時刻・光と失うもの
- **Examples**: ペルソナの D2（鶴居 タンチョウ → 阿寒湖）→ タンチョウの場面に leave / linger / stay、linger は鹿ゾーンの入口が 60 分遅れる / 最終日 → stay・turn-back が無い / 移動の無い日 → ランダムの場面なし / 同じ旅・同じ日 → 同じ束

### UC-2: Claude に書かせる（R7・R8）

- **Examples**: 正常 → 201、4 言語の見出し・短文・言い回し・一言、2 回目は 200 で Claude を呼ばない / 選択肢が 1 つ足りない → 作り直し → 2 回目も外れたら 502、保存しない / 「16:20」「6,705」「円」を含む → 外れ

### UC-3: イベントを残す（R9・R10）

- **Examples**: choice → 束の値を写して保存 / 同じ (runId, seq) をもう一度 → duplicates 1 / 中身が違う → 409 / 知らない sceneId → 400 / 緯度経度の欄 → 400 / トークンなし → 403

### UC-4: A-4 の画面（R11・R12）

- **Examples**: 楽しみの場面 → 見出し・滞在・支出・到着予定・3 つのボタン / ボタンを押す → onChoose と choice の送信 / Esc では閉じない / トークンが無い → 束を取りに行かず、ログも送らない

## エラーパターン

| 条件                                                 | ステータス | レスポンス                           |
| ---------------------------------------------------- | ---------- | ------------------------------------ |
| 旅が無い・id の形が違う                              | 404        | `{error:{code:"TRIP_NOT_FOUND"}}`    |
| その日が無い（n が日数を超える）                     | 404        | `{error:{code:"DAY_NOT_FOUND"}}`     |
| n・body の形が違う・知らない欄・知らない場面や選択肢 | 400        | `{error:{code:"INVALID_INPUT"}}`     |
| ownerToken が無い・違う                              | 403        | `{error:{code:"OWNER_REQUIRED"}}`    |
| 同じ日の束を作っている最中                           | 409        | `{error:{code:"IN_PROGRESS"}}`       |
| 保存したしおりをいまのマスターで作り直せない         | 409        | `{error:{code:"ITINERARY_CHANGED"}}` |
| 同じ (runId, seq) で中身が違う                       | 409        | `{error:{code:"EVENT_CONFLICT"}}`    |
| 旅のイベントが 5,000 件を超える                      | 409        | `{error:{code:"EVENT_LIMIT"}}`       |
| IP あたりの上限                                      | 429        | `{error:{code:"RATE_LIMITED"}}`      |
| 全体の 1 日の上限（Claude の呼び出し）               | 429        | `{error:{code:"DAILY_LIMIT"}}`       |
| 同時の Claude の呼び出しが上限                       | 503        | `{error:{code:"WRITER_BUSY"}}`       |
| Claude の失敗・時間切れ・検証で落ちた                | 502        | `{error:{code:"WRITER_FAILED"}}`     |

### 例外 → ステータスコードマッピング

| UseCase/Domain 例外             | HTTP ステータス |
| ------------------------------- | --------------- |
| `TripNotFoundError`（既存）     | 404             |
| `TripDayNotFoundError`（既存）  | 404             |
| `TripInputError`（既存）        | 400             |
| `OwnerRequiredError`            | 403             |
| `TripInProgressError`（既存）   | 409             |
| `ItineraryChangedError`（既存） | 409             |
| `EventConflictError`            | 409             |
| `EventLimitError`               | 409             |
| `DailyLimitError`（既存）       | 429             |
| `TripWriterBusyError`（既存）   | 503             |
| `SceneWriterError`              | 502             |

## ビジネスルール

R1〜R12 のとおり。束の組み立て（R2〜R6）は `apps/api/src/domain/stop-events/policies/` の純粋関数で、DayPlan と光の関数を受け取る（domain は `@antler/*` を import しない。application が `buildDayPlan` と `lightPeriod` を渡す）。

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（事実確認）/ 期日=2026-11-08（Day 6）/ 暫定挙動=決まった遅れ（+15〜+90 分）と 1 日あたりの予算からの目安を使い、画面に「目安」と書く] 選択肢の遅れの分数と、支出・宿の金額の目安が実感に合うか
- [Deferred: 担当=ユーザー / 期日=2026-11-06 / 暫定挙動=消さない] 束とイベントログの保持期間（TripPlan と一緒に決める）
- [Deferred: 担当=drive-link / 期日=2026-11-06（Day 4）/ 暫定挙動=選んだ遅れと泊まるかを onChoose で渡すだけ。運転の時計と行程には反映しない] 選んだ結果を運転（時刻・ゾーンの光・その日の終わり）にどう効かせるか
- [Deferred: 担当=record / 期日=2026-11-06（Day 4）/ 暫定挙動=ch7 の 4 種のまま。record は最終日の choice・衝突の有無から推定する] run の終わり（完走・途中でやめた）の印が要るか。要るなら kind を足す（追加は既存の形を壊さない）

## Test List（Canon TDD Step 1）

ID は plan-trip・brief-map のテストと重ならないよう、AUTH などは 31 から振る。

外側ループ（受け入れ）:

- [x] AC-31: ペルソナの旅の D2 で束の POST（Claude はフェイク）→ 201。場面に楽しみと選択肢、選択肢に失うもの、writing は 4 言語。D1（同梱の鹿ゾーンを通る移動がある日）では選択肢に鹿ゾーンの光が付く。2 回目は 200 で Claude を呼ばない。choice のイベントを POST → 200、保存した行に束の値が写っている
- [x] AC-32: A-4 のモーダルを束のフィクスチャで開くと、見出し・滞在・使った・到着予定・選択肢 3 つ（鹿ゾーンの帯つき）が出て、選択肢を押すと onChoose が呼ばれ、choice が X-Owner-Token つきで送られる

UC-1 束の組み立て:

- [x] DECK-1a: 楽しみの場面はその日の stops の順で、beforeLeg はその楽しみの後に出発する移動の添字。滞在は重さ × 96 分
- [x] DECK-1b: 楽しみの場面の選択肢は leave（0）・linger（+60）・stay。linger の鹿ゾーンの入口は leave の 60 分後で、光はその時刻で測り直す
- [x] DECK-1c: ランダムの場面の数は運転時間 ÷ 経験の間隔（120 / 150 / 180 分）の切り捨て、最大 3、場面は 1 日 6 つまで
- [x] DECK-1d: ランダムの場面は鹿ゾーンの中に置かない（入口の 1 km 手前に動く）。同じ種類が続かない
- [x] DECK-1e: 最終日と、その後に鹿ゾーンを通らない場面には stay・turn-back が無い。選択肢はどの場面も 2〜3 個
- [x] DECK-1f: 泊まる系は zone が null、失う重さはその日の残りの楽しみの合計、予約した宿が違えば 1 日あたりの予算（1,000 円単位）を失う
- [x] DECK-1g: 同じ旅・同じ日 → 同じ束（シードで再現）。別の seed → ランダムの場面が変わる
- [x] DECK-1h: 楽しみの場面の支出は 1 日あたりの予算 × 滞在 ÷ 600 分の 100 円単位、到着予定はその日の最後の移動の到着に遅れを足したもの
- [x] DECK-1i: [ADDED spec-adversary] 今の移動で鹿ゾーンを通った後のランダムの場面には turn-back が無い
- [x] DECK-1j: [ADDED spec-adversary] ゾーンが 2 つ残るとき、選択肢の zone は一番暗いもの（遅れで 2 つ目が夜になれば 2 つ目）で、count は残りの数
- [x] DECK-1k: [ADDED spec-adversary] 最終日に返却の 1 時間前を過ぎる選択肢は lateReturn
- [x] DECK-1l: [ADDED spec-adversary] 同じ拠点の楽しみ 2 つは同じ止まり場所で、2 つ目の at は 1 つ目の at ＋ 滞在。1 つ目で泊まっても 2 つ目は失わない。移動の無い日の楽しみは 8:00 から

UC-2 Claude の文:

- [x] WRITE-2a: 正常な文 → 検証を通る（4 言語・id・数・順）
- [x] WRITE-2b: 場面・選択肢の id・数・順が違う、1 言語が空 → 外れ
- [x] WRITE-2c: 3 桁以上の数・%・件・円・¥・$・元・원・絵文字・時刻（16:20・16時・4點・4시・四時）を含む → 外れ。見出し・短文の「1時間」は通る。言い回し・一言は数字を含めば外れ
- [x] WRITE-2d: Claude に渡す材料は選択肢由来の値だけ（自由入力の文字列・TripPlan のタイトル・日の説明が無い）で、束の時刻と金額を含まない
- [x] WRITE-2e: gateway は max_tokens・refusal・形の違う JSON を rejected で返し、時間切れ・認証の失敗を SceneWriterError にする

UC-3 イベントログ:

- [x] LOG-3a: choice は束の値（種類・遅れ・泊まるか・光・失う金額と重さ）を写して保存する
- [x] LOG-3b: その日の束が無い・知らない sceneId / choiceId → 400、何も保存しない
- [x] LOG-3c: encounter・collision・avoidance を保存し、listByTrip が run の受信順 → seq で返す
- [x] LOG-3d: 1 つの POST の中で seq が重なる・51 件・0 件 → 400
- [x] LOG-3e: 緯度経度など知らない欄・day が旅の日数を超える → 400
- [x] LOG-3f: [ADDED spec-adversary] at の暦日が day の日付でも翌日でもない・alerted: false なのに alertDistanceM・アラート OFF の run で alerted: true → 400

UC-4 A-4 の画面:

- [x] UI-4a: 楽しみの場面 → 見出し・短文・滞在・使った（目安）・到着予定、選択肢ごとに「→ 地点 時刻 着」と鹿ゾーンの帯と失うもの
- [x] UI-4b: 光の言い方（昼・薄暮・薄明・日没後・夜明け前）と「鹿ゾーンを通らない」「返却に遅れる」を 4 言語で出す。束の日付より後の時刻には「翌」
- [x] UI-4c: dialog の役割と見出しの名前、開いたら最初の選択肢にフォーカス、Esc で閉じない、ボタンは 44px 以上
- [x] UI-4d: writing が無い場面は楽しみの名前と決まった言い回しで出す（Claude の代わりの文は作らない）
- [x] UI-4e: useStopDeck はトークンがあれば X-Owner-Token つきで POST し、応答の形を確かめる。トークンが無ければ取りに行かない
- [x] UI-4f: useTripEventLog は seq を 0 から振って送り、トークンが無ければ何もしない
- [x] UI-4g: scenesBeforeLeg・roadScenesBetween がその場所の場面を返す
- [x] UI-4h: 確認用の画面 `/trip/:id/day/:n/stops` が場面の一覧を出し、押すとモーダルが開く

認可（threat.md）:

- [x] AUTH-31: 束の POST にトークンが無い → 403 OWNER_REQUIRED、Claude を呼ばない
- [x] AUTH-32: 束の POST に別の旅のトークン → 403
- [x] AUTH-33: イベントの POST にトークンが無い・違う → 403、保存しない
- [x] AUTH-34: 束の POST が 1 分に 11 件目 → 429 RATE_LIMITED
- [x] AUTH-35: イベントの POST が 1 分に 61 件目 → 429 RATE_LIMITED
- [x] AUTH-36: 1 日の上限に達したあと束の POST → 429 DAILY_LIMIT、Claude を呼ばない
- [x] AUTH-37: 旅のイベントが 5,000 件に達したあとの POST → 409 EVENT_LIMIT
- [x] AUTH-38: 正しいトークンなら束もイベントも通る（意図した権利が塞がれていない）
- [x] MASS-31: choice に delayMin・lost・light などの計算値を混ぜる → 400（端末の値で上書きできない）

障害・冪等・並行（resilience.md）:

- [x] FAIL-31: Claude が時間切れ → 502 WRITER_FAILED、束は failed、次の POST で作り直せる
- [x] FAIL-32: 2 回とも検証で外れる → 502（1 回目だけ外れたら 2 回目で 201）
- [x] FAIL-33: 同時呼び出しの枠が無い → 503 WRITER_BUSY、束は failed
- [x] FAIL-34: 保存した旅のしおりをいまのマスターで作り直せない → 409 ITINERARY_CHANGED、Claude を呼ばない
- [x] IDEM-31: 束を作り終えた日の 2 回目 → 200 と Idempotent-Replayed、Claude は 1 回だけ
- [x] IDEM-32: 同じ (runId, seq) の再送 → duplicates に数えて 200、行は 1 つ
- [x] IDEM-33: 同じ (runId, seq) で中身が違う → 409 EVENT_CONFLICT、その POST の新しい行も入らない
- [x] IDEM-34: [ADDED spec-adversary] 保存した束の data の版がいまの DayPlan と違う → 作り直す（201）
- [x] CONC-33: [ADDED spec-adversary] 作り直しに取られた後の古い生成の done は、自分の pending でなければ書かない
- [x] CONC-31: 同じ日の束を作っている最中の 2 つ目 → 409 IN_PROGRESS
- [x] CONC-32: pending が 2 分を過ぎた束 → 次の POST で作り直せる
- [x] MIGR-31: 空のデータファイルから起動すると 2 つの表が作られ、2 回目の起動でも壊れない

## Rule → ドメイン語彙対応

| Rule                | 語彙                                         | 置き場所                                       | 証明     |
| ------------------- | -------------------------------------------- | ---------------------------------------------- | -------- |
| R2〜R6: 束          | `buildStopDeck`                              | apps/api/src/domain/stop-events/policies/      | DECK-*   |
| R7: Claude の文     | `SceneWriterGateway` / `validateStopWriting` | apps/api/src/domain/stop-events/policies/      | WRITE-*  |
| R8: 費用の抑え      | `PrepareStopDeckUseCase`                     | apps/api/src/application/usecases/stop-events/ | AUTH-36  |
| R9: 書き込みの権利  | `isTripOwner`                                | apps/api/src/domain/stop-events/policies/      | AUTH-*   |
| R10: イベントログ   | `RecordTripEventsUseCase` / `resolveChoice`  | apps/api/src/application/usecases/stop-events/ | LOG-*    |
| R11: A-4 の画面     | `StopSceneModal` / `ChoiceButton`            | apps/sim/src/features/stop-events/components/  | UI-4a〜d |
| R12: 運転からの入口 | `useStopDeck` / `useTripEventLog`            | apps/sim/src/features/stop-events/hooks/       | UI-4e〜h |

## 受け入れ基準

- [x] 受け入れテスト AC-31・AC-32 が Green
- [x] 全 UC / 全エラーパターンのテストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型 / 依存方向）
- [x] code-reviewer・layer-guard・component-guard・accessibility-checker・security-auditor の Critical 0
