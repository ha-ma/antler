import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { PrepareStopDeckUseCase } from '../../../application/usecases/stop-events/prepare-stop-deck.usecase.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { OWNER_TOKEN_HEADER, stopDeckParamsSchema } from '../schemas/stop-deck.schema.js'
import { throwOnInvalidTripBody } from '../validation.js'

// POST /api/trips/:id/day/:n/stop-deck（docs/specs/stop-events/functional.md「API エンドポイント」、threat.md）。
// IP あたり 1 分 10 件（認可より先）→ パスの検証 → UseCase（所有者の照合・生成か保存済み）→ 201 / 200。

export const STOP_DECKS_PER_MINUTE_PER_IP = 10
/** body は読まない。大きな body は先に止める */
export const STOP_DECK_BODY_MAX_BYTES = 1024

export type StopDeckRoutesDeps = {
  prepareStopDeck: Pick<PrepareStopDeckUseCase, 'execute'>
  rateLimitKey: (c: Context) => string
  now?: () => number
}

export function stopDeckRoutes({ prepareStopDeck, rateLimitKey, now }: StopDeckRoutesDeps): Hono {
  // 変数名は app（sfad-drift が `app.post(` で threat.md の操作と突き合わせる）
  const app = new Hono()
  app.post(
    '/api/trips/:id/day/:n/stop-deck',
    rateLimit({
      limit: STOP_DECKS_PER_MINUTE_PER_IP,
      windowMs: 60_000,
      key: rateLimitKey,
      ...(now ? { now } : {}),
    }),
    bodyLimit({
      maxSize: STOP_DECK_BODY_MAX_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'INVALID_INPUT', message: '入力が大きすぎます' } }, 413),
    }),
    zValidator('param', stopDeckParamsSchema, throwOnInvalidTripBody),
    async (c) => {
      const { id, n } = c.req.valid('param')
      const result = await prepareStopDeck.execute({
        tripId: id,
        day: n,
        ownerToken: c.req.header(OWNER_TOKEN_HEADER),
      })
      if (result.replayed) c.header('Idempotent-Replayed', 'true')
      return c.json({ deck: result.deck, writing: result.writing }, result.replayed ? 200 : 201)
    },
  )
  return app
}
