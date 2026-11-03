---
paths:
  - "src/**/*.ts"
description: "Hono Clean Architecture: Route -> UseCase -> Domain -> Repository/Gateway"
---

# MUST

- Route handler は薄く保つ。validation、UseCase 呼び出し、response 変換だけにする
- UseCase は Application Service。順序、分岐、権限、トランザクション境界、失敗時方針を持つ
- Domain は Hono/Drizzle/Zod/外部ライブラリを知らない純粋な業務層にする
- Domain は関心ごとに `models/`、`value-objects/`、`rules/`、`policies/`、`events/`、`errors/` を分ける
- Repository interface は `application/ports/`、Drizzle 実装は `infrastructure/repositories/`
- Gateway は外部 transport（mail/storage/決済/LLM）専用。Repository に混ぜない
- UseCase/Domain で `Context` や HTTP status を使わない。ドメイン例外を `error-mapper` で変換する
- 汎用 `Service` レイヤ（`src/services/`、`application/services/`、`ports/services/`）を作らない

# Directory

```
src/
  domain/{domain}/
    models/{noun}.ts
    value-objects/{noun}.ts
    rules/{noun}-rules.ts
    policies/{noun}-policy.ts
    events/{noun}-events.ts
    errors/{noun}-errors.ts
  application/
    ports/
      repositories/{domain}.repository.ts
      gateways/{external}.gateway.ts
      security/{concern}.ts
      unit-of-work.ts
    usecases/{domain}/
      {verb}-{domain}.usecase.ts
      dto.ts
  infrastructure/
    db/            # schema.ts, connection.ts, migrate.ts, seed.ts, drizzle-unit-of-work.ts
    repositories/  # drizzle-{domain}.repository.ts
    gateways/      # {impl}-{external}.gateway.ts
    security/      # {impl}-{concern}.ts
    http/
      app.ts
      error-mapper.ts
      schemas/{domain}.schema.ts
      routes/{domain}.routes.ts
      middleware/
    jobs/{domain}/{job}.job.ts
    commands/{command}.ts
  di/container.ts
  index.ts / worker.ts
tests/factories/
```

# Path-Specific Rules

Claude must apply the matching layer rule before creating or editing a file in
these locations.

- `src/domain/**` -> `hono-domain-rules.md`
- `src/application/ports/**` -> `hono-ports-rules.md`
- `src/application/usecases/**` -> `hono-usecases-rules.md`
- `src/infrastructure/http/**` -> `hono-http-rules.md`
- `src/infrastructure/repositories/**` -> `hono-repositories-rules.md`
- `src/infrastructure/gateways/**`, `src/infrastructure/security/**` -> `hono-gateways-rules.md`
- `src/infrastructure/db/**` -> `hono-db-rules.md`
- `src/di/**` -> `hono-di-rules.md`

# Dependency Direction

```
infrastructure -> application -> domain
di -> all layers (composition only)
```

- `domain -> application/infrastructure/di/外部ライブラリ`: NG
- `application -> infrastructure/di/hono/drizzle-orm`: NG
- `routes -> drizzle-orm 直接 import`: NG（Repository 経由）
- `usecases -> Context/HTTPException/HTTP status`: NG（ドメイン例外 + error-mapper）
- `repositories -> gateways`、`gateways -> repositories`: NG
- `di -> all`: OK（組み立てのみ。業務ロジック禁止）

# Route Pattern

```typescript
// GOOD: thin route
import { zValidator } from "@hono/zod-validator";
import { createUserSchema } from "../schemas/user.schema";

app.post("/users", zValidator("json", createUserSchema), async (c) => {
  const dto = toCreateUserInputDTO(c.req.valid("json"));
  const result = await c.var.container.createUserUseCase.execute(dto, c.var.container.unitOfWork);
  return c.json(toUserResponse(result), 201);
});

// BAD: route owns business and persistence
app.post("/users", async (c) => {
  const body = await c.req.json();                       // Zod なし
  if (!body.email.includes("@")) return c.json({}, 400); // 業務判断
  const db = drizzle(c.env.DB);
  await db.insert(users).values(body);                   // 直接 DB 操作
  return c.json(body);
});
```

# Domain Policy Pattern

Policy は DB/API を知らない業務判断だけを扱う。UseCase が Repository で取得した
Domain model を渡し、Policy が判断する。

```typescript
// domain/users/policies/invitation-policy.ts（純粋関数）
export function ensureCanInvite(inviter: User, team: Team): void {
  if (!isTeamAdmin(inviter, team)) {
    throw new UserCannotInviteError(inviter.id, team.id);
  }
}
```

# Reminder

- UseCase に Drizzle の DB 型を渡さない。`UnitOfWork` interface を渡す
- `src/services/` / `application/services/` / `ports/services/` を作らない
- `Bash` / Python shell / 生成スクリプトで `src/**/*.ts` を生成・上書きしない。`Write` / `Edit` / `MultiEdit` 経由にする
- Domain policies は I/O しない。Repository/Gateway も呼ばない
- 外部副作用は Gateway に閉じ、コミット後実行、冪等性を検討する
