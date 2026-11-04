import { zValidator } from '@hono/zod-validator'
import { buildRecordView } from '@antler/trip'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { DeleteTripUseCase } from '../../../application/usecases/record/delete-trip.usecase.js'
import type { GetTripRecordUseCase } from '../../../application/usecases/record/get-trip-record.usecase.js'
import type { SaveRunUseCase } from '../../../application/usecases/record/save-run.usecase.js'
import { TripNotFoundError } from '../../../domain/trips/errors/trip-errors.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { bearerToken, recordParamsSchema, saveRunBodySchema } from '../schemas/record.schema.js'
import { throwOnInvalidTripBody } from '../validation.js'
import type { OgImages } from '../views/og-image-renderer.js'
import { RECORD_PAGE_CSP, renderNotFoundPage, renderRecordPage } from '../views/record-page.js'
import { buildShioriSvg } from '../views/shiori-svg.js'

// 旅の記録（docs/specs/record/functional.md「API エンドポイント」、threat.md の Authorization Matrix）。
// 書き込み（runs・DELETE）は所有者トークン（Bearer）。読み出し（record・/t/:id・og.png）は ID を知る人に公開。
// どの応答もキャッシュさせない（削除がすぐ効く。threat.md「認可の失効」）。

/** 書き込み（記録作成・削除）の IP あたりの上限（ch6「記録作成 10/分/IP」） */
export const RECORD_WRITES_PER_MINUTE_PER_IP = 10
/** 読み出し（JSON・SSR） */
export const RECORD_READS_PER_MINUTE_PER_IP = 60
/** OG 画像 */
export const OG_IMAGES_PER_MINUTE_PER_IP = 20
/** run の body の上限 */
export const RUN_BODY_MAX_BYTES = 16 * 1024

export type RecordUrls = { api: string; sim: string; pwa: string }

export type RecordRoutesDeps = {
  getRecord: Pick<GetTripRecordUseCase, 'execute'>
  saveRun: Pick<SaveRunUseCase, 'execute'>
  deleteTrip: Pick<DeleteTripUseCase, 'execute'>
  ogImages: OgImages
  /** 公開 URL（env だけから。Host ヘッダは使わない） */
  urls: RecordUrls
  /** レート制限の鍵（利用者の IP）。di が TRUST_PROXY に従って作る */
  rateLimitKey: (c: Context) => string
  now?: () => number
}

const PUBLIC_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
}

export function recordRoutes({
  getRecord,
  saveRun,
  deleteTrip,
  ogImages,
  urls,
  rateLimitKey,
  now,
}: RecordRoutesDeps): Hono {
  const limit = (perMinute: number) =>
    rateLimit({ limit: perMinute, windowMs: 60_000, key: rateLimitKey, ...(now ? { now } : {}) })
  const params = zValidator('param', recordParamsSchema, throwOnInvalidTripBody)

  // 変数名は app（sfad-drift が `app.get(` で threat.md の操作と突き合わせる）
  const app = new Hono()

  app.post(
    '/api/trips/:id/runs',
    limit(RECORD_WRITES_PER_MINUTE_PER_IP),
    bodyLimit({
      maxSize: RUN_BODY_MAX_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '記録が大きすぎます' } }, 413),
    }),
    params,
    zValidator('json', saveRunBodySchema, throwOnInvalidTripBody),
    async (c) => {
      const result = await saveRun.execute({
        tripId: c.req.valid('param').id,
        ownerToken: bearerToken(c.req.header('Authorization')),
        run: c.req.valid('json'),
      })
      c.header('Cache-Control', 'no-store')
      return c.json({ run: result.run }, result.replayed ? 200 : 201)
    },
  )

  app.get('/api/trips/:id/record', limit(RECORD_READS_PER_MINUTE_PER_IP), params, async (c) => {
    const { trip, record } = await getRecord.execute({ id: c.req.valid('param').id })
    return c.json({ trip, record }, 200, PUBLIC_HEADERS)
  })

  app.delete('/api/trips/:id', limit(RECORD_WRITES_PER_MINUTE_PER_IP), params, async (c) => {
    await deleteTrip.execute({
      tripId: c.req.valid('param').id,
      ownerToken: bearerToken(c.req.header('Authorization')),
    })
    return c.body(null, 204, { 'Cache-Control': 'no-store' })
  })

  app.get('/t/:id', limit(RECORD_READS_PER_MINUTE_PER_IP), params, async (c) => {
    const { id } = c.req.valid('param')
    const headers = {
      ...PUBLIC_HEADERS,
      'Content-Security-Policy': RECORD_PAGE_CSP,
      'Content-Type': 'text/html; charset=utf-8',
    }
    try {
      const { trip, record } = await getRecord.execute({ id })
      const path = `/t/${encodeURIComponent(trip.id)}`
      const page = await renderRecordPage(buildRecordView(trip, record), {
        page: `${urls.api}${path}`,
        ogImage: `${urls.api}${path}/og.png`,
        app: `${urls.sim}${path}`,
        plan: `${urls.sim}/plan`,
        pwa: urls.pwa,
      })
      return c.body(page.toString(), 200, headers)
    } catch (error) {
      if (!(error instanceof TripNotFoundError)) throw error
      const page = await renderNotFoundPage(`${urls.sim}/plan`)
      return c.body(page.toString(), 404, headers)
    }
  })

  app.get('/t/:id/og.png', limit(OG_IMAGES_PER_MINUTE_PER_IP), params, async (c) => {
    const { trip, record, version } = await getRecord.execute({ id: c.req.valid('param').id })
    const key = `${trip.id}:${String(version.runs)}:${String(version.lastSeq)}`
    const png = await ogImages.png(key, () => buildShioriSvg(buildRecordView(trip, record)))
    return c.body(png, 200, { ...PUBLIC_HEADERS, 'Content-Type': 'image/png' })
  })

  return app
}
