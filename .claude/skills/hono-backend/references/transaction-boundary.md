# トランザクション管理

## 基本原則

**UseCase 層だけがトランザクション境界を決定する。UnitOfWork 経由で抽象的に制御する。**

| レイヤ | トランザクション操作 |
|--------|-------------------|
| infrastructure/http/ (routes) | ❌ 禁止 |
| application/usecases/ | ✅ `uow.transaction()` で制御 |
| infrastructure/gateways/, infrastructure/security/ | ❌ 禁止 |
| infrastructure/repositories/ | ❌ 禁止（渡された状態を使うのみ） |

## UnitOfWork パターン

UseCase は ORM 固有のトランザクション API を知らない。`UnitOfWork` インターフェースが抽象化する。

### ポート定義（application 層）

```typescript
// application/ports/unit-of-work.ts

export interface UnitOfWork {
  readonly userRepo: UserRepository;
  readonly announcementRepo: AnnouncementRepository;

  /**
   * トランザクション内でコールバックを実行
   * - 正常完了: 自動 commit
   * - 例外発生: 自動 rollback
   */
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
```

### 具象実装（infrastructure 層）

```typescript
// infrastructure/db/drizzle-unit-of-work.ts

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { UnitOfWork } from "../../application/ports/unit-of-work";
import { DrizzleUserRepository } from "../repositories/drizzle-user.repository";
import { DrizzleAnnouncementRepository } from "../repositories/drizzle-announcement.repository";

type DrizzleDB = LibSQLDatabase;

export class DrizzleUnitOfWork implements UnitOfWork {
  readonly userRepo: UserRepository;
  readonly announcementRepo: AnnouncementRepository;

  constructor(private db: DrizzleDB) {
    this.userRepo = new DrizzleUserRepository(db);
    this.announcementRepo = new DrizzleAnnouncementRepository(db);
  }

  async transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => {
      // tx スコープの UnitOfWork を生成
      // → tx 内の Repository は全て同じトランザクションを共有
      const txUow = new DrizzleUnitOfWork(tx as unknown as DrizzleDB);
      return await fn(txUow);
    });
  }
}
```

**ポイント**: `transaction()` 内で新しい `DrizzleUnitOfWork` を生成することで、トランザクション内の全 Repository が同じ `tx` を共有する。

---

## 正しいパターン

### 書き込み系 UseCase

```typescript
export class CreateUserUseCase {
  constructor(private passwordHasher: PasswordHasher) {}

  async execute(dto: CreateUserInputDTO, uow: UnitOfWork): Promise<UserOutputDTO> {
    // バリデーション（トランザクション外で OK）
    if (!validateEmail(dto.email)) {
      throw new InvalidEmailError(dto.email);
    }

    // トランザクション内: DB 操作
    const user = await uow.transaction(async (tx) => {
      const existing = await tx.userRepo.findByEmail(dto.email);
      if (existing) throw new UserAlreadyExistsError(dto.email);

      const passwordHash = await this.passwordHasher.hash(dto.password);
      return await tx.userRepo.create({ ...dto, passwordHash, role: dto.role ?? "member" });
    });

    return UserOutputDTO.fromDomain(user);
  }
}
```

### 複数 Repository をまたぐ操作

```typescript
export class DeleteUserUseCase {
  async execute(userId: string, uow: UnitOfWork): Promise<void> {
    // 存在確認（トランザクション外でも可）
    const user = await uow.userRepo.findById(userId);
    if (!user) throw new UserNotFoundError(userId);

    // 複数テーブルを1トランザクションで操作
    await uow.transaction(async (tx) => {
      await tx.tokenRepo.deleteByUserId(userId);  // 関連データ削除
      await tx.userRepo.delete(userId);            // ユーザー削除
      // ← 両方成功で commit、どちらか失敗で rollback
    });
  }
}
```

### 読み取り専用（トランザクション不要）

```typescript
export class GetUserUseCase {
  async execute(userId: string, uow: UnitOfWork): Promise<UserOutputDTO> {
    // 読み取りのみ → transaction() 不要
    const user = await uow.userRepo.findById(userId);
    if (!user) throw new UserNotFoundError(userId);
    return UserOutputDTO.fromDomain(user);
  }
}
```

---

## Repository の実装

Repository は自身が持つ `db` を使うだけ。トランザクション制御はしない。

```typescript
// infrastructure/repositories/drizzle-user.repository.ts

export class DrizzleUserRepository implements UserRepository {
  constructor(private db: DrizzleDB) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(usersTable).where(eq(usersTable.id, id));
    return rows[0] ?? null;
  }

  async create(data: CreateUserData): Promise<User> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = { id, ...data, failedAttempts: 0, lockedUntil: null, createdAt: now, updatedAt: now };
    await this.db.insert(usersTable).values(record);
    return record;
  }
}
```

`DrizzleUnitOfWork.transaction()` で tx スコープの UnitOfWork が生成されるため、Repository は通常の db として使えるが、実際には tx 内で動作する。

---

## 副作用の扱い

トランザクション成功後に実行すべき副作用（メール送信等）は、**トランザクションの外**で実行する。
外部 transport（メール送信等）は Gateway 経由で呼び出す。

```typescript
export class CreateUserWithNotificationUseCase {
  constructor(
    private passwordHasher: PasswordHasher,
    private mailGateway: MailGateway,
  ) {}

  async execute(dto: CreateUserInputDTO, uow: UnitOfWork): Promise<UserOutputDTO> {
    // トランザクション内: DB 操作のみ
    const user = await uow.transaction(async (tx) => {
      const passwordHash = await this.passwordHasher.hash(dto.password);
      return await tx.userRepo.create({ ...dto, passwordHash, role: dto.role ?? "member" });
    });
    // ← ここまでで DB はコミット済み

    // トランザクション外: 副作用（冪等キーで重複送信を防ぐ）
    try {
      await this.mailGateway.sendWelcome(user.email, { idempotencyKey: `welcome:${user.id}` });
    } catch (e) {
      console.error("Email failed:", e);
      // メール失敗はユーザー作成を rollback しない
    }

    return UserOutputDTO.fromDomain(user);
  }
}
```

---

## ORM を差し替える場合

1. `UnitOfWork` インターフェースは変更不要
2. `DrizzleUnitOfWork` → `PrismaUnitOfWork` 等に差し替え
3. `DrizzleUserRepository` → `PrismaUserRepository` 等に差し替え
4. application/ と domain/ は **一切変更不要**

---

## アンチパターン

```typescript
// ❌ Repository でトランザクション制御
export class DrizzleUserRepository {
  async createWithProfile(data: CreateUserData) {
    await this.db.transaction(async (tx) => {    // 禁止: UseCase の責務
      await tx.insert(usersTable).values(...);
      await tx.insert(profilesTable).values(...);
    });
  }
}

// ❌ Route でトランザクション制御
app.post("/users", async (c) => {
  await db.transaction(async (tx) => {           // 禁止: UseCase の責務
    // ...
  });
});

// ❌ UseCase が ORM 固有の API を直接使う
export class CreateUserUseCase {
  async execute(dto: CreateUserInputDTO, db: DrizzleDB) {
    await db.transaction(async (tx) => {         // 禁止: UnitOfWork 経由にする
      await tx.insert(usersTable).values(...);   // 禁止: Repository 経由にする
    });
  }
}
```
