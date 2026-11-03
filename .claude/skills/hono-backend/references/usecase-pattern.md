# UseCase パターン

## UseCase の責務

1. **フロー制御**: Repository と Gateway/セキュリティポートを組み合わせて1つのビジネスストーリーを実行
2. **トランザクション管理**: UnitOfWork 経由でトランザクション境界を決定
3. **DTO 変換**: 入力→ドメイン→出力の変換
4. **例外ハンドリング**: ドメイン例外の throw

## UseCase が依存するもの

```
UseCase → domain/{domain}/models (型)
        → domain/{domain}/rules, policies (ビジネスルール・業務判断)
        → domain/{domain}/errors, domain/shared/errors (例外)
        → application/ports (interface のみ)
```

**禁止**: UseCase が infrastructure/ の具象クラスやフレームワーク型に依存すること。
**禁止**: `application` 配下・`ports` 配下に汎用 services ディレクトリを作ること。

## UseCase の構造

```
1 UseCase = 1 ビジネスアクション = 1 execute() メソッド
```

### 命名規則
- ファイル: `<verb>-<noun>.usecase.ts` (例: `create-user.usecase.ts`)
- クラス: `<Verb><Noun>UseCase` (例: `CreateUserUseCase`)
- メソッド: `execute()` のみ

---

## Ports（駆動ポート）

UseCase が依存するインターフェース群。`application/ports/` に配置する。
Repository、Gateway（外部 transport）、セキュリティポート（hash/token）は明確に分離する。

### Repository ポート

```typescript
// application/ports/repositories/user.repository.ts

import type { User, UserRole } from "../../../domain/users/models/user";

export interface CreateUserData {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

export interface UpdateUserData {
  name?: string;
  email?: string;
}

export interface UserFilters {
  search?: string;
  role?: UserRole;
  page?: number;
  limit?: number;
}

/**
 * UserRepository インターフェース
 *
 * ORM の型（DrizzleDB 等）を一切含まない。
 * 具象実装は infrastructure/repositories/ で行う。
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByFilters(filters: UserFilters): Promise<{ users: User[]; total: number }>;
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  incrementFailedAttempts(id: string): Promise<void>;
  resetFailedAttempts(id: string): Promise<void>;
  lockAccount(id: string, lockedUntil: string): Promise<void>;
}
```

### Gateway ポート（外部 transport）

```typescript
// application/ports/gateways/mail.gateway.ts
export interface MailGateway {
  sendWelcome(to: string, opts: { idempotencyKey: string }): Promise<void>;
  sendPasswordReset(to: string, token: string): Promise<void>;
}

// application/ports/gateways/storage.gateway.ts
export interface StorageGateway {
  upload(key: string, data: Uint8Array): Promise<string>;
  delete(key: string): Promise<void>;
}
```

### セキュリティポート（hash/token 等の技術ポート。業務判断を持たない）

```typescript
// application/ports/security/password-hasher.ts
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hashed: string): Promise<boolean>;
}

// application/ports/security/token-provider.ts
export interface TokenPayload {
  userId: string;
  role: string;
}

export interface TokenProvider {
  generateAccess(payload: TokenPayload): string;
  generateRefresh(payload: TokenPayload): string;
  verifyAccess(token: string): TokenPayload | null;
  verifyRefresh(token: string): TokenPayload | null;
}
```

### UnitOfWork ポート

```typescript
// application/ports/unit-of-work.ts

import type { UserRepository } from "./repositories/user.repository";
import type { AnnouncementRepository } from "./repositories/announcement.repository";

/**
 * UnitOfWork インターフェース
 *
 * - トランザクション管理を抽象化
 * - UseCase は UnitOfWork 経由でのみ Repository にアクセス
 * - 具象実装は infrastructure/db/ で ORM 固有のトランザクションに変換
 */
export interface UnitOfWork {
  readonly userRepo: UserRepository;
  readonly announcementRepo: AnnouncementRepository;
  // 他の Repository を追加...

  /**
   * トランザクション内でコールバックを実行
   * - 成功: 自動 commit
   * - 例外: 自動 rollback
   *
   * @param fn トランザクション内で実行する処理。引数の uow は tx スコープの UnitOfWork。
   */
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
```

---

## DTO 変換チェーン

```
Request Body (unknown)
  → infrastructure/http/schemas/ で Zod parse → CreateUserInputDTO (型安全)
    → UseCase.execute() → ドメインモデル (User)
      → UserOutputDTO.fromDomain(user) → レスポンス JSON
```

### DTO 定義例

```typescript
// application/usecases/users/dto.ts

import type { User, UserRole } from "../../../domain/users/models/user";

// --- Input DTO ---

export interface CreateUserInputDTO {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserInputDTO {
  name?: string;
  email?: string;
}

export interface ListUsersInputDTO {
  search?: string;
  role?: UserRole;
  page?: number;
  limit?: number;
}

// --- Output DTO ---

export class UserOutputDTO {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly email: string,
    public readonly role: UserRole,
    public readonly createdAt: string,
  ) {}

  static fromDomain(user: User): UserOutputDTO {
    return new UserOutputDTO(user.id, user.name, user.email, user.role, user.createdAt);
  }
}

export class UserListOutputDTO {
  private constructor(
    public readonly users: UserOutputDTO[],
    public readonly total: number,
    public readonly page: number,
    public readonly limit: number,
  ) {}

  static fromDomainList(
    users: User[],
    total: number,
    page: number,
    limit: number,
  ): UserListOutputDTO {
    return new UserListOutputDTO(users.map(UserOutputDTO.fromDomain), total, page, limit);
  }
}
```

---

## UseCase 実装例

### 書き込み系（トランザクションあり）

```typescript
// application/usecases/users/create-user.usecase.ts

import { validateEmail, validatePassword } from "../../../domain/users/rules/user-rules";
import { UserAlreadyExistsError, InvalidEmailError, InvalidPasswordError } from "../../../domain/users/errors/user-errors";
import type { PasswordHasher } from "../../ports/security/password-hasher";
import type { UnitOfWork } from "../../ports/unit-of-work";
import type { CreateUserInputDTO } from "./dto";
import { UserOutputDTO } from "./dto";

export class CreateUserUseCase {
  constructor(private passwordHasher: PasswordHasher) {}

  async execute(dto: CreateUserInputDTO, uow: UnitOfWork): Promise<UserOutputDTO> {
    // 1. バリデーション（ドメインルール呼び出し）
    if (!validateEmail(dto.email)) {
      throw new InvalidEmailError(dto.email);
    }
    const passwordErrors = validatePassword(dto.password);
    if (passwordErrors.length > 0) {
      throw new InvalidPasswordError(passwordErrors);
    }

    // 2. トランザクション内でビジネスフロー実行
    const user = await uow.transaction(async (tx) => {
      const existing = await tx.userRepo.findByEmail(dto.email);
      if (existing) throw new UserAlreadyExistsError(dto.email);

      const passwordHash = await this.passwordHasher.hash(dto.password);
      return await tx.userRepo.create({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role ?? "member",
      });
    });

    return UserOutputDTO.fromDomain(user);
  }
}
```

### 読み取り系（トランザクションなし）

```typescript
// application/usecases/users/get-user.usecase.ts

import { UserNotFoundError } from "../../../domain/users/errors/user-errors";
import type { UnitOfWork } from "../../ports/unit-of-work";
import { UserOutputDTO } from "./dto";

export class GetUserUseCase {
  async execute(userId: string, uow: UnitOfWork): Promise<UserOutputDTO> {
    const user = await uow.userRepo.findById(userId);
    if (!user) throw new UserNotFoundError(userId);
    return UserOutputDTO.fromDomain(user);
  }
}
```

### 副作用あり（トランザクション外の処理）

```typescript
// application/usecases/users/create-user-with-email.usecase.ts

export class CreateUserWithEmailUseCase {
  constructor(
    private passwordHasher: PasswordHasher,
    private mailGateway: MailGateway,
  ) {}

  async execute(dto: CreateUserInputDTO, uow: UnitOfWork): Promise<UserOutputDTO> {
    // トランザクション内: DB 操作
    const user = await uow.transaction(async (tx) => {
      const passwordHash = await this.passwordHasher.hash(dto.password);
      return await tx.userRepo.create({ ...dto, passwordHash, role: dto.role ?? "member" });
    });

    // トランザクション外: 副作用（失敗しても DB はコミット済み）
    try {
      await this.mailGateway.sendWelcome(user.email, { idempotencyKey: `welcome:${user.id}` });
    } catch (e) {
      console.error("Welcome email failed:", e);
    }

    return UserOutputDTO.fromDomain(user);
  }
}
```

---

## DI (依存性注入)

### Composition Root

```typescript
// di/container.ts

// --- Infrastructure 具象実装 ---
import { DrizzleUnitOfWork } from "../infrastructure/db/drizzle-unit-of-work";
import { BcryptPasswordHasher } from "../infrastructure/security/bcrypt-password-hasher";
import { JwtTokenProvider } from "../infrastructure/security/jwt-token-provider";
import { ConsoleMailGateway } from "../infrastructure/gateways/console-mail.gateway";

// --- UseCase ---
import { CreateUserUseCase } from "../application/usecases/users/create-user.usecase";
import { GetUserUseCase } from "../application/usecases/users/get-user.usecase";
import { ListUsersUseCase } from "../application/usecases/users/list-users.usecase";
import { LoginUseCase } from "../application/usecases/users/login.usecase";

// --- ポート具象化 ---
const passwordHasher = new BcryptPasswordHasher();
const tokenProvider = new JwtTokenProvider(process.env.JWT_SECRET!);
const mailGateway = new ConsoleMailGateway();

// --- UseCase 組み立て ---
export const createUserUseCase = new CreateUserUseCase(passwordHasher);
export const getUserUseCase = new GetUserUseCase();
export const listUsersUseCase = new ListUsersUseCase();
export const loginUseCase = new LoginUseCase(passwordHasher, tokenProvider);

// --- UnitOfWork ファクトリ ---
// エントリポイント(index.ts/worker.ts)で DB を初期化後に呼ぶ
export function createUnitOfWork(db: any): UnitOfWork {
  return new DrizzleUnitOfWork(db);
}

export { tokenProvider };
```

### ドメイン単位でのファクトリ（大規模向け）

```typescript
// di/user.di.ts
export function createUserUseCases(passwordHasher: PasswordHasher, tokenProvider: TokenProvider) {
  return {
    createUser: new CreateUserUseCase(passwordHasher),
    getUser: new GetUserUseCase(),
    listUsers: new ListUsersUseCase(),
    login: new LoginUseCase(passwordHasher, tokenProvider),
  };
}

// di/container.ts
const passwordHasher = new BcryptPasswordHasher();
const tokenProvider = new JwtTokenProvider(process.env.JWT_SECRET!);
export const userUseCases = createUserUseCases(passwordHasher, tokenProvider);
```

---

## テスト時の DI

UseCase のテストでは infrastructure/ の具象実装を一切使わない。

```typescript
// __tests__/unit/usecases/create-user.test.ts

const mockPasswordHasher: PasswordHasher = {
  hash: vi.fn().mockResolvedValue("hashed-password"),
  verify: vi.fn().mockResolvedValue(true),
};

const mockUserRepo: UserRepository = {
  findByEmail: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({ id: "new-id", name: "Test", email: "test@example.com", role: "member", createdAt: "..." }),
  // ...
};

const mockUow: UnitOfWork = {
  userRepo: mockUserRepo,
  announcementRepo: {} as any,
  transaction: vi.fn(async (fn) => fn(mockUow)),
};

const useCase = new CreateUserUseCase(mockPasswordHasher);
const result = await useCase.execute({ name: "Test", email: "test@example.com", password: "pass1234" }, mockUow);
```

Drizzle も Hono も bcrypt も import していない。**純粋なビジネスロジックのテスト**。
