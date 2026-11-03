---
paths:
  - "src/infrastructure/db/**/*.ts"
description: "Hono db layer rules: Drizzle schema, connection, UnitOfWork"
---

# DB Rules

`src/infrastructure/db/` owns Drizzle schema, connections, migrations, and the
UnitOfWork implementation.

## Write Here

- `schema.ts`: Drizzle table definitions
- `connection.ts`: runtime-specific DB connections (D1/libsql/node)
- `migrate.ts` / `seed.ts`: migration and seed entrypoints
- `drizzle-unit-of-work.ts`: UnitOfWork implementation wrapping
  `db.transaction`

## Do Not Write Here

- business logic or domain rules
- HTTP knowledge or `hono` imports
- Repository query logic — that belongs in `infrastructure/repositories/`
- Zod HTTP schemas — table schema and HTTP contract are different things

## Reminder

- Drizzle テーブル定義と Domain model を混ぜない。変換は Repository が行う
- `db.transaction` を UseCase から直接呼ばない。UnitOfWork interface を経由する
