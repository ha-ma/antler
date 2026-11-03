# フックパターン

## 目次

- [基本原則](#基本原則)
- [useApiQuery パターン](#useapiquery-パターン)
- [useApiMutation パターン](#useapimutation-パターン)
- [API クライアント (fetch ベース)](#api-クライアント-fetch-ベース)
- [カスタムフック設計](#カスタムフック設計)
- [依存配列のベストプラクティス](#依存配列のベストプラクティス)
- [クリーンアップパターン](#クリーンアップパターン)

---

## 基本原則

### 1フック1関心

```tsx
// ✅ Good: 単一責任
export const useUsers = () => { /* ユーザー取得のみ */ };
export const useUserCreate = () => { /* ユーザー作成のみ */ };
export const useUserDelete = () => { /* ユーザー削除のみ */ };

// ❌ Bad: 複数の関心事
export const useUsersAll = () => {
  // 取得も、作成も、削除も、更新も...
};
```

### 命名規則

| パターン | 命名 | 例 |
|----------|------|-----|
| データ取得 | `use<Resource>` | `useUsers`, `useUser` |
| データ変更 | `use<Resource><Action>` | `useUserCreate`, `useUserDelete` |
| UI ロジック | `use<Behavior>` | `useToggle`, `useDebounce` |
| Feature 専用 | `use<Feature>` | `useTaskBoard`, `useDashboard` |

---

## useApiQuery パターン

### 基本使用法

```ts
// hooks/use-users.ts
import { useApiQuery } from '@/lib/api/use-api-query';
import type { User } from '@/types/user';

// 一覧取得
export const useUsers = () => {
  return useApiQuery<User[]>({
    queryKey: ['users'],
    url: '/api/users',
  });
};

// 単一取得
export const useUser = (userId: number) => {
  return useApiQuery<User>({
    queryKey: ['users', userId],
    url: `/api/users/${userId}`,
    enabled: userId > 0,
  });
};

// フィルタリング
export const useUsersByRole = (role: UserRole) => {
  return useApiQuery<User[]>({
    queryKey: ['users', { role }],
    url: '/api/users',
    params: { role },
  });
};
```

### コンポーネントでの使用

```tsx
const UserList: React.FC = () => {
  const { data: users, isLoading, error, refetch } = useUsers();

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;
  if (!users?.length) return <Empty description="ユーザーがいません" />;

  return (
    <List
      dataSource={users}
      renderItem={(user) => <UserCard user={user} />}
    />
  );
};
```

### Query Key 戦略

```ts
// Query Key ファクトリパターン (推奨)
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: number) => [...userKeys.details(), id] as const,
  tasks: (id: number) => [...userKeys.detail(id), 'tasks'] as const,
};
```

---

## useApiMutation パターン

### 基本使用法

```ts
// hooks/use-user-mutations.ts
import { useApiMutation } from '@/lib/api/use-api-mutation';
import { useQueryClient } from '@tanstack/react-query';

// 作成
export const useUserCreate = () => {
  const queryClient = useQueryClient();

  return useApiMutation<User, CreateUserRequest>({
    url: '/api/users',
    method: 'POST',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
};

// 更新
export const useUserUpdate = (userId: number) => {
  const queryClient = useQueryClient();

  return useApiMutation<User, UpdateUserRequest>({
    url: `/api/users/${userId}`,
    method: 'PATCH',
    onSuccess: (data) => {
      queryClient.setQueryData(['users', userId], data);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
};

// 削除
export const useUserDelete = () => {
  const queryClient = useQueryClient();

  return useApiMutation<void, number>({
    url: (userId) => `/api/users/${userId}`,
    method: 'DELETE',
    onSuccess: (_, userId) => {
      queryClient.removeQueries({ queryKey: ['users', userId] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
};
```

### Optimistic Updates

```ts
export const useUserStatusUpdate = (userId: number) => {
  const queryClient = useQueryClient();

  return useApiMutation<User, { status: UserStatus }>({
    url: `/api/users/${userId}/status`,
    method: 'PATCH',
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ['users', userId] });
      const previous = queryClient.getQueryData<User>(['users', userId]);

      queryClient.setQueryData<User>(['users', userId], (old) => ({
        ...old!,
        status: newData.status,
      }));

      return { previous };
    },
    onError: (_err, _newData, context) => {
      queryClient.setQueryData(['users', userId], context?.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users', userId] });
    },
  });
};
```

---

## API クライアント (fetch ベース)

### 薄いラッパー

```ts
// lib/api/client.ts
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data: unknown,
  ) {
    super(`${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

const getHeaders = (): HeadersInit => {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const handleResponse = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, res.statusText, data);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
};

export const apiClient = {
  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      });
    }
    const query = searchParams.toString() ? `?${searchParams}` : '';
    const res = await fetch(`${BASE_URL}${url}${query}`, {
      headers: getHeaders(),
    });
    return handleResponse<T>(res);
  },

  async post<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${url}`, {
      method: 'POST',
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async patch<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${url}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  async delete<T>(url: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${url}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<T>(res);
  },
};
```

### useApiQuery ラッパー

```ts
// lib/api/use-api-query.ts
import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { apiClient } from './client';

interface ApiQueryOptions<T> extends Omit<UseQueryOptions<T>, 'queryFn'> {
  url: string;
  params?: Record<string, unknown>;
}

export const useApiQuery = <T>(options: ApiQueryOptions<T>) => {
  const { url, params, ...queryOptions } = options;

  return useQuery<T>({
    queryFn: () => apiClient.get<T>(url, params),
    ...queryOptions,
  });
};
```

### useApiMutation ラッパー

```ts
// lib/api/use-api-mutation.ts
import { useMutation, UseMutationOptions } from '@tanstack/react-query';
import { apiClient } from './client';

interface ApiMutationOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, Error, TVariables>, 'mutationFn'> {
  url: string | ((variables: TVariables) => string);
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
}

export const useApiMutation = <TData, TVariables>(
  options: ApiMutationOptions<TData, TVariables>,
) => {
  const { url, method, ...mutationOptions } = options;

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables) => {
      const resolvedUrl = typeof url === 'function' ? url(variables) : url;

      switch (method) {
        case 'POST':
          return apiClient.post<TData>(resolvedUrl, variables);
        case 'PATCH':
          return apiClient.patch<TData>(resolvedUrl, variables);
        case 'DELETE':
          return apiClient.delete<TData>(resolvedUrl);
        default:
          throw new Error(`Unsupported method: ${method}`);
      }
    },
    ...mutationOptions,
  });
};
```

> **Axios からの移行**: 既存プロジェクトで Axios を使用している場合、`apiClient` の内部実装のみ差し替えれば、`useApiQuery`/`useApiMutation` の使用箇所は変更不要。

---

## カスタムフック設計

### UI ロジックフック

```ts
export const useToggle = (initialValue = false) => {
  const [value, setValue] = useState(initialValue);

  const toggle = useCallback(() => setValue((v) => !v), []);
  const setTrue = useCallback(() => setValue(true), []);
  const setFalse = useCallback(() => setValue(false), []);

  return { value, toggle, setTrue, setFalse };
};
```

### Feature 専用フック

```ts
// features/task-board/hooks.ts
export const useTaskBoard = (projectId: number) => {
  const { data: tasks } = useTasks(projectId);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const { mutate: moveTask, isPending } = useTaskMove(projectId);

  const selectedTask = useMemo(
    () => tasks?.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  const selectTask = useCallback((taskId: number) => {
    setSelectedTaskId(taskId);
  }, []);

  return {
    tasks,
    selectedTask,
    isMoving: isPending,
    selectTask,
    moveTask,
  };
};
```

### 複合フック

```ts
export const usePagination = (options: { defaultPageSize?: number } = {}) => {
  const { defaultPageSize = 20 } = options;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const offset = useMemo(() => (page - 1) * pageSize, [page, pageSize]);

  const reset = useCallback(() => setPage(1), []);

  const goToPage = useCallback((newPage: number) => {
    setPage(Math.max(1, newPage));
  }, []);

  const changePageSize = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  }, []);

  return {
    page, pageSize, offset,
    setPage: goToPage, setPageSize: changePageSize, reset,
    pagination: {
      current: page,
      pageSize,
      onChange: goToPage,
      onShowSizeChange: (_: number, size: number) => changePageSize(size),
    },
  };
};
```

---

## 依存配列のベストプラクティス

```tsx
// ✅ Good: 使用する値をすべて含める
useEffect(() => {
  fetchData(userId, status);
}, [userId, status]);

// ❌ Bad: 依存を省略
useEffect(() => {
  fetchData(userId, status);
}, [userId]); // status が抜けている

// ✅ Good: 関数は useCallback で安定化
const handleClick = useCallback(() => {
  doSomething(value);
}, [value]);

// ✅ Good: 必要なプロパティのみ依存
const { title } = config;
useEffect(() => {
  updateTitle(title);
}, [title]);
```

---

## クリーンアップパターン

### イベントリスナー

```tsx
useEffect(() => {
  const handleResize = () => setWidth(window.innerWidth);
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

### AbortController (fetch)

```tsx
useEffect(() => {
  const controller = new AbortController();

  const fetchData = async () => {
    try {
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      setData(data);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setError(error);
    }
  };

  fetchData();
  return () => controller.abort();
}, [url]);
```

> **Note**: TanStack Query を使っている場合、AbortController は自動的にハンドルされるため手動管理不要。

---

## 関連ドキュメント

- **[状態管理](state-management.md)** - TanStack Query 詳細
- **[カスタムフック例](../examples/custom-hook.ts)** - 完全な実装例
- **[コンポーネントパターン](component-patterns.md)** - フック抽出戦略
