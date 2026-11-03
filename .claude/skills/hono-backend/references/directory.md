# ディレクトリ構成

## 標準構成

```
src/
├── domain/                              # Enterprise Business Rules（最内層）
│   │                                    # 外部ライブラリへの依存ゼロ。純粋 TypeScript のみ。ドメインごとに分割する。
│   ├── users/
│   │   ├── models/                      # エンティティ / 値オブジェクトの型
│   │   │   └── user.ts                  #   interface User, UserRole 等
│   │   ├── value-objects/
│   │   │   └── email.ts
│   │   ├── rules/                       # 純粋ドメインロジック（単一エンティティの妥当性判定）
│   │   │   └── user-rules.ts            #   isEmailValid, isAccountLocked 等
│   │   ├── policies/                    # 認可・複数エンティティ横断の業務判断
│   │   │   └── invitation-policy.ts     #   ensureCanInvite 等
│   │   ├── events/                      # Domain Event 型
│   │   │   └── user-created.ts
│   │   └── errors/                      # ドメイン固有例外
│   │       └── user-errors.ts           #   UserNotFoundError 等
│   ├── announcements/
│   │   └── ...                          # 同じ構成をドメインごとに繰り返す
│   └── shared/
│       └── errors/                      # ドメイン横断のエラー基盤
│           ├── base.ts                  #   DomainError 基底クラス（HTTP statusCode を持たない）
│           ├── error-codes.ts           #   ErrorCode 定数
│           └── index.ts                 #   汎用例外（ResourceNotFoundError 等）+ re-export
│
├── application/                         # Application Business Rules
│   │                                    # domain/ にのみ依存。HTTP/ORM の型を import しない。
│   ├── ports/                           # 駆動ポート（インターフェース定義）
│   │   ├── repositories/                #   Repository インターフェース
│   │   │   ├── user.repository.ts
│   │   │   ├── announcement.repository.ts
│   │   │   └── index.ts
│   │   ├── gateways/                    #   外部 transport のインターフェース
│   │   │   ├── mail.gateway.ts          #     メール送信
│   │   │   ├── storage.gateway.ts       #     ファイルストレージ
│   │   │   ├── payment.gateway.ts       #     決済
│   │   │   └── index.ts
│   │   ├── security/                    #   技術ポート（業務判断を持たない）
│   │   │   ├── password-hasher.ts       #     パスワードハッシュ
│   │   │   ├── token-provider.ts        #     JWT トークン
│   │   │   └── index.ts
│   │   └── unit-of-work.ts              #   UnitOfWork インターフェース
│   │
│   └── usecases/                        # ビジネスフロー制御（Application Service）
│       ├── users/
│       │   ├── create-user.usecase.ts
│       │   ├── get-user.usecase.ts
│       │   ├── list-users.usecase.ts
│       │   ├── update-user.usecase.ts
│       │   ├── login.usecase.ts
│       │   └── dto.ts                   #   Input/Output DTO
│       ├── announcements/
│       │   ├── create-announcement.usecase.ts
│       │   ├── list-announcements.usecase.ts
│       │   └── dto.ts
│       └── ...
│
├── infrastructure/                      # Frameworks & Drivers（最外層）
│   │                                    # Hono, Drizzle 等のフレームワーク固有コード。
│   ├── db/                              # ORM / DB 固有
│   │   ├── schema.ts                    #   Drizzle テーブル定義
│   │   ├── connection.ts                #   DB 接続管理
│   │   ├── create-tables.ts             #   DDL 実行
│   │   ├── seed.ts                      #   初期データ
│   │   ├── migrate.ts                   #   マイグレーション
│   │   └── drizzle-unit-of-work.ts      #   UnitOfWork の Drizzle 実装
│   │
│   ├── repositories/                    # Repository の具象実装
│   │   ├── drizzle-user.repository.ts
│   │   ├── drizzle-announcement.repository.ts
│   │   └── ...
│   │
│   ├── gateways/                        # 外部 transport の具象実装
│   │   ├── resend-mail.gateway.ts       #   MailGateway → Resend
│   │   ├── r2-storage.gateway.ts        #   StorageGateway → R2
│   │   └── ...
│   │
│   ├── security/                        # 技術ポートの具象実装
│   │   ├── bcrypt-password-hasher.ts    #   PasswordHasher → bcryptjs
│   │   ├── jwt-token-provider.ts        #   TokenProvider → jsonwebtoken
│   │   └── ...
│   │
│   ├── http/                            # HTTP フレームワーク固有
│   │   ├── app.ts                       #   Hono アプリ定義 + ミドルウェア
│   │   ├── error-mapper.ts              #   ErrorCode → HTTP ステータスマッピング
│   │   ├── schemas/                     #   Zod request/response（HTTP 契約のみ）
│   │   │   ├── user.schema.ts
│   │   │   └── ...
│   │   ├── routes/                      #   ルートハンドラ
│   │   │   ├── user.routes.ts
│   │   │   ├── auth.routes.ts
│   │   │   ├── announcement.routes.ts
│   │   │   └── ...
│   │   └── middleware/                  #   Hono ミドルウェア
│   │       ├── auth.middleware.ts
│   │       └── ...
│   │
│   ├── jobs/                            # Queue consumer / commit 後の副作用
│   │   └── users/
│   │       └── send-welcome-mail.job.ts
│   │
│   └── commands/                        # 運用タスク entrypoint
│       └── seed-users.ts
│
├── di/                                  # Composition Root（DI 組み立て）
│   └── container.ts                     #   全依存関係の組み立て
│
├── index.ts                             # Node.js エントリポイント
└── worker.ts                            # Cloudflare Workers エントリポイント
```

## レイヤー間の import ルール

```
domain/         → 何も import しない（純粋 TypeScript）
application/    → domain/ のみ import
infrastructure/ → domain/ + application/ を import
di/             → 全層を import（組み立てのため）
```

### 禁止される import

```typescript
// ❌ domain/ が外部ライブラリを import
// domain/users/rules/user-rules.ts
import { eq } from "drizzle-orm";          // 禁止
import { Hono } from "hono";               // 禁止

// ❌ application/ が infrastructure/ を import
// application/usecases/users/create-user.usecase.ts
import { DrizzleDB } from "../../infrastructure/db/connection";  // 禁止
import { Hono } from "hono";                                     // 禁止

// ❌ application/ がフレームワーク固有型を使う
// application/ports/repositories/user.repository.ts
import type { LibSQLDatabase } from "drizzle-orm/libsql";        // 禁止

// ❌ 汎用 Service レイヤを作る
// src/services/ や、application・ports 配下に汎用 services ディレクトリを作るのは禁止
```

## ファイル配置ルール

### 新規ドメイン追加時

1. `domain/<domain>/models/<domain>.ts` にエンティティ定義
2. `domain/<domain>/rules/<domain>-rules.ts` に純粋ビジネスルール
3. `domain/<domain>/errors/<domain>-errors.ts` にドメイン固有例外（必要なら）
4. `application/ports/repositories/<domain>.repository.ts` にインターフェース
5. `application/usecases/<domain>/` に UseCase + DTO
6. `infrastructure/repositories/drizzle-<domain>.repository.ts` に具象実装
7. `infrastructure/db/schema.ts` にテーブル定義追加
8. `infrastructure/http/schemas/<domain>.schema.ts` に Zod schema
9. `infrastructure/http/routes/<domain>.routes.ts` にルート
10. `di/container.ts` に DI 登録
11. `infrastructure/http/app.ts` にルートマウント

### 配置判断フロー

```
「この関数/クラスはどこに置く？」
│
├─ 純粋なビジネスルール（単一エンティティ、I/O なし）？ ────→ domain/<domain>/rules/
├─ 認可・複数エンティティ横断の業務判断？ ──────────────→ domain/<domain>/policies/
├─ ドメインの型定義？ ─────────────────────────────→ domain/<domain>/models/
├─ ドメイン例外？ ────────────────────────────────→ domain/<domain>/errors/（基底は domain/shared/errors/）
├─ Repository のインターフェース？ ───────────────────→ application/ports/repositories/
├─ 外部 transport（mail/storage/決済/LLM）のインターフェース？ → application/ports/gateways/
├─ 技術ポート（hash/token）のインターフェース？ ────────→ application/ports/security/
├─ ビジネスフローの制御？ ────────────────────────────→ application/usecases/
├─ DB の読み書き実装？ ──────────────────────────────→ infrastructure/repositories/
├─ 外部 transport の実装？ ───────────────────────────→ infrastructure/gateways/
├─ 技術処理の実装 (JWT, hash 等)？ ────────────────────→ infrastructure/security/
├─ HTTP 契約（Zod）？ ──────────────────────────────→ infrastructure/http/schemas/
├─ HTTP ルート/ミドルウェア？ ─────────────────────────→ infrastructure/http/
├─ テーブル定義？ ────────────────────────────────→ infrastructure/db/schema.ts
└─ DI 組み立て？ ────────────────────────────────→ di/container.ts
```

## ランタイム別エントリポイント

```
src/
├── index.ts     # Node.js: @hono/node-server + libsql 接続
├── worker.ts    # CF Workers: D1 バインディング注入
└── infrastructure/http/app.ts  # 共通: Hono アプリ本体
```

- `app.ts` は Hono アプリの定義のみ（ランタイム非依存）
- エントリポイントが DI container を構築し、infrastructure 具象実装を注入
- domain/ と application/ はランタイムを一切意識しない
