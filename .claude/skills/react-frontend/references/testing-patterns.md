# テストパターン

## 目次

- [テスト環境セットアップ](#テスト環境セットアップ)
- [コンポーネントテスト](#コンポーネントテスト)
- [フックテスト](#フックテスト)
- [API モック (MSW)](#api-モック-msw)
- [テストのベストプラクティス](#テストのベストプラクティス)

---

## テスト環境セットアップ

### Vitest 設定

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/setup.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### テストセットアップ

```ts
// tests/setup.ts
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// matchMedia のモック
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ResizeObserver のモック
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
```

### テストユーティリティ

```tsx
// tests/utils/test-utils.tsx
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ReactElement, PropsWithChildren } from 'react';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

const AllTheProviders = ({ children }: PropsWithChildren) => {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };
```

---

## コンポーネントテスト

### 基本テスト

```tsx
import { render, screen, fireEvent } from '@/tests/utils/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './index';

describe('Button', () => {
  it('renders with label', () => {
    render(<Button label="Click me" onClick={() => {}} />);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Button label="Click me" onClick={handleClick} />);

    fireEvent.click(screen.getByRole('button'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when loading', () => {
    const handleClick = vi.fn();
    render(<Button label="Submit" onClick={handleClick} loading />);

    fireEvent.click(screen.getByRole('button'));

    expect(handleClick).not.toHaveBeenCalled();
  });
});
```

### Feature コンポーネントテスト

```tsx
import { render, screen, waitFor } from '@/tests/utils/test-utils';
import { describe, it, expect } from 'vitest';
import { UserList } from './index';
import { server } from '@/tests/mocks/server';
import { http, HttpResponse } from 'msw';

describe('UserList', () => {
  it('renders loading state initially', () => {
    render(<UserList />);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('renders users after loading', async () => {
    render(<UserList />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('renders empty state when no users', async () => {
    server.use(
      http.get('/api/users', () => {
        return HttpResponse.json({ users: [], total: 0 });
      })
    );

    render(<UserList />);

    await waitFor(() => {
      expect(screen.getByText('ユーザーがいません')).toBeInTheDocument();
    });
  });

  it('renders error state on API failure', async () => {
    server.use(
      http.get('/api/users', () => {
        return HttpResponse.error();
      })
    );

    render(<UserList />);

    await waitFor(() => {
      expect(screen.getByText(/エラーが発生しました/)).toBeInTheDocument();
    });
  });
});
```

### フォームテスト

```tsx
import { render, screen, waitFor } from '@/tests/utils/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { UserForm } from './index';
import userEvent from '@testing-library/user-event';

describe('UserForm', () => {
  it('submits form with valid data', async () => {
    const handleSubmit = vi.fn();
    const user = userEvent.setup();

    render(<UserForm onSubmit={handleSubmit} />);

    await user.type(screen.getByLabelText('名前'), 'Alice');
    await user.type(screen.getByLabelText('メール'), 'alice@example.com');
    await user.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Alice',
        email: 'alice@example.com',
      });
    });
  });

  it('shows validation error for empty name', async () => {
    const user = userEvent.setup();

    render(<UserForm onSubmit={() => {}} />);

    await user.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() => {
      expect(screen.getByText('名前は必須です')).toBeInTheDocument();
    });
  });
});
```

---

## フックテスト

### renderHook の使用

```tsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useToggle } from './use-toggle';

describe('useToggle', () => {
  it('initializes with false by default', () => {
    const { result } = renderHook(() => useToggle());
    expect(result.current.value).toBe(false);
  });

  it('toggles value', () => {
    const { result } = renderHook(() => useToggle());

    act(() => {
      result.current.toggle();
    });

    expect(result.current.value).toBe(true);
  });
});
```

### API フックテスト

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useUsers } from './use-users';
import { createWrapper } from '@/tests/utils/test-utils';
import { server } from '@/tests/mocks/server';
import { http, HttpResponse } from 'msw';

describe('useUsers', () => {
  it('fetches users successfully', async () => {
    const { result } = renderHook(() => useUsers(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Alice');
  });

  it('handles error', async () => {
    server.use(
      http.get('/api/users', () => {
        return HttpResponse.json(
          { message: 'Server error' },
          { status: 500 }
        );
      })
    );

    const { result } = renderHook(() => useUsers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
```

---

## API モック (MSW)

### ハンドラー定義

```ts
// tests/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

const mockUsers = [
  { id: 1, name: 'Alice', role: 'admin', status: 'active' },
  { id: 2, name: 'Bob', role: 'member', status: 'active' },
];

export const handlers = [
  http.get('/api/users', () => {
    return HttpResponse.json({
      users: mockUsers,
      total: mockUsers.length,
    });
  }),

  http.get('/api/users/:id', ({ params }) => {
    const user = mockUsers.find((u) => u.id === Number(params.id));
    if (!user) {
      return HttpResponse.json({ message: 'Not found' }, { status: 404 });
    }
    return HttpResponse.json(user);
  }),

  http.post('/api/users', async ({ request }) => {
    const body = await request.json();
    const newUser = { id: mockUsers.length + 1, ...body, status: 'active' };
    return HttpResponse.json(newUser, { status: 201 });
  }),

  http.delete('/api/users/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
```

### サーバー設定

```ts
// tests/mocks/server.ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

### セットアップ統合

```ts
// tests/setup.ts に追加
import { server } from './mocks/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

---

## テストのベストプラクティス

### 何をテストするか

```tsx
// ✅ テストすべきもの
describe('UserCard', () => {
  it('displays user name', () => {});          // ユーザーに見えるもの
  it('calls onSelect when clicked', () => {});  // ユーザーインタラクション
  it('truncates long names with ellipsis', () => {}); // エッジケース
});

// ❌ テストしなくてよいもの
describe('UserCard', () => {
  it('calls useState', () => {});           // 実装の詳細
  it('has className container', () => {});  // 実装の詳細
  it('UI library works', () => {});         // 外部ライブラリ
});
```

### テストの構造

```tsx
// AAA パターン: Arrange, Act, Assert
it('increments counter when button is clicked', () => {
  // Arrange
  const { getByRole, getByText } = render(<Counter initialValue={0} />);

  // Act
  fireEvent.click(getByRole('button', { name: 'Increment' }));

  // Assert
  expect(getByText('Count: 1')).toBeInTheDocument();
});
```

### テストファイルの配置

```
# コンポーネントと同じ場所 (推奨)
components/ui/Button/
├── index.tsx
├── Button.test.tsx
└── index.module.css

hooks/
├── use-users.ts
└── use-users.test.ts
```

### データテスト属性

```tsx
// テスト用属性を追加
<div data-testid="user-card">
  <span data-testid="user-name">{user.name}</span>
</div>

// テストで使用
expect(screen.getByTestId('user-name')).toHaveTextContent('Alice');
```

---

## 関連ドキュメント

- **[フックパターン](hooks-patterns.md)** - テスト対象のフック設計
- **[コンポーネントパターン](component-patterns.md)** - テストしやすいコンポーネント設計
