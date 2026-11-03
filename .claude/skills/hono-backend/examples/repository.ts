/**
 * Repository パターン実装テンプレート
 *
 * 配置:
 *   application/ports/repositories/user.repository.ts  ← ポート（interface）
 *   infrastructure/repositories/drizzle-user.repository.ts  ← 具象実装
 *   infrastructure/db/drizzle-unit-of-work.ts  ← UnitOfWork 具象実装
 *   di/container.ts  ← DI 組み立て
 *
 * 重要:
 *   - ポート（interface）には ORM の型を含めない
 *   - 具象実装クラスにはライブラリ名プレフィックス (Drizzle)
 *   - Repository はコンストラクタで db を受け取る（引数ではない）
 */

// ============================================================
// application/ports/repositories/user.repository.ts — ポート
// ============================================================
// ORM の型を一切含まない。domain/users/models/ の型のみ参照。

import type { User, UserRole } from "../../domain/users/models/user";

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
 * UserRepository ポート
 *
 * - ORM / DB 固有の型を含まない
 * - 引数に db / tx を取らない（コンストラクタ注入）
 * - UseCase はこのインターフェースにのみ依存
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

// ============================================================
// application/ports/unit-of-work.ts — UnitOfWork ポート
// ============================================================

export interface UnitOfWork {
  readonly userRepo: UserRepository;
  // readonly announcementRepo: AnnouncementRepository;

  /**
   * トランザクション内でコールバックを実行
   * 引数 uow は tx スコープの UnitOfWork（全 repo が同じ tx を共有）
   */
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}

// ============================================================
// infrastructure/repositories/drizzle-user.repository.ts — 具象実装
// ============================================================
// Drizzle 固有のコード。application/ からは import されない。

import { eq, like, or, sql, desc } from "drizzle-orm";
import { usersTable } from "../db/schema";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

type DrizzleDB = LibSQLDatabase;

/**
 * Drizzle ORM による UserRepository 実装
 *
 * - コンストラクタで db を受け取る
 * - UnitOfWork が tx スコープで new DrizzleUserRepository(tx) を生成
 * - Repository 自身はトランザクション制御しない
 */
export class DrizzleUserRepository implements UserRepository {
  constructor(private db: DrizzleDB) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    return (rows[0] as User | undefined) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
    return (rows[0] as User | undefined) ?? null;
  }

  async findByFilters(
    filters: UserFilters,
  ): Promise<{ users: User[]; total: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (filters.search) {
      conditions.push(
        or(
          like(usersTable.name, `%${filters.search}%`),
          like(usersTable.email, `%${filters.search}%`),
        ),
      );
    }
    if (filters.role) {
      conditions.push(eq(usersTable.role, filters.role));
    }

    let query = this.db.select().from(usersTable);
    for (const cond of conditions) {
      if (cond) query = query.where(cond);
    }

    const [users, countResult] = await Promise.all([
      query.orderBy(desc(usersTable.createdAt)).limit(limit).offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(usersTable)
        .where(conditions[0]),
    ]);

    return { users: users as User[], total: countResult[0]?.count ?? 0 };
  }

  async create(data: CreateUserData): Promise<User> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = {
      id,
      ...data,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(usersTable).values(record);
    return record as User;
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    await this.db
      .update(usersTable)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(usersTable.id, id));

    const updated = await this.findById(id);
    if (!updated) throw new Error(`User ${id} not found after update`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(usersTable).where(eq(usersTable.id, id));
  }

  async exists(id: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, id));
    return rows.length > 0;
  }

  async incrementFailedAttempts(id: string): Promise<void> {
    await this.db
      .update(usersTable)
      .set({
        failedAttempts: sql`${usersTable.failedAttempts} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(usersTable.id, id));
  }

  async resetFailedAttempts(id: string): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
      .where(eq(usersTable.id, id));
  }

  async lockAccount(id: string, lockedUntil: string): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ lockedUntil, updatedAt: new Date().toISOString() })
      .where(eq(usersTable.id, id));
  }
}

// ============================================================
// infrastructure/db/drizzle-unit-of-work.ts — UnitOfWork 具象実装
// ============================================================

/**
 * Drizzle ORM による UnitOfWork 実装
 *
 * transaction() 内で新しい DrizzleUnitOfWork を生成し、
 * 全 Repository が同じ tx を共有する。
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  readonly userRepo: UserRepository;
  // readonly announcementRepo: AnnouncementRepository;

  constructor(private db: DrizzleDB) {
    this.userRepo = new DrizzleUserRepository(db);
    // this.announcementRepo = new DrizzleAnnouncementRepository(db);
  }

  async transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => {
      // tx スコープの UnitOfWork を新規生成
      // → 全 Repository が tx を共有 = 一貫性保証
      const txUow = new DrizzleUnitOfWork(tx as unknown as DrizzleDB);
      return await fn(txUow);
    });
  }
}

// ============================================================
// di/container.ts — DI 組み立て（Composition Root）
// ============================================================

// import { DrizzleUnitOfWork } from "../infrastructure/db/drizzle-unit-of-work";
// import { BcryptPasswordHasher } from "../infrastructure/security/bcrypt-password-hasher";
// import { JwtTokenProvider } from "../infrastructure/security/jwt-token-provider";
// import { CreateUserUseCase } from "../application/usecases/users/create-user.usecase";

// セキュリティポート具象化
// const passwordHasher = new BcryptPasswordHasher();
// const tokenProvider = new JwtTokenProvider(process.env.JWT_SECRET!);

// UseCase 組み立て（PasswordHasher を注入）
// export const createUserUseCase = new CreateUserUseCase(passwordHasher);
// export const getUserUseCase = new GetUserUseCase();
// export const listUsersUseCase = new ListUsersUseCase();

// UnitOfWork ファクトリ
// エントリポイント(index.ts)で DB 初期化後に呼ぶ
// export function createUnitOfWork(db: any): UnitOfWork {
//   return new DrizzleUnitOfWork(db);
// }

// ============================================================
// テスト用モック
// ============================================================

import { vi } from "vitest";

/**
 * モック UserRepository
 * UseCase テストで使用。Drizzle を import しない。
 */
export function createMockUserRepo(
  overrides?: Partial<UserRepository>,
): UserRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    findByFilters: vi.fn().mockResolvedValue({ users: [], total: 0 }),
    create: vi.fn().mockImplementation(async (data) => ({
      id: "mock-id",
      ...data,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    })),
    update: vi.fn().mockImplementation(async (id, data) => ({
      id,
      name: data.name ?? "Mock",
      email: data.email ?? "mock@example.com",
      role: "member",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: new Date().toISOString(),
    })),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    incrementFailedAttempts: vi.fn().mockResolvedValue(undefined),
    resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
    lockAccount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * モック UnitOfWork
 * transaction() をパススルーする。
 */
export function createMockUnitOfWork(userRepo: UserRepository): UnitOfWork {
  const uow: UnitOfWork = {
    userRepo,
    transaction: vi.fn(async (fn) => fn(uow)),
  };
  return uow;
}
