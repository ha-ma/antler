import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { EventLog } from '../../../application/ports/system/event-log.js'
import type { SubmitCaptureUseCase } from '../../../application/usecases/captures/submit-capture.usecase.js'
import { CaptureInputError } from '../../../domain/captures/errors/capture-errors.js'
import { CAPTURE_BODY_MAX_BYTES } from '../../../domain/captures/rules/capture-rules.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { parseCaptureForm, parseCaptureJson } from '../schemas/capture.schema.js'

// POST /api/captures（docs/specs/edge-capture/functional.md A1〜A9）。
// 認証なし（#9 登録なし）。IP あたり 1 分 60 件 → 本文 1.25 MB → multipart の読み方・Capture の検証 → UseCase → 201 / 200。
// 読み出し（GET）・削除（DELETE）の口は作らない（取り込みは dataset/ がファイルを直接読む。IDOR の面を作らない）。

export const CAPTURES_PER_MINUTE_PER_IP = 60

export type CaptureRoutesDeps = {
  submitCapture: Pick<SubmitCaptureUseCase, 'execute'>
  /** レート制限の鍵（利用者の IP）。di が TRUST_PROXY に従って作る */
  rateLimitKey: (c: Context) => string
  /** capture.received を出す。出すのは id・source・画像の大きさ・status だけ（Capture の本文・roadSegment・画像・IP は出さない） */
  log: EventLog
  now?: () => number
}

export function captureRoutes({ submitCapture, rateLimitKey, log, now }: CaptureRoutesDeps): Hono {
  // 変数名は app（sfad-drift が `app.post(` で threat.md の操作と突き合わせる）
  const app = new Hono()
  app.post(
    '/api/captures',
    rateLimit({
      limit: CAPTURES_PER_MINUTE_PER_IP,
      windowMs: 60_000,
      key: rateLimitKey,
      ...(now ? { now } : {}),
    }),
    bodyLimit({
      maxSize: CAPTURE_BODY_MAX_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'INVALID_INPUT', message: '入力が大きすぎます' } }, 413),
    }),
    async (c) => {
      const form = await c.req.parseBody({ all: true }).catch(() => {
        throw new CaptureInputError(['body: multipart/form-data として読めません'])
      })
      const { captureText, image } = parseCaptureForm(form)
      const capture = parseCaptureJson(captureText)
      const result = await submitCapture.execute({
        capture,
        image: new Uint8Array(await image.arrayBuffer()),
      })
      const status = result.replayed ? 200 : 201
      if (result.replayed) c.header('Idempotent-Replayed', 'true')
      log.info('capture.received', {
        id: result.id,
        source: capture.source,
        imageBytes: result.imageBytes,
        status,
      })
      return c.json({ id: result.id, image: result.image }, status)
    },
  )
  return app
}
