import type { Hono } from 'hono'
import { loadEnv, type Env } from '../infrastructure/config/env.js'
import { createApp } from '../infrastructure/http/app.js'
import { createLogger, type Logger } from '../infrastructure/logging/logger.js'

// Composition Root。全層を組み立てる唯一の場所。

export type Container = { env: Env; logger: Logger; app: Hono }

export function buildContainer(source: Record<string, string | undefined>): Container {
  const env = loadEnv(source)
  const logger = createLogger(env.LOG_LEVEL, { base: { service: 'api' } })
  const app = createApp({
    logger,
    corsOrigins: env.CORS_ORIGINS,
    readinessChecks: [],
    exposeErrorDetails: env.NODE_ENV !== 'production',
  })
  return { env, logger, app }
}
