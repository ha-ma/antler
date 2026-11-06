import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { PrepareChatUseCase } from '../../../application/usecases/chats/prepare-chat.usecase.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { chatParamsSchema } from '../schemas/chat.schema.js'
import { bearerToken } from '../schemas/stop-deck.schema.js'
import { throwOnInvalidTripBody } from '../validation.js'

// POST /api/trips/:id/day/:n/chat（docs/specs/drive-audio-chat/functional.md「API エンドポイント」、threat.md）。
// IP あたり 1 分 10 件（認可より先）→ パスの検証 → UseCase（所有者の照合・生成か保存済み）→ 201 / 200。

export const CHATS_PER_MINUTE_PER_IP = 10
/** body は読まない。大きな body は先に止める */
export const CHAT_BODY_MAX_BYTES = 1024

export type ChatRoutesDeps = {
  prepareChat: Pick<PrepareChatUseCase, 'execute'>
  rateLimitKey: (c: Context) => string
  now?: () => number
}

export function chatRoutes({ prepareChat, rateLimitKey, now }: ChatRoutesDeps): Hono {
  // 変数名は app（sfad-drift が `app.post(` で threat.md の操作と突き合わせる）
  const app = new Hono()
  app.post(
    '/api/trips/:id/day/:n/chat',
    rateLimit({
      name: 'chats.prepare',
      limit: CHATS_PER_MINUTE_PER_IP,
      windowMs: 60_000,
      key: rateLimitKey,
      ...(now ? { now } : {}),
    }),
    bodyLimit({
      maxSize: CHAT_BODY_MAX_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'INVALID_INPUT', message: '入力が大きすぎます' } }, 413),
    }),
    zValidator('param', chatParamsSchema, throwOnInvalidTripBody),
    async (c) => {
      const { id, n } = c.req.valid('param')
      const result = await prepareChat.execute({
        tripId: id,
        day: n,
        ownerToken: bearerToken(c.req.header('authorization')),
      })
      if (result.replayed) c.header('Idempotent-Replayed', 'true')
      return c.json({ chat: result.chat }, result.replayed ? 200 : 201)
    },
  )
  return app
}
