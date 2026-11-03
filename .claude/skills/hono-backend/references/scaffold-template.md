# Scaffold テンプレート集

新規ドメイン追加時のコピペ可能なテンプレート。
`{Name}` = PascalCase (例: `Post`)、`{name}` = camelCase/snake_case (例: `post`)、`{names}` = 複数形 (例: `posts`)。

生成順序は [SKILL.md の Scaffold セクション](../SKILL.md#scaffold-新規ドメイン追加) を参照。

---

## 1. `domain/{name}/models/{name}.ts`

```typescript
// domain/{name}/models/{name}.ts
// 純粋な TypeScript 型定義のみ。外部ライブラリ import は禁止。

export type {Name}Id = string & { readonly _brand: "{Name}Id" };

export interface {Name} {
  id: {Name}Id;
  // TODO: ドメイン固有フィールドを追加
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// 生成ヘルパー（infrastructure 層で使わない場合は削除）
export function create{Name}Id(raw: string): {Name}Id {
  return raw as {Name}Id;
}
```

---

## 2. `domain/{name}/rules/{name}-rules.ts`

```typescript
// domain/{name}/rules/{name}-rules.ts
// 純粋関数のみ。引数と戻り値のみに依存する。副作用なし。単一エンティティの妥当性判定。
// import 可能: domain/{name}/models/ の型のみ

import type { {Name} } from "../models/{name}";

/**
 * {Name} の名前が有効かどうかを判定する。
 * ルール: 1文字以上 100文字以下。前後の空白は無効。
 */
export function is{Name}NameValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 100;
}

/**
 * {Name} が編集可能な状態かどうかを判定する。
 * ルール: ステータスが "draft" または "rejected" の場合のみ編集可能。
 */
export function can{Name}BeEdited({name}: {Name}): boolean {
  // TODO: ドメイン固有の編集可否ルールを実装
  return true;
}

/**
 * TODO: 追加のビジネスルールをここに純粋関数として定義する。
 * 各関数は単一のルールのみを表現する（Single Responsibility）。
 * 複数エンティティ横断の認可・業務判断は rules/ ではなく policies/ に置く。
 */
```

---

## 3. `domain/{name}/errors/{name}-errors.ts`

```typescript
// domain/{name}/errors/{name}-errors.ts
// ドメイン例外クラス。HTTP 知識を持たない。

export class {Name}NotFoundError extends Error {
  readonly code = "{NAME}_NOT_FOUND" as const;
  constructor(public readonly id: string) {
    super(`{Name} not found: ${id}`);
    this.name = "{Name}NotFoundError";
  }
}

export class {Name}AlreadyExistsError extends Error {
  readonly code = "{NAME}_ALREADY_EXISTS" as const;
  constructor(public readonly identifier: string) {
    super(`{Name} already exists: ${identifier}`);
    this.name = "{Name}AlreadyExistsError";
  }
}

export class Invalid{Name}Error extends Error {
  readonly code = "INVALID_{NAME}" as const;
  constructor(
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`Invalid {name} ${field}: ${reason}`);
    this.name = "Invalid{Name}Error";
  }
}

// union 型でまとめると error-mapper で網羅チェックできる
export type {Name}Error =
  | {Name}NotFoundError
  | {Name}AlreadyExistsError
  | Invalid{Name}Error;
```

大規模プロジェクトでは `domain/shared/errors/base.ts` の `DomainError` を継承する形式
（[exception-handling.md](exception-handling.md) 参照）に揃えてもよい。

---

## 4. `application/ports/repositories/{name}.repository.ts`

```typescript
// application/ports/repositories/{name}.repository.ts
// interface のみ。ORM の型を import してはならない。

import type { {Name}, {Name}Id } from "../../../domain/{name}/models/{name}";

export interface Create{Name}Data {
  // TODO: 作成時に必要なフィールドを定義
}

export interface Update{Name}Data {
  // TODO: 更新時のパーシャルなフィールドを定義
}

export interface {Name}Repository {
  findById(id: {Name}Id): Promise<{Name} | null>;
  findAll(options?: {Name}ListOptions): Promise<{Name}[]>;
  create(data: Create{Name}Data): Promise<{Name}>;
  update(id: {Name}Id, data: Update{Name}Data): Promise<{Name}>;
  delete(id: {Name}Id): Promise<void>;
}

export interface {Name}ListOptions {
  limit?: number;
  offset?: number;
  // TODO: フィルタリング/ソートオプションを追加
}
```

外部 transport（mail/storage/決済/LLM）が必要な場合は
`application/ports/gateways/{external}.gateway.ts` に別途定義する（Repository に混ぜない）。

---

## 5. `application/usecases/{name}/dto.ts`

```typescript
// application/usecases/{name}/dto.ts
// Input/Output DTO。Hono/Drizzle の型を import してはならない。

import type { {Name} } from "../../../domain/{name}/models/{name}";

// --- Input DTO ---

export interface Create{Name}InputDTO {
  // TODO: 作成エンドポイントが受け取るフィールド
}

export interface Update{Name}InputDTO {
  // TODO: 更新エンドポイントが受け取るフィールド（パーシャル可）
}

export interface List{Name}InputDTO {
  limit?: number;
  offset?: number;
}

// --- Output DTO ---

export interface {Name}OutputDTO {
  id: string;
  // TODO: クライアントに返すフィールド（内部 ID 等は除外）
  createdAt: string;
  updatedAt: string;
}

export interface List{Name}OutputDTO {
  items: {Name}OutputDTO[];
  total: number;
  limit: number;
  offset: number;
}

// ドメインモデル → OutputDTO 変換
export const {Name}OutputDTO = {
  fromDomain({name}: {Name}): {Name}OutputDTO {
    return {
      id: {name}.id,
      // TODO: フィールドマッピング
      createdAt: {name}.createdAt,
      updatedAt: {name}.updatedAt,
    };
  },
};
```

---

## 6. `application/usecases/{name}/create-{name}.usecase.ts`

```typescript
// application/usecases/{name}/create-{name}.usecase.ts

import type { UnitOfWork } from "../../ports/unit-of-work";
import { {Name}AlreadyExistsError, Invalid{Name}Error } from "../../../domain/{name}/errors/{name}-errors";
import { is{Name}NameValid } from "../../../domain/{name}/rules/{name}-rules";
import type { Create{Name}InputDTO, {Name}OutputDTO } from "./dto";
import { {Name}OutputDTO as DTO } from "./dto";

export class Create{Name}UseCase {
  // コンストラクタに外部ポート（PasswordHasher, MailGateway 等）を注入する場合はここに追加
  constructor() {}

  async execute(
    input: Create{Name}InputDTO,
    uow: UnitOfWork,
  ): Promise<{Name}OutputDTO> {
    // 1. ビジネスルール検証
    // if (!is{Name}NameValid(input.name)) {
    //   throw new Invalid{Name}Error("name", "must be 1-100 characters");
    // }

    return uow.transaction(async (tx) => {
      // 2. 重複チェック（必要な場合）
      // const existing = await tx.{name}Repo.findByIdentifier(input.identifier);
      // if (existing) throw new {Name}AlreadyExistsError(input.identifier);

      // 3. 作成
      const {name} = await tx.{name}Repo.create({
        // TODO: input から Create{Name}Data へマッピング
      });

      return DTO.fromDomain({name});
    });
  }
}
```

---

## 7. `application/usecases/{name}/get-{name}.usecase.ts`

```typescript
// application/usecases/{name}/get-{name}.usecase.ts

import type { UnitOfWork } from "../../ports/unit-of-work";
import { {Name}NotFoundError } from "../../../domain/{name}/errors/{name}-errors";
import type { {Name}OutputDTO } from "./dto";
import { {Name}OutputDTO as DTO } from "./dto";

export class Get{Name}UseCase {
  async execute(id: string, uow: UnitOfWork): Promise<{Name}OutputDTO> {
    const {name} = await uow.{name}Repo.findById(id as any);
    if (!{name}) throw new {Name}NotFoundError(id);
    return DTO.fromDomain({name});
  }
}
```

---

## 8. `application/usecases/{name}/list-{name}.usecase.ts`

```typescript
// application/usecases/{name}/list-{name}.usecase.ts

import type { UnitOfWork } from "../../ports/unit-of-work";
import type { List{Name}InputDTO, List{Name}OutputDTO } from "./dto";
import { {Name}OutputDTO as DTO } from "./dto";

export class List{Name}UseCase {
  async execute(
    input: List{Name}InputDTO,
    uow: UnitOfWork,
  ): Promise<List{Name}OutputDTO> {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    const items = await uow.{name}Repo.findAll({ limit, offset });
    // TODO: total count が必要な場合は count() メソッドを Repository に追加する

    return {
      items: items.map(DTO.fromDomain),
      total: items.length, // TODO: 実際の total に置き換える
      limit,
      offset,
    };
  }
}
```

---

## 9. `application/usecases/{name}/update-{name}.usecase.ts`

```typescript
// application/usecases/{name}/update-{name}.usecase.ts

import type { UnitOfWork } from "../../ports/unit-of-work";
import { {Name}NotFoundError } from "../../../domain/{name}/errors/{name}-errors";
import type { Update{Name}InputDTO, {Name}OutputDTO } from "./dto";
import { {Name}OutputDTO as DTO } from "./dto";

export class Update{Name}UseCase {
  async execute(
    id: string,
    input: Update{Name}InputDTO,
    uow: UnitOfWork,
  ): Promise<{Name}OutputDTO> {
    return uow.transaction(async (tx) => {
      const existing = await tx.{name}Repo.findById(id as any);
      if (!existing) throw new {Name}NotFoundError(id);

      const updated = await tx.{name}Repo.update(id as any, {
        // TODO: input から Update{Name}Data へマッピング
      });

      return DTO.fromDomain(updated);
    });
  }
}
```

---

## 10. `application/usecases/{name}/delete-{name}.usecase.ts`

```typescript
// application/usecases/{name}/delete-{name}.usecase.ts

import type { UnitOfWork } from "../../ports/unit-of-work";
import { {Name}NotFoundError } from "../../../domain/{name}/errors/{name}-errors";

export class Delete{Name}UseCase {
  async execute(id: string, uow: UnitOfWork): Promise<void> {
    return uow.transaction(async (tx) => {
      const existing = await tx.{name}Repo.findById(id as any);
      if (!existing) throw new {Name}NotFoundError(id);
      await tx.{name}Repo.delete(id as any);
    });
  }
}
```

---

## 11. `infrastructure/repositories/drizzle-{name}.repository.ts`

```typescript
// infrastructure/repositories/drizzle-{name}.repository.ts
// Drizzle ORM を使った具象実装。domain/ と application/ に依存してよい。

import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../db/client"; // drizzle() の戻り値の型
import { {names} } from "../db/schema";
import type { {Name}Repository, Create{Name}Data, Update{Name}Data, {Name}ListOptions } from "../../application/ports/repositories/{name}.repository";
import type { {Name}, {Name}Id } from "../../domain/{name}/models/{name}";

export class Drizzle{Name}Repository implements {Name}Repository {
  constructor(private db: DrizzleDb) {}

  async findById(id: {Name}Id): Promise<{Name} | null> {
    const row = await this.db.query.{names}.findFirst({
      where: eq({names}.id, id),
    });
    return row ? toModel(row) : null;
  }

  async findAll(options: {Name}ListOptions = {}): Promise<{Name}[]> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const rows = await this.db.query.{names}.findMany({
      limit,
      offset,
    });
    return rows.map(toModel);
  }

  async create(data: Create{Name}Data): Promise<{Name}> {
    const [row] = await this.db
      .insert({names})
      .values({
        // TODO: data → schema フィールドへマッピング
        ...data,
      })
      .returning();
    return toModel(row);
  }

  async update(id: {Name}Id, data: Update{Name}Data): Promise<{Name}> {
    const [row] = await this.db
      .update({names})
      .set({
        // TODO: data → schema フィールドへマッピング
        ...data,
        updatedAt: new Date().toISOString(),
      })
      .where(eq({names}.id, id))
      .returning();
    return toModel(row);
  }

  async delete(id: {Name}Id): Promise<void> {
    await this.db.delete({names}).where(eq({names}.id, id));
  }
}

// Drizzle の行型 → ドメインモデルへの変換
// この関数はこのファイル内にとどめる（他のファイルに export しない）
function toModel(row: typeof {names}.$inferSelect): {Name} {
  return {
    id: row.id as {Name}Id,
    // TODO: フィールドマッピング
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

---

## 12. `infrastructure/http/schemas/{name}.schema.ts`

```typescript
// infrastructure/http/schemas/{name}.schema.ts
// Zod: HTTP request/response 契約のみ。Domain model を re-export しない。

import { z } from "zod";

export const create{Name}Schema = z.object({
  // TODO: 作成エンドポイントのフィールド定義
  // name: z.string().min(1).max(100),
}).strict();

export const update{Name}Schema = z.object({
  // TODO: 更新エンドポイントのフィールド定義（パーシャル）
}).partial();

export const list{Name}Schema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Create{Name}Request = z.infer<typeof create{Name}Schema>;
export type Update{Name}Request = z.infer<typeof update{Name}Schema>;
```

---

## 13. `infrastructure/http/routes/{name}.routes.ts`

```typescript
// infrastructure/http/routes/{name}.routes.ts
// Hono ルート定義。ビジネスロジックを持たない。
// try-catch は書かない（error-mapper ミドルウェアに委譲）。

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Env } from "../../types/env";
import { create{Name}Schema, update{Name}Schema, list{Name}Schema } from "../schemas/{name}.schema";
import { build{Name}Container } from "../../di/container"; // または汎用 buildContainer

export const {name}Routes = new Hono<{ Bindings: Env }>();

// GET /api/{names}
{name}Routes.get("/", zValidator("query", list{Name}Schema), async (c) => {
  const { list{Name}UseCase, unitOfWork } = build{Name}Container(c.env);
  const query = c.req.valid("query");
  const result = await list{Name}UseCase.execute(query, unitOfWork);
  return c.json(result);
});

// GET /api/{names}/:id
{name}Routes.get("/:id", async (c) => {
  const { get{Name}UseCase, unitOfWork } = build{Name}Container(c.env);
  const result = await get{Name}UseCase.execute(c.req.param("id"), unitOfWork);
  return c.json(result);
});

// POST /api/{names}
{name}Routes.post("/", zValidator("json", create{Name}Schema), async (c) => {
  const { create{Name}UseCase, unitOfWork } = build{Name}Container(c.env);
  const body = c.req.valid("json");
  const result = await create{Name}UseCase.execute(body, unitOfWork);
  return c.json(result, 201);
});

// PATCH /api/{names}/:id
{name}Routes.patch("/:id", zValidator("json", update{Name}Schema), async (c) => {
  const { update{Name}UseCase, unitOfWork } = build{Name}Container(c.env);
  const body = c.req.valid("json");
  const result = await update{Name}UseCase.execute(c.req.param("id"), body, unitOfWork);
  return c.json(result);
});

// DELETE /api/{names}/:id
{name}Routes.delete("/:id", async (c) => {
  const { delete{Name}UseCase, unitOfWork } = build{Name}Container(c.env);
  await delete{Name}UseCase.execute(c.req.param("id"), unitOfWork);
  return c.body(null, 204);
});
```

---

## 14. `di/{name}.di.ts`

```typescript
// di/{name}.di.ts
// DI 組み立て。{Name} ドメインに関連するインスタンスを生成して返す。

import type { Env } from "../types/env";
import { D1UnitOfWork } from "../infrastructure/db/d1-unit-of-work";
import { Create{Name}UseCase } from "../application/usecases/{name}/create-{name}.usecase";
import { Get{Name}UseCase } from "../application/usecases/{name}/get-{name}.usecase";
import { List{Name}UseCase } from "../application/usecases/{name}/list-{name}.usecase";
import { Update{Name}UseCase } from "../application/usecases/{name}/update-{name}.usecase";
import { Delete{Name}UseCase } from "../application/usecases/{name}/delete-{name}.usecase";

export function build{Name}Container(env: Env) {
  const unitOfWork = new D1UnitOfWork(env.DB);
  const create{Name}UseCase = new Create{Name}UseCase();
  const get{Name}UseCase = new Get{Name}UseCase();
  const list{Name}UseCase = new List{Name}UseCase();
  const update{Name}UseCase = new Update{Name}UseCase();
  const delete{Name}UseCase = new Delete{Name}UseCase();

  return {
    unitOfWork,
    create{Name}UseCase,
    get{Name}UseCase,
    list{Name}UseCase,
    update{Name}UseCase,
    delete{Name}UseCase,
  };
}
```

**汎用 container.ts にまとめる場合**（小規模プロジェクト向け）:

```typescript
// di/container.ts に追記
export function buildContainer(env: Env) {
  const unitOfWork = new D1UnitOfWork(env.DB);
  return {
    unitOfWork,
    // user ドメイン
    createUserUseCase: new CreateUserUseCase(new BcryptPasswordHasher()),
    // {name} ドメイン（追記分）
    create{Name}UseCase: new Create{Name}UseCase(),
    get{Name}UseCase: new Get{Name}UseCase(),
    list{Name}UseCase: new List{Name}UseCase(),
    update{Name}UseCase: new Update{Name}UseCase(),
    delete{Name}UseCase: new Delete{Name}UseCase(),
  };
}
```

---

## チェックリスト: 生成後の確認

テンプレートから生成した後、以下を確認する。

- [ ] `{Name}`, `{name}`, `{names}` がすべて実際の名前に置換されているか？
- [ ] `// TODO:` コメントが残っていないか？（フィールド定義を完成させた）
- [ ] `domain/{name}/models/{name}.ts` に外部 import がないか？
- [ ] `application/` ファイルに Hono/Drizzle の import がないか？
- [ ] `application`・`infrastructure` 配下に汎用 services ディレクトリを作っていないか？
- [ ] `infrastructure/repositories/` の `toModel()` 関数が型安全か？
- [ ] Route handler に `try-catch` がないか？
- [ ] DI ファイルが `src/index.ts` でルートにマウントされているか？

```typescript
// src/index.ts でマウント例
import { {name}Routes } from "./infrastructure/http/routes/{name}.routes";
app.route("/api/{names}", {name}Routes);
```
