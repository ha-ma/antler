---
paths:
  - "src/features/*/store.ts"
  - "src/features/*/store.tsx"
description: "React Zustand store rules"
---

# Store Rules

`src/features/{name}/store.ts` is the only place Zustand may be imported.

## Write Here

- one `create()` store per feature
- state + verb-named actions (`setCount`, `resetFilters`, `toggleModal`)
- persist middleware wiring when needed (RN: MMKV)

## Do Not Write Here

- server data — it belongs to TanStack Query, not the store
- form state — React Hook Form owns it
- a second store — if one store isn't enough, split the feature
- JSX, data fetching, or imports of other features

## Reminder

- 消費側は必ず selector で購読する: `useStore(s => s.count)`
- store が5プロパティを超えたら分割を検討
