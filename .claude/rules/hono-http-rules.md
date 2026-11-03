---
paths:
  - "src/infrastructure/http/**/*.ts"
description: "Hono HTTP layer rules: routes, schemas, middleware, error mapper"
---

# HTTP Rules

`src/infrastructure/http/` is the only layer that knows HTTP.

## Write Here

- `routes/{domain}.routes.ts`: thin handlers — zValidator, DTO conversion,
  UseCase call, response mapping
- `schemas/{domain}.schema.ts`: Zod request/response contracts only
- `middleware/`: auth token reading, logging, CORS
- `error-mapper.ts`: `errorCode` -> HTTP status conversion (`app.onError`)
- `app.ts`: runtime-agnostic Hono app definition

## Do Not Write Here

- business logic or business branching in handlers — delegate to UseCase
- `drizzle-orm` imports — data access goes through Repository via UseCase
- domain rule duplication in schemas (validation constants come from
  `domain/{domain}/rules/`)
- per-route try/catch for domain errors — `error-mapper.ts` owns conversion
- authorization decisions — middleware reads tokens; UseCase and
  `domain/policies/` decide

## Handler Shape

```typescript
app.post("/users", zValidator("json", createUserSchema), async (c) => {
  const dto = toCreateUserInputDTO(c.req.valid("json"));
  const result = await c.var.container.createUserUseCase.execute(dto, c.var.container.unitOfWork);
  return c.json(toUserResponse(result), 201);
});
```

validation -> DTO 変換 -> UseCase -> response の4手で完結させる。
