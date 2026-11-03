---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
description: "React/RNディレクトリ・import規約 - feature-basedアーキテクチャ"
---

# MUST: アーキテクチャの絶対ルール

- feature間のimportは barrel file (index.ts) 経由のみ
- Zustand store は `src/features/{name}/store.ts` にだけ配置
- shared → feature への import 禁止（依存方向が逆）
- feature → app への import 禁止
- 1ファイル1コンポーネント、named export のみ（default export禁止。ルーティングの lazy 用に `src/app/` のみ例外可）
- `Bash` や Python スクリプトで `src/**/*.ts(x)` を生成・上書きしない。コード作成は `Write` / `Edit` / `MultiEdit` 経由で Hook に検査させる

# Path-Specific Rules

Claude must apply the matching layer rule before creating or editing a file in
these locations.

- `src/features/*/components/**` -> `react-components-rules.md`
- `src/features/*/hooks/**` -> `react-hooks-rules.md`
- `src/features/*/store.ts` -> `react-store-rules.md`
- `src/features/*/index.ts`, `src/features/*/types.ts` -> `react-feature-api-rules.md`
- `src/shared/**` -> `react-shared-rules.md`
- `src/app/**` -> `react-app-rules.md`

# ディレクトリ構造（feature-based）

```
src/
  features/{name}/
    components/     ← UIコンポーネント（useStateはここだけ）
    hooks/          ← TanStack Query/データ取得カスタムhook
    store.ts        ← Zustand store（このファイルだけ）
    types.ts        ← feature固有の型定義
    index.ts        ← 公開API（barrel file）
  shared/
    components/     ← 汎用UI（Button, Modal等）
    hooks/          ← 汎用hooks（useDebounce等）
    utils/          ← 汎用ユーティリティ
  app/              ← ルーティング、プロバイダ、レイアウト
```

# Import 規約

## 依存方向（守ること）

```
app → features → shared
       ↑ barrel経由のみ
```

- feature → shared: OK
- feature → 他feature（barrel経由）: OK
- feature → 他feature（内部ファイル直接）: **禁止**
- shared → feature: **禁止**
- feature → app: **禁止**

## barrel file (index.ts)

```typescript
// src/features/auth/index.ts — 公開APIだけexport
export { LoginForm } from './components/LoginForm'
export { useAuth } from './hooks/useAuth'
export type { User, AuthState } from './types'
// 内部コンポーネントやstoreはexportしない
```

# ファイル配置ルール

| 種類 | ルール |
|------|--------|
| コンポーネント | PascalCase、1ファイル1つ、テストは `ComponentName.test.tsx` |
| hooks | `use` prefix必須、TanStack Query hookは `hooks/` に配置 |
| store | feature毎に1つの `store.ts`。複数必要ならfeatureを分割 |
| アクション名 | 動詞始まり: `setCount`, `resetFilters`, `toggleModal` |

# 新規feature作成チェックリスト

1. `src/features/{name}/` ディレクトリ作成
2. `types.ts` で型定義
3. `store.ts` でZustand store（必要な場合のみ）
4. `hooks/` でデータ取得hook
5. `components/` でUIコンポーネント
6. `index.ts` で公開API定義
7. 他featureからの直接importがないか確認

# REMINDER

- feature間のimportは必ず index.ts 経由
- 新しいfeatureを作る時は上のチェックリストを使う
- storeは各featureに1つだけ
