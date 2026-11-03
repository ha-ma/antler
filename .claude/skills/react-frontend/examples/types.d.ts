/**
 * 型定義パターンの実装例
 *
 * このファイルは types/<domain>.d.ts のテンプレートとして使用できます。
 *
 * 構成:
 * 1. ドメインモデル型
 * 2. API Request/Response 型
 * 3. Discriminated Unions
 * 4. ユーティリティ型
 * 5. コンポーネント Props 型
 *
 * 命名規則:
 * - インターフェース/Type: PascalCase
 * - Request 型: <Action><Resource>Request
 * - Response 型: <Resource><Action>Response または <Resource>ListResponse
 */

// =============================================================================
// 1. ドメインモデル型
// =============================================================================

/**
 * ユーザーモデル
 *
 * API レスポンスの構造を反映。
 * フィールドはスネークケースではなくキャメルケースで定義。
 */
export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl: string | null;
  createdAt: string;    // ISO 8601 形式
  updatedAt: string;    // ISO 8601 形式
}

/** ユーザーロール */
export type UserRole = 'admin' | 'editor' | 'member';

/** ユーザーステータス */
export type UserStatus =
  | 'active'       // 有効
  | 'inactive'     // 無効
  | 'suspended';   // 停止

/**
 * タスクモデル
 */
export interface Task {
  id: number;
  userId: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
}

/** タスクステータス */
export type TaskStatus =
  | 'todo'           // 未着手
  | 'in_progress'    // 進行中
  | 'done'           // 完了
  | 'blocked';       // ブロック

/** タスク優先度 */
export type TaskPriority = 'low' | 'medium' | 'high';

/**
 * 通知モデル
 */
export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

/** 通知タイプ */
export type NotificationType =
  | 'info'
  | 'warning'
  | 'error'
  | 'success';

/**
 * ファイルモデル
 */
export interface FileItem {
  id: number;
  name: string;
  mimeType: string;
  size: number;          // bytes
  url: string;
  createdAt: string;
}

// =============================================================================
// 2. API Request/Response 型
// =============================================================================

/**
 * ユーザー作成リクエスト
 */
export interface CreateUserRequest {
  name: string;
  email: string;
  role: UserRole;
}

/**
 * ユーザー更新リクエスト
 * Partial を使って部分更新を表現
 */
export interface UpdateUserRequest {
  name?: string;
  role?: UserRole;
  status?: UserStatus;
}

/**
 * ユーザー一覧レスポンス
 */
export interface UserListResponse {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * タスク作成リクエスト
 */
export interface CreateTaskRequest {
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
}

/**
 * タスク一覧レスポンス
 */
export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

/**
 * ファイルアップロードリクエスト
 */
export interface UploadFileRequest {
  file: File;
  name?: string;
}

/**
 * API エラーレスポンス
 */
export interface ApiErrorResponse {
  message: string;
  code: string;
  details?: Record<string, string[]>;
}

/**
 * フィルター/クエリパラメータ型
 */
export interface UserFilters {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: number;
  page?: number;
  pageSize?: number;
}

// =============================================================================
// 3. Discriminated Unions
// =============================================================================

/**
 * ローディング状態を表す Discriminated Union
 *
 * 使用例:
 * const [state, setState] = useState<LoadingState<User>>({ status: 'idle' });
 *
 * switch (state.status) {
 *   case 'idle': return <Button onClick={load}>Load</Button>;
 *   case 'loading': return <Spinner />;
 *   case 'error': return <Error error={state.error} />;
 *   case 'success': return <UserCard user={state.data} />;
 * }
 */
export type LoadingState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: T };

/**
 * API 結果を表す Discriminated Union
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * フォームステップを表す Discriminated Union
 */
export type FormStep =
  | { step: 'input'; values: Partial<FormValues> }
  | { step: 'confirm'; values: FormValues }
  | { step: 'submitting'; values: FormValues }
  | { step: 'success'; result: SubmitResult }
  | { step: 'error'; error: Error; values: FormValues };

interface FormValues {
  name: string;
  email: string;
}

interface SubmitResult {
  id: number;
}

/**
 * 認証状態を表す Discriminated Union
 */
export type AuthState =
  | { status: 'unauthenticated' }
  | { status: 'authenticating' }
  | { status: 'authenticated'; user: User };

// =============================================================================
// 4. ユーティリティ型
// =============================================================================

/** null を許容する型 */
export type Nullable<T> = T | null;

/** 配列またはシングル */
export type ArrayOrSingle<T> = T | T[];

/** 部分的な必須フィールド */
export type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;

/** 部分的なオプショナルフィールド */
export type WithOptional<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

/** ID を除いた型 (作成時用) */
export type CreateInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

/** ID のみの型 */
export type WithId<T> = T & { id: number };

/** 深い Partial */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** 関数の戻り値型を取得 */
export type AsyncReturnType<T extends (...args: unknown[]) => Promise<unknown>> =
  T extends (...args: unknown[]) => Promise<infer R> ? R : never;

// =============================================================================
// 5. コンポーネント Props 型
// =============================================================================

/** 汎用リストコンポーネントの Props */
export interface ListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T) => string | number;
  emptyMessage?: string;
  loading?: boolean;
}

/** 汎用セレクトコンポーネントの Props */
export interface SelectProps<T> {
  options: T[];
  value: T | null;
  onChange: (value: T) => void;
  getLabel: (item: T) => string;
  getValue: (item: T) => string | number;
  placeholder?: string;
  disabled?: boolean;
}

/** 汎用モーダルの Props */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** フォームフィールドの共通 Props */
export interface FormFieldProps<T> {
  name: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

// =============================================================================
// 6. イベントハンドラ型
// =============================================================================

/** 汎用変更ハンドラ */
export type ChangeHandler<T = string> = (value: T) => void;

/** 汎用送信ハンドラ */
export type SubmitHandler<T> = (values: T) => void | Promise<void>;

/** 汎用選択ハンドラ */
export type SelectHandler<T> = (item: T) => void;

/** 汎用削除ハンドラ */
export type DeleteHandler<T = number> = (id: T) => void | Promise<void>;

/** 汎用確認ハンドラ */
export type ConfirmHandler = () => void | Promise<void>;

// =============================================================================
// Type Guards
// =============================================================================

/** User かどうかを判定する Type Guard */
export function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'email' in value &&
    'role' in value
  );
}

/** Task かどうかを判定する Type Guard */
export function isTask(value: unknown): value is Task {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'title' in value &&
    'status' in value &&
    'priority' in value
  );
}

/** API エラーかどうかを判定する Type Guard */
export function isApiError(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    'code' in value
  );
}

/** 配列かどうかを判定する汎用 Type Guard */
export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.every(guard);
}
