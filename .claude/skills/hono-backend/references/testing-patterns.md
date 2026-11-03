# テストパターン

## テストピラミッド

```
    /  Acceptance  \     ← E2E ビジネスフロー（少数）
   / Integration    \    ← API + DB 統合テスト
  /     Unit         \   ← UseCase / Domain / Gateway・Security（多数）
```

## テスト環境

### Vitest 設定

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      JWT_SECRET: "test-secret",
      NODE_ENV: "test",
    },
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
```

---

## Unit テスト

### UseCase テスト（フレームワーク非依存）

UseCase は ports (interface) にのみ依存するため、**Drizzle も Hono も import せずにテスト可能**。

```typescript
// __tests__/unit/usecases/create-user.usecase.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CreateUserUseCase } from "../../../application/usecases/users/create-user.usecase";
import type { PasswordHasher } from "../../../application/ports/security/password-hasher";
import type { UserRepository } from "../../../application/ports/repositories/user.repository";
import type { UnitOfWork } from "../../../application/ports/unit-of-work";
import { UserAlreadyExistsError } from "../../../domain/users/errors/user-errors";

// --- モックファクトリ ---

function createMockPasswordHasher(): PasswordHasher {
  return {
    hash: vi.fn().mockResolvedValue("hashed-password"),
    verify: vi.fn().mockResolvedValue(true),
  };
}

function createMockUserRepo(overrides?: Partial<UserRepository>): UserRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    findByFilters: vi.fn().mockResolvedValue({ users: [], total: 0 }),
    create: vi.fn().mockImplementation(async (data) => ({
      id: "generated-id",
      ...data,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    })),
    update: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    incrementFailedAttempts: vi.fn(),
    resetFailedAttempts: vi.fn(),
    lockAccount: vi.fn(),
    ...overrides,
  };
}

function createMockUnitOfWork(userRepo: UserRepository): UnitOfWork {
  const uow: UnitOfWork = {
    userRepo,
    announcementRepo: {} as any,
    transaction: vi.fn(async (fn) => fn(uow)),
  };
  return uow;
}

// --- テスト ---

describe("CreateUserUseCase", () => {
  let useCase: CreateUserUseCase;
  let mockPasswordHasher: PasswordHasher;
  let mockRepo: UserRepository;
  let mockUow: UnitOfWork;

  beforeEach(() => {
    mockPasswordHasher = createMockPasswordHasher();
    mockRepo = createMockUserRepo();
    mockUow = createMockUnitOfWork(mockRepo);
    useCase = new CreateUserUseCase(mockPasswordHasher);
  });

  it("有効な入力でユーザーを作成できる", async () => {
    const result = await useCase.execute(
      { name: "Test", email: "test@example.com", password: "password123" },
      mockUow,
    );

    expect(result.email).toBe("test@example.com");
    expect(mockRepo.findByEmail).toHaveBeenCalledWith("test@example.com");
    expect(mockPasswordHasher.hash).toHaveBeenCalledWith("password123");
    expect(mockRepo.create).toHaveBeenCalled();
  });

  it("重複メールで UserAlreadyExistsError を投げる", async () => {
    vi.mocked(mockRepo.findByEmail).mockResolvedValueOnce({ id: "existing" } as any);

    await expect(
      useCase.execute(
        { name: "Test", email: "dup@example.com", password: "password123" },
        mockUow,
      ),
    ).rejects.toThrow(UserAlreadyExistsError);
  });

  it("無効なメール形式で InvalidEmailError を投げる", async () => {
    await expect(
      useCase.execute(
        { name: "Test", email: "invalid", password: "password123" },
        mockUow,
      ),
    ).rejects.toThrow("無効なメールアドレス");
  });

  it("短すぎるパスワードで InvalidPasswordError を投げる", async () => {
    await expect(
      useCase.execute(
        { name: "Test", email: "test@example.com", password: "short" },
        mockUow,
      ),
    ).rejects.toThrow("パスワードが要件を満たしていません");
  });
});
```

### Domain テスト（純粋関数）

```typescript
// __tests__/unit/domain/user-rules.test.ts

import { describe, it, expect } from "vitest";
import { validateEmail, validatePassword, isAccountLocked, shouldLockAccount } from "../../../domain/users/rules/user-rules";

describe("validateEmail", () => {
  it("有効なメールを受け入れる", () => {
    expect(validateEmail("user@example.com")).toBe(true);
    expect(validateEmail("user+tag@example.co.jp")).toBe(true);
  });

  it("無効なメールを拒否する", () => {
    expect(validateEmail("")).toBe(false);
    expect(validateEmail("invalid")).toBe(false);
    expect(validateEmail("@example.com")).toBe(false);
  });
});

describe("isAccountLocked", () => {
  it("ロック期限内は true", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    expect(isAccountLocked({ lockedUntil: future })).toBe(true);
  });

  it("ロック期限切れは false", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(isAccountLocked({ lockedUntil: past })).toBe(false);
  });

  it("lockedUntil が null は false", () => {
    expect(isAccountLocked({ lockedUntil: null })).toBe(false);
  });
});
```

---

## Integration テスト

### Route テスト（HTTP + DB）

統合テストでは実際の infrastructure 具象実装を使う。

```typescript
// __tests__/integration/routes/user.routes.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../../../infrastructure/http/app";
import { setupTestDb, resetTestDb, seedTestAdmin } from "../../helpers/db";

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

function authReq(path: string, user: { id: string; role: string }, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: {
      ...init?.headers,
      "x-user-id": user.id,
      "x-user-role": user.role,
    },
  });
}

describe("POST /api/users", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("管理者がユーザーを作成できる", async () => {
    const admin = await seedTestAdmin();
    const res = await authReq("/api/users", admin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New User",
        email: "new@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.email).toBe("new@example.com");
  });

  it("一般ユーザーは作成できない (403)", async () => {
    const res = await authReq("/api/users", { id: "m-id", role: "member" }, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "T", email: "t@t.com", password: "pass1234" }),
    });
    expect(res.status).toBe(403);
  });

  it("重複メールで 409 + ErrorCode", async () => {
    const admin = await seedTestAdmin();
    await authReq("/api/users", admin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "A", email: "dup@test.com", password: "password123" }),
    });
    const res = await authReq("/api/users", admin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "B", email: "dup@test.com", password: "password123" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("RESOURCE_ALREADY_EXISTS");
  });
});
```

### テスト用 DB ヘルパー

```typescript
// __tests__/helpers/db.ts

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { createTables } from "../../infrastructure/db/create-tables";
import { DrizzleUnitOfWork } from "../../infrastructure/db/drizzle-unit-of-work";
import { BcryptPasswordHasher } from "../../infrastructure/security/bcrypt-password-hasher";

let testDb: any;
let testUow: UnitOfWork;

export async function setupTestDb(): Promise<void> {
  const client = createClient({ url: ":memory:" });
  testDb = drizzle(client);
  await createTables(testDb);
  testUow = new DrizzleUnitOfWork(testDb);
}

export async function resetTestDb(): Promise<void> {
  await setupTestDb();
}

export function getTestUow(): UnitOfWork {
  return testUow;
}

export async function seedTestAdmin(): Promise<{ id: string; role: string }> {
  const passwordHasher = new BcryptPasswordHasher();
  const hash = await passwordHasher.hash("admin123");
  // ... insert into testDb
  return { id: "admin-test-id", role: "admin" };
}
```

---

## Acceptance テスト

```typescript
// __tests__/acceptance/auth.acceptance.test.ts

describe("認証フロー", () => {
  beforeEach(async () => {
    await resetTestDb();
    await seedTestAdmin();
  });

  it("ログイン → プロフィール取得 → ログアウト", async () => {
    const loginRes = await req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password: "admin123" }),
    });
    expect(loginRes.status).toBe(200);
    const { accessToken } = await loginRes.json();

    const profileRes = await req("/api/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(profileRes.status).toBe(200);

    const logoutRes = await req("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(logoutRes.status).toBe(200);
  });
});
```

---

## カバレッジ目標

| レイヤ | 目標 | テスト種別 |
|--------|------|----------|
| domain/{domain}/rules/, policies/ | 100% | Unit（純粋関数、最速） |
| application/usecases/ | 90%+ | Unit（モック DI） |
| infrastructure/gateways/, infrastructure/security/ | 80%+ | Unit |
| infrastructure/repositories/ | 80%+ | Integration（in-memory DB） |
| infrastructure/http/routes/ | 統合テストで担保 | Integration |

---

## ベストプラクティス

### Do
- ✅ UseCase テストはモック DI で高速（DB/HTTP 不要）
- ✅ Domain テストは純粋関数テストで最速
- ✅ テスト名は日本語で「何ができる/何が起きる」を記述
- ✅ エラーケースも必ずテスト（例外の型・ErrorCode を検証）
- ✅ 各テストは独立（beforeEach で DB リセット）
- ✅ 統合テストは `app.request()` で実際の HTTP 層を通す

### Don't
- ❌ テスト間で状態を共有しない
- ❌ 外部 API を実呼び出ししない（モック化）
- ❌ UseCase テストで ORM を import しない
- ❌ `setTimeout`/`sleep` でタイミング依存テストを書かない
