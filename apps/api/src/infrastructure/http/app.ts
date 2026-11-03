import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { serializeError, type Logger } from '../logging/logger.js'
import { toHttpError } from './error-mapper.js'
import { healthRoutes, type ReadinessCheck } from './routes/health.routes.js'

// Hono アプリの定義（ランタイム非依存）。起動は src/index.ts、組み立ては di/container.ts。

export type AppDeps = {
  logger: Logger
  corsOrigins: readonly string[]
  readinessChecks: readonly ReadinessCheck[]
  exposeErrorDetails: boolean
}

export function createApp({
  logger,
  corsOrigins,
  readinessChecks,
  exposeErrorDetails,
}: AppDeps): Hono {
  const app = new Hono()

  app.use(requestId())
  app.use(async (c, next) => {
    const started = performance.now()
    await next()
    logger.info('http.request', {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    })
  })
  app.use(secureHeaders())
  app.use(
    cors({
      origin: [...corsOrigins],
      allowMethods: ['GET', 'POST', 'DELETE'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  )

  app.route('/', healthRoutes(readinessChecks))

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '見つかりません' } }, 404))
  app.onError((error, c) => {
    const mapped = toHttpError(error)
    logger.error('http.error', {
      requestId: c.get('requestId'),
      path: c.req.path,
      status: mapped.status,
      error: serializeError(error),
    })
    const body = exposeErrorDetails && error instanceof Error ? { detail: error.message } : {}
    return c.json({ error: { code: mapped.code, message: mapped.message, ...body } }, mapped.status)
  })

  return app
}
