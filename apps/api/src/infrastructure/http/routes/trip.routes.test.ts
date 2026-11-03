import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TripDetailsSchema, TripPlanSchema } from '@antler/schema'
import { assessRisk, buildItinerary, PERSONA_INPUT, pleasuresInArea } from '@antler/trip'
import {
  FixedClock,
  KEY_A,
  KEY_B,
  MemoryLog,
  ScriptedWriter,
} from '../../../../tests/factories/trips.js'
import { CreateTripUseCase } from '../../../application/usecases/trips/create-trip.usecase.js'
import { TripWriterError } from '../../../domain/trips/errors/trip-errors.js'
import { openDatabase, type Connection } from '../../db/connection.js'
import { DrizzleUnitOfWork } from '../../db/drizzle-unit-of-work.js'
import { ensureSchema } from '../../db/migrate.js'
import { createLogger } from '../../logging/logger.js'
import { DrizzleTripRepository } from '../../repositories/drizzle-trip.repository.js'
import {
  HmacSha256TokenSigner,
  NodeRandomSource,
  NodeSha256Hasher,
} from '../../security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../system/in-process-concurrency-limiter.js'
import { createApp } from '../app.js'

// POST /api/trips の e2e（Hono の app.request ＋ 一時ファイルの SQLite。Claude はフェイク）。

const T0 = Date.parse('2026-11-03T12:00:00+09:00')
let dir: string
let conn: Connection

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'antler-api-'))
  conn = openDatabase(`file:${join(dir, 'trips.db')}`)
  await ensureSchema(conn.client)
})

afterEach(() => {
  conn.client.close()
  rmSync(dir, { recursive: true, force: true })
})

function setup(
  opts: { writer?: ScriptedWriter; dailyCalls?: number; slots?: InProcessConcurrencyLimiter } = {},
) {
  const writer = opts.writer ?? new ScriptedWriter()
  const repo = new DrizzleTripRepository(conn.db)
  const lines: Record<string, unknown>[] = []
  const logger = createLogger('debug', {
    sink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
  })
  const createTrip = new CreateTripUseCase({
    trips: repo,
    uow: new DrizzleUnitOfWork(conn.db),
    writer,
    writerSlots: opts.slots ?? new InProcessConcurrencyLimiter(4),
    random: new NodeRandomSource(),
    hasher: new NodeSha256Hasher(),
    ownerTokens: new HmacSha256TokenSigner('e2e-owner-token-secret-0123456789abcdef'),
    clock: new FixedClock(T0),
    log: new MemoryLog(),
    dailyWriterCallLimit: opts.dailyCalls ?? 400,
  })
  const app = createApp({
    logger,
    corsOrigins: ['http://localhost:5173'],
    readinessChecks: [],
    exposeErrorDetails: false,
    trips: {
      createTrip,
      rateLimitKey: (c) => c.req.header('x-test-ip') ?? 'unknown',
      now: () => T0,
    },
  })
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/api/trips', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': KEY_A,
        'x-test-ip': '203.0.113.1',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { app, post, writer, repo, lines }
}

async function errorCode(res: Response): Promise<unknown> {
  const body = (await res.json()) as { error?: { code?: string } }
  return body.error?.code
}

async function tripCount(): Promise<number> {
  const rs = await conn.client.execute('SELECT COUNT(*) AS n FROM trips')
  return Number(rs.rows[0]?.['n'])
}

type Created = {
  plan: unknown
  details: unknown
  ownerToken: string
}

describe('POST /api/trips', () => {
  it('AC-1: ペルソナの入力 → 201。plan は TripPlanSchema を通り days は 5 日、details は TripDetailsSchema を通り、保存した旅を読める', async () => {
    const { post, repo } = setup()
    const res = await post(PERSONA_INPUT)
    expect(res.status).toBe(201)
    const body = (await res.json()) as Created
    const plan = TripPlanSchema.parse(body.plan)
    const details = TripDetailsSchema.parse(body.details)
    expect(plan.days).toHaveLength(5)
    expect(plan.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5])
    // riskScore は端末の計算（同じ関数）と小数 2 桁で一致
    const deviceScore = assessRisk(PERSONA_INPUT, buildItinerary(PERSONA_INPUT)).score
    expect(plan.riskScore.toFixed(2)).toBe(deviceScore.toFixed(2))
    for (const lang of ['ja', 'en', 'zh', 'ko'] as const) {
      expect(details.titles[lang].length).toBeGreaterThan(0)
    }
    expect(details.dayNotes).toHaveLength(5)
    expect(plan.title).toBe(details.titles.zh)
    expect(details.tripId).toBe(plan.id)
    expect(body.ownerToken).toMatch(/^[0-9a-f]{64}$/)
    const saved = await repo.findTrip(plan.id)
    expect(saved?.plan).toEqual(plan)
    expect(saved?.details).toEqual(details)
  })

  it('AUTH-1: 未認証で 201（意図的な公開が塞がれていない）', async () => {
    const { post } = setup()
    expect((await post(PERSONA_INPUT, { Authorization: '' })).status).toBe(201)
  })

  it('UC-1d・MASS-1: 知らない欄（id・seed・title・days・riskScore・alertEnabled・ownerToken）→ 400、保存しない', async () => {
    const { post, writer } = setup()
    const extras = {
      id: 'AAAAAAAA',
      seed: 1,
      title: 'x',
      days: [],
      riskScore: 0,
      alertEnabled: false,
      ownerToken: 'x',
    }
    for (const [key, value] of Object.entries(extras)) {
      const res = await post({ ...PERSONA_INPUT, [key]: value }, { 'Idempotency-Key': KEY_B })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('INVALID_INPUT')
    }
    // 入れ子の知らない欄も拒否する
    const nested = await post({ ...PERSONA_INPUT, party: { ...PERSONA_INPUT.party, admin: true } })
    expect(nested.status).toBe(400)
    expect(writer.calls).toHaveLength(0)
    expect(await tripCount()).toBe(0)
  })

  it('UC-1: 運転できる人が人数より多い・返却が出発以前・予算 1,000,001 → 400', async () => {
    const { post } = setup()
    const bad = [
      { ...PERSONA_INPUT, party: { ...PERSONA_INPUT.party, drivers: 5 } },
      { ...PERSONA_INPUT, return: { ...PERSONA_INPUT.return, at: PERSONA_INPUT.depart.at } },
      { ...PERSONA_INPUT, budgetPerPersonJPY: 1_000_001 },
    ]
    for (const body of bad) expect((await post(body)).status).toBe(400)
  })

  it('UC-2d: エリアのマスターに無い id（もう一方のエリアの id・存在しない id）→ 400', async () => {
    const { post } = setup()
    const dooId = pleasuresInArea('doo')[0]?.id
    expect(dooId).toBeDefined()
    for (const id of [dooId, 'no-such-pleasure']) {
      const res = await post({ ...PERSONA_INPUT, pleasures: [{ id, weight: 3 }] })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('INVALID_INPUT')
    }
  })

  it('読めない JSON → 400 INVALID_INPUT', async () => {
    const { post } = setup()
    const res = await post('{"lang":')
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('INVALID_INPUT')
  })

  it('Idempotency-Key が無い・UUID でない → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const { app, post } = setup()
    const missing = await app.request('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PERSONA_INPUT),
    })
    expect(missing.status).toBe(400)
    expect(await errorCode(missing)).toBe('IDEMPOTENCY_KEY_REQUIRED')
    const notUuid = await post(PERSONA_INPUT, { 'Idempotency-Key': 'abc' })
    expect(await errorCode(notUuid)).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('Idempotency-Key は UUID v4 だけ（v1・nil は 400）。crypto.randomUUID() は通る', async () => {
    const { post } = setup()
    for (const key of [
      'c232ab00-9414-11ec-b3c8-9f6bdeced846', // v1（時刻由来）
      '00000000-0000-0000-0000-000000000000',
      '0b6f6f0e-4f7e-4b0e-1a57-2f1d8f3c9a01', // variant が違う
    ]) {
      const res = await post(PERSONA_INPUT, { 'Idempotency-Key': key })
      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('IDEMPOTENCY_KEY_REQUIRED')
    }
    expect((await post(PERSONA_INPUT, { 'Idempotency-Key': crypto.randomUUID() })).status).toBe(201)
  })

  it('IDEM-1: 同じキー・同じ body で 2 回 → 2 回目は同じ旅（Idempotent-Replayed）、Claude は 1 回だけ', async () => {
    const { post, writer } = setup()
    const first = (await (await post(PERSONA_INPUT)).json()) as Created
    const res = await post(PERSONA_INPUT)
    expect(res.status).toBe(201)
    expect(res.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await res.json()).toEqual(first)
    expect(writer.calls).toHaveLength(1)
    expect(await tripCount()).toBe(1)
  })

  it('AUTH-4: 同じ冪等キーで body を変えて送る → 409 IDEMPOTENCY_MISMATCH、最初の旅を返さない', async () => {
    const { post } = setup()
    await post(PERSONA_INPUT)
    const res = await post({ ...PERSONA_INPUT, lang: 'en' })
    expect(res.status).toBe(409)
    const text = await res.text()
    expect(text).toContain('IDEMPOTENCY_MISMATCH')
    expect(text).not.toContain('plan')
  })

  it('CONC-1: 同じキーの要求が処理中に 2 つ目が来る → 409 IN_PROGRESS', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    const inner = new ScriptedWriter()
    const writer = Object.assign(new ScriptedWriter(), {
      write: async (req: Parameters<ScriptedWriter['write']>[0]) => {
        await gate
        return inner.write(req)
      },
    })
    const { post } = setup({ writer })
    const first = post(PERSONA_INPUT)
    // 1 つ目が pending を作るまで待つ
    for (let i = 0; i < 50; i++) {
      const rs = await conn.client.execute('SELECT COUNT(*) AS n FROM trip_requests')
      if (Number(rs.rows[0]?.['n']) === 1) break
      await new Promise((r) => setTimeout(r, 5))
    }
    const second = await post(PERSONA_INPUT)
    expect(second.status).toBe(409)
    expect(await errorCode(second)).toBe('IN_PROGRESS')
    release()
    expect((await first).status).toBe(201)
    expect(inner.calls).toHaveLength(1)
  })

  it('FAIL-1: Claude が時間切れ → 502 WRITER_FAILED、保存しない。IDEM-2: 同じキーの再送で 201', async () => {
    const writer = new ScriptedWriter([new TripWriterError('timeout')])
    const { post, lines } = setup({ writer })
    const res = await post(PERSONA_INPUT)
    expect(res.status).toBe(502)
    expect(await errorCode(res)).toBe('WRITER_FAILED')
    expect(await tripCount()).toBe(0)
    expect(lines.find((l) => l['event'] === 'http.error')).toMatchObject({ level: 'warn' })
    const rs = await conn.client.execute('SELECT status FROM trip_requests')
    expect(rs.rows[0]?.['status']).toBe('failed')
    expect((await post(PERSONA_INPUT)).status).toBe(201)
  })

  it('AUTH-2: 失敗した呼び出しも数え、1 日の上限に達したあと → 429 DAILY_LIMIT「本日の生成上限に達しました」、Claude を呼ばない', async () => {
    // 上限 2 回。1 回目は時間切れ（502）、2 回目は成功（201）、3 回目は呼ばずに 429
    const { post, writer } = setup({
      writer: new ScriptedWriter([new TripWriterError('timeout')]),
      dailyCalls: 2,
    })
    expect((await post(PERSONA_INPUT)).status).toBe(502)
    expect((await post(PERSONA_INPUT)).status).toBe(201)
    const res = await post(PERSONA_INPUT, { 'Idempotency-Key': KEY_B })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({
      error: { code: 'DAILY_LIMIT', message: '本日の生成上限に達しました' },
    })
    expect(writer.calls).toHaveLength(2)
    const rs = await conn.client.execute('SELECT calls FROM trip_writer_calls')
    expect(Number(rs.rows[0]?.['calls'])).toBe(3)
  })

  it('Claude の同時呼び出しの枠が埋まっていたら 503 WRITER_BUSY、Claude を呼ばない', async () => {
    const slots = new InProcessConcurrencyLimiter(1)
    const held = slots.tryAcquire()
    const { post, writer } = setup({ slots })
    const res = await post(PERSONA_INPUT)
    expect(res.status).toBe(503)
    expect(await errorCode(res)).toBe('WRITER_BUSY')
    expect(writer.calls).toHaveLength(0)
    held?.()
    expect((await post(PERSONA_INPUT)).status).toBe(201)
  })

  it('AUTH-3: 同じ IP から 1 分に 11 件目 → 429 RATE_LIMITED（別の IP は通る）', async () => {
    const { post } = setup()
    for (let i = 0; i < 10; i++) {
      expect((await post({ bad: true }, { 'x-test-ip': '198.51.100.7' })).status).toBe(400)
    }
    const blocked = await post(PERSONA_INPUT, { 'x-test-ip': '198.51.100.7' })
    expect(blocked.status).toBe(429)
    expect(await errorCode(blocked)).toBe('RATE_LIMITED')
    expect((await post(PERSONA_INPUT, { 'x-test-ip': '198.51.100.8' })).status).toBe(201)
  })

  it('body が大きすぎる → 413', async () => {
    const { post } = setup()
    const res = await post({ ...PERSONA_INPUT, padding: 'x'.repeat(20_000) })
    expect(res.status).toBe(413)
  })

  it('CORS の preflight で Idempotency-Key を許す', async () => {
    const { app } = setup()
    const res = await app.request('/api/trips', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,idempotency-key',
      },
    })
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain(
      'idempotency-key',
    )
  })
})
