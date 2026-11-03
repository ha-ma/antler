---
paths:
  - "src/features/*/index.ts"
  - "src/features/*/types.ts"
description: "React feature public API (barrel) and types rules"
---

# Feature API Rules

`index.ts` is the feature's public API (barrel); `types.ts` owns its types.

## Write Here (index.ts)

- named re-exports of the components/hooks/types other features may use
- nothing else — no logic, no side effects

## Write Here (types.ts)

- feature-specific type definitions

## Do Not Write Here

- re-exporting the store or internal components not meant for other features
- `export *` — export the public surface explicitly
- imports of other features or `src/app/`
- runtime code in `index.ts`
