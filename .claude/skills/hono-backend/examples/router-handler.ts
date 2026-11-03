/**
 * Router ハンドラ実装テンプレート
 *
 * 配置:
 *   infrastructure/http/app.ts              ← Hono アプリ + ミドルウェア
 *   infrastructure/http/error-mapper.ts     ← ErrorCode → HTTP ステータス
 *   infrastructure/http/middleware/auth.middleware.ts ← JWT 認証
 *   infrastructure/http/routes/user.routes.ts        ← ルートハンドラ
 *
 * Route の責務:
 *   - HTTP リクエストの受付・パース
 *   - UseCase 呼び出し
 *   - HTTP レスポンスの返却
 *
 * Route の禁止事項:
 *   - ビジネスロジック
 *   - 直接 DB 操作
 *   - try/catch（error-mapper に委譲）
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";

// ============================================================
// infrastructure/http/error-mapper.ts
// ============================================================
// HTTP の知識はこのファイルにのみ存在する。

import { DomainError } from "../../domain/shared/errors/base";
import { ErrorCode } from "../../domain/shared/errors/error-codes";

/**
 * ErrorCode → HTTP ステータスコード マッピングテーブル
 *
 * ドメイン層は HTTP を知らない。
 * この変換テーブルがドメインの意味を HTTP プロトコルに翻訳する唯一の場所。
 *
 * 新しい ErrorCode を追加したら、ここにエントリを追加するだけ。
 * domain/ と application/ の変更は不要。
 */
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

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

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

  // 未知のエラー: 内部情報を隠蔽してサーバーログにのみ出力
  console.error("Unhandled error:", err);
  return c.json(
    { error: { code: ErrorCode.INTERNAL_ERROR, message: "内部サーバーエラーが発生しました" } },
    500,
  );
}

// ============================================================
// infrastructure/http/middleware/auth.middleware.ts
// ============================================================

import type { TokenProvider } from "../../../application/ports/security/token-provider";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
} from "../../../domain/shared/errors";
import type { User } from "../../../domain/users/models/user";

type HonoEnv = {
  Variables: {
    user: User;
  };
};

/**
 * 認証ミドルウェアファクトリ
 *
 * TokenProvider を注入して生成。
 * infrastructure の具象 (JwtTokenProvider) は di/container.ts で注入される。
 */
export function createAuthMiddleware(tokenProvider: TokenProvider) {
  return async function authMiddleware(
    c: Context<HonoEnv>,
    next: () => Promise<void>,
  ): Promise<void | Response> {
    // Bearer トークン
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = tokenProvider.verifyAccess(token);
      if (payload) {
        c.set("user", { id: payload.userId, role: payload.role } as User);
        return next();
      }
    }

    // 開発/テスト用: ヘッダーベース認証
    const userId = c.req.header("x-user-id");
    const userRole = c.req.header("x-user-role");
    if (userId && userRole) {
      c.set("user", { id: userId, role: userRole } as User);
      return next();
    }

    throw new AuthenticationRequiredError();
  };
}

export async function adminOnly(
  c: Context<HonoEnv>,
  next: () => Promise<void>,
): Promise<void | Response> {
  const user = c.get("user");
  if (user.role !== "admin") {
    throw new PermissionDeniedError("管理者権限が必要です");
  }
  return next();
}

export async function editorOrAdmin(
  c: Context<HonoEnv>,
  next: () => Promise<void>,
): Promise<void | Response> {
  const user = c.get("user");
  if (user.role !== "admin" && user.role !== "editor") {
    throw new PermissionDeniedError("編集者以上の権限が必要です");
  }
  return next();
}

// ============================================================
// infrastructure/http/routes/user.routes.ts
// ============================================================

import type { UnitOfWork } from "../../../application/ports/unit-of-work";

/**
 * User ルート
 *
 * 責務: HTTP の受付と返却のみ。
 * UseCase に処理を委譲。try/catch なし（error-handler が一括処理）。
 */
export function createUserRoutes(
  authMiddleware: any,
  unitOfWork: UnitOfWork,
  useCases: {
    createUser: { execute: (dto: any, uow: UnitOfWork) => Promise<any> };
    getUser: { execute: (id: string, uow: UnitOfWork) => Promise<any> };
    listUsers: { execute: (filters: any, uow: UnitOfWork) => Promise<any> };
    updateUser: { execute: (id: string, dto: any, uow: UnitOfWork) => Promise<any> };
  },
) {
  const routes = new Hono<HonoEnv>();

  routes.use("*", authMiddleware);

  // GET /api/users
  routes.get("/", async (c) => {
    const filters = {
      search: c.req.query("search"),
      role: c.req.query("role"),
      page: Number(c.req.query("page") ?? "1"),
      limit: Number(c.req.query("limit") ?? "20"),
    };
    const result = await useCases.listUsers.execute(filters, unitOfWork);
    return c.json(result);
  });

  // GET /api/users/:id
  routes.get("/:id", async (c) => {
    const id = c.req.param("id");
    const result = await useCases.getUser.execute(id, unitOfWork);
    return c.json(result);
  });

  // POST /api/users
  routes.post("/", adminOnly, async (c) => {
    const body = await c.req.json();
    const result = await useCases.createUser.execute(body, unitOfWork);
    return c.json(result, 201);
  });

  // PATCH /api/users/:id
  routes.patch("/:id", adminOnly, async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const result = await useCases.updateUser.execute(id, body, unitOfWork);
    return c.json(result);
  });

  return routes;
}

// ============================================================
// infrastructure/http/app.ts — アプリケーション定義
// ============================================================

// import { errorHandler } from "./error-mapper";
// import { createAuthMiddleware } from "./middleware/auth.middleware";
// import { createUserRoutes } from "./routes/user.routes";
// import { tokenProvider, createUserUseCase, ... } from "../../di/container";

export function createApp(deps: {
  unitOfWork: UnitOfWork;
  tokenProvider: TokenProvider;
  useCases: {
    createUser: any;
    getUser: any;
    listUsers: any;
    updateUser: any;
  };
}) {
  const app = new Hono();

  // グローバルミドルウェア
  app.use(
    "*",
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(",") ?? ["http://localhost:5173"],
      credentials: true,
    }),
  );

  // グローバル例外ハンドラ（ErrorCode → HTTP ステータス変換）
  app.onError(errorHandler);

  // 認証ミドルウェア
  const authMiddleware = createAuthMiddleware(deps.tokenProvider);

  // ルートマウント
  const userRoutes = createUserRoutes(authMiddleware, deps.unitOfWork, deps.useCases);
  app.route("/api/users", userRoutes);
  // app.route("/api/auth", createAuthRoutes(...));
  // app.route("/api/announcements", createAnnouncementRoutes(...));

  return app;
}

// ============================================================
// index.ts — Node.js エントリポイント（Composition Root を起動）
// ============================================================

/*
import { serve } from "@hono/node-server";
import { createApp } from "./infrastructure/http/app";
import { DrizzleUnitOfWork } from "./infrastructure/db/drizzle-unit-of-work";
import { BcryptPasswordHasher } from "./infrastructure/security/bcrypt-password-hasher";
import { JwtTokenProvider } from "./infrastructure/security/jwt-token-provider";
import { CreateUserUseCase } from "./application/usecases/users/create-user.usecase";
import { GetUserUseCase } from "./application/usecases/users/get-user.usecase";
import { ListUsersUseCase } from "./application/usecases/users/list-users.usecase";
import { UpdateUserUseCase } from "./application/usecases/users/update-user.usecase";
import { initDb, getDb } from "./infrastructure/db/connection";

async function main() {
  await initDb();

  const passwordHasher = new BcryptPasswordHasher();
  const tokenProvider = new JwtTokenProvider(process.env.JWT_SECRET!);
  const unitOfWork = new DrizzleUnitOfWork(getDb());

  const app = createApp({
    unitOfWork,
    tokenProvider,
    useCases: {
      createUser: new CreateUserUseCase(passwordHasher),
      getUser: new GetUserUseCase(),
      listUsers: new ListUsersUseCase(),
      updateUser: new UpdateUserUseCase(),
    },
  });

  serve({ fetch: app.fetch, port: 3000 }, (info) => {
    console.log(`Server running on http://localhost:${info.port}`);
  });
}

main();
*/
