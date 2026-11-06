# api: POST /api/trips/:id/day/:n/chat の実装（drive-audio-chat の api 部分）

2026-11-06。ブランチ feat/drive-audio-chat。コミットはしていない（メインセッションがコミットする）。

## 結果

- api の全テスト 50 ファイル・473 件 Green、`npm run typecheck` 通過、`npm run lint -w @antler/api` 通過、Prettier 通過、`scripts/ci_arch_check.py` 違反なし
- `sfad-drift.py` は DRIFT あり（下の「残したこと」1。docs/ の threat.md の追記が要る。コードの問題ではない）

## 作ったファイル

| 層      | ファイル                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain  | `apps/api/src/domain/chats/models/chat-deck.ts`（ChatTopic・ChatSpeaker・RoadCue・ChatPlanLine・ChatPlan・ChatLine・ChatDeck・StoredChat・ChatWriting・ChatWritingBrief） |
| domain  | `apps/api/src/domain/chats/models/chat-material.ts`（ChatMaterial・LightOnRoad）                                                                                          |
| domain  | `apps/api/src/domain/chats/rules/chat-rules.ts`（定数すべて）                                                                                                             |
| domain  | `apps/api/src/domain/chats/errors/chat-errors.ts`（ChatLimitError・ChatWriterError）                                                                                      |
| domain  | `apps/api/src/domain/chats/policies/chat-plan-policy.ts`（`buildChatPlan`・`chatKeyMaterial`・`speakersFor`）                                                             |
| domain  | `apps/api/src/domain/chats/policies/chat-random.ts`（mulberry32。stop-events と混ぜる印を変えた `0x4348`）                                                                |
| domain  | `apps/api/src/domain/chats/policies/chat-writing-policy.ts`（`validateChatWriting`）                                                                                      |
| ports   | `apps/api/src/application/ports/gateways/chat-writer.gateway.ts`、`apps/api/src/application/ports/repositories/chat.repository.ts`                                        |
| usecase | `apps/api/src/application/usecases/chats/prepare-chat.usecase.ts`（`PrepareChatUseCase`）、`chat-material.ts`（DayPlan → 材料・光・Claude の材料）                        |
| infra   | `apps/api/src/infrastructure/gateways/claude-chat-writer.gateway.ts`、`prompts/chat-writing.ts`                                                                           |
| infra   | `apps/api/src/infrastructure/repositories/drizzle-chat.repository.ts`                                                                                                     |
| http    | `apps/api/src/infrastructure/http/routes/chat.routes.ts`（`app.post('/api/trips/:id/day/:n/chat', ...)`）、`schemas/chat.schema.ts`（パスと応答の zod）                   |
| test    | 各 `*.test.ts`（下の表）、`apps/api/tests/factories/chats.ts`（`openChatTestDb`・`ScriptedChatWriter`・`validChatWriting`）                                               |

共有ファイルへの追加: `infrastructure/http/app.ts`（`chats?: ChatRoutesDeps` と route 1 つ）、`di/container.ts`（`PrepareChatUseCase`。`writerSlots`・`roadCatalog`・`trips`・`CLAUDE_DAILY_CALL_LIMIT` を共有）、`http/error-mapper.ts`（ChatLimitError → 409 `CHAT_LIMIT`、ChatWriterError → 502 `WRITER_FAILED`）、`db/schema.ts`（`tripChats`）、`db/migrate.ts`（`trip_chats` ＋ 索引 `trip_chats_trip_id`、`SCHEMA_VERSION` 3、版のコメント）、`repositories/drizzle-record.repository.ts`（deleteTrip に `trip_chats` の 1 行）。

既存テストの追従: `src/di/container.test.ts`（表の一覧に `trip_chats`）、`src/application/usecases/record/record-usecases.test.ts`（UC-5a に `trip_chats` の行を足して消えることを確かめる）、`tests/vercel/handler.test.ts`（版 2 の直書きを `SCHEMA_VERSION` に）。

## 決めたこと（仕様に無かった・読み方を決めたこと）

1. **km の丸め**: 0.1 km（小数 1 桁）。配置の時点で丸めてから、ゾーン・1 km の間隔の判定を丸めた値でする（最後に丸めると間隔が崩れるため）。ゾーンの入口の手前は切り下げ、出口の先は切り上げ（丸めてもゾーンに入らない）
2. **±10% の揺らぎ**: 移動の距離の 10%（`TALK_JITTER_RATIO × distanceKm`）
3. **1 km 以内**: 差が 1 km ちょうども「以内」として作らない（`<= 1`）
4. **10 行の削り方**: 移動の順 → km の順に並べた話の行の先頭 10 行を残す（後ろの移動から、同じ移動なら遠い方から減る）。depart は数えない
5. **0.2 km より短い移動**: depart を移動の終わり（距離の地点）に置く
6. **depart を動かした先の判定**: 「出口が終わりの 1 km 手前より先」を、動かした先（出口 ＋ 0.2 km、切り上げ）が距離 − 1 km を超えるかで判定（出口だけで見るより少し厳しい）。動かした先が別のゾーンなら、その出口の先へ繰り返す
7. **割り当ての順**: 位置を全部決めて削って並べた後に、その順で id・話し手・話題を割り当てる（乱数は候補ごとに必ず 1 回引くので、同じ旅は同じ列）
8. **「楽しみが残っている」**: その行の移動（leg）より後に着く拠点の楽しみ（stop-events の pausesOf と同じ考え: 止まり場所 k > leg）。pleasure の話題には、しおりの順で最初に残っている楽しみ 1 つを付ける。出発地の楽しみ（D2 のタンチョウなど）は残っていない扱い
9. **光**: `LightOnRoad(leg, km, atMs)` を domain が受け、通過時刻（出発 ＋ km ÷ 距離 × 所要）は domain が計算。地点は application が `pointAtKm` → `lightPeriod`。light の行だけに付ける
10. **Claude の材料**: 楽しみは `name` だけ（`note` には「鹿が最も多い町」「9:00 / 14:00」が入るので渡さない）。地名は各行の移動の from / to（マスターの 4 言語）。数は人数と月だけ
11. **失敗の記憶（10 分）に入れる理由**: 中身の外れ（invalid・truncated・refused・malformed）だけ。時間切れ・上流の失敗・認証は覚えない（FAIL-41「もう一度送ると呼び直して 201」と R15「Claude が失敗した鍵は覚える」の食い違いを、FAIL-41 を優先して読んだ）。同時の枠（503）・1 日の上限（429）も覚えない。記憶は Clock の時刻で期限を見て、見るたびに期限切れを捨てる
12. **順序**: 保存済みの行を読む（200） → 失敗の記憶（502） → 空の束なら保存（旅ごとの上限を数えない） → 旅ごとの 30 束（409） → 枠（503） → 1 日の上限（429） → Claude
13. **数詞の禁止の範囲**（誤検出を避けた）:
    - 漢数字は 2 文字以上の連なり（`[〇零一二三四五六七八九十百千万萬億兆兩两]{2,}`）。「万一」「萬一」は外れる（許容）
    - 英語は 11 以上（eleven〜nineteen・twenty〜ninety）と位（hundred・thousand・million・billion・trillion・percent・dozen）。one〜ten は "no one" "the two of us" で普通に出るので通す
    - 韓国語は「数＋位」の形だけ（`[일삼사오육칠팔구][십백천만억]|이[십백천억]|[십백][만억]|천억`）。「사이」「천천히」「이만」「천만에요」は通す
    - 鹿の語は `鹿|シカ|deer|사슴`（deer は大文字小文字無視）。ひらがなの「しか」（助詞）は入れない
14. **長さ**: 60 文字はコードポイントで数える
15. **プロンプト**: `DEER_SAFETY_WRITING` は入れない（鹿の注意を書かせる部品なので R17 と矛盾）。max_tokens 4,000（上限の行数 × 4 言語 × 60 文字で切れないように）、モデル・思考・時間切れ 30 秒・再試行 1 回は loss の gateway と同じ
16. **応答**: `{ chat }` を明示して組み立てる（保存した行の鍵・作成時刻・材料の欄 pleasure / light を返さない）。保存済みを返すときは `Idempotent-Replayed: true`（stop-deck と同じ）。`data` は routes・zones の 2 欄（DayPlan.data の conditions は混ぜない）
17. **ログ**: `chat.created` / `chat.replayed` に旅・日・行の数・所要 ms。ほかに `chat.owner_required`・`chat.itinerary_changed`・`chat.trip_limit`・`chat.writer.busy`・`chat.daily_limit`・`chat.writer.invalid`（理由のコードだけ）・`chat.writer.remembered_failure`。本文・材料・トークンは出さない

## Test List の ID とテストの場所

| ID                   | 場所                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| AC-41                | `apps/api/src/infrastructure/http/routes/chat.routes.test.ts`（e2e）、usecase 側は `prepare-chat.usecase.test.ts` の UC-1 |
| PLAN-1a〜1g          | `apps/api/src/domain/chats/policies/chat-plan-policy.test.ts`                                                             |
| WRITE-2a・2b・2c・2g | `apps/api/src/domain/chats/policies/chat-writing-policy.test.ts`                                                          |
| WRITE-2d             | `prepare-chat.usecase.test.ts`（usecase が作る材料）、`claude-chat-writer.gateway.test.ts`（プロンプトの材料と system）   |
| WRITE-2e             | `apps/api/src/infrastructure/gateways/claude-chat-writer.gateway.test.ts`                                                 |
| WRITE-2f             | `prepare-chat.usecase.test.ts`（2 件）、`chat.routes.test.ts`（502）                                                      |
| SAVE-2a・2b・2c      | `prepare-chat.usecase.test.ts`、`chat.routes.test.ts`（SAVE-2c）                                                          |
| AUTH-41・42・44・45  | `prepare-chat.usecase.test.ts`、`chat.routes.test.ts`                                                                     |
| AUTH-43              | `chat.routes.test.ts`                                                                                                     |
| FAIL-41・43・45      | `prepare-chat.usecase.test.ts`（FAIL-45 は `chat.routes.test.ts` にも）                                                   |
| FAIL-42              | `prepare-chat.usecase.test.ts`、`chat.routes.test.ts`                                                                     |
| IDEM-41              | `prepare-chat.usecase.test.ts`（順の 2 回・同時の 2 要求）                                                                |
| CONC-41              | `prepare-chat.usecase.test.ts`（負け側は保存済みを返す）、`drizzle-chat.repository.test.ts`（INSERT が false）            |
| MIGR-41              | `apps/api/src/infrastructure/repositories/drizzle-chat.repository.test.ts`                                                |

エラーパターン（404 TRIP_NOT_FOUND・404 DAY_NOT_FOUND・400 INVALID_INPUT・413）と ITINERARY_CHANGED は usecase と route のテストにある。

## 残したこと

1. **sfad-drift の THREAT GAP**（docs/ なので触っていない）: 新しい `POST /api/trips/:id/day/:n/chat` が、brief-map・deploy-a・edge-capture・loss・plan-trip・record・stop-events の threat.md の操作列に無い（他の feature の threat.md は api の全 route を N/A 行で持つ形）。逆に drive-audio-chat の threat.md に、api の既存の route（GET /api/trips/:id/record・GET /t/:id・GET /t/:id/og.png・POST /api/captures・POST /api/trips/:id/events ほか）の行が足りない。BRIDGE GAP（sim の `chat/`・`audio/`）と STALE は sim 側・コミットの話
2. **Vercel（Turso）のマイグレーション**: `SCHEMA_VERSION` が 3 になったので、main に入れる前に production と preview に `npm run db:migrate` を流す（plan.md のとおり。流すまで Vercel の関数は 503）
3. **プロンプトの実機確認**: 本物の Claude ではまだ呼んでいない（テストはフェイク）。数詞・簡体字・鹿の語で外れる率は、実機で数回呼んで確かめたい（外れが多ければプロンプトか正規表現を直す）
4. 動作確認のサーバは立てていない（8812 番は使っていない）
