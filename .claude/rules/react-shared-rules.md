---
paths:
  - "src/shared/**/*.ts"
  - "src/shared/**/*.tsx"
description: "React shared layer rules"
---

# Shared Rules

`src/shared/` owns domain-neutral reusable code: `components/` (Button, Modal),
`hooks/` (useDebounce), `utils/`.

## Write Here

- generic UI components with no feature knowledge
- generic hooks and utilities
- code promoted only after two real feature call sites

## Do Not Write Here

- imports of `src/features/` — the dependency direction is
  `app -> features -> shared`, never backwards
- imports of `src/app/`
- `zustand` imports — shared has no store
- feature-specific naming or business terms — if it knows the domain, it
  belongs in that feature
