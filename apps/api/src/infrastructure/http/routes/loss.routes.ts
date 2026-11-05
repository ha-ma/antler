import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { WriteLossUseCase } from '../../../application/usecases/losses/write-loss.usecase.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { createLossBodySchema, lossParamsSchema } from '../schemas/loss.schema.js'
import { throwOnInvalidTripBody } from '../validation.js'

// POST /api/trips/:id/losses（docs/specs/loss/functional.md「API エンドポイント」、threat.md）。
// 認証なし（旅の ID を知る人が作れる）。IP あたり 1 分 10 件 → パス・body の検証 → UseCase → 201（新規）/ 200（保存済み）。

export const LOSSES_PER_MINUTE_PER_IP = 10
/** body の上限。入力は選択肢と短い値だけ */
export const LOSS_BODY_MAX_BYTES = 4 * 1024

export type LossRoutesDeps = {
  writeLoss: Pick<WriteLossUseCase, 'execute'>
  /** レート制限の鍵（利用者の IP）。di が TRUST_PROXY に従って作る */
  rateLimitKey: (c: Context) => string
  now?: () => number
}

export function lossRoutes({ writeLoss, rateLimitKey, now }: LossRoutesDeps): Hono {
  // 変数名は app（sfad-drift が `app.post(` で threat.md の操作と突き合わせる）
  const app = new Hono()
  app.post(
    '/api/trips/:id/losses',
    rateLimit({
      name: 'losses.write',
      limit: LOSSES_PER_MINUTE_PER_IP,
      windowMs: 60_000,
      key: rateLimitKey,
      ...(now ? { now } : {}),
    }),
    bodyLimit({
      maxSize: LOSS_BODY_MAX_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'INVALID_INPUT', message: '入力が大きすぎます' } }, 413),
    }),
    zValidator('param', lossParamsSchema, throwOnInvalidTripBody),
    zValidator('json', createLossBodySchema, throwOnInvalidTripBody),
    async (c) => {
      const result = await writeLoss.execute({
        tripId: c.req.valid('param').id,
        collision: c.req.valid('json'),
      })
      return c.json({ loss: result.loss }, result.replayed ? 200 : 201)
    },
  )
  return app
}
