import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OWNER_HASH,
  PERSONA_COLLISION,
  PERSONA_TRIP_ID,
  personaTrip,
  ScriptedLossWriter,
  validStory,
} from '../../../../tests/factories/losses.js'
import { WriteLossUseCase } from '../../../application/usecases/losses/write-loss.usecase.js'
import { LossWriterError } from '../../../domain/losses/errors/loss-errors.js'
import { openDatabase, type Connection } from '../../db/connection.js'
import { ensureSchema } from '../../db/migrate.js'
import { createLogger } from '../../logging/logger.js'
import { DrizzleLossRepository } from '../../repositories/drizzle-loss.repository.js'
import { DrizzleTripRepository } from '../../repositories/drizzle-trip.repository.js'
import { NodeSha256Hasher } from '../../security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../system/in-process-concurrency-limiter.js'
import { SystemClock } from '../../system/system-clock.js'
import { createApp } from '../app.js'
import { LOSSES_PER_MINUTE_PER_IP } from './loss.routes.js'

// POST /api/trips/:id/losses の e2e（Hono の app.request ＋ 一時ファイルの SQLite。Claude はフェイク）。
// docs/specs/loss/functional.md AC-1・UC-6、threat.md AUTH-1〜AUTH-8、resilience.md FAIL-1

const T0 = Date.parse('2026-11-04T12:00:00+09:00')
let dir: string
let conn: Connection

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'antler-api-losses-'))
  conn = openDatabase(`file:${join(dir, 'trips.db')}`)
  await ensureSchema(conn.client)
})

afterEach(() => {
  conn.client.close()
  rmSync(dir, { recursive: true, force: true })
})

async function setup(writer = new ScriptedLossWriter()) {
  const trips = new DrizzleTripRepository(conn.db)
  await trips.insertTrip(personaTrip())
  const logger = createLogger('error', { sink: () => undefined })
  const app = createApp({
    logger,
    corsOrigins: ['http://localhost:5173'],
    readinessChecks: [],
    exposeErrorDetails: false,
    losses: {
      writeLoss: new WriteLossUseCase({
        trips,
        losses: new DrizzleLossRepository(conn.db),
        writer,
        writerSlots: new InProcessConcurrencyLimiter(4),
        hasher: new NodeSha256Hasher(),
        clock: new SystemClock(),
        log: logger,
        dailyWriterCallLimit: 400,
      }),
      rateLimitKey: (c) => c.req.header('x-test-ip') ?? 'unknown',
      now: () => T0,
    },
  })
  const post = (
    body: unknown,
    opts: { id?: string; ip?: string; headers?: Record<string, string> } = {},
  ) =>
    app.request(`/api/trips/${opts.id ?? PERSONA_TRIP_ID}/losses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-ip': opts.ip ?? '203.0.113.1',
        ...opts.headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { post, writer }
}

type LossBody = { loss: { tripId: string; story: Record<string, string>; createdAt: string } }

describe('POST /api/trips/:id/losses', () => {
  it('AC-1 / AUTH-1: 未認証で 201、story は 4 言語。同じ body の 2 回目は 200 で同じ story、Claude は 1 回', async () => {
    const { post, writer } = await setup()
    const first = await post(PERSONA_COLLISION)
    expect(first.status).toBe(201)
    const a = (await first.json()) as LossBody
    expect(a.loss.tripId).toBe(PERSONA_TRIP_ID)
    expect(Object.keys(a.loss.story).sort()).toEqual(['en', 'ja', 'ko', 'zh'])
    expect(a.loss.story).toEqual(validStory().story)
    const second = await post(PERSONA_COLLISION)
    expect(second.status).toBe(200)
    expect(((await second.json()) as LossBody).loss).toEqual(a.loss)
    expect(writer.calls).toHaveLength(1)
  })

  it('AUTH-7 / AUTH-8: 応答に ownerTokenHash・鍵・記述子が無い。ownerToken を付けても形は同じ', async () => {
    const { post } = await setup()
    const res = await post(PERSONA_COLLISION, { headers: { authorization: 'Bearer anything' } })
    const text = await res.text()
    expect(text).not.toContain(OWNER_HASH)
    expect(text).not.toMatch(/ownerToken|keyHash|key_hash|achievedStops/)
    expect(Object.keys((JSON.parse(text) as LossBody).loss).sort()).toEqual([
      'createdAt',
      'story',
      'tripId',
    ])
  })

  it('UC-6a / AUTH-2: 無い id と形の違う id は同じ 404 TRIP_NOT_FOUND、Claude を呼ばない', async () => {
    const { post, writer } = await setup()
    for (const id of ['Nope1234', 'abc', '%2E%2E%2Fx']) {
      const res = await post(PERSONA_COLLISION, { id })
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TRIP_NOT_FOUND')
    }
    expect(writer.calls).toHaveLength(0)
  })

  it('AUTH-3: 同じ IP から 1 分に 11 件目 → 429 RATE_LIMITED', async () => {
    const { post } = await setup()
    for (let i = 0; i < LOSSES_PER_MINUTE_PER_IP; i++) await post(PERSONA_COLLISION)
    const res = await post(PERSONA_COLLISION)
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
    expect((await post(PERSONA_COLLISION, { ip: '203.0.113.2' })).status).toBe(200)
  })

  it('AUTH-5 / UC-6c: body に story・tripId・createdAt を混ぜる・読めない JSON → 400、保存しない', async () => {
    const { post, writer } = await setup()
    for (const extra of [
      { story: { ja: '書き換え' } },
      { tripId: 'Other123' },
      { createdAt: '2020-01-01T00:00:00Z' },
    ]) {
      const res = await post({ ...PERSONA_COLLISION, ...extra })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_INPUT')
    }
    expect((await post('{not json')).status).toBe(400)
    expect(writer.calls).toHaveLength(0)
    // 保存していないので、正しい body は新しく作る
    expect((await post(PERSONA_COLLISION)).status).toBe(201)
  })

  it('UC-6b: しおりと合わない記述子（日の範囲外・移動の範囲外・暦日の違い・別の日の楽しみ）→ 400', async () => {
    const { post, writer } = await setup()
    for (const body of [
      { ...PERSONA_COLLISION, day: 6 },
      { ...PERSONA_COLLISION, leg: 3 },
      { ...PERSONA_COLLISION, at: '2027-02-17T16:31:00+09:00' },
      { ...PERSONA_COLLISION, at: '2027-02-15T16:31:00' },
      { ...PERSONA_COLLISION, achievedStops: ['drift-ice-walk'] },
      { ...PERSONA_COLLISION, achievedStops: ['Not A Slug'] },
    ]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(writer.calls).toHaveLength(0)
  })

  it('FAIL-1: Claude の時間切れ → 502 WRITER_FAILED、もう一度送ると 201', async () => {
    const { post } = await setup(new ScriptedLossWriter([new LossWriterError('timeout')]))
    const res = await post(PERSONA_COLLISION)
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('WRITER_FAILED')
    expect((await post(PERSONA_COLLISION)).status).toBe(201)
  })
})
