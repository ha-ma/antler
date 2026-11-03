---
paths:
  - "src/**/*.ts"
description: "Hono patterns: Zod schemas, UseCase, UnitOfWork, error mapping, RPC"
---

# Zod Schema（HTTP 契約のみ）

- Zod schema は `infrastructure/http/schemas/` に置く
- schema は HTTP request/response 契約だけを持つ。Domain model を re-export しない
- schema <-> DTO の変換は Route で明示する

```typescript
// infrastructure/http/schemas/user.schema.ts
import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
}).strict();

export type CreateUserRequest = z.infer<typeof createUserSchema>;
```

# UseCase Pattern

```typescript
// application/usecases/users/create-user.usecase.ts
export class CreateUserUseCase {
  constructor(
    private readonly passwordHasher: PasswordHasher,
    private readonly mailGateway: MailGateway,
  ) {}

  async execute(dto: CreateUserInputDTO, uow: UnitOfWork): Promise<CreateUserOutputDTO> {
    ensureValidEmail(dto.email); // domain rule

    const user = await uow.transaction(async (tx) => {
      const existing = await tx.userRepo.findByEmail(dto.email);
      if (existing) throw new UserAlreadyExistsError(dto.email);
      const passwordHash = await this.passwordHasher.hash(dto.password);
      return tx.userRepo.create({ ...dto, passwordHash });
    });

    await this.mailGateway.sendWelcome(user.email, { idempotencyKey: `welcome:${user.id}` });
    return toCreateUserOutputDTO(user);
  }
}
```

# Error Handling

- Domain/UseCase はドメイン例外（`errorCode` のみ、HTTP status なし）を投げる
- HTTP 変換は `infrastructure/http/error-mapper.ts` に集約する
- Route ごとの try/catch 量産は禁止

```typescript
// infrastructure/http/error-mapper.ts（HTTP を知る唯一の場所）
app.onError((err, c) => {
  if (err instanceof DomainError) {
    const status = ERROR_STATUS_MAP[err.errorCode] ?? 500;
    return c.json({ error: { code: err.errorCode, message: err.message } }, status);
  }
  return c.json({ error: { code: "INTERNAL_ERROR", message: "internal error" } }, 500);
});
```

# UnitOfWork

- `commit`/`rollback` は UnitOfWork の責務。Repository は書き込みを持つが確定しない
- UseCase は `application/ports/unit-of-work.ts` の interface にのみ依存する
- Drizzle 実装は `infrastructure/db/drizzle-unit-of-work.ts`

# Hono RPC

```typescript
import { hc } from "hono/client";
import type { AppType } from "@/infrastructure/http/app";

const client = hc<AppType>("http://localhost:8787");
```

# Middleware

- 認証: `infrastructure/http/middleware/auth.middleware.ts`。認可の業務判断は UseCase / `domain/policies/`
- CORS: 本番で `origin: "*"` を使わない。環境別 allowlist
- エラーハンドリング: `app.onError()`（error-mapper）で統一

# Tests

- domain rules/policies は pure unit test（最速・最多）
- UseCase は ports の fake で orchestration を test
- Repository 実装は test DB（D1/libsql）で integration test
- Route は Hono の `app.request()` で主要 happy/error path を test
- テストデータは `tests/factories/` のビルダーを使う
