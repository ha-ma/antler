---
name: react-feature
description: "React/RN feature scaffolding - ディレクトリ構造と必須ファイルを自動生成。新しいfeatureを作る時に使う。"
---

# React Feature Scaffold

新しいfeatureのディレクトリ構造と必須ファイルを生成する。

## 使い方

```
/react-feature auth
/react-feature product-list --with-store --with-form
```

## 引数

- `$1` (必須): feature名（kebab-case）
- `--with-store`: Zustand store を生成
- `--with-form`: React Hook Form フォームコンポーネントを生成
- `--with-query`: TanStack Query データ取得hookを生成

## 手順

1. State設計を宣言する（state-management.md 参照）
2. 以下のファイルを生成

### 常に生成

```
src/features/{name}/
  types.ts        ← feature固有の型定義
  index.ts        ← barrel file（公開API）
  components/     ← ディレクトリ
  hooks/          ← ディレクトリ
```

### --with-store

`src/features/{name}/store.ts`:
```typescript
import { create } from 'zustand'
import type { {PascalName}State } from './types'

interface {PascalName}Store extends {PascalName}State {
  // actions
}

export const use{PascalName}Store = create<{PascalName}Store>()((set, get) => ({
  // state + actions — selectorで使うこと: useStore(s => s.field)
}))
```

### --with-query

`src/features/{name}/hooks/use{PascalName}.ts`:
```typescript
import { useQuery } from '@tanstack/react-query'
import type { {PascalName} } from '../types'

export const {camelName}Keys = {
  detail: (id: string) => ['{kebab-name}', id] as const,
}

export function use{PascalName}(id: string) {
  return useQuery({
    queryKey: {camelName}Keys.detail(id),
    queryFn: async (): Promise<{PascalName}> => {
      const res = await fetch(`/{kebab-name}/${id}`)
      if (!res.ok) throw new Error(`failed to fetch {kebab-name}: ${res.status}`)
      return res.json()
    },
    enabled: !!id,
  })
}
```

### --with-form

`src/features/{name}/components/{PascalName}Form.tsx`:
```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const {camelName}Schema = z.object({
  // TODO: Define schema
})
type {PascalName}FormData = z.infer<typeof {camelName}Schema>

export function {PascalName}Form() {
  const { register, handleSubmit, formState: { errors } } = useForm<{PascalName}FormData>({
    resolver: zodResolver({camelName}Schema),
  })
  const onSubmit = (data: {PascalName}FormData) => { /* TODO */ }
  return <form onSubmit={handleSubmit(onSubmit)}>{/* TODO */}</form>
}
```

### index.ts

```typescript
export { {PascalName}Form } from './components/{PascalName}Form'
export { use{PascalName} } from './hooks/use{PascalName}'
export type { {PascalName} } from './types'
```

## 生成後チェック

- [ ] State設計を宣言したか
- [ ] index.ts の公開APIは適切か
- [ ] 他featureからの直接importがないか
