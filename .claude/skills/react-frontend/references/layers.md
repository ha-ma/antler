# レイヤ別ルール

## 目次

- [pages/ (ページ層)](#pages-ページ層)
- [components/features/ (Feature 層)](#componentsfeatures-feature-層)
- [components/ui/ (UI 層)](#componentsui-ui-層)
- [hooks/ (フック層)](#hooks-フック層)
- [types/ (型定義層)](#types-型定義層)
- [components/context/ (Context 層)](#componentscontext-context-層)
- [lib/api/ (API クライアント層)](#libapi-api-クライアント層)

---

## pages/ (ページ層)

**OK**:
- ルーティングに対応するページコンポーネント
- Feature コンポーネントの配置
- レイアウトの適用
- ページレベルのメタ情報設定

**NG**:
- ビジネスロジックの実装
- 直接の API 呼び出し
- 状態管理ロジック
- 複雑な UI レンダリング

```tsx
// ✅ Good: pages/users/[userId]/index.tsx
export default function UserPage() {
  const { userId } = useParams();
  return (
    <MainLayout>
      <UserProfile userId={Number(userId)} />
    </MainLayout>
  );
}

// ❌ Bad: ビジネスロジックを含む
export default function UserPage() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch(`/api/users/${userId}`).then(...); // NG: 直接 fetch
  }, []);
  // 長大な JSX...
}
```

---

## components/features/ (Feature 層)

**OK**:
- ビジネスロジックの実装
- カスタムフックによる状態管理
- API 呼び出し（useApiQuery 経由）
- 複数の UI コンポーネントの組み合わせ
- エラー・ローディング状態のハンドリング

**NG**:
- 300行を超えるコンポーネント
- 直接の fetch 呼び出し（useApiQuery を経由する）
- グローバル状態の直接操作（Context 経由で行う）

```tsx
// ✅ Good: 分割された Feature コンポーネント
// components/features/task-board/index.tsx (Container)
export const TaskBoard: React.FC<Props> = ({ projectId }) => {
  const { tasks, moveTask } = useTaskBoard(projectId);
  const { filter, setFilter } = useTaskFilter();

  return (
    <div className={styles.container}>
      <TaskFilter filter={filter} onChange={setFilter} />
      <TaskColumns tasks={tasks} onMove={moveTask} />
    </div>
  );
};

// ❌ Bad: 巨大な単一コンポーネント
export const TaskBoard = () => {
  // 50+ useState
  // 20+ useEffect
  // 2000行の JSX...
};
```

---

## components/ui/ (UI 層)

**OK**:
- Props のみに依存する純粋コンポーネント
- UI ライブラリのラッパーコンポーネント
- 汎用的なスタイリング
- アクセシビリティ対応

**NG**:
- API 呼び出し
- ビジネスロジック
- グローバル状態への依存
- useEffect による副作用

```tsx
// ✅ Good: 純粋な UI コンポーネント
interface StatusBadgeProps {
  status: 'active' | 'inactive' | 'pending';
  label?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
}) => (
  <span className={`${styles.badge} ${styles[status]}`}>
    {label ?? status}
  </span>
);

// ❌ Bad: API 呼び出しを含む
export const UserCard: React.FC<{ userId: number }> = ({ userId }) => {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetchUser(userId).then(setUser); // NG: UI 層で API 呼び出し
  }, [userId]);
  // ...
};
```

---

## hooks/ (フック層)

**OK**:
- TanStack Query を使った API フック
- 再利用可能なロジック抽出
- 1フック1関心の原則
- 型安全な戻り値

**NG**:
- 複数の関心事を持つフック
- コンポーネント固有のロジック（→ features 内に配置）
- 直接の fetch 呼び出し（→ useApiQuery を使う）

```ts
// ✅ Good: 単一責任のフック
// hooks/use-users.ts
export const useUsers = (filters?: UserFilters) => {
  return useApiQuery<UserListResponse>({
    queryKey: ['users', filters],
    url: '/api/users',
    params: filters,
  });
};

export const useUser = (userId: number) => {
  return useApiQuery<User>({
    queryKey: ['users', userId],
    url: `/api/users/${userId}`,
    enabled: userId > 0,
  });
};

// ❌ Bad: 複数の関心事
export const useUserAndTasks = (userId: number) => {
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  // 複数の API 呼び出しを管理...
};
```

---

## types/ (型定義層)

**OK**:
- API レスポンス型
- ドメインモデル型
- 共通ユーティリティ型
- Discriminated Unions

**NG**:
- `any` 型の使用
- 実装コード
- ビジネスロジック

```ts
// ✅ Good: 型定義ファイル
// types/task.d.ts
export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: number | null;
  createdAt: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

// Discriminated Union for state
export type TaskState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: Task };

// ❌ Bad: any を使用
export interface TaskData {
  items: any[]; // NG
  result: any;  // NG
}
```

---

## components/context/ (Context 層)

**OK**:
- アプリ全体で共有する UI 状態
- テーマ、認証、言語設定など
- Provider + Hook のセット提供

**NG**:
- サーバー状態の管理（→ TanStack Query）
- コンポーネント固有の状態
- 過度なネスト

```tsx
// ✅ Good: Context + Hook パターン
// context/AuthContext.tsx
interface AuthContextValue {
  user: User | null;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  // ...
  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// ❌ Bad: サーバー状態を Context で管理
const UsersContext = createContext<User[]>([]); // NG: TanStack Query を使うべき
```

---

## lib/api/ (API クライアント層)

**OK**:
- fetch ベースの API クライアント
- 共通エラーハンドリング
- useApiQuery / useApiMutation ラッパー
- 認証トークン管理

**NG**:
- ビジネスロジック
- UI コンポーネント
- 特定ドメインのロジック

```ts
// ✅ Good: 汎用 API ユーティリティ
// lib/api/client.ts
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const apiClient = {
  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const query = params ? `?${new URLSearchParams(/* ... */)}` : '';
    const res = await fetch(`${BASE_URL}${url}${query}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw await createApiError(res);
    return res.json();
  },
  // post, put, patch, delete ...
};

// lib/api/use-api-query.ts
export const useApiQuery = <T>(options: ApiQueryOptions) => {
  return useQuery<T>({
    queryKey: options.queryKey,
    queryFn: () => apiClient.get(options.url, options.params),
    ...options,
  });
};
```

---

## 依存関係図

```
pages/
  ↓ (imports)
components/features/
  ↓ (imports)
components/ui/     hooks/     components/context/
  ↓                 ↓              ↓
types/          lib/api/       types/
```

**ルール**:
- 上位レイヤは下位レイヤのみに依存
- 同一レイヤ間の依存は最小限に
- 循環依存は禁止

---

## 関連ドキュメント

- **[コンポーネントパターン](component-patterns.md)** - 300行ルール、分割戦略
- **[フックパターン](hooks-patterns.md)** - useApiQuery の使い方
- **[アンチパターン](anti-patterns.md)** - やってはいけないこと
