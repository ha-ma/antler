# layer-guard: drive-audio-chat の api（コミット 7589dd0）

エージェントに Write が無かったため、メインセッションが要約を写した。結論: **Critical 0 / Warning 2 / Info 5**。Clean Architecture の依存方向に準拠。

## Critical

なし（domain/chats は相対 import だけで外部・@antler/* を使わない。application に hono・drizzle・infrastructure が無い。UseCase に HTTP の知識なし。Route は検証・UseCase・201/200 だけ。services 層なし。例外の HTTP 変換は error-mapper だけ）。

## Warning

- W1 `prepare-chat.usecase.ts`: 所有者の照合（OwnerRequiredError・isOwnerTokenShape・isTripOwner）を `domain/stop-events/` から import している。所有者は trips 共通の概念なので、次に触るときに `domain/trips/` か共有の policy へ移す（今回は既存を編集しない方針なのでそのまま）
- W2 `prepare-chat.usecase.ts`: single-flight の Map と失敗の記憶（10 分）がインスタンスのメモリにある。1 プロセス前提（同時の枠と同じ）。複数インスタンスで動かすなら ports に出すか制約を明記する

## Info

- domain/chats → stop-events・trips の依存（LocalizedText・Light・TripError など純粋な型・定数・例外）は方向として妥当。逆向きは無い。将来 `domain/shared/` に切り出す余地
- 共有ファイルへの追加（app.ts・container.ts・db/schema.ts・migrate.ts・drizzle-record.repository.ts）は境界上問題なし
- `chat.routes.ts` の bodyLimit の 413 は既存の route と同じ形
- `chat.routes.ts` が `bearerToken` を `stop-deck.schema.ts` から import（schemas 間の横依存。共通の auth schema に移すと整理できる）
- application の `chat-material.ts` は domain の `models/chat-material.ts` と同名で紛らわしい（`chat-material-mapper.ts` などへの改名を検討）
