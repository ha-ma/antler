/**
 * 完全な UseCase 実装テンプレート
 *
 * ディレクトリ構成:
 *   domain/users/models/user.ts                        ← エンティティ型
 *   domain/users/rules/user-rules.ts                    ← 純粋ドメインロジック
 *   domain/users/errors/user-errors.ts                  ← ドメイン固有例外
 *   domain/shared/errors/index.ts                       ← DomainError 基底 + 汎用例外
 *   application/ports/repositories/user.repository.ts   ← Repository ポート
 *   application/ports/security/password-hasher.ts       ← セキュリティポート
 *   application/ports/unit-of-work.ts                   ← UnitOfWork ポート
 *   application/usecases/users/dto.ts                   ← DTO
 *   application/usecases/users/create-user.usecase.ts   ← UseCase
 *
 * 依存方向:
 *   UseCase → domain/ (models, rules, errors)
 *           → application/ports/ (interface のみ)
 *   UseCase は infrastructure/ を一切 import しない。
 */

// ============================================================
// domain/users/models/user.ts — エンティティ型
// ============================================================

export type UserRole = "admin" | "editor" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  failedAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// domain/users/rules/user-rules.ts — 純粋ドメインロジック
// ============================================================
// 外部 I/O なし。import は標準 TypeScript のみ。

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 8) errors.push("8文字以上必要です");
  if (!/[a-zA-Z]/.test(password)) errors.push("英字を含む必要があります");
  if (!/\d/.test(password)) errors.push("数字を含む必要があります");
  return errors;
}

export function isAccountLocked(user: Pick<User, "lockedUntil">): boolean {
  if (!user.lockedUntil) return false;
  return new Date(user.lockedUntil) > new Date();
}

export function shouldLockAccount(failedAttempts: number, maxAttempts = 5): boolean {
  return failedAttempts >= maxAttempts;
}

export function calculateLockoutUntil(durationMinutes = 30): string {
  const lockout = new Date();
  lockout.setMinutes(lockout.getMinutes() + durationMinutes);
  return lockout.toISOString();
}

// ============================================================
// domain/shared/errors/, domain/users/errors/user-errors.ts — ドメイン例外（HTTP statusCode なし）
// ============================================================

// → domain-exceptions.ts の例を参照

// ============================================================
// application/ports/repositories/user.repository.ts
// ============================================================
// ORM の型を一切含まない。

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

// ============================================================
// application/ports/security/password-hasher.ts
// ============================================================

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hashed: string): Promise<boolean>;
}

// ============================================================
// application/ports/unit-of-work.ts
// ============================================================

export interface UnitOfWork {
  readonly userRepo: UserRepository;
  // readonly announcementRepo: AnnouncementRepository;
  // ... 他の Repository

  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}

// ============================================================
// application/usecases/users/dto.ts — Input/Output DTO
// ============================================================

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

  static fromDomainList(users: User[], total: number, page: number, limit: number): UserListOutputDTO {
    return new UserListOutputDTO(users.map(UserOutputDTO.fromDomain), total, page, limit);
  }
}

// ============================================================
// application/usecases/users/create-user.usecase.ts
// ============================================================

// import { validateEmail, validatePassword } from "../../../domain/users/rules/user-rules";
// import { UserAlreadyExistsError, InvalidEmailError, InvalidPasswordError } from "../../../domain/users/errors/user-errors";
// import type { PasswordHasher } from "../../ports/security/password-hasher";
// import type { UnitOfWork } from "../../ports/unit-of-work";

export class CreateUserUseCase {
  constructor(private passwordHasher: PasswordHasher) {}

  async execute(dto: CreateUserInputDTO, uow: UnitOfWork): Promise<UserOutputDTO> {
    // 1. ドメインバリデーション
    if (!validateEmail(dto.email)) {
      throw new InvalidEmailError(dto.email);
    }
    const passwordErrors = validatePassword(dto.password);
    if (passwordErrors.length > 0) {
      throw new InvalidPasswordError(passwordErrors);
    }

    // 2. トランザクション内でビジネスフロー
    const user = await uow.transaction(async (tx) => {
      // 重複チェック (Repository 経由)
      const existing = await tx.userRepo.findByEmail(dto.email);
      if (existing) {
        throw new UserAlreadyExistsError(dto.email);
      }

      // パスワードハッシュ化 (セキュリティポート経由)
      const passwordHash = await this.passwordHasher.hash(dto.password);

      // 永続化 (Repository 経由)
      return await tx.userRepo.create({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role ?? "member",
      });
    });

    // 3. DTO に変換して返却
    return UserOutputDTO.fromDomain(user);
  }
}

// ============================================================
// application/usecases/users/get-user.usecase.ts
// ============================================================

export class GetUserUseCase {
  async execute(userId: string, uow: UnitOfWork): Promise<UserOutputDTO> {
    const user = await uow.userRepo.findById(userId);
    if (!user) throw new UserNotFoundError(userId);
    return UserOutputDTO.fromDomain(user);
  }
}

// ============================================================
// application/usecases/users/list-users.usecase.ts
// ============================================================

export class ListUsersUseCase {
  async execute(filters: ListUsersInputDTO, uow: UnitOfWork): Promise<UserListOutputDTO> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const { users, total } = await uow.userRepo.findByFilters({ ...filters, page, limit });
    return UserListOutputDTO.fromDomainList(users, total, page, limit);
  }
}

// ============================================================
// application/usecases/users/update-user.usecase.ts
// ============================================================

export class UpdateUserUseCase {
  async execute(userId: string, dto: UpdateUserInputDTO, uow: UnitOfWork): Promise<UserOutputDTO> {
    if (dto.email && !validateEmail(dto.email)) {
      throw new InvalidEmailError(dto.email);
    }

    return await uow.transaction(async (tx) => {
      const existing = await tx.userRepo.findById(userId);
      if (!existing) throw new UserNotFoundError(userId);

      if (dto.email && dto.email !== existing.email) {
        const dup = await tx.userRepo.findByEmail(dto.email);
        if (dup) throw new UserAlreadyExistsError(dto.email);
      }

      const updated = await tx.userRepo.update(userId, dto);
      return UserOutputDTO.fromDomain(updated);
    });
  }
}

// ============================================================
// テスト例: UseCase は ORM/HTTP を import せずにテスト可能
// ============================================================

/*
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPasswordHasher: PasswordHasher = {
  hash: vi.fn().mockResolvedValue("hashed"),
  verify: vi.fn().mockResolvedValue(true),
};

const mockRepo: UserRepository = {
  findByEmail: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({ id: "new", name: "T", email: "t@e.com", role: "member", createdAt: "..." }),
  // ...
};

const mockUow: UnitOfWork = {
  userRepo: mockRepo,
  transaction: vi.fn(async (fn) => fn(mockUow)),
};

describe("CreateUserUseCase", () => {
  it("ユーザーを作成できる", async () => {
    const uc = new CreateUserUseCase(mockPasswordHasher);
    const result = await uc.execute({ name: "T", email: "t@e.com", password: "pass1234" }, mockUow);
    expect(result.email).toBe("t@e.com");
  });
});
*/
