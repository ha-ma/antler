---
paths:
  - "src/features/*/components/**/*.tsx"
  - "src/features/*/components/**/*.ts"
description: "React feature components layer rules"
---

# Component Rules

`src/features/{name}/components/` owns the feature's UI.

## Write Here

- presentational components (PascalCase, one component per file, named export)
- local UI state with `useState` (max 3 per component)
- consumption of the feature's own `hooks/` and `store.ts` selectors

## Do Not Write Here

- data fetching — TanStack Query hooks live in `hooks/`
- `zustand` imports — consume the store's exported hooks with selectors
- imports of another feature's internals — go through its barrel (`index.ts`)
- imports of `src/app/`
- `useEffect` for data fetching / derived values / event reactions — see the
  state-management alternatives table first
- default exports
