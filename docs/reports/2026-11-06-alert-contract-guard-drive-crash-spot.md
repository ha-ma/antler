# alert-contract-guard: drive-crash-spot（2026-11-06）

読み取り専用のエージェントの返答を、メインセッションが写した。**Critical 0 / Warning 2 / Info 2**

## Critical

なし。

- 車内スマホは `PhoneScreen.tsx` で `@antler/alert-ui` の `AlertState` をそのまま使う（props は state / distance / side / lang / compact / muted。AlertState.md どおり。複製・色の上書きなし）
- アラート OFF では描かない（`DrivePage.tsx` の `snapshot.alertEnabled &&`。A5-4）。`muted` は一時停止・終了・音トグル OFF で true
- `alert-danger` の使用は既存の ZonePanel の縁と DangerOverlay だけ（どれも検知の表示）。衝突の演出（`CrashOverlay.tsx`、`drive.css` の `.drive-crash*`）は `ink` と `ground` だけ。光は 1 回で点滅しない
- `packages/schema`・`packages/alert-ui` に差分なし。Capture・TripPlan・WebSocket に手が入っていない

## Warning

- W-1 `drive.css` の `.drive-phone__screen`: 180×360 の箱を scale(0.42〜0.6) で縮めるので、compact の 9px の文字が実効 3.8〜5.4px になる。数値と形が主なので契約違反ではないが、狭い画面では縮小率を上げるか文字を省くかを決めたい
- W-2 車内スマホは `pointer-events: none`。読み上げは AlertState 側（role）に任せている。縦の案内の間は inert が効く。OFF ではスマホが無いが読み上げも不要

## Info

- record API の後方互換: `spotting` は `run.ts` で `.optional()`。旧クライアント（欄なし）の送信は strictObject でも通る。保存済みの古い行も同じスキーマで読める。`totals.spotting` も optional
- 新クライアントを旧 API に送ると strictObject が `spotting` を未知のキーとして 400 にする。デプロイは api を先に（同じリポジトリから同時に出す運用なので実害は小さい。PR に書く）
