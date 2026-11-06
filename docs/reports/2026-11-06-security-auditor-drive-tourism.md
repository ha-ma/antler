# セキュリティ監査: drive-tourism (2026-11-06)

対象: コミット 3ef3eb3 と未コミットの差分（api の会話の束、sim の chat-api / ChatFeed / PhotoCaption / RecommendCard）。
結果: Critical 0 / Warning 2 / Info 3。

## Critical

なし。

## Warning

### W1 (CWE-20) 保存済みしおりの楽しみ id がマスターに無いとき、応答の pleasure に未知の slug がそのまま出る

- 場所: apps/api/src/domain/chats/policies/chat-plan-policy.ts（`pleasureCandidates` の m.stops、候補は id を検証せず採用）。apps/api/src/application/usecases/chats/chat-material.ts の `toChatMaterial` は `stops` を未フィルタで写す。`laterStopsOf` は `pleasureById` で絞っている。
- 経路: TripPlan の `days[].stops` は `Slug` の正規表現だけで受理される（packages/schema/src/trip-plan.ts:37）。所有者が自分の旅に任意の slug を入れられる。それが応答の `pleasure` に載る。
- 影響: 正規表現で縛られ、送り先は所有者本人。sim は zod でマスターに無い id を null にする（chat-api.ts）ので、任意パスの画像を読む経路は無い。`photoOf` は記録済み id の Map 引きだけで、`photoSrc` の file は `photos/<slug>.(jpg|png)` の正規表現で縛られる。実害は小さいが、AUTH-T1「pleasure はしおりの楽しみの id か null だけ」は api 単体では満たされない（検証は sim 側だけ）。
- 副作用: 未知 id の行は `pleasureBrief` が null を返し、Claude には pleasure の話題なのに材料が無い。品質低下であって安全上の問題ではない。
- 修正案: `toChatMaterial` で `stops` を `pleasureById(id) !== undefined` で絞る（`laterStopsOf` と同じ）。または `toDeck` / 保存の前に pleasure を `pleasureById` で確かめ、無ければ null にする。

### W2 (CWE-77 / LLM01) Claude に渡す材料の 4 言語の名前はマスター由来だが、型で自由入力が入らないことを守る仕組みが無い

- 場所: apps/api/src/application/usecases/chats/chat-material.ts の `toChatWritingBrief` / `pleasureBrief`、apps/api/src/infrastructure/gateways/claude-chat-writer.gateway.ts の `toPromptMaterial`。
- 現状: 利用者入力は材料に入っていない。入るのは `pleasureById(...).name`、`placeById(...).name`、固定の列挙値（timeOfDay / length / timing / angle / when / light）、月、天気・路面（DayPlan 由来）、`party.size` / `experience`。これらは `packages/trip` のマスターか列挙で、`note`（時刻・数を含む）は渡していない。現時点でプロンプトインジェクションの経路は確認できない。
- 懸念: 将来 TripPlan の自由入力（宿名・メモなど）を `Localized` として足すと、そのまま材料に入る。出力側は `validateChatWriting`（数字・鹿の語・言語）で縛られているので爆発半径は小さい。
- 修正案: 材料の型（`ChatWritingBrief`）を列挙値とマスター名だけにしたまま、テストで「材料の JSON に plan の自由入力が含まれない」ことを固定する。優先度は低い。

## Info

- I1 AUTH-T1 は実装どおり。`prepare-chat.usecase.ts` の合成は `pleasure: line.pleasure`（計画から）で、Claude の応答は `text` だけを使う。`chat.schema.ts` は strictObject で `pleasure` は slug の正規表現かつ nullable。body は読まない。
- I2 FAIL-T1 は実装どおり。`CHAT_KEY_VERSION = 'chat:v2'`（chat-rules.ts:37）。v1 の束は鍵が違うので読まれない。費用の面は spec どおり CHAT_LIMIT（30 束）と DAILY_LIMIT が守る。
- I3 XSS・URL・シークレット・個人情報は問題なし。
  - `dangerouslySetInnerHTML` / `innerHTML` / `href` は chat/・components/hud/ に無い。
  - 出典（撮影者・ライセンス）は React のテキストノードで出る。リンクにしない。
  - `img` の src は `BASE_URL + photo.file` で、file は同梱の記録（zod で検証、`photos/<slug>.(jpg|png)`）から作る。応答由来の文字列は URL に入らない。
  - `PhotoSchema` は `sourceUrl` を commons.wikimedia.org の https に限定し、ライセンスは CC0 / PD / CC BY だけ。
  - 追加コードにハードコードの鍵・トークンは無い。ログ（`drive.chat.*`）は理由の種類だけで、本文・ownerToken を出さない。
  - Claude に渡す材料に氏名・位置・時刻・金額は無い（`party.size` と `experience` のみ）。

## 総合

- リスクレベル: Low
- 推奨: W1 を直す。api 側で `stops` を `pleasureById` で絞るのが最小。W2 は材料に自由入力が入らないことを守るテストを足すとよい（任意）。コードは変更していない。
