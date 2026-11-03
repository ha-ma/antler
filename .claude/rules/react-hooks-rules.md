---
paths:
  - "src/features/*/hooks/**/*.ts"
  - "src/features/*/hooks/**/*.tsx"
description: "React feature hooks layer rules"
---

# Hooks Rules

`src/features/{name}/hooks/` owns data fetching and reusable feature logic.

## Write Here

- TanStack Query hooks (`useQuery` / `useMutation`) with query keys
- custom hooks with a `use` prefix
- subscriptions/timers isolated in a custom hook (the only sanctioned
  `useEffect` location — with a reason comment)

## Do Not Write Here

- `useState + useEffect + fetch` patterns — use TanStack Query
- `zustand` imports — the store's hooks come from `store.ts`
- JSX / component rendering
- imports of another feature's internals — barrel only
- imports of `src/app/`
