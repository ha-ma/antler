# component-guard レビュー: apps/sim/src/features/loss（A-6 喪失）

日付: 2026-11-04 / ブランチ: claude/loss-1adb87 / 対象: `git diff main...HEAD -- apps/sim`
規約: apps/sim/CLAUDE.md、.claude/rules/react-architecture.md・react-components-rules.md・react-hooks-rules.md

結果: Critical 0 / Warning 3 / Info 5

## 合格した項目

- components/ にデータ取得なし。fetch は hooks/useLossTripDay.ts・useLossStory.ts のみで、どちらも `useQuery`（Query キー付き）。
- useEffect は 0 件。見出しのフォーカスは module スコープの ref コールバック `focusOnMount` で、参照が安定していて再実行されない。
- useState は 0 件（上限 3）。`zustand` の import と `create()` は 0 件。`any` は 0 件。
- feature 境界: 外から `@/features/loss` を import しているのは `apps/sim/src/app/routes.tsx` だけで、barrel 経由。loss から他 feature・`src/app/` への import なし。
  - barrel の公開は `LossPage` / `lossHref` / `CollisionReport` 型の 3 つだけ。
  - `@/shared/utils/logger` への依存は feature → shared で正しい向き。
- State 設計の宣言: `types.ts` 冒頭にあり。URL の状態、サーバーの状態（Query）、派生、Zustand/useState 不使用の理由まで書いてある。実装と一致。
- Props drilling: LossPage → LossContent → StoryPanel / LossCard / StatsCard の 2 段までで、3 段以上の受け渡しなし。
- TanStack Query の使い方:
  - `enabled` で URL 不正時は fetch しない。
  - 喪失文の POST は内容で冪等なので `useQuery`（retry:false、refetchOnWindowFocus/Reconnect:false、staleTime:Infinity）。理由コメントあり。
  - Query キーに `tripId`・`day`・`leg`・`at`・`alertEnabled`・`achievedStops`（sort 済み）を含め、`queryFn` が送る値と整合している。
  - しおりの再試行は 5xx と通信失敗の 1 回だけ。AbortSignal とタイムアウトも付いている。

## Warning

1. 1 ファイル 1 コンポーネント違反（react-architecture.md の MUST）
   - `components/LossPage.tsx`: `LossPage` / `LossStatus` / `LossContent` の 3 つ。
   - `components/LossCard.tsx`: `LossCard` / `CheckMark` / `CrossMark` / 関数 `rowText`。
   - 直し方: `LossStatus.tsx`・`LossContent.tsx`・`CheckMark.tsx`・`CrossMark.tsx`（または 1 つの `ResultMark`）に分ける。`LossContent` は約 100 行の JSX なので、4 指標の `<dl>` を `MetricTiles.tsx` に切り出すとよい。
2. ロジックが components/ に残っている（hooks への分離、CLAUDE.md の MUST「ロジック分離」）
   - `LossPage.tsx:46-53`: Query のエラーを `LossStatus` の kind へ対応づける分岐（`DAY_NOT_FOUND`・404・409・その他）をコンポーネントが持つ。
   - `LossPage.tsx:92-104`: `strikeItinerary` / `assessLoss` / eyebrow の組み立てが描画の中にある。
   - 直し方: `hooks/useLossView.ts`（仮）に「`useCollision` → `useLossTripDay` → 検証 → `{ status } | { content }`」を畳む。エラー対応は純粋関数 `statusKindOf(error)` にしてテストする。
3. `StoryPanel.tsx:15-17` の `limited` 判定（`DAILY_LIMIT` / `LOSS_LIMIT` の分類）が components/ にある。
   - 直し方: `useLossStory` から `isLimited` を返す、または `hooks/` に `isStoryLimited(error)` を置く。`LossStoryError` の import がコンポーネントから消える。

## Info

1. `hooks/api.ts` は `use` で始まらず、hooks でもない（`apiBase` / `errorCode`）。hooks/ には `use*` だけを置く規約なので、`utils/api.ts` に移すのが望ましい。
2. `useLossTripDay.ts` は brief-map の `useTripDay` とほぼ同じ取得処理（コメントに理由あり）。重複が 3 つ目になるなら brief-map の barrel に `useTripDay` を公開するか、shared/ に昇格する。
3. `useLossStory(collision, true)`（`StoryPanel.tsx:13`）は `enabled` が常に true。呼び出し側で検証済みを保証しているので、引数を外すか、将来使わないならコメントを直す。
4. `useCollision` は毎回 `parseCollision` を呼び新しいオブジェクトを返す。Query キーは値ベースなので実害はないが、`useMemo([id, search])` で参照を安定させるとよい。
5. `LossPage.tsx:20` の `const BASELINE: LossBaseline = baseline`（JSON の型付け）は `types.ts` / `data/` 側で済ませたほうがコンポーネントが薄くなる。また `domain/`・`data/`・`text.ts` は規約の標準構成（components/ hooks/ store.ts types.ts index.ts）の外だが、純粋関数と文言の置き場として妥当で、依存方向は崩れていない。

## 指摘なし（確認済み）

- `drive` から `lossHref` を呼ぶ側は、このブランチではまだ無い（drive-link で追加予定）。その feature 側は barrel 経由で import すること。
