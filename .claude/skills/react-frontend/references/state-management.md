# 状態管理

## 目次

- [状態の分類](#状態の分類)
- [TanStack Query (サーバー状態)](#tanstack-query-サーバー状態)
- [Context (グローバル UI 状態)](#context-グローバル-ui-状態)
- [Local State (コンポーネント状態)](#local-state-コンポーネント状態)
- [状態管理の判断フロー](#状態管理の判断フロー)

---

## 状態の分類

| 種類 | 定義 | 管理手法 | 例 |
|------|------|----------|-----|
| **サーバー状態** | API から取得するデータ | TanStack Query | ユーザー一覧、タスク情報 |
| **グローバル UI** | アプリ全体で共有する UI 状態 | Context | テーマ、認証状態、言語設定 |
| **ローカル** | コンポーネント固有の状態 | useState | フォーム入力、モーダル開閉 |
| **URL 状態** | URL に反映される状態 | Router | ページ、フィルター、検索条件 |

---

## TanStack Query (サーバー状態)

### 基本設定

```tsx
// main.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5分
      gcTime: 10 * 60 * 1000,   // 10分 (旧 cacheTime)
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

### Query Key 設計

```ts
// lib/api/query-keys.ts

// ファクトリパターン (推奨)
export const queryKeys = {
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    list: (filters?: UserFilters) =>
      [...queryKeys.users.lists(), filters] as const,
    details: () => [...queryKeys.users.all, 'detail'] as const,
    detail: (id: number) => [...queryKeys.users.details(), id] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    byUser: (userId: number) =>
      [...queryKeys.tasks.all, 'user', userId] as const,
    detail: (id: number) => [...queryKeys.tasks.all, 'detail', id] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    byUser: (userId: number) =>
      [...queryKeys.notifications.all, 'user', userId] as const,
  },
};
```

### キャッシュ無効化

```ts
export const useUserDelete = () => {
  const queryClient = useQueryClient();

  return useApiMutation<void, number>({
    url: (id) => `/api/users/${id}`,
    method: 'DELETE',
    onSuccess: (_, userId) => {
      // 特定ユーザーのキャッシュを削除
      queryClient.removeQueries({
        queryKey: queryKeys.users.detail(userId)
      });

      // 関連するタスクキャッシュも削除
      queryClient.removeQueries({
        queryKey: queryKeys.tasks.byUser(userId)
      });

      // 一覧を再取得
      queryClient.invalidateQueries({
        queryKey: queryKeys.users.lists()
      });
    },
  });
};
```

### プリフェッチ

```tsx
// ホバー時にプリフェッチ
const UserCard: React.FC<{ user: User }> = ({ user }) => {
  const queryClient = useQueryClient();

  const handleMouseEnter = () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.users.detail(user.id),
      queryFn: () => apiClient.get(`/api/users/${user.id}`),
      staleTime: 5 * 60 * 1000,
    });
  };

  return (
    <Link to={`/users/${user.id}`} onMouseEnter={handleMouseEnter}>
      <Card>{user.name}</Card>
    </Link>
  );
};
```

### 無限スクロール

```ts
export const useInfiniteUsers = () => {
  return useInfiniteQuery({
    queryKey: queryKeys.users.lists(),
    queryFn: ({ pageParam = 0 }) =>
      apiClient.get('/api/users', {
        offset: pageParam,
        limit: 20,
      }),
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.data.length < 20) return undefined;
      return allPages.length * 20;
    },
    initialPageParam: 0,
  });
};
```

---

## Context (グローバル UI 状態)

### 設計原則

```
✅ Context に向いているもの:
- テーマ (ダーク/ライト)
- 認証状態 (ログインユーザー)
- 言語設定
- サイドバー開閉状態

❌ Context に向いていないもの:
- API から取得するデータ → TanStack Query
- 頻繁に更新される値 → 再レンダリングが多発
- コンポーネント固有の状態 → useState
```

### Context + Hook パターン

```tsx
// components/context/AuthContext.tsx
import { createContext, useContext, useState, useCallback, PropsWithChildren } from 'react';

interface User {
  id: number;
  name: string;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<{ user: User; token: string }>(
      '/api/auth/login',
      { email, password },
    );
    setUser(response.user);
    localStorage.setItem('token', response.token);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('token');
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

### Context の分割

```tsx
// ❌ Bad: 巨大な Context
const AppContext = createContext({
  user: null,
  theme: 'light',
  locale: 'ja',
  sidebarOpen: true,
  // ... たくさんの状態
});

// ✅ Good: 責務ごとに分割
const AuthContext = createContext<AuthContextValue | null>(null);
const ThemeContext = createContext<ThemeContextValue | null>(null);
const LocaleContext = createContext<LocaleContextValue | null>(null);
const UIContext = createContext<UIContextValue | null>(null);

// Provider の組み合わせ
const AppProviders: React.FC<PropsWithChildren> = ({ children }) => (
  <AuthProvider>
    <ThemeProvider>
      <LocaleProvider>
        <UIProvider>
          {children}
        </UIProvider>
      </LocaleProvider>
    </ThemeProvider>
  </AuthProvider>
);
```

### パフォーマンス最適化

```tsx
// 状態と更新関数を分離
const ThemeStateContext = createContext<Theme>('light');
const ThemeDispatchContext = createContext<(theme: Theme) => void>(() => {});

export const ThemeProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('light');

  return (
    <ThemeStateContext.Provider value={theme}>
      <ThemeDispatchContext.Provider value={setTheme}>
        {children}
      </ThemeDispatchContext.Provider>
    </ThemeStateContext.Provider>
  );
};

// 状態のみ必要なコンポーネント (更新時の再レンダリングなし)
export const useTheme = () => useContext(ThemeStateContext);

// 更新のみ必要なコンポーネント (状態変更時の再レンダリングなし)
export const useSetTheme = () => useContext(ThemeDispatchContext);
```

---

## Local State (コンポーネント状態)

### useState

```tsx
// 単純な値
const [count, setCount] = useState(0);
const [name, setName] = useState('');

// オブジェクト
const [form, setForm] = useState({ name: '', email: '' });
setForm((prev) => ({ ...prev, name: 'New Name' }));

// 初期値が高コストな場合
const [data, setData] = useState(() => expensiveComputation());
```

### useReducer

```tsx
// 複雑な状態には useReducer
type FormAction =
  | { type: 'SET_VALUE'; field: string; value: string }
  | { type: 'SET_ERROR'; field: string; error: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_END' }
  | { type: 'RESET' };

const formReducer = (state: FormState, action: FormAction): FormState => {
  switch (action.type) {
    case 'SET_VALUE':
      return {
        ...state,
        values: { ...state.values, [action.field]: action.value },
        errors: { ...state.errors, [action.field]: undefined },
      };
    case 'SUBMIT_START':
      return { ...state, isSubmitting: true };
    case 'SUBMIT_END':
      return { ...state, isSubmitting: false };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
};
```

### 派生状態

```tsx
// ❌ Bad: 状態を複製
const [items, setItems] = useState<Item[]>([]);
const [filteredItems, setFilteredItems] = useState<Item[]>([]);
useEffect(() => {
  setFilteredItems(items.filter((i) => i.active));
}, [items]);

// ✅ Good: useMemo で派生
const [items, setItems] = useState<Item[]>([]);
const filteredItems = useMemo(
  () => items.filter((i) => i.active),
  [items]
);
```

---

## 状態管理の判断フロー

```
新しい状態を追加する場合:

1. API から取得するデータか？
   → TanStack Query を使用

2. 複数のコンポーネントで共有する UI 状態か？
   → Context を検討
   → ただし Props で渡せるなら Props を優先

3. URL に反映すべき状態か？
   → URL パラメータ / クエリストリングを使用

4. 上記以外
   → useState / useReducer
```

### 状態のリフトアップ

```tsx
// ❌ Bad: 同じ状態を複数コンポーネントで管理
const ComponentA = () => {
  const [selectedId, setSelectedId] = useState(null);
};
const ComponentB = () => {
  const [selectedId, setSelectedId] = useState(null);
};

// ✅ Good: 共通の親にリフトアップ
const Parent = () => {
  const [selectedId, setSelectedId] = useState(null);
  return (
    <>
      <ComponentA selectedId={selectedId} onSelect={setSelectedId} />
      <ComponentB selectedId={selectedId} />
    </>
  );
};
```

---

## 関連ドキュメント

- **[フックパターン](hooks-patterns.md)** - useApiQuery の詳細
- **[レイヤ別ルール](layers.md)** - Context の配置
- **[型安全](type-safety.md)** - 状態の型定義
