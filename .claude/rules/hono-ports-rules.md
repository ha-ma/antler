---
paths:
  - "src/application/ports/**/*.ts"
description: "Hono application ports rules (interfaces only)"
---

# Ports Rules

`src/application/ports/` owns driven-port interfaces. Implementations live in
`infrastructure/`.

## Write Here

- `repositories/{domain}.repository.ts`: Repository interfaces using domain
  types only
- `gateways/{external}.gateway.ts`: external transport interfaces (mail,
  storage, payment, LLM)
- `security/{concern}.ts`: technical port interfaces (`PasswordHasher`,
  `TokenProvider`)
- `unit-of-work.ts`: transaction boundary interface

## Do Not Write Here

- implementations — only `interface` / `type` declarations
- ORM types (`drizzle-orm`), HTTP types (`hono`), or SDK types in signatures
- a generic `ports/services/` directory — name ports by role: Repository /
  Gateway / security
- business logic — decisions belong in `domain/{domain}/policies/`

## Naming

```text
DB access                -> {domain}.repository.ts  (interface {Domain}Repository)
External transport       -> {external}.gateway.ts   (interface {External}Gateway)
Hash/token/crypto        -> security/{concern}.ts   (PasswordHasher, TokenProvider)
Transaction boundary     -> unit-of-work.ts         (interface UnitOfWork)
```
