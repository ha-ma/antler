---
feature: drive-tourism
target_paths:
  - apps/sim/src/features/drive/chat/
  - apps/sim/src/features/drive/components/hud/
  - apps/sim/src/features/drive/components/DrivePage.tsx
  - apps/sim/src/features/drive/components/drive.css
  - apps/sim/src/features/plan-trip/index.ts
  - apps/api/src/domain/chats/
  - apps/api/src/application/usecases/chats/
  - apps/api/src/infrastructure/gateways/prompts/chat-writing.ts
  - apps/api/src/infrastructure/http/schemas/chat.schema.ts
spec_confirmed_at: cff9f43
tier: 2
---

# 仕様: drive-tourism（A-3 運転中の観光の会話と、鹿ゾーンの前のおすすめ）

## 概要

ユーザーがローカルで運転を試した 2 回目の指摘（2026-11-06、`docs/changes/2026-11-06-a-local-feedback-2-tourism.md`）のうち、観光の 2 つを運転画面（`apps/sim/src/features/drive/`）に入れる。

1. 運転中の会話を、A-1 で選んだ楽しみ（観光の中身）と、その写真が出てくる会話にする。置き場所は画面の右上
2. 鹿ゾーンに入る前に、次の楽しみのおすすめのカード（写真・一言・所要・到着の目安）を、会話とは別に画面の右下に出す

要件: ch3 A3-5（同乗者の吹き出し）・A3-7（つぎの楽しみ。赤の間は 60%）・A3-8（会話）、ch5（3 状態・4 言語・アクセシビリティ）、ch8（規約 1〜8）、付録 A #1（Claude の活用）。
前の feature: `docs/specs/drive-audio-chat/functional.md`（R10〜R19。この feature は R11 の話題・R13 の位置と行数・R15 の鍵の版・R16 の材料・R19 の見本の会話を変える）、`docs/specs/plan-trip-photos/functional.md`（写真と引用）。

**Tier 2 の理由**: 外部副作用（Claude に渡す材料とプロンプトが変わる）、永続化（保存する会話の束の行に `pleasure` が増える。表は変えない＝`trip_chats.deck` は JSON の列なので `SCHEMA_VERSION` は据え置き、保存の鍵の版を `chat:v2` に上げる）。認可と並行性は drive-audio-chat のまま（新しいルートなし）。

**範囲外**: 鹿の出方・ステージ（`domain/deer-*`・`stages` ほか）、路面・季節（`vehicle.ts`・`scene/`）は別のセッションが同時に直す。ここは `engine` のスナップショット（`zone`・`alert`・`stage`・`destination`）を読むだけ。立ち寄り（A-4）の組み込み、会話の読み上げ。

## Example Map

Story: 台湾から 4 人で初めての北海道を走るドライバーとして、運転中の車内の会話で今日の楽しみ（流氷・タンチョウ）の話を写真つきで聞き、鹿ゾーンに入る前には次の楽しみを思い出して、気持ちよく慎重に走りたい。

Questions は 2026-11-06 に推奨で決定（CLAUDE.md の方針）。決めたことは各 Rule に「推奨で決定」と書いた。

### 会話の話題を観光に（api の domain・application・プロンプト）

- T1 話題の割り当て（R11 の「話題」を置き換える。位置・話し手・行の数・id は R11 のまま）
  - 出発の行は `depart` のまま
  - 話の行（depart 以外）を移動・km の順に 0, 1, 2 … と数え、i mod 3 が 0 か 1 の行は、楽しみの候補（T2）があれば `pleasure`。i mod 3 が 2 の行と、候補の無い行は、`weather`・`light`・`scenery`・`snack`・`music` からシード付き乱数で選ぶ（前の楽しみ以外の話題と同じものを続けない）。話の行の 3 分の 2 が楽しみの話になる（推奨で決定）
- T2 楽しみの候補（その行の移動 L で決める。止まり場所は R11 と同じ「しおりの順を保ち、前には戻らない」）
  - その日のこれからの楽しみ（止まり場所が L より後）があれば、それを順に回す（`timing: 'ahead'`）
  - その日のこれからの楽しみが無く、その日に済んだ楽しみ（止まり場所が L 以前）があれば、いちばん最近のもの（`timing: 'done'`）と、後の日の楽しみ（`timing: 'ahead'`）を順に回す
  - その日に楽しみが無ければ、後の日の楽しみ（しおりの日の順、最大 3 件。`timing: 'ahead'`）を順に回す
  - どれも無ければ候補なし（楽しみの話をしない）
  - 「順に回す」: 楽しみの行ごとに 1 つ進む（候補が 2 件なら A・B・A …）
- T3 切り口（同じ楽しみの話が続いても同じ文にならないように。推奨で決定）
  - `ahead` は、その楽しみの何回目の行かで `anticipation`（期待）→ `highlight`（見られるもの・できること）→ `tip`（楽しみ方のこつ・服装・寄り道の工夫）→ 繰り返し
  - `done` は `memory`（振り返り）
- T4 Claude に渡す材料（R16 に足す）: 楽しみの行に、楽しみの名前（4 言語）・拠点の地名（4 言語、マスター）・時間帯（`day` / `night` / `dawn`）・所要の区分（`short` 2 時間以下 / `half` 4 時間以下 / `long`）・`timing`・`angle`。楽しみの補足（note）と所要の時間の数は渡さない（時刻・数字・「鹿」を含むものがあるため）
- T5 プロンプト: 楽しみの行では、その楽しみの中身（そこで見られるもの・できること・食べるもの・季節の様子）を具体的に、切り口に合わせて書く。北海道で広く知られた事実だけを使い、材料に無い施設名・店名・料金・時刻を作らない。`done` は「さっきの〜」の振り返り。ほかの決まり（R17 の長さ・数字・鹿の語・絵文字・言語）は同じ
- T6 応答と保存: `ChatLine` に `pleasure: string | null`（`pleasure` の話題の行は楽しみの id、ほかは null）を足す。保存の鍵の版を `chat:v2` に上げる（v1 の束は読まれない。行の形の違う束を返さない）。1 つの旅の束の上限 30 は v1 の束も数える（作り直しはまれなので許す。推奨で決定）
- T7 文の検証は R17 のまま（楽しみの名前に数字・鹿の語を含むものは無い。マスターのテストで守る）

### 会話の表示（sim の `chat/`）

- T8 写真つきの吹き出し（R13 を変える）
  - `pleasure` のある行は、一言の左に楽しみの写真（`apps/sim/public/photos/`、記録は `plan-trip` の `photoOf`。幅 64 px・高さ 48 px、`object-fit: cover`、飾りなので `alt=""`）と、一言の下に出典「写真: 撮影者 / ライセンス」（caption、`ink-muted`、4 言語の「写真」）を出す。写真の記録が無い楽しみは写真も出典も出さない
  - 出典はリンクにしない（HUD の会話は操作要素を置かない・ポインタを通す。R13）。出典のリンクは A-1 の楽しみのカードと `CREDITS.md` にある（推奨で決定）
  - 置き場所は画面の右上（右の列の上から積む。新しい行は下）。見える行は新しい 3 行まで（写真で 1 行が高くなるため。R13 の 4 行を変える）
  - 赤の間は待たせる・通知音なし・減光 60%・読み上げは最後の 1 行（R12・R13 のまま）
- T9 見本の会話（R19 を変える）: 話の行の話題を T1 と同じ数え方で割り当てる。楽しみの候補は、その日の楽しみ（`scenario.stops`）、無ければ到着地を拠点とする楽しみ（マスター。見本の場面は阿寒湖の 2 件）。文は 4 言語の決まった表に楽しみの名前を差し込む（同乗者 3 種・ラジオ 2 種。数字・鹿の語を含まない）。行に楽しみの id を付けて、写真も出す
- T10 応答の確かめ（R18）: `pleasure` は任意・null 可（無ければ null として扱う）。楽しみのマスターに無い id は null にする（写真を出さない）

### ゾーンの前のおすすめ（sim の `components/hud/`）

- T11 出すとき: 出発した後、走行中（`outcome: 'driving'`）、ゾーンの外（`zone.gps.status` が `outside`）で、次のゾーンまでの距離が 0 km より大きく 5 km 以下、かつ赤（`danger`）でないとき（推奨で決定。ステージは入口の 5 km 手前から始まるので、各ステージの始まりから入口まで）。ゾーンに入ったら・赤になったら・走行が終わったら消す（小さくせずに消す。AlertState と琥珀の表示の邪魔をしない）。アラート OFF の走行でも出す（ゾーンの表示は OFF でも残るため）
- T12 出す楽しみ: その日の楽しみ（`scenario.stops`）があれば、ステージの番号で順に回す（ステージ 1 は 1 件目、2 は 2 件目 …）。無ければ到着地（`scenario.to`）を拠点とする楽しみ（マスターの順）を同じく回す。どれも無ければ出さない
- T13 中身: 見出し「この先のおすすめ」（eyebrow）、写真（幅いっぱい・高さ 112 px、`object-fit: cover`、`alt=""`。記録が無ければ写真の面を出さない）、楽しみの名前（heading）、一言（note。ただし note に鹿の語（鹿・シカ・deer・사슴）が入るときは出さない。偽警報に見える文を出さない）、所要の目安（「所要 約 n 時間」、数は `num-s` の等幅）、到着の目安（楽しみの拠点がその日の到着地のときだけ、目的地の到着予定 `destination.etaMs` を JST の時刻で）、出典（T8 と同じ平文）。文言は旅の言語（4 言語）
- T14 見た目と配置: 右の列の下、音量の操作（`AudioControls`）の上に置く（推奨で決定。右上の会話・右下のおすすめ・いちばん下に音量の操作）。幅は右の列（`--drive-chat-w`）。`surface` の面・`line` の枠・`radius-l`。色・文字・余白は tokens.json の CSS 変数だけ。現れるときは 0.2 秒で下からふわっと（点滅しない。`prefers-reduced-motion` では動かさない）。操作要素を置かない・フォーカスを取らない・ポインタを通す。`<aside>` に `aria-label`（4 言語）。読み上げの領域（aria-live）にしない（アラートの読み上げと重ねない）
- T15 アイコン: 使わない（写真と文字だけ。要るならインライン SVG）。絵文字を使わない

## API エンドポイント

### POST /api/trips/:id/day/:n/chat（drive-audio-chat の R15 のまま。応答の行に 1 欄足す）

- **レスポンス 201 / 200**: `{ chat: ChatDeck }`
  - `ChatLine`: `{ id, cue: { kind: 'road', leg, km }, topic, speaker, pleasure: string | null, text: { ja, en, zh, ko } }`

## ユースケース

### UC-1: 楽しみの話題を割り当てる（T1〜T3・T6）

- **Given**: 保存した旅とその日の DayPlan
- **When**: 会話の束を組み立てる
- **Then**: 話の行の 3 分の 2 が楽しみの話。楽しみの id・時（ahead / done）・切り口が決まる
- **Examples**: ペルソナの D1（流氷・タンチョウ）→ 楽しみの行はその 2 件を回す / 楽しみの無い日で後の日に 2 件 → その 2 件を ahead で回す / 旅に楽しみが 1 件も無い → 楽しみの行なし、話題は R11 の 5 種 / 同じ楽しみの 1・2・3・4 回目 → anticipation・highlight・tip・anticipation / 最後の楽しみを過ぎた移動 → memory と後の日の楽しみ

### UC-2: Claude の材料とプロンプト（T4・T5）

- **Examples**: 楽しみの行の材料に名前・拠点・時間帯・所要の区分・timing・angle がある / note・時間の数・時刻・距離は無い / プロンプトに切り口の書き分けがある

### UC-3: 写真つきの会話（T8〜T10）

- **Examples**: api の楽しみの行 → 吹き出しに写真と「写真: kkawamura / CC BY 4.0」（リンクなし）/ 天気の行 → 写真なし / 4 行目 → いちばん古い行が消える / 見本の場面 → 阿寒湖の楽しみの行が出て写真つき / `pleasure` の無い応答 → 写真なしで使う / マスターに無い id → 写真なし

### UC-4: ゾーンの前のおすすめ（T11〜T15）

- **Examples**: 次のゾーンまで 4.9 km → カードが出る / 5.1 km → 出ない / ゾーンに入る → 消える / 赤 → 消える / 完走 → 消える / ステージ 2 → 2 件目の楽しみ / 楽しみの無い見本の場面 → 阿寒湖の楽しみ / 拠点が到着地 → 到着の目安の時刻、そうでない → 時刻なし / 野付半島（note に「鹿」）→ 一言を出さない / en の旅 → 英語の見出しと名前

## エラーパターン

drive-audio-chat の表のまま（新しいエラーなし）。

## ビジネスルール

T1〜T15 のとおり。話題の割り当て（T1〜T3）は `apps/api/src/domain/chats/policies/chat-plan-policy.ts` の純粋関数（domain は `@antler/*` を import しない。後の日の楽しみと拠点は application が写す）。おすすめの出しどき・楽しみの選び方（T11・T12）は `apps/sim/src/features/drive/components/hud/recommend.ts` の純粋関数。楽しみの写真は `plan-trip` の barrel（`photoOf`・`photoSrc`）から読む。

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（好み）/ 期日=2026-11-08（Day 6）/ 暫定挙動=T1 の 3 分の 2・T11 の 5 km] 楽しみの話の多さと、おすすめを出し始める距離（実機で見て決める）
- [Deferred: 担当=ユーザー（A-4 の要件との関係）/ 期日=2026-11-07 / 暫定挙動=到着の目安は拠点が到着地のときだけ] 途中の立ち寄りの到着の目安（場面が移動ごとの地点を持たないため。A-4 の組み込みで移動ごとの到着時刻を持たせる）

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [ ] AC-1（api）: ペルソナの旅の D1 の会話の POST → 話の行の 3 分の 2 以上が `pleasure` で、その id はその日の楽しみ。ほかの行の `pleasure` は null。Claude の材料の楽しみの行に名前・拠点・切り口がある
- [ ] AC-2（sim）: 旅の場面で api の楽しみの行を越えると、右上の会話に写真と出典が出る。ゾーンの 5 km 手前ではおすすめのカードが右下（音量の操作の上）に出て、ゾーンに入ると消える

UC-1 話題の割り当て（api）:

- [ ] UC-1a: 話の行の i mod 3 が 0・1 の行は、候補があれば pleasure。2 の行は楽しみ以外の 5 種から（続けない）
- [ ] UC-1b: その日のこれからの楽しみを順に回す。済んだ後の移動は memory（いちばん最近）と後の日の楽しみを回す
- [ ] UC-1c: その日に楽しみが無ければ後の日の楽しみ（最大 3 件）。旅に楽しみが無ければ楽しみの行なし
- [ ] UC-1d: 同じ楽しみの ahead は anticipation → highlight → tip → anticipation
- [ ] UC-1e: 応答・保存の行に pleasure（楽しみの行だけ id、ほかは null）。鍵の版は chat:v2

UC-2 材料とプロンプト（api）:

- [ ] UC-2a: 楽しみの行の材料に名前・拠点の地名・時間帯・所要の区分・timing・angle。note・数字を含まない
- [ ] UC-2b: プロンプトに切り口（anticipation・highlight・tip・memory）の書き分けと、作らないもの（施設名・料金・時刻）がある
- [ ] UC-2c: 応答の schema が pleasure を持つ（null 可）

UC-3 写真つきの会話（sim）:

- [ ] UC-3a: 応答の確かめ: pleasure は任意・null 可。マスターに無い id は null
- [ ] UC-3b: 道のりに写した行と、画面に出す行が pleasure を持つ
- [ ] UC-3c: 楽しみの行の吹き出しに写真（alt=""）と出典の平文（リンクなし）。ほかの行は写真なし。見えるのは 3 行
- [ ] UC-3d: 見本の会話: 話の行の 3 分の 2 が楽しみ（その日の楽しみ、無ければ到着地の楽しみ）。4 言語の文に数字・鹿の語が無い
- [ ] UC-3e: 会話の列は右上に積む（CSS の決まり）

UC-4 ゾーンの前のおすすめ（sim）:

- [ ] UC-4a: 出しどき: ゾーンの外・0 < 次のゾーンまで ≤ 5 km・赤でない・走行中だけ
- [ ] UC-4b: 楽しみの選び方: その日の楽しみをステージの番号で回す。無ければ到着地の楽しみ。どれも無ければ出さない
- [ ] UC-4c: 到着の目安は拠点が到着地のときだけ。note に鹿の語があれば一言を出さない
- [ ] UC-4d: カードに見出し・写真・名前・一言・所要・到着・出典。操作要素なし・aria-label（4 言語）
- [ ] UC-4e: 運転画面で、カードは右の列の音量の操作の上に出て、ゾーンに入ると消える

## 非機能要件

- [ ] 性能: 写真は 24 枚とも幅 500 px 以下（plan-trip-photos）。吹き出し・カードの `img` は `decoding="async"`。会話・カードの更新は運転のスナップショット（約 10 Hz）の購読で、3D のフレームに足さない
- [ ] アクセシビリティ: 文字は背景と 4.5:1 以上（tokens の ink / ink-muted on surface）。操作要素を足さない。点滅しない

## 受け入れ基準

- [ ] 受け入れテスト AC-1・AC-2 が Green
- [ ] 全 UC のテストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（lint / format / 型）
- [ ] ブラウザで確かめる（音を鳴らさない。開発ビルド、api 8822・sim 5212）
