# アンチパターン

## 目次

- [巨大コンポーネント](#巨大コンポーネント)
- [any 型の使用](#any-型の使用)
- [コンポーネント内直接 fetch](#コンポーネント内直接-fetch)
- [命名の不統一](#命名の不統一)
- [Prop Drilling](#prop-drilling)
- [テストの欠如](#テストの欠如)
- [その他のアンチパターン](#その他のアンチパターン)

---

## 巨大コンポーネント

### 問題

1,000行超のコンポーネント (50+ useState, 20+ useEffect) は以下の問題を引き起こす:

1. **可読性**: 全体を把握できない
2. **テスト困難**: ユニットテスト不可能
3. **再利用不可**: 一部だけ使いたくても使えない
4. **変更影響大**: 小さな変更が予期せぬバグを生む
5. **レビュー困難**: PR が大きすぎてレビューできない

### ❌ Bad

```tsx
const DataSyncComponent = () => {
  // 50+ useState
  const [source1, setSource1] = useState(null);
  const [source2, setSource2] = useState(null);
  const [waveform1, setWaveform1] = useState([]);
  const [waveform2, setWaveform2] = useState([]);
  const [offset, setOffset] = useState(0);
  // ... 45+ more useState

  // 20+ useEffect
  useEffect(() => { /* source1 の処理 */ }, [source1]);
  useEffect(() => { /* source2 の処理 */ }, [source2]);
  // ... 17+ more useEffect

  // 50+ ハンドラー
  // 1,000行以上の JSX
};
```

### ✅ Good

```tsx
// Container (100行以下)
const DataSync: React.FC<Props> = ({ projectId }) => {
  const sync = useDataSync(projectId);

  return (
    <div className={styles.container}>
      <SourceSection sources={sync.sources} onSelect={sync.selectSource} />
      <WaveformDisplay waveforms={sync.waveforms} offset={sync.offset} />
      <SyncControls
        offset={sync.offset}
        onOffsetChange={sync.updateOffset}
        onConfirm={sync.confirm}
      />
    </div>
  );
};

// カスタムフック (200行以下)
const useDataSync = (projectId: number) => {
  const { data: sources } = useSources(projectId);
  const [selectedSource, setSelectedSource] = useState(null);
  // ... ロジックを集約
  return { sources, selectedSource, /* ... */ };
};
```

→ 詳細: [コンポーネントパターン](component-patterns.md)

---

## any 型の使用

### 問題

1. **型チェック無効化**: TypeScript の恩恵が失われる
2. **実行時エラー**: コンパイル時に検出できないバグ
3. **IDE 支援なし**: 補完や型ヒントが効かない
4. **リファクタリング困難**: 影響範囲が不明

### ❌ Bad

```tsx
// 型定義ファイルでの any
interface DataResult {
  points: any[];      // ❌ 型が不明
  matrix: any;        // ❌ 構造が不明
  error: any;         // ❌ エラーの型が不明
}

// コンポーネントでの any
const processData = (data: any) => {
  return data.map((item: any) => item.value);  // ❌ 実行時エラーの可能性
};

// イベントハンドラーでの any
const handleChange = (e: any) => {
  setValue(e.target.value);  // ❌ e.target が存在しない可能性
};
```

### ✅ Good

```tsx
// 適切な型定義
interface Point3D { x: number; y: number; z: number; }

interface TransformMatrix {
  values: number[][];
  dimensions: [number, number];
}

interface DataResult {
  points: Point3D[];
  matrix: TransformMatrix;
  error: DataError | null;
}

// Type Guard による安全な処理
const processData = (data: unknown) => {
  if (!isDataArray(data)) {
    throw new Error('Invalid data format');
  }
  return data.map((item) => item.value);
};

// 適切なイベント型
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setValue(e.target.value);
};
```

→ 詳細: [型安全](type-safety.md)

---

## コンポーネント内直接 fetch

### 問題

1. **キャッシュなし**: 毎回 API 呼び出し
2. **重複コード**: 各コンポーネントで同じ処理
3. **ローディング/エラー管理が散らばる**
4. **テスト困難**: モックが大変
5. **競合状態**: クリーンアップ忘れでメモリリーク

### ❌ Bad

```tsx
const UserDetail: React.FC<{ id: number }> = ({ id }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`/api/users/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setUser(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
  }, [id]);

  // ❌ 競合状態の可能性
  // ❌ キャッシュなし
  // ❌ 他のコンポーネントと重複
};
```

### ✅ Good

```tsx
// hooks/use-user.ts
export const useUser = (id: number) => {
  return useApiQuery<User>({
    queryKey: ['users', id],
    url: `/api/users/${id}`,
    enabled: id > 0,
  });
};

// components/features/user-detail/index.tsx
const UserDetail: React.FC<{ id: number }> = ({ id }) => {
  const { data: user, isLoading, error, refetch } = useUser(id);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;
  if (!user) return <NotFound />;

  return <UserCard user={user} />;
};
```

→ 詳細: [フックパターン](hooks-patterns.md)

---

## 命名の不統一

### 問題

1. **予測困難**: ファイル名を予測できない
2. **検索困難**: grep/検索で見つけにくい
3. **チーム混乱**: 新規メンバーが迷う

### ❌ Bad

```
hooks/
├── useUsers.ts           # camelCase
├── use-tasks.ts          # kebab-case
├── notification_hook.ts  # snake_case
└── UseAuth.ts            # PascalCase
```

### ✅ Good

```
hooks/
├── use-users.ts          # kebab-case で統一
├── use-tasks.ts
├── use-notifications.ts
└── use-auth.ts

components/
├── features/
│   ├── user-profile/     # kebab-case で統一
│   ├── task-board/
│   └── dashboard/
└── ui/
    ├── Button/           # UI は PascalCase OK
    └── Modal/
```

→ 詳細: [命名規則](conventions.md)

---

## Prop Drilling

### 問題

8+ レイヤーの深いネスト、同じ Props が何度も受け渡される。

### ❌ Bad

```tsx
const Page = () => {
  const [user, setUser] = useState(null);
  return <Layout user={user} setUser={setUser} />;
};
const Layout = ({ user, setUser }) => <Sidebar user={user} setUser={setUser} />;
const Sidebar = ({ user, setUser }) => <Navigation user={user} setUser={setUser} />;
const Navigation = ({ user, setUser }) => <UserMenu user={user} setUser={setUser} />;
```

### ✅ Good

```tsx
// Context で共有
const Page = () => (
  <UserProvider>
    <Layout />
  </UserProvider>
);

const Layout = () => <Sidebar />;
const Sidebar = () => <Navigation />;

const UserMenu = () => {
  const { user, logout } = useUser(); // Context から取得
  return <UserAvatar user={user} onClick={logout} />;
};
```

→ 詳細: [状態管理](state-management.md)

---

## テストの欠如

### 問題

1. **リグレッション**: 変更時にバグを検出できない
2. **リファクタリング困難**: 怖くて触れない
3. **ドキュメント不足**: テストは仕様のドキュメント

### ❌ Bad

```
src/
├── components/features/
│   ├── user-profile/
│   │   └── index.tsx        # テストなし
│   └── task-board/
│       └── index.tsx        # テストなし
└── hooks/
    └── use-users.ts          # テストなし
```

### ✅ Good

```
src/
├── components/features/
│   ├── user-profile/
│   │   ├── index.tsx
│   │   └── UserProfile.test.tsx    # ✅
│   └── task-board/
│       ├── index.tsx
│       └── TaskBoard.test.tsx      # ✅
└── hooks/
    ├── use-users.ts
    └── use-users.test.ts            # ✅
```

→ 詳細: [テストパターン](testing-patterns.md)

---

## その他のアンチパターン

### インラインスタイルの乱用

```tsx
// ❌ Bad
<div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>

// ✅ Good
<div className={styles.container}>
```

### 条件付きレンダリングの複雑化

```tsx
// ❌ Bad
return (
  <div>
    {isLoading && !error && !data && <Loading />}
    {!isLoading && error && !data && <Error error={error} />}
    {!isLoading && !error && data && <Content data={data} />}
  </div>
);

// ✅ Good
if (isLoading) return <Loading />;
if (error) return <Error error={error} />;
if (!data) return <Empty />;
return <Content data={data} />;
```

### useEffect の依存配列無視

```tsx
// ❌ Bad
useEffect(() => {
  fetchData(userId, status);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [userId]); // status が抜けている

// ✅ Good
useEffect(() => {
  fetchData(userId, status);
}, [userId, status]);
```

---

## 関連ドキュメント

- **[コンポーネントパターン](component-patterns.md)** - 正しい分割方法
- **[型安全](type-safety.md)** - any の代替
- **[フックパターン](hooks-patterns.md)** - API 呼び出しの正しい方法
- **[テストパターン](testing-patterns.md)** - テストの書き方
