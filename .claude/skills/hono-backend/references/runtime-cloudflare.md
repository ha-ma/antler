# Cloudflare Workers + D1 ランタイムガイド

Cloudflare Workers 上で Hono + Drizzle + D1 を動かす際の固有パターン。
Node.js ランタイムとは異なる点に絞って記述する。

---

## エントリポイント

Node.js (`serve()`) と Workers (`export default`) は異なる。

```typescript
// src/index.ts

// ❌ Node.js スタイル（Workers では動作しない）
import { serve } from "@hono/node-server";
serve({ fetch: app.fetch, port: 3000 });

// ✅ Workers スタイル
import { Hono } from "hono";
const app = new Hono<{ Bindings: Env }>();
// ... ルート定義 ...
export default app;
```

Workers は `fetch` ハンドラをデフォルトエクスポートとして受け取る。
`app` を export default すると Hono が自動的に `fetch` として動作する。

---

## 環境変数・バインディングの型定義

`c.env` でバインディングにアクセスする。型は手動で定義する。

```typescript
// src/types/env.ts
export type Env = {
  // D1 データベース
  DB: D1Database;

  // KV ストア（使う場合）
  KV: KVNamespace;

  // R2 バケット（使う場合）
  BUCKET: R2Bucket;

  // シークレット / 環境変数（文字列）
  JWT_SECRET: string;
  STRIPE_SECRET_KEY: string;
};

// src/index.ts
import { Hono } from "hono";
import type { Env } from "./types/env";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => {
  // c.env.DB は D1Database として型付けされている
  return c.json({ ok: true });
});

export default app;
```

---

## Drizzle + D1 セットアップ

D1 は SQLite ベース。接続方法が Node.js (libsql) と異なる。

```typescript
// infrastructure/db/client.ts

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { D1Database } from "@cloudflare/workers-types";

// D1Database はリクエストごとに c.env から取得する
// シングルトンにしない（Workers はステートレスなので不要）
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
```

```typescript
// infrastructure/repositories/drizzle-user.repository.ts
import { createDb } from "../db/client";
import type { D1Database } from "@cloudflare/workers-types";
import type { UserRepository } from "../../application/ports/repositories/user.repository";
import type { User } from "../../domain/users/models/user";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

export class DrizzleUserRepository implements UserRepository {
  private db: ReturnType<typeof createDb>;

  constructor(d1: D1Database) {
    this.db = createDb(d1);
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    return row ? toUser(row) : null;
  }

  async create(data: CreateUserData): Promise<User> {
    const [row] = await this.db.insert(users).values(data).returning();
    return toUser(row);
  }
}

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    createdAt: row.createdAt,
  };
}
```

---

## ローカル開発: libsql を使った SQLite ファイル

D1 はローカルでは `@libsql/client` + `drizzle-orm/libsql` でエミュレートする。

```typescript
// infrastructure/db/client.ts (環境分岐版)

import type { D1Database } from "@cloudflare/workers-types";

export function createDb(d1: D1Database) {
  // Workers 本番 / Wrangler ローカル
  const { drizzle } = await import("drizzle-orm/d1");
  return drizzle(d1, { schema });
}

// ローカル Vitest 用ヘルパー
export function createLocalDb(url = ":memory:") {
  const { drizzle } = require("drizzle-orm/libsql");
  const { createClient } = require("@libsql/client");
  return drizzle(createClient({ url }), { schema });
}
```

`wrangler dev` を使う場合、D1 は自動的にローカル SQLite ファイルにルーティングされるため
ローカル分岐は Vitest 単体テスト向けのみ必要。

---

## D1 トランザクション

D1 はシンプルな SQLite トランザクション。PostgreSQL より制限が少ない。

```typescript
// application/ports/unit-of-work.ts (変更なし)
export interface UnitOfWork {
  readonly userRepo: UserRepository;
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}

// infrastructure/db/d1-unit-of-work.ts
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";

export class D1UnitOfWork implements UnitOfWork {
  private db: ReturnType<typeof drizzle>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.userRepo = new DrizzleUserRepository(d1);
  }

  readonly userRepo: UserRepository;

  async transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    // D1 は SQLite の BEGIN/COMMIT を使う
    // drizzle-orm/d1 の transaction() API
    return this.db.transaction(async (tx) => {
      const txUow = new D1TransactionUnitOfWork(tx);
      return fn(txUow);
    });
  }
}
```

**接続プーリングは不要**: Workers はリクエストごとに新しい V8 isolate で起動するため
コネクションの再利用を気にする必要はない。

---

## D1 の制限（コード設計への影響）

| 制限 | 影響 | 対応策 |
|------|------|--------|
| 10GB ストレージ上限 | 大量データの蓄積に向かない | アーカイブは R2 へ |
| シングルスレッド書き込み | 高頻度書き込みでボトルネック | Durable Objects 併用を検討 |
| ストアドプロシージャなし | DB 側のロジックを使えない | すべてアプリ層 (UseCase) で実装 |
| `ALTER TABLE` 制限 | カラム削除/変更が制限される | 新カラム追加 → データ移行の手順 |
| `RETURNING` はサポート | insert 後の ID 取得に使える | `drizzle.insert().values().returning()` |
| 全文検索は FTS5 のみ | 高度な検索は不向き | Vectorize や外部検索サービスを使う |

---

## wrangler.toml 設定

```toml
name = "my-api"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]  # Node.js 互換 API が必要な場合

# D1 バインディング
[[d1_databases]]
binding = "DB"                           # c.env.DB でアクセス
database_name = "my-api-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # `wrangler d1 create` で取得

# 本番環境の D1（ステージング/本番で分ける場合）
[env.production]
[[env.production.d1_databases]]
binding = "DB"
database_name = "my-api-db-prod"
database_id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"

# KV（セッションや一時データに使う場合）
[[kv_namespaces]]
binding = "KV"
id = "zzzzzzzz"

# R2（ファイルストレージ）
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "my-uploads"

# 環境変数（シークレットは `wrangler secret put` で設定）
[vars]
APP_ENV = "development"
# JWT_SECRET はここに書かない → `wrangler secret put JWT_SECRET` を使う
```

**シークレット設定コマンド**:
```bash
wrangler secret put JWT_SECRET       # インタラクティブ入力
wrangler secret put STRIPE_SECRET_KEY
```

---

## DI コンテナの Workers 対応

`c.env` はリクエストごとに異なるため、DI はリクエスト単位で組み立てる。

```typescript
// di/container.ts
import type { Env } from "../types/env";
import { D1UnitOfWork } from "../infrastructure/db/d1-unit-of-work";
import { BcryptPasswordHasher } from "../infrastructure/security/bcrypt-password-hasher";
import { CreateUserUseCase } from "../application/usecases/users/create-user.usecase";

export function buildContainer(env: Env) {
  // ステートレス: リクエストごとに new する（Workers ではこれが正解）
  const unitOfWork = new D1UnitOfWork(env.DB);
  const passwordHasher = new BcryptPasswordHasher();
  const createUserUseCase = new CreateUserUseCase(passwordHasher);

  return { unitOfWork, createUserUseCase };
}

// infrastructure/http/routes/user.routes.ts
app.post("/users", async (c) => {
  const { createUserUseCase, unitOfWork } = buildContainer(c.env);
  const body = await c.req.json();
  const dto = CreateUserSchema.parse(body);
  const result = await createUserUseCase.execute(dto, unitOfWork);
  return c.json(result, 201);
});
```

---

## マイグレーション

```bash
# スキーマから SQL を生成
npx drizzle-kit generate

# ローカル D1 に適用
wrangler d1 execute my-api-db --local --file=./drizzle/0001_migration.sql

# 本番 D1 に適用
wrangler d1 execute my-api-db --file=./drizzle/0001_migration.sql
```
