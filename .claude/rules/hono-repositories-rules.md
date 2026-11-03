---
paths:
  - "src/infrastructure/repositories/**/*.ts"
description: "Hono repository implementation rules"
---

# Repository Rules

`src/infrastructure/repositories/` owns Drizzle implementations of the
Repository ports. Drizzle is confined here and to `infrastructure/db/`.

## Write Here

- `drizzle-{domain}.repository.ts` implementing
  `application/ports/repositories/{domain}.repository.ts`
- Drizzle queries and DB record <-> domain model conversion
- query-level concerns: pagination, filtering, eager loading

## Do Not Write Here

- business decisions or validation — they belong in `domain/{domain}/policies/`
  and UseCase
- transaction finalization — `commit`/`rollback` is the UnitOfWork's job
- external API/SDK calls — they belong in `infrastructure/gateways/`
- `hono` imports or HTTP knowledge
- throwing HTTP-shaped errors — throw domain errors or infrastructure errors

## Conversion Rule

The repository converts between Drizzle records and domain models. Domain
models never leak Drizzle types; Drizzle records never leave this layer.
