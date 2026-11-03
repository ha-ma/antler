# 型安全

## 目次

- [any 禁止と代替](#any-禁止と代替)
- [Type Guard パターン](#type-guard-パターン)
- [Discriminated Unions](#discriminated-unions)
- [Generic Components](#generic-components)
- [API 型定義](#api-型定義)
- [イベントハンドラーの型](#イベントハンドラーの型)

---

## any 禁止と代替

### ルール

**`any` は禁止**。以下の代替手段を使用する。

| 状況 | 代替 |
|------|------|
| 型がわからない | `unknown` + Type Guard |
| 任意のオブジェクト | `Record<string, unknown>` |
| 任意の配列 | `unknown[]` |
| JSON データ | 適切な型を定義 |
| 外部ライブラリ | `@types/*` をインストール |

### unknown vs any

```tsx
// ❌ Bad: any は型チェックを無効化
const processData = (data: any) => {
  console.log(data.name.toUpperCase()); // 実行時エラーの可能性
};

// ✅ Good: unknown は型チェックを強制
const processData = (data: unknown) => {
  if (isUser(data)) {
    console.log(data.name.toUpperCase()); // OK
  }
};
```

### 修正例

```tsx
// ❌ Before: any だらけの型定義
interface DataResult {
  points: any[];
  matrix: any;
}

// ✅ After: 適切な型定義
interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface TransformMatrix {
  values: number[][];
  dimensions: [number, number];
}

interface DataResult {
  points: Point3D[];
  matrix: TransformMatrix;
}
```

---

## Type Guard パターン

### 基本パターン

```tsx
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

interface User {
  id: number;
  name: string;
  email: string;
}

function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'email' in value &&
    typeof (value as User).id === 'number' &&
    typeof (value as User).name === 'string' &&
    typeof (value as User).email === 'string'
  );
}
```

### 配列の Type Guard

```tsx
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isUserArray(value: unknown): value is User[] {
  return Array.isArray(value) && value.every(isUser);
}
```

### API レスポンスの検証

```tsx
interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
}

function isApiResponse<T>(
  value: unknown,
  isData: (data: unknown) => data is T
): value is ApiResponse<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'status' in value &&
    'message' in value &&
    typeof (value as ApiResponse<T>).status === 'number' &&
    typeof (value as ApiResponse<T>).message === 'string' &&
    isData((value as ApiResponse<T>).data)
  );
}

// 使用例
const response = await fetch('/api/users');
const json: unknown = await response.json();

if (isApiResponse(json, isUserArray)) {
  console.log(json.data[0].name); // 型安全
}
```

---

## Discriminated Unions

### 基本パターン

```tsx
type LoadingState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: T };

const [state, setState] = useState<LoadingState<User[]>>({ status: 'idle' });

switch (state.status) {
  case 'idle':
    return <Button onClick={load}>Load</Button>;
  case 'loading':
    return <Spinner />;
  case 'error':
    return <ErrorDisplay error={state.error} />;
  case 'success':
    return <UserList users={state.data} />;
}
```

### API レスポンス

```tsx
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const fetchUser = async (id: number): Promise<ApiResult<User>> => {
  try {
    const data = await apiClient.get<User>(`/api/users/${id}`);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
};

const result = await fetchUser(1);
if (result.ok) {
  console.log(result.data.name);
} else {
  console.error(result.error);
}
```

### フォーム状態

```tsx
type FormState =
  | { step: 'input'; values: FormValues }
  | { step: 'confirm'; values: FormValues }
  | { step: 'submitting'; values: FormValues }
  | { step: 'complete'; result: SubmitResult }
  | { step: 'error'; error: Error; values: FormValues };

const FormWizard: React.FC = () => {
  const [state, setState] = useState<FormState>({ step: 'input', values: {} });

  switch (state.step) {
    case 'input':
      return <InputForm values={state.values} onSubmit={goToConfirm} />;
    case 'confirm':
      return <ConfirmForm values={state.values} onConfirm={submit} />;
    case 'submitting':
      return <Spinner />;
    case 'complete':
      return <Complete result={state.result} />;
    case 'error':
      return <ErrorForm error={state.error} values={state.values} onRetry={retry} />;
  }
};
```

---

## Generic Components

### 基本パターン

```tsx
interface ListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T) => string | number;
  emptyMessage?: string;
}

export const List = <T,>({
  items,
  renderItem,
  keyExtractor,
  emptyMessage = 'No items',
}: ListProps<T>): React.ReactElement => {
  if (items.length === 0) {
    return <Empty description={emptyMessage} />;
  }

  return (
    <ul>
      {items.map((item, index) => (
        <li key={keyExtractor(item)}>{renderItem(item, index)}</li>
      ))}
    </ul>
  );
};

// 使用例
<List<User>
  items={users}
  renderItem={(user) => <UserCard user={user} />}
  keyExtractor={(user) => user.id}
/>
```

### Generic Select

```tsx
interface SelectProps<T> {
  options: T[];
  value: T | null;
  onChange: (value: T) => void;
  getLabel: (item: T) => string;
  getValue: (item: T) => string | number;
  placeholder?: string;
}

export const Select = <T,>({
  options,
  value,
  onChange,
  getLabel,
  getValue,
  placeholder,
}: SelectProps<T>): React.ReactElement => {
  return (
    <select
      value={value ? String(getValue(value)) : ''}
      onChange={(e) => {
        const selected = options.find((o) => String(getValue(o)) === e.target.value);
        if (selected) onChange(selected);
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={getValue(option)} value={getValue(option)}>
          {getLabel(option)}
        </option>
      ))}
    </select>
  );
};
```

### Generic Table

```tsx
interface Column<T> {
  key: string;
  title: string;
  render: (item: T) => React.ReactNode;
  width?: number;
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (item: T) => string | number;
  loading?: boolean;
}

export const DataTable = <T,>({
  data,
  columns,
  rowKey,
  loading,
}: TableProps<T>): React.ReactElement => {
  if (loading) return <Skeleton />;

  return (
    <table>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} style={{ width: col.width }}>{col.title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((item) => (
          <tr key={rowKey(item)}>
            {columns.map((col) => (
              <td key={col.key}>{col.render(item)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
```

---

## API 型定義

### Request / Response 型

```tsx
// types/user.d.ts

export interface User {
  id: number;
  name: string;
  role: UserRole;
  status: UserStatus;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'admin' | 'editor' | 'member';
export type UserStatus = 'active' | 'inactive' | 'suspended';

export interface CreateUserRequest {
  name: string;
  email: string;
  role: UserRole;
}

export interface UpdateUserRequest {
  name?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface UserListResponse {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserFilters {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}
```

### 型の再利用

```tsx
// 更新用 (すべてオプショナル)
type UpdateUserRequest = Partial<Pick<User, 'name' | 'role' | 'status'>>;

// 作成用 (id と日付以外必須)
type CreateUserRequest = Omit<User, 'id' | 'createdAt' | 'updatedAt'>;

// 一覧表示用 (必要なフィールドのみ)
type UserListItem = Pick<User, 'id' | 'name' | 'role' | 'status'>;
```

---

## イベントハンドラーの型

### フォームイベント

```tsx
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setValue(e.target.value);
};

const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
};

const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  // ...
};
```

### カスタムコールバック型

```tsx
// types/events.d.ts
export type ChangeHandler<T = string> = (value: T) => void;
export type SubmitHandler<T> = (values: T) => void | Promise<void>;
export type SelectHandler<T> = (item: T) => void;
export type DeleteHandler<T = number> = (id: T) => void | Promise<void>;

// 使用例
interface Props {
  onChange: ChangeHandler<number>;
  onSubmit: SubmitHandler<FormValues>;
  onSelect: SelectHandler<User>;
}
```

---

## 関連ドキュメント

- **[アンチパターン](anti-patterns.md)** - any 使用例と修正
- **[型定義例](../examples/types.d.ts)** - 完全な型定義例
- **[命名規則](conventions.md)** - 型の命名規則
