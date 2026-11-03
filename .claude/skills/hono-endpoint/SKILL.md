---
name: hono-endpoint
description: "Hono endpoint scaffolding - schema/route/UseCase/Repository を Clean Architecture 構成で生成する。新しいエンドポイントを作る時に使う。"
---

# Hono Endpoint Scaffold

新しいドメイン/エンドポイントのファイルセットを Clean Architecture の構成で生成する。
生成順序: **schema → route → UseCase + DTO → ports (Repository/Gateway) → infrastructure 実装 → di/container.ts 登録**。

## 使い方

```
/hono-endpoint orders
/hono-endpoint users --with-tests
```

## 生成ファイル

### 1. schema.ts（最初に作る。HTTP 契約のみ）

```typescript
// src/infrastructure/http/schemas/{name}.schema.ts
import { z } from "zod";

export const create{Pascal}Schema = z.object({
  // TODO: Define fields
}).strict();

export const {camel}ResponseSchema = z.object({
  id: z.string(),
  // TODO: Define fields
});

export type Create{Pascal}Request = z.infer<typeof create{Pascal}Schema>;
export type {Pascal}Response = z.infer<typeof {camel}ResponseSchema>;
```

### 2. route.ts（薄いハンドラ。ビジネスロジックを持たない）

```typescript
// src/infrastructure/http/routes/{name}.routes.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { create{Pascal}Schema } from "../schemas/{name}.schema";

export const {camel}Routes = new Hono();

{camel}Routes.post(
  "/",
  zValidator("json", create{Pascal}Schema),
  async (c) => {
    const dto = c.req.valid("json");
    const result = await c.var.container.create{Pascal}UseCase.execute(dto, c.var.container.unitOfWork);
    return c.json(result, 201);
  },
);
```

### 3. UseCase + DTO（ビジネスフロー制御。application/usecases）

```typescript
// src/application/usecases/{name}/dto.ts
export interface Create{Pascal}InputDTO {
  // TODO: Define fields
}

export interface {Pascal}OutputDTO {
  id: string;
  // TODO: Define fields
}
```

```typescript
// src/application/usecases/{name}/create-{name}.usecase.ts
import type { UnitOfWork } from "../../ports/unit-of-work";
import type { Create{Pascal}InputDTO, {Pascal}OutputDTO } from "./dto";

export class Create{Pascal}UseCase {
  async execute(dto: Create{Pascal}InputDTO, uow: UnitOfWork): Promise<{Pascal}OutputDTO> {
    return uow.transaction(async (tx) => {
      const {camel} = await tx.{camel}Repo.create(dto);
      return { id: {camel}.id /* TODO: ドメインモデル → OutputDTO のマッピング */ };
    });
  }
}
```

### 4. ports（Repository / Gateway インターフェース）

```typescript
// src/application/ports/repositories/{name}.repository.ts
import type { {Pascal} } from "../../../domain/{name}/models/{name}";
import type { Create{Pascal}InputDTO } from "../../usecases/{name}/dto";

export interface {Pascal}Repository {
  findById(id: string): Promise<{Pascal} | null>;
  create(data: Create{Pascal}InputDTO): Promise<{Pascal}>;
}
```

外部 transport（mail/storage/決済/LLM）が必要な場合は `application/ports/gateways/{external}.gateway.ts` に、
hash/token 等の技術ポートは `application/ports/security/{concern}.ts` に追加する。Repository と混ぜない。

### 5. infrastructure 実装

```typescript
// src/infrastructure/repositories/drizzle-{name}.repository.ts
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { {name}s } from "../db/schema";
import type { {Pascal}Repository } from "../../application/ports/repositories/{name}.repository";
import type { Create{Pascal}InputDTO } from "../../application/usecases/{name}/dto";

export class Drizzle{Pascal}Repository implements {Pascal}Repository {
  constructor(private db: DrizzleD1Database) {}

  async create(data: Create{Pascal}InputDTO) {
    const [result] = await this.db.insert({name}s).values(data).returning();
    return result;
  }

  async findById(id: string) {
    return (await this.db.query.{name}s.findFirst({ where: eq({name}s.id, id) })) ?? null;
  }
}
```

### 6. di/container.ts 登録

```typescript
// src/di/container.ts に追記
import { Drizzle{Pascal}Repository } from "../infrastructure/repositories/drizzle-{name}.repository";
import { Create{Pascal}UseCase } from "../application/usecases/{name}/create-{name}.usecase";

// UnitOfWork 経由で {camel}Repo を組み立てる（UnitOfWork 実装側に {camel}Repo を追加する）
// export const create{Pascal}UseCase = new Create{Pascal}UseCase();
```

## 生成後チェック

- [ ] schema.ts のフィールド定義は完了したか（`infrastructure/http/schemas/` のみに置いたか）
- [ ] route.ts にビジネスロジックが入っていないか（UseCase 呼び出しのみ、try/catch なし）
- [ ] zValidator で入力バリデーションしているか
- [ ] Repository interface に ORM の型が含まれていないか
- [ ] `application`・`infrastructure` 配下に汎用 services ディレクトリを作っていないか（Gateway/security へ）
- [ ] UseCase は UnitOfWork 経由でのみ Repository/Gateway にアクセスしているか
- [ ] di/container.ts に登録したか
