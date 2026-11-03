# レイヤ別ルール

## 同心円モデル

```
┌──────────────────────────────────────────────────┐
│  infrastructure/        (Frameworks & Drivers)    │
│    Hono, Drizzle, bcryptjs, jsonwebtoken 等       │
│  ┌──────────────────────────────────────────┐    │
│  │  application/     (Application Rules)     │    │
│  │    UseCase, DTO, Ports (interface)         │    │
│  │  ┌──────────────────────────────────┐    │    │
│  │  │  domain/    (Enterprise Rules)    │    │    │
│  │  │    Models, Rules, Policies, Errors │    │    │
│  │  └──────────────────────────────────┘    │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

**依存ルール**: 内側の層は外側の層を知らない。依存は常に外から内へ向かう。

---

## domain/ (Enterprise Business Rules)

**責務**: 組織横断で使えるビジネスルールとエンティティ。アプリケーション固有の知識を持たない。
ドメインごとに `domain/{domain}/` 配下へ分割し、関心ごとに `models/`、`value-objects/`、
`rules/`、`policies/`、`events/`、`errors/` を分ける。

**制約**: **外部ライブラリへの依存ゼロ**。純粋な TypeScript のみ。

### domain/{domain}/models/ — エンティティ / 値オブジェクト

```typescript
// ✅ 純粋な TypeScript 型定義
// domain/users/models/user.ts
export type UserRole = "admin" | "editor" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  failedAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### domain/{domain}/rules/ — 純粋ドメインロジック（単一エンティティの妥当性判定）

```typescript
// ✅ 純粋関数。外部 I/O なし。テスト最速。
// domain/users/rules/user-rules.ts
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isAccountLocked(user: Pick<User, "lockedUntil">): boolean {
  if (!user.lockedUntil) return false;
  return new Date(user.lockedUntil) > new Date();
}
```

### domain/{domain}/policies/ — 認可・複数エンティティ横断の業務判断

```typescript
// ✅ 純粋関数。DB/API を知らない。UseCase が Repository で取得した Domain model を渡す。
// domain/teams/policies/invitation-policy.ts
export function ensureCanInvite(inviter: User, team: Team): void {
  if (!isTeamAdmin(inviter, team)) {
    throw new UserCannotInviteError(inviter.id, team.id);
  }
}
```

### domain/{domain}/errors/, domain/shared/errors/ — ドメイン例外

```typescript
// ✅ HTTP ステータスコードを持たない。ドメインは HTTP を知らない。
// domain/shared/errors/base.ts
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly errorCode: ErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
```

ドメイン横断の `DomainError` 基底クラスと `ErrorCode` は `domain/shared/errors/` に置き、
`UserNotFoundError` のようなドメイン固有の例外は `domain/{domain}/errors/{domain}-errors.ts` に置く。

### NG（domain/ でやってはいけないこと）

```typescript
// ❌ domain/ で外部ライブラリを import
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ❌ domain/ で I/O を行う
export async function validateUniqueEmail(email: string, db: any) {
  const rows = await db.select()...;  // 禁止
}

// ❌ domain/ で HTTP を意識する
export class UserNotFoundError extends DomainError {
  constructor(id: string) {
    super("Not found", ErrorCode.RESOURCE_NOT_FOUND, 404);  // statusCode 禁止
  }
}
```

---

## application/ (Application Business Rules)

**責務**: アプリケーション固有のビジネスフロー制御。domain/ にのみ依存。

**制約**: HTTP フレームワーク（Hono）、ORM（Drizzle）の型を **一切 import しない**。
**禁止**: 汎用 `Service` レイヤ（`application` 配下・`ports` 配下の汎用 services ディレクトリ）。

### application/ports/ — インターフェース定義

```typescript
// ✅ Repository: ORM の型を含まない純粋なインターフェース
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
  delete(id: string): Promise<void>;
}

// ✅ セキュリティポート: 技術実装の詳細を隠蔽（業務判断を持たない）
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hashed: string): Promise<boolean>;
}

export interface TokenProvider {
  generateAccess(payload: TokenPayload): string;
  verifyAccess(token: string): TokenPayload | null;
}

// ✅ Gateway ポート: 外部 transport のインターフェース（Repository に混ぜない）
export interface MailGateway {
  sendWelcome(to: string, opts: { idempotencyKey: string }): Promise<void>;
}

// ✅ UnitOfWork: トランザクション管理の抽象化
export interface UnitOfWork {
  readonly userRepo: UserRepository;
  readonly announcementRepo: AnnouncementRepository;
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
```

### application/usecases/ — UseCase

```typescript
// ✅ domain/ と ports/ にのみ依存。フレームワーク非依存。
export class CreateUserUseCase {
  constructor(private passwordHasher: PasswordHasher) {}

  async execute(dto: CreateUserInputDTO, uow: UnitOfWork): Promise<UserOutputDTO> {
    if (!validateEmail(dto.email)) throw new InvalidEmailError(dto.email);

    return await uow.transaction(async (tx) => {
      const existing = await tx.userRepo.findByEmail(dto.email);
      if (existing) throw new UserAlreadyExistsError(dto.email);

      const passwordHash = await this.passwordHasher.hash(dto.password);
      const user = await tx.userRepo.create({ ...dto, passwordHash });
      return UserOutputDTO.fromDomain(user);
    });
  }
}
```

### NG（application/ でやってはいけないこと）

```typescript
// ❌ ORM の型を import
import type { LibSQLDatabase } from "drizzle-orm/libsql";

// ❌ HTTP フレームワークの型を import
import type { Context } from "hono";

// ❌ UseCase で HTTP レスポンスを返す
async execute(dto: CreateUserInputDTO, c: Context) {
  return c.json({ ... }, 201);  // 禁止
}

// ❌ UseCase で DB 固有のクエリを実行
async execute(dto: CreateUserInputDTO, db: DrizzleDB) {
  await db.select().from(usersTable)...;  // 禁止
}

// ❌ 汎用 Service を作る
// application 配下・ports 配下に汎用の service クラス/インターフェースを置くのは禁止
```

---

## infrastructure/ (Frameworks & Drivers)

**責務**: フレームワーク固有コードの実装。application/ports/ のインターフェースを具象化する。

**制約**: なし（全層を import 可能）。ただし **ビジネスロジックを含めない**。

### infrastructure/repositories/ — Repository 具象実装

```typescript
// ✅ Drizzle 固有の実装。application/ports/ の interface を implements。
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

### infrastructure/db/drizzle-unit-of-work.ts — UnitOfWork 実装

```typescript
// ✅ Drizzle のトランザクションを UnitOfWork に変換
export class DrizzleUnitOfWork implements UnitOfWork {
  readonly userRepo: UserRepository;
  readonly announcementRepo: AnnouncementRepository;

  constructor(private db: DrizzleDB) {
    this.userRepo = new DrizzleUserRepository(db);
    this.announcementRepo = new DrizzleAnnouncementRepository(db);
  }

  async transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => {
      const txUow = new DrizzleUnitOfWork(tx as unknown as DrizzleDB);
      return await fn(txUow);
    });
  }
}
```

### infrastructure/http/ — HTTP フレームワーク

```typescript
// ✅ Route は UseCase を呼ぶだけの薄いアダプター
app.post("/users", adminOnly, async (c) => {
  const body = await c.req.json();
  const result = await createUserUseCase.execute(body, unitOfWork);
  return c.json(result, 201);
});

// ✅ error-mapper: ErrorCode → HTTP ステータスコード（ここだけが HTTP を知る）
app.onError((err, c) => {
  if (err instanceof DomainError) {
    const status = ERROR_STATUS_MAP[err.errorCode] ?? 500;
    return c.json({ error: { code: err.errorCode, message: err.message } }, status);
  }
  return c.json({ error: { code: "INTERNAL_ERROR", message: "内部エラー" } }, 500);
});
```

### infrastructure/security/ — 技術ポートの具象実装

```typescript
// ✅ application/ports/security/ の interface を実装
export class BcryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }
  async verify(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }
}

export class JwtTokenProvider implements TokenProvider {
  constructor(private secret: string) {}
  generateAccess(payload: TokenPayload): string {
    return jwt.sign(payload, this.secret, { expiresIn: "15m" });
  }
  verifyAccess(token: string): TokenPayload | null {
    try { return jwt.verify(token, this.secret) as TokenPayload; }
    catch { return null; }
  }
}
```

### infrastructure/gateways/ — 外部 transport の具象実装

```typescript
// ✅ application/ports/gateways/ の interface を実装
export class ResendMailGateway implements MailGateway {
  constructor(private apiKey: string) {}
  async sendWelcome(to: string, opts: { idempotencyKey: string }): Promise<void> {
    // Resend API 呼び出し（冪等キーで重複送信を防ぐ）
  }
}
```

### NG（infrastructure/ でやってはいけないこと）

```typescript
// ❌ Repository にビジネスロジック
async create(data: CreateUserData): Promise<User> {
  if (data.role === "admin") throw new Error("管理者は作成不可");  // 禁止
}

// ❌ Route にビジネスロジック
app.post("/users", async (c) => {
  const body = await c.req.json();
  if (body.email.endsWith("@competitor.com")) {  // 禁止
    return c.json({ error: "forbidden" }, 403);
  }
});
```

---

## 例外の流れ

```
domain/shared/errors/, domain/{domain}/errors/ → DomainError を定義（ErrorCode のみ、statusCode なし）
                     ↓
application/     → UseCase が DomainError を throw
                     ↓
infrastructure/  → error-mapper が ErrorCode → HTTP ステータスに変換
```

HTTP の知識は **infrastructure/http/error-mapper.ts にのみ** 存在する。
