---
paths:
  - "src/application/usecases/**/*.ts"
description: "Hono UseCase layer rules"
---

# UseCase Rules

`src/application/usecases/{domain}/` is the Application Service layer.

## Write Here

- one user/application operation per UseCase
- ordering, branching, permission checks, consistency decisions
- UnitOfWork orchestration
- calls to Repository/Gateway/security port interfaces
- UseCase input/output DTOs (`dto.ts`)

## Do Not Write Here

- `hono` imports — no `Context`, no `HTTPException`, no HTTP status codes
- `drizzle-orm` imports or raw queries — depend on Repository ports
- direct `fetch`/SDK calls — depend on Gateway ports
- Zod schemas — HTTP contracts live in `infrastructure/http/schemas/`
- heavy business decisions that belong in `domain/{domain}/policies/`
- imports of `infrastructure/` or `di/`

## Conversion Rule

```text
HTTP schema <-> UseCase DTO: Route (infrastructure/http)
UseCase DTO <-> Domain model: UseCase
DB record   <-> Domain model: Repository implementation
```

UseCase returns an output DTO, not a Drizzle record or HTTP response shape.
