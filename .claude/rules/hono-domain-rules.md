---
paths:
  - "src/domain/**/*.ts"
description: "Hono domain layer rules (pure, per concern)"
---

# Domain Rules

`src/domain/{domain}/` owns pure business models, rules, and contracts, split
per concern. Zero dependency on external libraries — pure TypeScript only.

## Write Here

- `models/{noun}.ts`: domain models and types
- `value-objects/{noun}.ts`: validated value types
- `rules/{noun}-rules.ts`: pure business constants and invariants
- `policies/{noun}-policy.ts`: pure authorization/business decisions
- `events/{noun}-events.ts`: domain event types
- `errors/{noun}-errors.ts`: domain errors carrying `errorCode` only

## Do Not Write Here

- imports of `hono`, `drizzle-orm`, `zod`, `bcryptjs`, `jsonwebtoken`, or any
  external library
- imports of `application/`, `infrastructure/`, `di/`
- I/O of any kind — no `fetch`, no DB access, no `Date.now()`-dependent logic
  hidden inside rules (pass timestamps in as arguments)
- HTTP status codes in errors — the error-mapper owns HTTP knowledge

## Concern Selection

```text
Shape/type of the thing        -> models/
Validated value type           -> value-objects/
Constant or invariant          -> rules/
"May X do Y?" decision         -> policies/
Something happened             -> events/
Business failure               -> errors/
```
