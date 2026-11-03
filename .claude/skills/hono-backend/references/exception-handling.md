# 例外処理

## 設計原則

**ドメイン例外は HTTP を知らない**。ErrorCode → HTTP ステータスのマッピングは infrastructure 層の責務。

## レイヤ別ルール

| レイヤ | throw できるもの | HTTP を知るか |
|--------|-----------------|:------------:|
| domain/{domain}/errors/, domain/shared/errors/ | DomainError のサブクラスを定義 | ❌ |
| domain/{domain}/rules/, policies/ | DomainError を throw 可能 | ❌ |
| application/usecases/ | DomainError を throw | ❌ |
| infrastructure/http/ | error-mapper で HTTP レスポンスに変換 | ✅ |
| infrastructure/repositories/ | そのまま throw（ORM エラー等） | ❌ |
| infrastructure/gateways/, infrastructure/security/ | DomainError に変換して throw | ❌ |

## 例外階層

```
Error (Node.js 標準)
  └── DomainError (基底クラス) ← ErrorCode のみ、statusCode なし
        │
        ├── ResourceNotFoundError
        ├── ResourceAlreadyExistsError
        ├── ResourceConflictError
        │
        ├── ValidationError
        ├── InvalidInputError
        │
        ├── BusinessLogicError
        ├── OperationNotAllowedError
        ├── InsufficientResourcesError
        │
        ├── AuthenticationRequiredError
        ├── PermissionDeniedError
        ├── InvalidCredentialsError
        ├── TokenExpiredError
        ├── AccountLockedError
        │
        ├── ExternalServiceError
        ├── ServiceUnavailableError
        └── RateLimitExceededError
```

## ErrorCode 定数

```typescript
// domain/shared/errors/error-codes.ts

export const ErrorCode = {
  // リソース系
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  RESOURCE_ALREADY_EXISTS: "RESOURCE_ALREADY_EXISTS",
  RESOURCE_CONFLICT: "RESOURCE_CONFLICT",

  // バリデーション系
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_INPUT: "INVALID_INPUT",

  // ビジネスロジック系
  BUSINESS_LOGIC_ERROR: "BUSINESS_LOGIC_ERROR",
  OPERATION_NOT_ALLOWED: "OPERATION_NOT_ALLOWED",
  INSUFFICIENT_RESOURCES: "INSUFFICIENT_RESOURCES",

  // 認証・認可系
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",

  // 外部サービス系
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // 汎用
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

## DomainError 基底クラス

```typescript
// domain/shared/errors/base.ts

import type { ErrorCode } from "./error-codes";

/**
 * 全ドメイン例外の基底クラス
 *
 * HTTP ステータスコードを持たない。
 * HTTP への変換は infrastructure/http/error-mapper.ts が行う。
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly errorCode: ErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
```

## 汎用例外（domain/shared/errors/ に配置：ドメイン横断で再利用する例外）

```typescript
// domain/shared/errors/index.ts （汎用例外 + re-export）

export { DomainError } from "./base";
export { ErrorCode } from "./error-codes";

// --- リソース系 ---
export class ResourceNotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} が見つかりません: ${id}`, ErrorCode.RESOURCE_NOT_FOUND, { resource, id });
  }
}

export class ResourceAlreadyExistsError extends DomainError {
  constructor(resource: string, identifier: string) {
    super(`${resource} は既に存在します: ${identifier}`, ErrorCode.RESOURCE_ALREADY_EXISTS, { resource, identifier });
  }
}

// --- バリデーション系 ---
export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.VALIDATION_ERROR, details);
  }
}

// --- 認証系 ---
export class AuthenticationRequiredError extends DomainError {
  constructor() {
    super("認証が必要です", ErrorCode.AUTHENTICATION_REQUIRED);
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(action?: string) {
    super(action ? `権限がありません: ${action}` : "権限がありません", ErrorCode.PERMISSION_DENIED, action ? { action } : undefined);
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super("メールアドレスまたはパスワードが正しくありません", ErrorCode.INVALID_CREDENTIALS);
  }
}

// ... 他の例外も同様
```

## ドメイン固有例外（domain/{domain}/errors/{domain}-errors.ts に配置）

```typescript
// domain/users/errors/user-errors.ts

export class UserNotFoundError extends ResourceNotFoundError {
  constructor(id: string) { super("ユーザー", id); }
}

export class UserAlreadyExistsError extends ResourceAlreadyExistsError {
  constructor(email: string) { super("ユーザー", email); }
}

export class InvalidEmailError extends ValidationError {
  constructor(email: string) { super(`無効なメールアドレス: ${email}`, { email }); }
}

// domain/announcements/errors/announcement-errors.ts
export class AnnouncementNotFoundError extends ResourceNotFoundError {
  constructor(id: string) { super("お知らせ", id); }
}
```

---

## Error Mapper（infrastructure 層）

**ErrorCode → HTTP ステータスコードのマッピング**。HTTP の知識はこのファイルにのみ存在する。

```typescript
// infrastructure/http/error-mapper.ts

import type { Context } from "hono";
import { DomainError } from "../../domain/shared/errors/base";
import { ErrorCode } from "../../domain/shared/errors/error-codes";

/**
 * ErrorCode → HTTP ステータスコード マッピングテーブル
 *
 * ドメイン層は HTTP を知らない。この変換テーブルが
 * ドメインの意味を HTTP プロトコルに翻訳する唯一の場所。
 */
const ERROR_STATUS_MAP: Record<string, number> = {
  // リソース系
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_ALREADY_EXISTS]: 409,
  [ErrorCode.RESOURCE_CONFLICT]: 409,

  // バリデーション系
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_INPUT]: 400,

  // ビジネスロジック系
  [ErrorCode.BUSINESS_LOGIC_ERROR]: 422,
  [ErrorCode.OPERATION_NOT_ALLOWED]: 403,
  [ErrorCode.INSUFFICIENT_RESOURCES]: 422,

  // 認証・認可系
  [ErrorCode.AUTHENTICATION_REQUIRED]: 401,
  [ErrorCode.PERMISSION_DENIED]: 403,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.ACCOUNT_LOCKED]: 423,

  // 外部サービス系
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,

  // 汎用
  [ErrorCode.INTERNAL_ERROR]: 500,
};

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * グローバル例外ハンドラ
 *
 * app.onError(errorHandler) で登録。
 */
export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof DomainError) {
    const status = ERROR_STATUS_MAP[err.errorCode] ?? 500;
    const body: ErrorResponse = {
      error: {
        code: err.errorCode,
        message: err.message,
        ...(err.details && { details: err.details }),
      },
    };
    return c.json(body, status as any);
  }

  // 未知のエラー: 内部情報を隠蔽
  console.error("Unhandled error:", err);
  return c.json(
    { error: { code: ErrorCode.INTERNAL_ERROR, message: "内部サーバーエラーが発生しました" } },
    500,
  );
}
```

### マッピングテーブルの拡張

新しい ErrorCode を追加したら、`ERROR_STATUS_MAP` にエントリを追加するだけ。ドメイン層の変更は不要。

### 別の HTTP フレームワークへの移行

Hono → Express/Fastify に移行する場合、`error-mapper.ts` を書き換えるだけ。`ERROR_STATUS_MAP` は再利用可能。domain/ と application/ は一切変更不要。

---

## アンチパターン

```typescript
// ❌ ドメイン例外に statusCode を持たせる
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly errorCode: ErrorCode,
    public readonly statusCode: number,  // 禁止: ドメインは HTTP を知らない
  ) {}
}

// ❌ UseCase で HTTP レスポンスを返す
export class CreateUserUseCase {
  async execute(dto: CreateUserInputDTO, c: Context) {
    return c.json({ error: "..." }, 400);  // 禁止
  }
}

// ❌ Route で個別に例外を catch（error-mapper に委譲すべき）
app.post("/users", async (c) => {
  try {
    const result = await createUserUseCase.execute(dto, uow);
    return c.json(result, 201);
  } catch (e) {
    if (e instanceof UserNotFoundError) {      // 禁止
      return c.json({ error: e.message }, 404);
    }
  }
});

// ❌ エラーレスポンスで内部情報を漏らす
return c.json({ error: err.message, stack: err.stack, sql: query }, 500);
```
