---
name: hono-backend
description: |
  Hono + TypeScript バックエンド開発のアーキテクチャガイド。
  Clean Architecture に基づき、ドメイン/アプリケーション層は
  HTTP フレームワーク(Hono)・ORM(Drizzle)に一切依存しない。
  以下の場合に使用:
  (1) API エンドポイント実装
  (2) UseCase(Application Service)/Repository/Gateway/Policy 作成
  (3) レイヤー間の依存方向の確認
  (4) 新規ドメイン追加時のファイル配置
  (5) 例外処理・トランザクション管理の設計
  キーワード: Hono, API, UseCase, Repository, Gateway, Policy, Clean Architecture, エンドポイント, CRUD, TypeScript, Drizzle
---

> **設計哲学**: functional-philosophy.md の 6 原則を Clean Architecture で実現する。
> 純粋なコア (domain/) を守り、副作用を境界 (infrastructure/) に押し出す。

# Hono バックエンド設計

## Clean Architecture 同心円

```
┌─────────────────────────────────────────────┐
│  infrastructure/   (Frameworks & Drivers)    │
│  ┌─────────────────────────────────────┐    │
│  │  application/  (Application Rules)   │    │
│  │  ┌─────────────────────────────┐    │    │
│  │  │  domain/  (Enterprise Rules) │    │    │
│  │  └─────────────────────────────┘    │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## 依存方向（厳守）

```
infrastructure  →  application  →  domain
(Hono, Drizzle)    (UseCases)      (Entities, Rules, Policies)
```

- **domain/**: 純粋な TypeScript のみ。外部ライブラリ・フレームワークへの依存ゼロ。
- **application/**: domain/ にのみ依存。HTTP・ORM の型を一切 import しない。
- **infrastructure/**: Hono, Drizzle 等のフレームワーク固有コード。application/ の ports (interface) を実装。

**禁止**: 内側の層が外側の層に依存すること（domain → application, application → infrastructure）
**禁止**: 汎用 `Service` レイヤ（`src/services/` や、`application`・`ports` 配下の汎用 services ディレクトリ）。業務判断は `domain/{domain}/policies/`、外部 transport は Gateway に明示する。

## Quick Start: UseCase 作成

```typescript
// 1. ドメインモデル (domain/users/models/user.ts)
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

// 2. Repository ポート (application/ports/repositories/user.repository.ts)
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
}

// 3. UnitOfWork ポート (application/ports/unit-of-work.ts)
export interface UnitOfWork {
  readonly userRepo: UserRepository;
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}

// 4. UseCase 実装 (application/usecases/users/create-user.usecase.ts)
export class CreateUserUseCase {
  constructor(private passwordHasher: PasswordHasher) {}

  async execute(dto: CreateUserInputDTO, uow: UnitOfWork): Promise<UserOutputDTO> {
    if (!validateEmail(dto.email)) throw new InvalidEmailError(dto.email);

    return await uow.transaction(async (tx) => {
      const existing = await tx.userRepo.findByEmail(dto.email);
      if (existing) throw new UserAlreadyExistsError(dto.email);

      const passwordHash = await this.passwordHasher.hash(dto.password);
      const user = await tx.userRepo.create({ ...dto, passwordHash });
      return UserOutputDTO.fromDomain(user);
    });
  }
}

// 5. Route (infrastructure/http/routes/user.routes.ts)
app.post("/users", adminOnly, async (c) => {
  const body = await c.req.json();
  const result = await createUserUseCase.execute(body, unitOfWork);
  return c.json(result, 201);
});
```

→ 詳細: [UseCase パターン](references/usecase-pattern.md)

## 判断フロー: 新しいコードを書く場所を決める

```
1. HTTP リクエスト/レスポンスに触れるか？
   YES → infrastructure/http/routes/ または middleware/
   NO  → 次へ

2. DB/ORM に触れるか？
   YES → infrastructure/repositories/
   NO  → 次へ

3. 外部 transport（メール、S3、決済、LLM 等）に触れるか？
   YES → infrastructure/gateways/ (application/ports/gateways/ の interface を実装する)
   NO  → 次へ

4. hash/token 等の技術的処理か？
   YES → infrastructure/security/ (application/ports/security/ の interface を実装する)
   NO  → 次へ

5. ビジネスフローを制御するか？（複数の操作を組み合わせる）
   例: "ユーザーを作成し、メールを送信し、ログに記録する"
   YES → application/usecases/
   NO  → 次へ

6. 認可・複数エンティティ横断の業務判断か？
   例: ensureCanInvite(), canPublish()
   YES → domain/{domain}/policies/ (純粋関数)
   NO  → 次へ

7. 単一エンティティのビジネスルールか？（バリデーション、計算、判定）
   例: isEmailValid(), calculateDiscount()
   YES → domain/{domain}/rules/ (引数のみに依存する純粋関数)
   NO  → 次へ

8. 型定義・データ構造か？
   YES → domain/{domain}/models/ (または monorepo の shared パッケージ)
   NO  → 次へ

9. エラー定義か？
   YES → domain/{domain}/errors/ (ドメイン横断の基底は domain/shared/errors/)
```

### 旧テーブル形式（クイックリファレンス）

| 質問 | 配置先 | 参照 |
|------|--------|------|
| ドメインモデル（エンティティ/値オブジェクト）？ | `domain/{domain}/models/` | [layers.md](references/layers.md#domain-enterprise-business-rules) |
| 純粋なビジネスルール？ | `domain/{domain}/rules/` | [layers.md](references/layers.md#domain-enterprise-business-rules) |
| 認可・複数エンティティ横断の業務判断？ | `domain/{domain}/policies/` | [layers.md](references/layers.md#domain-enterprise-business-rules) |
| ドメイン例外？ | `domain/{domain}/errors/`（基底は `domain/shared/errors/`） | [exception-handling.md](references/exception-handling.md) |
| ビジネスフローの1ストーリー？ | `application/usecases/` | [usecase-pattern.md](references/usecase-pattern.md) |
| Repository のインターフェース？ | `application/ports/repositories/` | [usecase-pattern.md](references/usecase-pattern.md#ports) |
| 外部 transport（mail/storage/決済/LLM）のインターフェース？ | `application/ports/gateways/` | [usecase-pattern.md](references/usecase-pattern.md#ports) |
| 技術ポート（hash/token）のインターフェース？ | `application/ports/security/` | [usecase-pattern.md](references/usecase-pattern.md#ports) |
| Input/Output DTO？ | `application/usecases/<domain>/dto.ts` | [usecase-pattern.md](references/usecase-pattern.md#dto) |
| DB スキーマ・接続・マイグレーション？ | `infrastructure/db/` | [layers.md](references/layers.md#infrastructure) |
| Repository の具象実装？ | `infrastructure/repositories/` | [layers.md](references/layers.md#infrastructure) |
| HTTP ルート・ミドルウェア？ | `infrastructure/http/` | [layers.md](references/layers.md#infrastructure) |
| JWT・ハッシュ等の技術実装？ | `infrastructure/security/` | [layers.md](references/layers.md#infrastructure) |
| ErrorCode → HTTP ステータスの変換？ | `infrastructure/http/error-mapper.ts` | [exception-handling.md](references/exception-handling.md#error-mapper) |
| 外部 API 連携の実装（mail/storage/決済/LLM）？ | `infrastructure/gateways/` | [layers.md](references/layers.md#infrastructure) |
| DI 組み立て？ | `di/container.ts` | [usecase-pattern.md](references/usecase-pattern.md#di) |

## 技術スタック（参考）

infrastructure/ 層で使用する技術は差し替え可能。domain/ と application/ は影響を受けない。

| カテゴリ | デフォルト | 差し替え例 |
|---------|----------|-----------|
| HTTP フレームワーク | Hono | Express, Fastify, 他 |
| ORM | Drizzle ORM | Prisma, Kysely, TypeORM |
| DB | SQLite (libsql) | PostgreSQL, MySQL, D1 |
| パスワードハッシュ | bcryptjs | argon2, scrypt |
| トークン | jsonwebtoken | jose, @hono/jwt |
| テスト | Vitest | Jest |
| ランタイム | Node.js / CF Workers | Deno, Bun |

## Scaffold: 新規ドメイン追加

新しいドメイン（例: `post`, `product`, `order`）を追加する際は、以下の順序で生成する。
**内側から外側へ**。順序を逆にしてはならない（外側の層が内側を参照するため）。

```
生成順序 ({name} = ドメイン名の snake_case, {Name} = PascalCase):

 1. domain/{name}/models/{name}.ts                             ← 型定義 (pure)
 2. domain/{name}/rules/{name}-rules.ts                         ← バリデーション (pure functions)
 3. domain/{name}/errors/{name}-errors.ts                       ← ドメイン例外
 4. application/ports/repositories/{name}.repository.ts         ← Repository interface
 5. application/usecases/{name}/dto.ts                          ← Input/Output DTO
 6. application/usecases/{name}/create-{name}.usecase.ts        ← Create UseCase
 7. application/usecases/{name}/get-{name}.usecase.ts           ← Get UseCase
 8. application/usecases/{name}/list-{name}.usecase.ts          ← List UseCase
 9. application/usecases/{name}/update-{name}.usecase.ts        ← Update UseCase
10. application/usecases/{name}/delete-{name}.usecase.ts        ← Delete UseCase
11. infrastructure/repositories/drizzle-{name}.repository.ts    ← Drizzle 具象実装
12. infrastructure/http/schemas/{name}.schema.ts                ← Zod request/response
13. infrastructure/http/routes/{name}.routes.ts                 ← Hono ルート
14. di/{name}.di.ts  (または container.ts に追記)               ← DI 組み立て
```

CRUD が不要な場合（例: read-only ドメイン）はステップ 6〜10 の該当する UseCase を省略する。
テンプレート: [references/scaffold-template.md](references/scaffold-template.md)

## Validation 戦略: Zod / domain/rules / domain/policies の分担

3 つのバリデーション層は役割が異なる。混同しない。

| 層 | 場所 | 責務 | 例 |
|----|------|------|----|
| **Zod** | `infrastructure/http/schemas/` | HTTP 入力の形状確認・型変換 | 文字列 → 数値変換, 必須フィールド欠落検出 |
| **domain/rules** | `domain/{domain}/rules/{name}-rules.ts` | 単一エンティティの業務上の妥当性判定 | メール形式の正当性, アカウントのロック状態 |
| **domain/policies** | `domain/{domain}/policies/{noun}-policy.ts` | 認可・複数エンティティ横断の業務判断 | 公開権限, 招待可否 |

**判定ルール**:
- "データの形が正しいか？" → **Zod** (`infrastructure/http/schemas/`)
- "データがビジネス的に有効か？"（単一エンティティ） → **domain/rules** (純粋関数)
- "この操作は許可されるか？"（複数エンティティ・権限） → **domain/policies** (純粋関数)

```typescript
// infrastructure/http/schemas/user.schema.ts
// Zod: HTTP 入力を parse する (形状チェック)
const createUserSchema = z.object({
  email: z.string().min(1),   // "文字列で、空でないか？"
  age: z.coerce.number(),     // "数値に変換できるか？"
});

// domain/users/rules/user-rules.ts
// domain/rules: ビジネスルール (意味チェック)
export function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export function isAdultAge(age: number): boolean {
  return age >= 18;  // "18歳以上か？" はビジネスルール
}
```

## Cloudflare Workers + D1 ランタイムガイド

Workers ランタイム固有のパターン。Node.js とは異なる。
詳細: [references/runtime-cloudflare.md](references/runtime-cloudflare.md)

**エントリポイント**:
```typescript
// src/index.ts — Workers では serve() ではなく export default
import { Hono } from "hono";
export default app;  // NOT: serve(app)
```

**D1 バインディング取得**:
```typescript
// c.env.DB が D1Database。型は wrangler.toml の bindings から推論
type Env = { DB: D1Database };
const app = new Hono<{ Bindings: Env }>();
app.get("/", (c) => {
  const db = drizzle(c.env.DB);  // リクエストごとに取得する
});
```

**D1 の制限（コード設計に影響）**:
- SQLite ベース → `RETURNING` 句は D1 でサポート済み
- ストアドプロシージャなし → すべてのロジックはアプリ層で実装
- 接続プーリング不要 → Workers はリクエストごとにステートレス
- ローカル開発: `drizzle-orm/libsql` + `@libsql/client` で SQLite ファイルを使用

**wrangler.toml 最小構成**:
```toml
name = "my-api"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## Monorepo パターン

複数パッケージ構成（API + フロントエンド共存）の場合の配置ルール。

```
packages/
  shared/     ← API とフロントエンドが共有する型・定数・Zod スキーマ
    src/
      types/  ← domain/{domain}/models/ の型を re-export してもよい
      schemas/← Zod スキーマ (HTTP DTO の形状)
      constants/

  db/         ← Drizzle スキーマのみ。マイグレーションも含む
    src/
      schema/ ← テーブル定義 (infrastructure/db/ と同義)

  api/        ← Hono バックエンド (本スキルの対象)
  web/        ← フロントエンド (Next.js 等)
```

**shared パッケージの使い方**:
- `domain/{domain}/models/` の型を `shared/types/` に置いてフロントエンドと共有 → OK
- `domain/{domain}/rules/` の純粋関数を `shared/` に置いて再利用 → OK
- `infrastructure/` の Hono/Drizzle 型を `shared/` に置く → NG (フロントエンドが ORM に依存する)

## 生成後セルフチェック

生成したコードに対して以下を順番に確認する。1 つでも NG なら修正してから完了とする。

- [ ] `domain/` のファイルに外部ライブラリの import がないか？
      NG 例: `import { z } from "zod"` in `domain/users/models/user.ts`
- [ ] `application/` に Hono/Drizzle の型が含まれていないか？
      NG 例: `import { Context } from "hono"` in `application/usecases/`
- [ ] `application`・`infrastructure` 配下に汎用 services ディレクトリを作っていないか？
      NG 例: hash 用の汎用 service インターフェース（→ `application/ports/security/password-hasher.ts` へ）
- [ ] UseCase は `execute()` メソッドのみを公開しているか？
      NG 例: `createUser()`, `deleteUser()` など複数メソッド → 別 UseCase に分割
- [ ] Route handler にビジネスロジック（条件分岐による判定）がないか？
      NG 例: `if (user.role !== "admin") return c.json({ error: "forbidden" }, 403)` → middleware または UseCase へ
- [ ] Route handler に try-catch がないか？（error-mapper ミドルウェアに委譲）
      NG 例: `try { await useCase.execute(...) } catch (e) { return c.json(...) }`
- [ ] Repository interface に ORM の型がないか？
      NG 例: `findById(id: string): Promise<typeof users.$inferSelect>`
      OK 例: `findById(id: string): Promise<User | null>`
- [ ] `Result<T, E>` 型または例外スローで失敗フローを表現しているか？
      NG 例: `return null` で失敗を表現する
- [ ] 全関数の引数と戻り値に型が明示されているか？（`any` 禁止）
- [ ] オブジェクト更新に `const` + スプレッド構文を使っているか？
      NG 例: `user.name = "new"` (ミューテーション)
      OK 例: `const updated = { ...user, name: "new" }`

## 詳細リファレンス

### アーキテクチャ
- **[レイヤ別ルール](references/layers.md)** - 各層のOK/NG、依存関係
- **[ディレクトリ構成](references/directory.md)** - フォルダ構造と配置ルール
- **[規約](references/conventions.md)** - 命名規則、テスト方針、セキュリティ

### パターン・プラクティス
- **[UseCase パターン](references/usecase-pattern.md)** - Ports/UnitOfWork/DTO変換/DI
- **[例外処理](references/exception-handling.md)** - ドメイン例外、ErrorCode→HTTPマッピング
- **[トランザクション管理](references/transaction-boundary.md)** - UnitOfWork によるトランザクション境界
- **[テストパターン](references/testing-patterns.md)** - Unit/Integration テスト戦略
- **[アンチパターン](references/anti-patterns.md)** - やってはいけないこと

### ランタイム・環境
- **[Cloudflare Workers + D1](references/runtime-cloudflare.md)** - Workers 固有パターン、D1 制限、wrangler 設定
- **[Scaffold テンプレート](references/scaffold-template.md)** - ドメイン追加時のコピペ可能テンプレート集

### 実装例
- **[examples/](examples/)** - コピー可能な実装テンプレート
