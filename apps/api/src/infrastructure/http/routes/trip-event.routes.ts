import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { RecordTripEventsUseCase } from '../../../application/usecases/stop-events/record-trip-events.usecase.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { OWNER_TOKEN_HEADER } from '../schemas/stop-deck.schema.js'
import { recordTripEventsBodySchema, tripEventParamsSchema } from '../schemas/trip-event.schema.js'
import { throwOnInvalidTripBody } from '../validation.js'

// POST /api/trips/:id/events（docs/specs/stop-events/functional.md R10、threat.md）。
// IP あたり 1 分 60 件（認可より先）→ パス・body の検証 → UseCase（所有者の照合・重複・上限）→ 200。

export const TRIP_EVENTS_PER_MINUTE_PER_IP = 60
export const TRIP_EVENTS_BODY_MAX_BYTES = 32 * 1024

export type TripEventRoutesDeps = {
  recordTripEvents: Pick<RecordTripEventsUseCase, 'execute'>
  rateLimitKey: (c: Context) => string
  now?: () => number
}

export function tripEventRoutes({
  recordTripEvents,
  rateLimitKey,
  now,
}: TripEventRoutesDeps): Hono {
  // 変数名は app（sfad-drift が `app.post(` で threat.md の操作と突き合わせる）
  const app = new Hono()
  app.post(
    '/api/trips/:id/events',
    rateLimit({
      limit: TRIP_EVENTS_PER_MINUTE_PER_IP,
      windowMs: 60_000,
      key: rateLimitKey,
      ...(now ? { now } : {}),
    }),
    bodyLimit({
      maxSize: TRIP_EVENTS_BODY_MAX_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'INVALID_INPUT', message: '入力が大きすぎます' } }, 413),
    }),
    zValidator('param', tripEventParamsSchema, throwOnInvalidTripBody),
    zValidator('json', recordTripEventsBodySchema, throwOnInvalidTripBody),
    async (c) => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const result = await recordTripEvents.execute({
        tripId: id,
        ownerToken: c.req.header(OWNER_TOKEN_HEADER),
        runId: body.runId.toLowerCase(),
        alertEnabled: body.alertEnabled,
        events: body.events,
      })
      return c.json(result, 200)
    },
  )
  return app
}
