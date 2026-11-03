# MUST（最重要 — 全操作で守ること）

- データ取得は TanStack Query を使う（useState+useEffect+fetchではなく）
- Zustand create() は src/features/{name}/store.ts のみ（enforced by hook）
- feature間のimportは barrel file (index.ts) 経由のみ（enforced by hook）
- 新しいstateを追加する前に State設計を宣言する
- `Bash` や Python スクリプトで `src/**/*.ts(x)` を生成・上書きしない。コード作成は `Write` / `Edit` / `MultiEdit` 経由にして Hook に検査させる

# Stack

- Server state: TanStack Query
- Client state: Zustand (feature単位store)
- Form: React Hook Form + zod
- Local UI: useState (3個まで/コンポーネント)
- Lint: ESLint + boundaries + zustand-rules + react-you-might-not-need-an-effect
- Pre-commit: husky + lint-staged

# Architecture

- Feature-based: src/features/{name}/ (components, hooks, store.ts, types.ts, index.ts)
- 依存方向: app → features → shared（逆方向禁止）

@.claude/rules/state-management.md
@.claude/rules/react-architecture.md

# Commands

- `npm run lint` — ESLint実行
- `npm run typecheck` — tsc --noEmit
- `npm test` — テスト実行

# REMINDER（末尾 — recency bias）

- useEffectを書く前に代替を確認: TanStack Query, useMemo, event handler, key prop
- 新featureは State設計を宣言してから実装
- store.ts 以外で Zustand を import しない
