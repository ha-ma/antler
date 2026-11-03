import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { CreateTripUseCase } from '../../../application/usecases/trips/create-trip.usecase.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { createTripBodySchema, createTripHeadersSchema } from '../schemas/trip.schema.js'
import { throwOnInvalidTripBody, throwOnMissingIdempotencyKey } from '../validation.js'

// POST /api/trips（docs/specs/plan-trip/functional.md「API エンドポイント」）。
// 認証なし（#9 登録なし）。IP あたり 1 分 10 件（ch6）→ ヘッダ・body の検証 → UseCase → 201。

export const TRIPS_PER_MINUTE_PER_IP = 10
/** body の上限。入力は選択肢だけなので小さい */
export const TRIP_BODY_MAX_BYTES = 16 * 1024

export type TripRoutesDeps = {
  createTrip: Pick<CreateTripUseCase, 'execute'>
  /** レート制限の鍵（利用者の IP）。di が TRUST_PROXY に従って作る */
  rateLimitKey: (c: Context) => string
  now?: () => number
}

export function tripRoutes({ createTrip, rateLimitKey, now }: TripRoutesDeps): Hono {
  const routes = new Hono()
  routes.post(
    '/api/trips',
    rateLimit({
      limit: TRIPS_PER_MINUTE_PER_IP,
      windowMs: 60_000,
      key: rateLimitKey,
      ...(now ? { now } : {}),
    }),
    bodyLimit({
      maxSize: TRIP_BODY_MAX_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'INVALID_INPUT', message: '入力が大きすぎます' } }, 413),
    }),
    zValidator('header', createTripHeadersSchema, throwOnMissingIdempotencyKey),
    zValidator('json', createTripBodySchema, throwOnInvalidTripBody),
    async (c) => {
      const result = await createTrip.execute({
        idempotencyKey: c.req.valid('header')['idempotency-key'],
        trip: c.req.valid('json'),
      })
      if (result.replayed) c.header('Idempotent-Replayed', 'true')
      return c.json(
        { plan: result.plan, details: result.details, ownerToken: result.ownerToken },
        201,
      )
    },
  )
  return routes
}
