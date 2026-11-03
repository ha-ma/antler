# 命名規則

## 目次

- [ファイル名](#ファイル名)
- [コンポーネント名](#コンポーネント名)
- [変数・関数名](#変数関数名)
- [型名](#型名)
- [CSS クラス名](#css-クラス名)
- [インポート順序](#インポート順序)
- [テスト規則](#テスト規則)

---

## ファイル名

| 種別 | 規則 | 例 |
|------|------|-----|
| Feature ディレクトリ | kebab-case | `user-profile/`, `task-board/` |
| UI コンポーネント | PascalCase | `Button/`, `Modal/`, `DataTable/` |
| フック | kebab-case, `use-` prefix | `use-users.ts`, `use-debounce.ts` |
| 型定義 | kebab-case, `.d.ts` | `user.d.ts`, `task.d.ts` |
| ユーティリティ | kebab-case | `format.ts`, `validation.ts` |
| テスト | 対象名 + `.test` | `Button.test.tsx`, `use-users.test.ts` |

---

## コンポーネント名

```tsx
// PascalCase
export const UserProfile: React.FC<Props> = (props) => { /* ... */ };
export const TaskCard: React.FC<Props> = (props) => { /* ... */ };

// Container コンポーネント
export const UserListContainer: React.FC = () => { /* ... */ };

// Presentational コンポーネント (View suffix 任意)
export const UserListView: React.FC<ViewProps> = (props) => { /* ... */ };
```

### Props 型: コンポーネント名 + Props

```tsx
// ✅ Good
interface UserCardProps {
  user: User;
  onSelect: (userId: number) => void;
}

export const UserCard: React.FC<UserCardProps> = ({ ... }) => { ... };

// ❌ Bad
interface Props { ... }  // 汎用的すぎる
interface IUserCardProps { ... }  // I プレフィックス不要
```

### コールバック Props: on + 動詞

```tsx
// ✅ Good
interface Props {
  onClick: () => void;
  onSubmit: (data: FormValues) => void;
  onChange: (value: string) => void;
}

// ❌ Bad
interface Props {
  clickHandler: () => void;  // Handler サフィックス
  submitCallback: () => void; // Callback サフィックス
}
```

---

## 変数・関数名

```tsx
// camelCase
const isLoading = true;
const userCount = 0;
const handleSubmit = () => {};

// フック: use + PascalCase
const useUserProfile = () => {};
const useDebounce = () => {};

// イベントハンドラ: handle + 動詞
const handleClick = () => {};
const handleSubmit = () => {};
const handleDelete = () => {};

// boolean: is/has/can/should prefix
const isVisible = true;
const hasPermission = false;
const canEdit = true;
const shouldRefresh = false;

// 定数: UPPER_SNAKE_CASE
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const API_BASE_URL = import.meta.env.VITE_API_URL;
const DEFAULT_PAGE_SIZE = 20;
```

---

## 型名

```tsx
// インターフェース / Type: PascalCase
interface UserProfile { /* ... */ }
type TaskStatus = 'todo' | 'in_progress' | 'done';

// Props: <Component>Props
interface UserCardProps { /* ... */ }

// Request: <Action><Resource>Request
interface CreateUserRequest { /* ... */ }
interface UpdateTaskRequest { /* ... */ }

// Response: <Resource>ListResponse
interface UserListResponse { /* ... */ }

// Filters: <Resource>Filters
interface UserFilters { /* ... */ }

// Discriminated Union: status/type フィールド
type LoadingState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: T };

// Generic: T prefix
interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}
```

---

## CSS クラス名

```css
/* CSS Modules: camelCase */
.container { }
.headerTitle { }
.actionButton { }

/* 状態: is- prefix */
.isActive { }
.isDisabled { }
.isSelected { }

/* バリアント */
.button { }
.buttonPrimary { }
.buttonDanger { }
```

---

## インポート順序

```tsx
// 1. React / 外部ライブラリ
import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

// 2. 内部モジュール (@/ エイリアス)
import { useApiQuery } from '@/lib/api/use-api-query';
import { useAuth } from '@/components/context/AuthContext';
import { Button } from '@/components/ui/Button';
import type { User } from '@/types/user';

// 3. 相対パス (同一 Feature 内)
import { ProfileCard } from './components/ProfileCard';
import { useUserProfile } from './hooks';

// 4. スタイル
import styles from './index.module.css';
```

各グループ間は空行で区切る。

---

## テスト規則

### テストファイル配置

```
# 推奨: コンポーネントと同じ場所
components/ui/Button/
├── index.tsx
├── Button.test.tsx
└── index.module.css
```

### テスト命名

```tsx
describe('UserCard', () => {
  it('renders user name', () => {});
  it('calls onSelect when clicked', () => {});
  it('shows loading state', () => {});
});
```

### コメント規約

```tsx
// ✅ Good: 公開フックには JSDoc
/**
 * ユーザー一覧を取得するフック
 * @param filters - フィルター条件
 */
export const useUsers = (filters?: UserFilters) => { ... };

// ✅ Good: 理由を説明するコメント
// API の仕様上、終了時刻は開始時刻より1秒後である必要がある
const endTime = startTime + 1000;

// ❌ Bad: 自明なコメント
// ユーザー名を取得
const userName = user.name;

// ✅ Good: TODO に課題番号
// TODO(#123): キャッシュ戦略を見直す
```

---

## 関連ドキュメント

- **[ディレクトリ構成](directory.md)** - ファイル配置ルール
- **[型安全](type-safety.md)** - TypeScript パターン
- **[アンチパターン](anti-patterns.md)** - 避けるべきこと
