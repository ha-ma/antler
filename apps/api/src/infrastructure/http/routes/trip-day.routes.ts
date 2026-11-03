import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import type { GetTripDayUseCase } from '../../../application/usecases/trip-day/get-trip-day.usecase.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { tripDayParamsSchema } from '../schemas/trip-day.schema.js'
import { throwOnInvalidTripBody } from '../validation.js'

// GET /api/trips/:id/day/:n（docs/specs/brief-map/functional.md「API エンドポイント」）。
// 認証なし（ID を知る人が読める。threat.md）。IP あたり 1 分 60 件 → パスの検証 → UseCase → 200。

export const TRIP_DAYS_PER_MINUTE_PER_IP = 60

export type TripDayRoutesDeps = {
  getTripDay: Pick<GetTripDayUseCase, 'execute'>
  /** レート制限の鍵（利用者の IP）。di が TRUST_PROXY に従って作る */
  rateLimitKey: (c: Context) => string
  now?: () => number
}

export function tripDayRoutes({ getTripDay, rateLimitKey, now }: TripDayRoutesDeps): Hono {
  // 変数名は app（sfad-drift が `app.get(` で threat.md の操作と突き合わせる）
  const app = new Hono()
  app.get(
    '/api/trips/:id/day/:n',
    rateLimit({
      limit: TRIP_DAYS_PER_MINUTE_PER_IP,
      windowMs: 60_000,
      key: rateLimitKey,
      ...(now ? { now } : {}),
    }),
    zValidator('param', tripDayParamsSchema, throwOnInvalidTripBody),
    async (c) => {
      const { id, n } = c.req.valid('param')
      const { plan, details, day } = await getTripDay.execute({ id, day: n })
      return c.json({ plan, details, day }, 200)
    },
  )
  return app
}
