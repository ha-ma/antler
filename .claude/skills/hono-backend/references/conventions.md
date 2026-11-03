# 規約

## 命名規則

### ファイル命名

| 層 | 種類 | パターン | 例 |
|----|------|----------|-----|
| domain | モデル | `domain/{domain}/models/{noun}.ts` | `domain/users/models/user.ts` |
| domain | 値オブジェクト | `domain/{domain}/value-objects/{noun}.ts` | `domain/users/value-objects/email.ts` |
| domain | ルール | `domain/{domain}/rules/{noun}-rules.ts` | `domain/users/rules/user-rules.ts` |
| domain | ポリシー | `domain/{domain}/policies/{noun}-policy.ts` | `domain/teams/policies/invitation-policy.ts` |
| domain | イベント | `domain/{domain}/events/{noun}-events.ts` | `domain/users/events/user-created.ts` |
| domain | エラー（ドメイン固有） | `domain/{domain}/errors/{noun}-errors.ts` | `domain/users/errors/user-errors.ts` |
| domain | エラー（横断的基底） | `domain/shared/errors/base.ts`, `error-codes.ts` | - |
| application | UseCase | `application/usecases/{domain}/{verb}-{noun}.usecase.ts` | `create-user.usecase.ts` |
| application | DTO | `application/usecases/{domain}/dto.ts` | - |
| application | Repository ポート | `application/ports/repositories/{domain}.repository.ts` | `user.repository.ts` |
| application | Gateway ポート | `application/ports/gateways/{external}.gateway.ts` | `mail.gateway.ts` |
| application | セキュリティポート | `application/ports/security/{concern}.ts` | `password-hasher.ts` |
| application | UnitOfWork ポート | `application/ports/unit-of-work.ts` | - |
| infrastructure | Repository 実装 | `infrastructure/repositories/drizzle-{domain}.repository.ts` | `drizzle-user.repository.ts` |
| infrastructure | Gateway 実装 | `infrastructure/gateways/{impl}-{external}.gateway.ts` | `resend-mail.gateway.ts` |
| infrastructure | セキュリティ実装 | `infrastructure/security/{impl}-{concern}.ts` | `bcrypt-password-hasher.ts` |
| infrastructure | UnitOfWork 実装 | `infrastructure/db/drizzle-unit-of-work.ts` | - |
| infrastructure | Zod schema | `infrastructure/http/schemas/{domain}.schema.ts` | `user.schema.ts` |
| infrastructure | Route | `infrastructure/http/routes/{domain}.routes.ts` | `user.routes.ts` |
| infrastructure | Middleware | `infrastructure/http/middleware/{purpose}.middleware.ts` | `auth.middleware.ts` |
| infrastructure | Error Mapper | `infrastructure/http/error-mapper.ts` | - |
| infrastructure | DB スキーマ | `infrastructure/db/schema.ts` | - |
| infrastructure | Job | `infrastructure/jobs/{domain}/{job}.job.ts` | `send-welcome-mail.job.ts` |
| - | テスト | `<target>.test.ts` | `create-user.usecase.test.ts` |
| - | 受け入れテスト | `<domain>.acceptance.test.ts` | `auth.acceptance.test.ts` |

### クラス・インターフェース命名

| 種類 | パターン | 例 |
|------|----------|-----|
| UseCase | `<Verb><Noun>UseCase` | `CreateUserUseCase` |
| Repository (port) | `<Noun>Repository` | `UserRepository` |
| Repository (impl) | `Drizzle<Noun>Repository` | `DrizzleUserRepository` |
| Gateway (port) | `<Noun>Gateway` | `MailGateway` |
| Gateway (impl) | `<Impl><Noun>Gateway` | `ResendMailGateway` |
| Password Hasher (port) | `PasswordHasher` | - |
| Password Hasher (impl) | `<Impl>PasswordHasher` | `BcryptPasswordHasher` |
| Token Provider (port) | `TokenProvider` | - |
| Token Provider (impl) | `<Impl>TokenProvider` | `JwtTokenProvider` |
| UnitOfWork (port) | `UnitOfWork` | - |
| UnitOfWork (impl) | `Drizzle UnitOfWork` | `DrizzleUnitOfWork` |
| Input DTO | `<Verb><Noun>InputDTO` | `CreateUserInputDTO` |
| Output DTO | `<Noun>OutputDTO` | `UserOutputDTO` |
| DomainError | `<Noun><Problem>Error` | `UserNotFoundError` |

### 変数・関数命名

| 種類 | パターン | 例 |
|------|----------|-----|
| UseCase インスタンス | `camelCase` | `createUserUseCase` |
| Repository インスタンス | `camelCase` | `userRepo` |
| UnitOfWork | `uow` or `unitOfWork` | `uow` |
| トランザクション中 UnitOfWork | `tx` | `tx` |
| ドメインロジック関数 | `camelCase (動詞始まり)` | `validateEmail` |
| DB テーブル定数 | `camelCase + Table` | `usersTable` |
| 定数 | `UPPER_SNAKE_CASE` | `JWT_SECRET` |
| エラーコード | `UPPER_SNAKE_CASE` | `RESOURCE_NOT_FOUND` |

### 具象実装クラスのプレフィックス規則

具象クラスには使用ライブラリ名をプレフィックスとして付ける。
ポート（interface）にはプレフィックスを付けない。

```
port:  UserRepository          ← 抽象（ライブラリ名なし）
impl:  DrizzleUserRepository   ← 具象（Drizzle プレフィックス）

port:  PasswordHasher
impl:  BcryptPasswordHasher    ← bcryptjs を使用

port:  TokenProvider
impl:  JwtTokenProvider        ← jsonwebtoken を使用

port:  MailGateway
impl:  ResendMailGateway       ← Resend を使用

port:  UnitOfWork
impl:  DrizzleUnitOfWork
```

ORM や ライブラリを差し替える場合、impl クラスを新規作成するだけ。port と UseCase は変更不要。

## テスト方針

### テストピラミッド

```
    /  Acceptance  \     ← E2E（少数）
   / Integration    \    ← API + DB
  /     Unit         \   ← UseCase / Domain / Gateway・Security（多数）
```

### カバレッジ目標

| レイヤ | 目標 | 優先度 |
|--------|------|--------|
| domain/{domain}/rules/, policies/ | 100% | 最高（純粋関数） |
| application/usecases/ | 90%+ | 高（ビジネスフロー） |
| infrastructure/gateways/, infrastructure/security/ | 80%+ | 中 |
| infrastructure/repositories/ | 80%+ | 中（統合テスト） |
| infrastructure/http/routes/ | 統合テストで担保 | 低（薄い層） |

### テストファイル配置

```
__tests__/
├── unit/
│   ├── usecases/     # モック DI（ORM/HTTP 不使用）
│   ├── domain/       # 純粋関数テスト（rules/policies）
│   └── gateways/     # Gateway/security 実装テスト
├── integration/
│   ├── routes/       # app.request() で API テスト
│   └── repositories/ # in-memory DB でテスト
└── acceptance/
    └── *.acceptance.test.ts
```

## セキュリティ

### 認証
- JWT Bearer トークン（Access: 15分, Refresh: 7日）
- パスワードは `PasswordHasher` で抽象化（具象: bcryptjs, ソルトラウンド 10）
- アカウントロック: 5回失敗で30分ロック

### エラーレスポンス
- **本番**: スタックトレース、SQL クエリ、内部パスを含めない
- error-mapper が DomainError → 構造化レスポンスに変換
- 未知のエラーは `INTERNAL_ERROR` として内部情報を隠蔽

### 入力バリデーション
- `domain/{domain}/rules/` で純粋関数バリデーション
- ORM のパラメタライズドクエリで SQL インジェクション防止
- レスポンスの Content-Type は `application/json` 固定

### CORS
- `ALLOWED_ORIGINS` 環境変数で制御
- 本番では `*` を使わない

## コード品質

### Import 順序

```typescript
// 1. Node.js 標準モジュール
import crypto from "crypto";

// 2. サードパーティ（infrastructure 層のみ）
import { Hono } from "hono";
import { eq } from "drizzle-orm";

// 3. domain/
import type { User } from "../../domain/users/models/user";
import { validateEmail } from "../../domain/users/rules/user-rules";
import { UserNotFoundError } from "../../domain/users/errors/user-errors";

// 4. application/
import type { UserRepository } from "../../application/ports/repositories/user.repository";
import type { UnitOfWork } from "../../application/ports/unit-of-work";

// 5. infrastructure/（同じ infrastructure 層内でのみ）
import { usersTable } from "../db/schema";
```

### 型の使い方
- `any` は禁止。`unknown` + Type Guard を使用
- 関数の引数・戻り値に明示的な型注釈
- `as` キャスト最小限（テストコード内は許容）
- Drizzle の `InferSelectModel` / `InferInsertModel` は infrastructure 層でのみ使用
