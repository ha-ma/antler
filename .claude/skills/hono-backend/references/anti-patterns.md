# アンチパターン

## 1. 依存方向の違反

### 問題
内側の層が外側の層に依存すると、フレームワーク変更時に全層を修正する必要がある。

### ❌ NG

```typescript
// domain/users/rules/user-rules.ts が ORM に依存
import { eq } from "drizzle-orm";       // 禁止: domain/ は外部ライブラリに依存しない
import { usersTable } from "../../../infrastructure/db/schema";  // 禁止

// application/usecases/ が infrastructure/ に依存
import { DrizzleDB } from "../../infrastructure/db/connection";  // 禁止
import { Hono } from "hono";                                     // 禁止
```

### ✅ OK

```typescript
// domain/ は純粋 TypeScript のみ
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// application/ は domain/ と ports/ にのみ依存
import type { User } from "../../domain/users/models/user";
import type { UserRepository } from "../ports/repositories/user.repository";
```

---

## 2. ドメイン例外に HTTP statusCode

### 問題
ドメイン層が HTTP プロトコルの知識を持つと、フレームワーク独立の原則に反する。

### ❌ NG

```typescript
// domain/shared/errors/base.ts
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly errorCode: ErrorCode,
    public readonly statusCode: number,  // 禁止: ドメインは HTTP を知らない
  ) {}
}

export class UserNotFoundError extends DomainError {
  constructor(id: string) {
    super(`User not found: ${id}`, ErrorCode.RESOURCE_NOT_FOUND, 404);  // 禁止
  }
}
```

### ✅ OK

```typescript
// domain/shared/errors/base.ts — statusCode なし
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly errorCode: ErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {}
}

// infrastructure/http/error-mapper.ts — ここだけが HTTP を知る
const ERROR_STATUS_MAP: Record<string, number> = {
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_ALREADY_EXISTS]: 409,
  // ...
};
```

---

## 3. Repository/UseCase に ORM 型が露出

### 問題
Repository インターフェースに ORM 固有の型が含まれると、ORM 変更時に application 層全体を修正する必要がある。

### ❌ NG

```typescript
// application/ports/repositories/user.repository.ts
import type { LibSQLDatabase } from "drizzle-orm/libsql";  // 禁止

export interface UserRepository {
  findById(db: LibSQLDatabase, id: string): Promise<User | null>;  // 禁止
}

// application/usecases/users/create-user.usecase.ts
import type { DrizzleDB } from "../../infrastructure/db/connection";  // 禁止

export class CreateUserUseCase {
  async execute(dto: CreateUserInputDTO, db: DrizzleDB) {           // 禁止
    await db.transaction(async (tx) => {                             // 禁止
      await tx.insert(usersTable).values(...);                       // 禁止
    });
  }
}
```

### ✅ OK

```typescript
// application/ports/ — ORM の型を含まない
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
}

export interface UnitOfWork {
  readonly userRepo: UserRepository;
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}

// application/usecases/ — UnitOfWork 経由
export class CreateUserUseCase {
  async execute(dto: CreateUserInputDTO, uow: UnitOfWork) {
    return await uow.transaction(async (tx) => {
      const user = await tx.userRepo.create({ ... });
      return UserOutputDTO.fromDomain(user);
    });
  }
}
```

---

## 4. Route でビジネスロジック

### 問題
Route ハンドラにビジネスルールが混入すると、テスト困難・再利用不能・責務肥大化を招く。

### ❌ NG

```typescript
app.post("/api/announcements", authMiddleware, adminOnly, async (c) => {
  const body = await c.req.json();
  const user = c.get("user");

  // ビジネスロジックが Route に混入
  if (body.status === "published" && !body.title) {
    return c.json({ error: "公開するにはタイトルが必要" }, 400);
  }
  if (body.isPinned) {
    const pinnedCount = await db.select(...)...;
    if (pinnedCount >= 5) {
      return c.json({ error: "ピン留めは最大5件" }, 400);
    }
  }

  const id = crypto.randomUUID();
  await db.insert(announcementsTable).values({ id, ...body });
  return c.json({ id }, 201);
});
```

### ✅ OK

```typescript
app.post("/api/announcements", authMiddleware, adminOnly, async (c) => {
  const body = await c.req.json();
  const user = c.get("user");
  const dto = { ...body, authorId: user.id };
  const result = await createAnnouncementUseCase.execute(dto, unitOfWork);
  return c.json(result, 201);
});
```

ビジネスルール（公開バリデーション等）は `domain/announcements/rules/`、ピン留め上限のような
複数エンティティ横断の判断は `domain/announcements/policies/` に集約し、UseCase から呼び出す。

---

## 5. 汎用 Service レイヤの復活

### 問題
`src/services/` や、`application` 配下・`ports` 配下に汎用の service ディレクトリを作って
業務判断や技術処理を集約すると、責務が曖昧になり肥大化・テスト困難を招く。業務判断は
`domain/{domain}/policies/`、外部 transport は Gateway（`application/ports/gateways/`）、
hash/token 等の技術ポートは `application/ports/security/` に明示する。

### ❌ NG

```typescript
// application/ports/ 配下に汎用 service インターフェースを置く   ← 禁止パス
export interface PasswordService {
  hash(plain: string): Promise<string>;
}

// application 配下に汎用 service クラスを置く                    ← 禁止パス
export class AuthService {
  static async login(email: string, password: string) {
    const db = getDb();
    const users = await db.select()...;          // DB直接操作
    const user = users[0];
    if (!user) throw new Error("Not found");
    if (user.lockedUntil > new Date()) { ... }   // ビジネスロジック
    const valid = await bcrypt.compare(...);      // 技術処理
    if (!valid) {
      await db.update(usersTable)...;             // DB直接操作
      if (failedAttempts >= 5) { ... }            // ビジネスロジック
    }
    return jwt.sign({ ... });                     // 技術処理
  }
}
```

### ✅ OK

```typescript
// application/ports/security/password-hasher.ts
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hashed: string): Promise<boolean>;
}

// application/ports/security/token-provider.ts
export interface TokenProvider {
  generateAccess(payload: TokenPayload): string;
  verifyAccess(token: string): TokenPayload | null;
}

// application/usecases/users/login.usecase.ts — ビジネスフロー制御
export class LoginUseCase {
  constructor(
    private passwordHasher: PasswordHasher,
    private tokenProvider: TokenProvider,
  ) {}

  async execute(dto: LoginInputDTO, uow: UnitOfWork): Promise<LoginOutputDTO> {
    const user = await uow.userRepo.findByEmail(dto.email);
    if (!user) throw new InvalidCredentialsError();
    if (isAccountLocked(user)) throw new AccountLockedError();  // domain/users/rules/

    const valid = await this.passwordHasher.verify(dto.password, user.passwordHash);
    if (!valid) {
      await this.handleFailedLogin(uow, user);
      throw new InvalidCredentialsError();
    }
    await uow.userRepo.resetFailedAttempts(user.id);
    return { accessToken: this.tokenProvider.generateAccess({ userId: user.id, role: user.role }) };
  }
}

// domain/users/rules/user-rules.ts: 純粋ロジック
export function isAccountLocked(user: Pick<User, "lockedUntil">): boolean { ... }
```

---

## 6. エラーレスポンスで内部情報漏洩

### ❌ NG

```typescript
app.onError((err, c) => {
  return c.json({
    error: err.message,
    stack: err.stack,                    // スタックトレース漏洩
    query: "SELECT * FROM users WHERE", // SQL漏洩
    path: "/home/app/src/infrastructure/...", // パス漏洩
  }, 500);
});
```

### ✅ OK

```typescript
app.onError((err, c) => {
  if (err instanceof DomainError) {
    const status = ERROR_STATUS_MAP[err.errorCode] ?? 500;
    return c.json({ error: { code: err.errorCode, message: err.message } }, status);
  }
  console.error("Unhandled:", err);  // サーバーログにのみ出力
  return c.json({ error: { code: "INTERNAL_ERROR", message: "内部エラー" } }, 500);
});
```

---

## 7. Route から catch で例外処理（error-mapper に委譲すべき）

### ❌ NG

```typescript
app.post("/users", async (c) => {
  try {
    const result = await createUserUseCase.execute(dto, uow);
    return c.json(result, 201);
  } catch (e) {
    if (e instanceof UserNotFoundError) {
      return c.json({ error: e.message }, 404);  // 禁止: error-mapper で一括処理
    }
    if (e instanceof ValidationError) {
      return c.json({ error: e.message }, 400);  // 禁止
    }
    throw e;
  }
});
```

### ✅ OK

```typescript
// Route: try/catch なし。例外はそのまま throw。
app.post("/users", async (c) => {
  const body = await c.req.json();
  const result = await createUserUseCase.execute(body, uow);
  return c.json(result, 201);
  // ← 例外発生時: app.onError(errorHandler) が一括処理
});
```

---

## チェックリスト

新しいコードを書く前に確認:

- [ ] domain/ は純粋 TypeScript のみか？（外部ライブラリ import なし）
- [ ] application/ は domain/ と ports/ にのみ依存か？（ORM/HTTP の型なし）
- [ ] `src/services/` や、`application`・`infrastructure` 配下に汎用 service ディレクトリを作っていないか？
- [ ] DomainError に statusCode が含まれていないか？
- [ ] Repository interface に ORM の型が含まれていないか？
- [ ] UseCase は UnitOfWork 経由でのみ Repository/Gateway にアクセスしているか？
- [ ] Route は UseCase を呼ぶだけか？（ビジネスロジックなし、try/catch なし）
- [ ] トランザクションは UseCase で UnitOfWork 経由か？（Repository/Route で直接制御していないか）
- [ ] エラーレスポンスに内部情報が含まれていないか？
- [ ] 具象クラスにライブラリプレフィックスが付いているか？（DrizzleXxx, BcryptXxx）
