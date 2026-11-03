/**
 * カスタムフックの実装例
 *
 * このファイルは新規フック作成時のテンプレートとして使用できます。
 *
 * 構成:
 * 1. API データ取得フック (useApiQuery ベース)
 * 2. API ミューテーションフック (useApiMutation ベース)
 * 3. UI ロジックフック
 * 4. 複合フック
 *
 * 使い方:
 * 1. このファイルを hooks/ または features/<domain>/hooks.ts にコピー
 * 2. User → 実際のリソース名に置換
 * 3. 型とロジックを実際の要件に合わせて修正
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/api/use-api-query';
import { useApiMutation } from '@/lib/api/use-api-mutation';

// =============================================================================
// 型定義 (types/<domain>.d.ts から import する)
// =============================================================================

interface User {
  id: number;
  name: string;
  role: 'admin' | 'editor' | 'member';
  status: 'active' | 'inactive' | 'suspended';
  email: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateUserRequest {
  name: string;
  email: string;
  role: User['role'];
}

interface UpdateUserRequest {
  name?: string;
  role?: User['role'];
  status?: User['status'];
}

interface UserFilters {
  role?: User['role'];
  status?: User['status'];
  page?: number;
  pageSize?: number;
}

interface UserListResponse {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
}

// =============================================================================
// 1. API データ取得フック
// =============================================================================

/**
 * Query Key ファクトリ
 *
 * 一貫した Query Key を生成するためのヘルパー。
 * キャッシュ無効化時に便利。
 */
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters?: UserFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: number) => [...userKeys.details(), id] as const,
  tasks: (id: number) => [...userKeys.detail(id), 'tasks'] as const,
};

/**
 * ユーザー一覧を取得するフック
 *
 * @param filters - フィルター条件
 * @returns ユーザー一覧と状態
 *
 * @example
 * const { data, isLoading, error } = useUsers({ status: 'active' });
 */
export const useUsers = (filters?: UserFilters) => {
  return useApiQuery<UserListResponse>({
    queryKey: userKeys.list(filters),
    url: '/api/users',
    params: filters,
  });
};

/**
 * 単一ユーザーを取得するフック
 *
 * @param userId - ユーザーID
 * @returns ユーザーと状態
 *
 * @example
 * const { data: user, isLoading } = useUser(123);
 */
export const useUser = (userId: number) => {
  return useApiQuery<User>({
    queryKey: userKeys.detail(userId),
    url: `/api/users/${userId}`,
    enabled: userId > 0,
  });
};

// =============================================================================
// 2. API ミューテーションフック
// =============================================================================

/**
 * ユーザー作成フック
 *
 * @example
 * const { mutate: createUser, isPending } = useUserCreate();
 * createUser({ name: 'Alice', email: 'alice@example.com', role: 'member' });
 */
export const useUserCreate = () => {
  const queryClient = useQueryClient();

  return useApiMutation<User, CreateUserRequest>({
    url: '/api/users',
    method: 'POST',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
};

/**
 * ユーザー更新フック
 *
 * @param userId - ユーザーID
 *
 * @example
 * const { mutate: updateUser } = useUserUpdate(123);
 * updateUser({ name: 'Updated Name' });
 */
export const useUserUpdate = (userId: number) => {
  const queryClient = useQueryClient();

  return useApiMutation<User, UpdateUserRequest>({
    url: `/api/users/${userId}`,
    method: 'PATCH',
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(userKeys.detail(userId), updatedUser);
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
};

/**
 * ユーザー削除フック
 *
 * @example
 * const { mutate: deleteUser } = useUserDelete();
 * deleteUser(123);
 */
export const useUserDelete = () => {
  const queryClient = useQueryClient();

  return useApiMutation<void, number>({
    url: (userId) => `/api/users/${userId}`,
    method: 'DELETE',
    onSuccess: (_, userId) => {
      queryClient.removeQueries({ queryKey: userKeys.detail(userId) });
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
};

/**
 * 楽観的更新を行うユーザーステータス更新フック
 *
 * @param userId - ユーザーID
 */
export const useUserStatusUpdate = (userId: number) => {
  const queryClient = useQueryClient();

  return useApiMutation<User, { status: User['status'] }>({
    url: `/api/users/${userId}/status`,
    method: 'PATCH',
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: userKeys.detail(userId) });

      const previousUser = queryClient.getQueryData<User>(
        userKeys.detail(userId)
      );

      if (previousUser) {
        queryClient.setQueryData<User>(userKeys.detail(userId), {
          ...previousUser,
          status: newData.status,
        });
      }

      return { previousUser };
    },
    onError: (_err, _newData, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(
          userKeys.detail(userId),
          context.previousUser
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
};

// =============================================================================
// 3. UI ロジックフック
// =============================================================================

/**
 * トグルフック
 *
 * @example
 * const { value: isOpen, toggle, setTrue: open, setFalse: close } = useToggle();
 */
export const useToggle = (initialValue = false) => {
  const [value, setValue] = useState(initialValue);

  const toggle = useCallback(() => setValue((v) => !v), []);
  const setTrue = useCallback(() => setValue(true), []);
  const setFalse = useCallback(() => setValue(false), []);

  return { value, toggle, setTrue, setFalse };
};

/**
 * デバウンスフック
 *
 * @example
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearchTerm = useDebounce(searchTerm, 300);
 */
export const useDebounce = <T>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

/**
 * 前回の値を保持するフック
 *
 * @example
 * const previousCount = usePrevious(count);
 */
export const usePrevious = <T>(value: T): T | undefined => {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
};

/**
 * ローカルストレージと同期するフック
 *
 * @example
 * const [theme, setTheme] = useLocalStorage('theme', 'light');
 */
export const useLocalStorage = <T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.error(`Error saving to localStorage: ${error}`);
      }
    },
    [key, storedValue]
  );

  return [storedValue, setValue];
};

// =============================================================================
// 4. 複合フック
// =============================================================================

/**
 * ページネーションフック
 *
 * @example
 * const { page, pageSize, pagination } = usePagination();
 * <Table pagination={pagination} />
 */
export const usePagination = (options: {
  defaultPage?: number;
  defaultPageSize?: number;
} = {}) => {
  const { defaultPage = 1, defaultPageSize = 20 } = options;

  const [page, setPage] = useState(defaultPage);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const offset = useMemo(() => (page - 1) * pageSize, [page, pageSize]);

  const reset = useCallback(() => {
    setPage(defaultPage);
  }, [defaultPage]);

  const goToPage = useCallback((newPage: number) => {
    setPage(Math.max(1, newPage));
  }, []);

  const changePageSize = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  }, []);

  const pagination = useMemo(
    () => ({
      current: page,
      pageSize,
      onChange: goToPage,
      onShowSizeChange: (_: number, size: number) => changePageSize(size),
    }),
    [page, pageSize, goToPage, changePageSize]
  );

  return {
    page,
    pageSize,
    offset,
    setPage: goToPage,
    setPageSize: changePageSize,
    reset,
    pagination,
  };
};

/**
 * 選択状態管理フック
 *
 * @example
 * const { selectedIds, isSelected, toggle, selectAll, clear } = useSelection<number>();
 */
export const useSelection = <T extends string | number>() => {
  const [selectedIds, setSelectedIds] = useState<Set<T>>(new Set());

  const isSelected = useCallback(
    (id: T) => selectedIds.has(id),
    [selectedIds]
  );

  const toggle = useCallback((id: T) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const select = useCallback((id: T) => {
    setSelectedIds((prev) => new Set(prev).add(id));
  }, []);

  const deselect = useCallback((id: T) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  return {
    selectedIds: selectedArray,
    selectedCount: selectedIds.size,
    isSelected,
    toggle,
    select,
    deselect,
    selectAll,
    clear,
  };
};
