---
paths:
  - "src/infrastructure/gateways/**/*.ts"
  - "src/infrastructure/security/**/*.ts"
description: "Hono gateway and security implementation rules"
---

# Gateway / Security Rules

`src/infrastructure/gateways/` implements external-transport ports (mail,
storage, payment, LLM). `src/infrastructure/security/` implements technical
ports (`PasswordHasher`, `TokenProvider`).

## Write Here

- `gateways/{impl}-{external}.gateway.ts`: SDK/HTTP calls to external services,
  implementing `application/ports/gateways/`
- `security/{impl}-{concern}.ts`: bcrypt/JWT/crypto implementations of
  `application/ports/security/`
- retry, timeout, idempotency-key handling for outbound calls

## Do Not Write Here

- DB access or `drizzle-orm` imports — DB belongs to repositories
- business workflow or business decisions — UseCase orchestrates, policies
  decide
- `hono` imports or HTTP response shaping
- calls into `infrastructure/repositories/` — a gateway never touches
  persistence

## Reminder

- 外部副作用はコミット後に実行されるよう UseCase 側で順序を制御する
- 冪等キーを受け取れる signature にする
