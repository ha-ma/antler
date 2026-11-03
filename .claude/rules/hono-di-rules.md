---
paths:
  - "src/di/**/*.ts"
description: "Hono DI composition root rules"
---

# DI Rules

`src/di/container.ts` is the composition root — the only place that may import
every layer.

## Write Here

- construction and wiring of repositories, gateways, security implementations,
  UnitOfWork, and UseCases
- runtime-specific wiring differences (Workers vs Node) driven by entrypoints

## Do Not Write Here

- business logic, validation, or branching beyond construction
- HTTP handlers or middleware
- configuration parsing beyond what wiring needs — keep secrets/config reading
  at the entrypoint and pass values in

## Reminder

- エントリポイント（`index.ts` / `worker.ts`）が環境を読み、container を構築し、
  `infrastructure/http/app.ts` に注入する
- container の外で `new Drizzle...Repository()` しない。組み立てはここに集約する
