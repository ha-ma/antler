import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { serializeError, type Logger } from '../logging/logger.js'
import { toHttpError } from './error-mapper.js'
import { captureRoutes, type CaptureRoutesDeps } from './routes/capture.routes.js'
import { healthRoutes, type ReadinessCheck } from './routes/health.routes.js'
import { lossRoutes, type LossRoutesDeps } from './routes/loss.routes.js'
import { recordRoutes, type RecordRoutesDeps } from './routes/record.routes.js'
import { tripDayRoutes, type TripDayRoutesDeps } from './routes/trip-day.routes.js'
import { tripRoutes, type TripRoutesDeps } from './routes/trip.routes.js'

// Hono アプリの定義（ランタイム非依存）。起動は src/index.ts、組み立ては di/container.ts。

export type AppDeps = {
  logger: Logger
  corsOrigins: readonly string[]
  readinessChecks: readonly ReadinessCheck[]
  exposeErrorDetails: boolean
  /** POST /api/trips（plan-trip）。無ければ載せない */
  trips?: TripRoutesDeps
  /** GET /api/trips/:id/day/:n（brief-map）。無ければ載せない */
  tripDays?: TripDayRoutesDeps
  /** POST /api/trips/:id/losses（loss）。無ければ載せない */
  losses?: LossRoutesDeps
  /** 走行の記録・記録・削除・/t/:id（record）。無ければ載せない */
  records?: RecordRoutesDeps
  /** POST /api/captures（edge-capture）。無ければ載せない */
  captures?: CaptureRoutesDeps
}

export function createApp({
  logger,
  corsOrigins,
  readinessChecks,
  exposeErrorDetails,
  trips,
  tripDays,
  losses,
  records,
  captures,
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
      // Authorization は旅の所有者トークン（record の runs・DELETE）
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Authorization'],
      exposeHeaders: ['Idempotent-Replayed', 'Retry-After'],
      maxAge: 600,
    }),
  )

  app.route('/', healthRoutes(readinessChecks))
  if (trips) app.route('/', tripRoutes(trips))
  if (tripDays) app.route('/', tripDayRoutes(tripDays))
  if (losses) app.route('/', lossRoutes(losses))
  if (records) app.route('/', recordRoutes(records))
  if (captures) app.route('/', captureRoutes(captures))

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '見つかりません' } }, 404))
  app.onError((error, c) => {
    const mapped = toHttpError(error)
    // 利用者側の誤り（4xx）と Claude の失敗（502。理由は gateway が記録済み）は warn、それ以外は error
    const level = mapped.status < 500 || mapped.status === 502 ? 'warn' : 'error'
    logger[level]('http.error', {
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
