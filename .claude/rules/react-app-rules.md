---
paths:
  - "src/app/**/*.ts"
  - "src/app/**/*.tsx"
description: "React app layer rules (routing, providers, layout)"
---

# App Rules

`src/app/` owns routing, providers, and layout composition.

## Write Here

- route definitions and navigation wiring
- providers (QueryClientProvider, theme, error boundary)
- layout shells composing feature barrels
- default exports only where the router's lazy-loading requires them

## Do Not Write Here

- business logic or feature UI — compose features via their barrels
- imports of feature internals (`features/{name}/components/...`) — barrel only
- `zustand` imports or stores
- data-fetching hooks — those live in the owning feature
