import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TripDetailsSchema, TripPlanSchema, type TripPlan } from '@antler/schema'
import {
  assessRisk,
  buildItinerary,
  buildTripPlan,
  DayPlanSchema,
  PERSONA_INPUT,
} from '@antler/trip'
import { GetTripDayUseCase } from '../../../application/usecases/trip-day/get-trip-day.usecase.js'
import { openDatabase, type Connection } from '../../db/connection.js'
import { ensureSchema } from '../../db/migrate.js'
import { FileRoadCatalogGateway } from '../../gateways/file-road-catalog.gateway.js'
import { createLogger } from '../../logging/logger.js'
import { DrizzleTripRepository } from '../../repositories/drizzle-trip.repository.js'
import { SystemClock } from '../../system/system-clock.js'
import { createApp } from '../app.js'
import { TRIP_DAYS_PER_MINUTE_PER_IP } from './trip-day.routes.js'

// GET /api/trips/:id/day/:n の e2e（Hono の app.request ＋ 一時ファイルの SQLite ＋ 同梱データ）。
// docs/specs/brief-map/functional.md AC-1・UC-5、threat.md AUTH-1〜AUTH-4

const T0 = Date.parse('2026-11-03T12:00:00+09:00')
const ID = 'K7m2abcd'
const OWNER_HASH = 'f'.repeat(64)
let dir: string
let conn: Connection

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'antler-api-day-'))
  conn = openDatabase(`file:${join(dir, 'trips.db')}`)
  await ensureSchema(conn.client)
})

afterEach(() => {
  conn.client.close()
  rmSync(dir, { recursive: true, force: true })
})

async function setup() {
  const repo = new DrizzleTripRepository(conn.db)
  const itinerary = buildItinerary(PERSONA_INPUT)
  const plan: TripPlan = TripPlanSchema.parse(
    buildTripPlan(PERSONA_INPUT, itinerary, assessRisk(PERSONA_INPUT, itinerary), {
      id: ID,
      seed: 918273,
      title: '流氷とタンチョウ',
    }),
  )
  const note = { ja: '移動', en: 'Drive', zh: '移動', ko: '이동' }
  const details = TripDetailsSchema.parse({
    tripId: ID,
    titles: { ja: '流氷とタンチョウ', en: 'Drift ice', zh: '流冰', ko: '유빙' },
    dayNotes: plan.days.map((d) => ({ day: d.day, note })),
    skipped: [],
    createdAt: '2026-11-03T12:00:00+09:00',
  })
  await repo.insertTrip({ plan, details, ownerTokenHash: OWNER_HASH, createdAtMs: T0 })
  const logger = createLogger('error', { sink: () => undefined })
  const app = createApp({
    logger,
    corsOrigins: ['http://localhost:5173'],
    readinessChecks: [],
    exposeErrorDetails: false,
    tripDays: {
      getTripDay: new GetTripDayUseCase({
        trips: repo,
        data: new FileRoadCatalogGateway(),
        clock: new SystemClock(),
        log: logger,
      }),
      rateLimitKey: (c) => c.req.header('x-test-ip') ?? 'unknown',
      now: () => T0,
    },
  })
  const get = (path: string, ip = '203.0.113.1') =>
    app.request(path, { headers: { 'x-test-ip': ip } })
  return { get, plan }
}

describe('GET /api/trips/:id/day/:n', () => {
  it('AC-1 / AUTH-1: ヘッダなしで全日 200。形が正しく、ゾーンを通る日があり、時刻と移動の順がそろい、2 回目も同じ', async () => {
    const { get, plan } = await setup()
    let passages = 0
    for (const d of plan.days) {
      const path = `/api/trips/${ID}/day/${String(d.day)}`
      const res = await get(path)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { plan: unknown; details: unknown; day: unknown }
      expect(TripPlanSchema.parse(body.plan).id).toBe(ID)
      expect(TripDetailsSchema.parse(body.details).tripId).toBe(ID)
      const day = DayPlanSchema.parse(body.day)
      expect(day.day).toBe(d.day)
      passages += day.zones.length
      const ms = (iso: string) => Date.parse(iso)
      day.legs.forEach((leg, i) => {
        const next = day.legs[i + 1]
        if (next) expect(ms(leg.arriveAt)).toBeLessThanOrEqual(ms(next.departAt))
      })
      for (const z of day.zones) {
        const leg = day.legs[z.leg]
        expect(ms(z.entryAt)).toBeGreaterThanOrEqual(ms(leg?.departAt ?? ''))
        expect(ms(z.exitAt)).toBeLessThanOrEqual(ms(leg?.arriveAt ?? ''))
      }
      const again = (await (await get(path)).json()) as { day: unknown }
      expect(again.day).toEqual(body.day)
    }
    expect(passages).toBeGreaterThan(0)
    // 全日の DayPlan を 2 回ずつ作る（単独で約 2 秒）。並行セッションで負荷が高いと 5 秒を超える（既知、2026-11-04 の報告）
  }, 20_000)

  it('AUTH-2: 応答のどこにも ownerTokenHash とその値が無い', async () => {
    const { get } = await setup()
    const text = await (await get(`/api/trips/${ID}/day/1`)).text()
    expect(text).not.toContain('ownerTokenHash')
    expect(text).not.toContain(OWNER_HASH)
  }, 20_000)

  it('UC-5b: n が 1 以上の整数でない → 400 INVALID_INPUT', async () => {
    const { get } = await setup()
    for (const n of ['0', '1.5', 'abc', '-1', '01']) {
      const res = await get(`/api/trips/${ID}/day/${n}`)
      expect(res.status, n).toBe(400)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_INPUT')
    }
  })

  it('UC-5c / AUTH-3: 日数を超える n → 404 DAY_NOT_FOUND、無い id・形の違う id → 同じ 404 TRIP_NOT_FOUND', async () => {
    const { get } = await setup()
    const code = async (path: string) => {
      const res = await get(path)
      return [res.status, ((await res.json()) as { error: { code: string } }).error.code]
    }
    expect(await code(`/api/trips/${ID}/day/6`)).toEqual([404, 'DAY_NOT_FOUND'])
    for (const id of ['Zz9yXx8w', 'K7m!', 'a'.repeat(17), '%2E%2E%2Fx'])
      expect(await code(`/api/trips/${id}/day/1`), id).toEqual([404, 'TRIP_NOT_FOUND'])
  })

  it('UC-5e / AUTH-4: 同じ IP から 1 分に 61 件目 → 429。別の IP は通る', async () => {
    const { get } = await setup()
    for (let i = 0; i < TRIP_DAYS_PER_MINUTE_PER_IP; i++)
      expect((await get(`/api/trips/Zz9yXx8w/day/1`, '198.51.100.7')).status).toBe(404)
    const limited = await get(`/api/trips/${ID}/day/1`, '198.51.100.7')
    expect(limited.status).toBe(429)
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
    expect((await get(`/api/trips/${ID}/day/1`, '198.51.100.8')).status).toBe(200)
  })
})
