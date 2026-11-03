/**
 * ドメイン例外定義テンプレート
 *
 * 配置:
 *   domain/shared/errors/error-codes.ts        ← ErrorCode 定数
 *   domain/shared/errors/base.ts               ← DomainError 基底クラス
 *   domain/shared/errors/index.ts              ← ドメイン横断の汎用例外 + re-export
 *   domain/{domain}/errors/{domain}-errors.ts  ← ドメイン固有例外（例: domain/users/errors/user-errors.ts）
 *
 * 重要: DomainError は HTTP statusCode を持たない。
 * ErrorCode → HTTP ステータスのマッピングは
 * infrastructure/http/error-mapper.ts が行う。
 */

// ============================================================
// domain/shared/errors/error-codes.ts
// ============================================================

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

// ============================================================
// domain/shared/errors/base.ts
// ============================================================

/**
 * 全ドメイン例外の基底クラス
 *
 * HTTP statusCode を持たない。
 * ドメイン層は HTTP プロトコルの存在を知らない。
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

// ============================================================
// domain/shared/errors/index.ts - ドメイン横断の汎用例外 + re-export
// ============================================================

export { DomainError } from "./base";
export { ErrorCode } from "./error-codes";

// --- リソース系 ---

export class ResourceNotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(
      `${resource} が見つかりません: ${id}`,
      ErrorCode.RESOURCE_NOT_FOUND,
      { resource, id },
    );
  }
}

export class ResourceAlreadyExistsError extends DomainError {
  constructor(resource: string, identifier: string) {
    super(
      `${resource} は既に存在します: ${identifier}`,
      ErrorCode.RESOURCE_ALREADY_EXISTS,
      { resource, identifier },
    );
  }
}

export class ResourceConflictError extends DomainError {
  constructor(resource: string, reason: string) {
    super(
      `${resource} の競合: ${reason}`,
      ErrorCode.RESOURCE_CONFLICT,
      { resource, reason },
    );
  }
}

// --- バリデーション系 ---

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.VALIDATION_ERROR, details);
  }
}

export class InvalidInputError extends DomainError {
  constructor(field: string, reason: string) {
    super(
      `無効な入力: ${field} - ${reason}`,
      ErrorCode.INVALID_INPUT,
      { field, reason },
    );
  }
}

// --- 認証・認可系 ---

export class AuthenticationRequiredError extends DomainError {
  constructor() {
    super("認証が必要です", ErrorCode.AUTHENTICATION_REQUIRED);
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(action?: string) {
    super(
      action ? `権限がありません: ${action}` : "権限がありません",
      ErrorCode.PERMISSION_DENIED,
      action ? { action } : undefined,
    );
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super(
      "メールアドレスまたはパスワードが正しくありません",
      ErrorCode.INVALID_CREDENTIALS,
    );
  }
}

export class TokenExpiredError extends DomainError {
  constructor() {
    super("トークンの有効期限が切れています", ErrorCode.TOKEN_EXPIRED);
  }
}

export class AccountLockedError extends DomainError {
  constructor() {
    super("アカウントがロックされています", ErrorCode.ACCOUNT_LOCKED);
  }
}

// --- ビジネスロジック系 ---

export class BusinessLogicError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.BUSINESS_LOGIC_ERROR, details);
  }
}

export class OperationNotAllowedError extends DomainError {
  constructor(operation: string, reason: string) {
    super(
      `${operation} は許可されていません: ${reason}`,
      ErrorCode.OPERATION_NOT_ALLOWED,
      { operation, reason },
    );
  }
}

// --- 外部サービス系 ---

export class ExternalServiceError extends DomainError {
  constructor(service: string, message: string) {
    super(
      `外部サービスエラー (${service}): ${message}`,
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      { service },
    );
  }
}

// ============================================================
// ドメイン固有例外の例
// domain/{domain}/errors/{domain}-errors.ts に配置する
// ============================================================

// --- User ドメイン (domain/users/errors/user-errors.ts) ---
export class UserNotFoundError extends ResourceNotFoundError {
  constructor(id: string) {
    super("ユーザー", id);
  }
}

export class UserAlreadyExistsError extends ResourceAlreadyExistsError {
  constructor(email: string) {
    super("ユーザー", email);
  }
}

export class InvalidEmailError extends ValidationError {
  constructor(email: string) {
    super(`無効なメールアドレス: ${email}`, { email });
  }
}

export class InvalidPasswordError extends ValidationError {
  constructor(errors: string[]) {
    super("パスワードが要件を満たしていません", { errors });
  }
}

// --- Announcement ドメイン (domain/announcements/errors/announcement-errors.ts) ---
export class AnnouncementNotFoundError extends ResourceNotFoundError {
  constructor(id: string) {
    super("お知らせ", id);
  }
}

export class MaxPinnedExceededError extends BusinessLogicError {
  constructor(max: number) {
    super(`ピン留めは最大${max}件までです`, { max });
  }
}

// ============================================================
// infrastructure/http/error-mapper.ts
// HTTP の知識はこのファイルにのみ存在する
// ============================================================

// import type { Context } from "hono";
// import { DomainError } from "../../domain/shared/errors/base";
// import { ErrorCode } from "../../domain/shared/errors/error-codes";

const ERROR_STATUS_MAP: Record<string, number> = {
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_ALREADY_EXISTS]: 409,
  [ErrorCode.RESOURCE_CONFLICT]: 409,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.BUSINESS_LOGIC_ERROR]: 422,
  [ErrorCode.OPERATION_NOT_ALLOWED]: 403,
  [ErrorCode.INSUFFICIENT_RESOURCES]: 422,
  [ErrorCode.AUTHENTICATION_REQUIRED]: 401,
  [ErrorCode.PERMISSION_DENIED]: 403,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.ACCOUNT_LOCKED]: 423,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

/**
 * Hono グローバル例外ハンドラ
 * app.onError(errorHandler) で登録
 */
export function errorHandler(err: Error, c: any): Response {
  if (err instanceof DomainError) {
    const status = ERROR_STATUS_MAP[err.errorCode] ?? 500;
    return c.json(
      {
        error: {
          code: err.errorCode,
          message: err.message,
          ...(err.details && { details: err.details }),
        },
      },
      status,
    );
  }

  console.error("Unhandled error:", err);
  return c.json(
    { error: { code: ErrorCode.INTERNAL_ERROR, message: "内部サーバーエラーが発生しました" } },
    500,
  );
}
