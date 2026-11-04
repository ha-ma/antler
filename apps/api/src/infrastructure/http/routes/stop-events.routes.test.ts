import {
  NOW,
  OTHER_TOKEN,
  OWNER_TOKEN,
  ROAD_DATA,
  RUN_ID,
  SLOW_TEST_MS,
  ScriptedSceneWriter,
  TRIP_ID,
  openTestDb,
  type TestDb,
} from '../../../../tests/factories/stop-events.js'
import { FixedClock, MemoryLog } from '../../../../tests/factories/trips.js'
import { PrepareStopDeckUseCase } from '../../../application/usecases/stop-events/prepare-stop-deck.usecase.js'
import { RecordTripEventsUseCase } from '../../../application/usecases/stop-events/record-trip-events.usecase.js'
import { createLogger } from '../../logging/logger.js'
import { NodeSha256Hasher } from '../../security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../system/in-process-concurrency-limiter.js'
import { createApp } from '../app.js'
import { STOP_DECKS_PER_MINUTE_PER_IP } from './stop-deck.routes.js'
import { TRIP_EVENTS_PER_MINUTE_PER_IP } from './trip-event.routes.js'

// stop-events の e2e（Hono の app.request ＋ メモリの SQLite ＋ 同梱データ。Claude はフェイク）。
// docs/specs/stop-events/functional.md AC-31・LOG-3d・LOG-3e、threat.md AUTH-31〜AUTH-38・MASS-31

const D2_AT = '2027-02-15T09:00:00+09:00'

let db: TestDb
beforeEach(async () => {
  db = await openTestDb()
})
afterEach(() => {
  db.connection.client.close()
})

function app(writer = new ScriptedSceneWriter()) {
  const clock = new FixedClock(NOW)
  const log = new MemoryLog()
  const hasher = new NodeSha256Hasher()
  const prepareStopDeck = new PrepareStopDeckUseCase({
    trips: db.trips,
    decks: db.decks,
    data: ROAD_DATA,
    writer,
    writerSlots: new InProcessConcurrencyLimiter(4),
    hasher,
    clock,
    log,
    dailyWriterCallLimit: 400,
  })
  const recordTripEvents = new RecordTripEventsUseCase({
    trips: db.trips,
    decks: db.decks,
    events: db.events,
    hasher,
    clock,
    log,
  })
  const rateLimitKey = () => '203.0.113.7'
  const now = () => NOW
  return createApp({
    logger: createLogger('error', { sink: () => undefined }),
    corsOrigins: ['http://localhost:5173'],
    readinessChecks: [],
    exposeErrorDetails: false,
    stopDecks: { prepareStopDeck, rateLimitKey, now },
    tripEvents: { recordTripEvents, rateLimitKey, now },
  })
}

const deckUrl = (day = 2) => `/api/trips/${TRIP_ID}/day/${String(day)}/stop-deck`
const owner = (token: string | null = OWNER_TOKEN): Record<string, string> =>
  token ? { 'X-Owner-Token': token } : {}

function postEvents(a: ReturnType<typeof app>, body: unknown, token: string | null = OWNER_TOKEN) {
  return a.request(`/api/trips/${TRIP_ID}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...owner(token) },
    body: JSON.stringify(body),
  })
}

const choiceBody = (extra: Record<string, unknown> = {}) => ({
  runId: RUN_ID,
  alertEnabled: true,
  events: [
    {
      kind: 'choice',
      seq: 0,
      day: 2,
      at: D2_AT,
      sceneId: 'p-red-crowned-crane',
      choiceId: 'linger',
      ...extra,
    },
  ],
})

describe('stop-events の HTTP', { timeout: SLOW_TEST_MS }, () => {
  it('AC-31: 束の POST → 201、2 回目は 200 で Claude を呼ばない。choice を残すと束の値が写る', async () => {
    const writer = new ScriptedSceneWriter()
    const a = app(writer)
    const first = await a.request(deckUrl(), { method: 'POST', headers: owner() })
    expect(first.status).toBe(201)
    const body = (await first.json()) as {
      deck: { scenes: { id: string; choices: { id: string; zone: unknown; lost: unknown }[] }[] }
      writing: { scenes: { id: string; headline: Record<string, string> }[] }
    }
    const crane = body.deck.scenes.find((s) => s.id === 'p-red-crowned-crane')
    expect(crane?.choices.map((c) => c.id)).toEqual(['leave', 'linger'])
    expect(crane?.choices[0]).toHaveProperty('lost')
    expect(Object.keys(body.writing.scenes[0]?.headline ?? {}).sort()).toEqual([
      'en',
      'ja',
      'ko',
      'zh',
    ])

    const second = await a.request(deckUrl(), { method: 'POST', headers: owner() })
    expect(second.status).toBe(200)
    expect(second.headers.get('Idempotent-Replayed')).toBe('true')
    expect(writer.calls).toHaveLength(1)

    // 束の時刻は分まで（sim は scene.at をそのまま送る）
    const logged = await postEvents(a, choiceBody({ at: '2027-02-15T10:56+09:00' }))
    expect(logged.status).toBe(200)
    expect(await logged.json()).toEqual({ accepted: 1, duplicates: 0 })
    const [row] = await db.events.listByTrip(TRIP_ID)
    expect(row?.data).toMatchObject({ choiceKind: 'linger', delayMin: 60 })

    // D1 には鹿ゾーンのある移動があり、選択肢に光と入口の時刻が付く
    const d1 = await a.request(deckUrl(1), { method: 'POST', headers: owner() })
    const d1Body = (await d1.json()) as {
      deck: { scenes: { choices: { zone: { light: string } | null }[] }[] }
    }
    expect(d1Body.deck.scenes.some((s) => s.choices.some((c) => c.zone?.light))).toBe(true)
  })

  it('AUTH-38: 正しいトークンなら束もイベントも通る。CORS は X-Owner-Token を許す', async () => {
    const a = app()
    expect((await a.request(deckUrl(), { method: 'POST', headers: owner() })).status).toBe(201)
    expect((await postEvents(a, choiceBody())).status).toBe(200)
    const preflight = await a.request(deckUrl(), {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-owner-token',
      },
    })
    expect(preflight.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain(
      'x-owner-token',
    )
  })

  it('AUTH-31・AUTH-32・AUTH-33: トークンが無い・違う → 403 OWNER_REQUIRED（束もイベントも）', async () => {
    const a = app()
    for (const token of [null, OTHER_TOKEN, 'short']) {
      const res = await a.request(deckUrl(), { method: 'POST', headers: owner(token) })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ error: { code: 'OWNER_REQUIRED' } })
    }
    await a.request(deckUrl(), { method: 'POST', headers: owner() })
    for (const token of [null, OTHER_TOKEN]) {
      const res = await postEvents(a, choiceBody(), token)
      expect(res.status).toBe(403)
    }
    expect(await db.events.listByTrip(TRIP_ID)).toEqual([])
  })

  it('旅が無い → 404 TRIP_NOT_FOUND、日が無い → 404 DAY_NOT_FOUND、n の形が違う → 400', async () => {
    const a = app()
    const none = await a.request('/api/trips/Zz9yXx8w/day/1/stop-deck', {
      method: 'POST',
      headers: owner(),
    })
    expect(none.status).toBe(404)
    expect(await none.json()).toMatchObject({ error: { code: 'TRIP_NOT_FOUND' } })
    const day = await a.request(deckUrl(9), { method: 'POST', headers: owner() })
    expect(await day.json()).toMatchObject({ error: { code: 'DAY_NOT_FOUND' } })
    const bad = await a.request(`/api/trips/${TRIP_ID}/day/0/stop-deck`, {
      method: 'POST',
      headers: owner(),
    })
    expect(bad.status).toBe(400)
  })

  it('AUTH-34: 束の POST が 1 分に 11 件目 → 429 RATE_LIMITED（トークンが無くても数える）', async () => {
    const a = app()
    for (let i = 0; i < STOP_DECKS_PER_MINUTE_PER_IP; i++) {
      await a.request(deckUrl(), {
        method: 'POST',
        headers: owner(i % 2 === 0 ? null : OWNER_TOKEN),
      })
    }
    const res = await a.request(deckUrl(), { method: 'POST', headers: owner() })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
  })

  it('AUTH-35: イベントの POST が 1 分に 61 件目 → 429 RATE_LIMITED', async () => {
    const a = app()
    for (let i = 0; i < TRIP_EVENTS_PER_MINUTE_PER_IP; i++) await postEvents(a, {}, null)
    const res = await postEvents(a, choiceBody())
    expect(res.status).toBe(429)
  })

  it('MASS-31: choice に計算値（delayMin・lost・plannedLight）を混ぜる → 400、保存しない', async () => {
    const a = app()
    await a.request(deckUrl(), { method: 'POST', headers: owner() })
    for (const extra of [
      { delayMin: 0 },
      { lost: { jpy: 0 } },
      { plannedLight: 'day' },
      { tripId: 'Other123' },
    ]) {
      const res = await postEvents(a, choiceBody(extra))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } })
    }
    expect(await db.events.listByTrip(TRIP_ID)).toEqual([])
  })

  it('LOG-3d・LOG-3e: 0 件・51 件・緯度経度・知らない kind・runId が UUID でない → 400', async () => {
    const a = app()
    const ev = { kind: 'collision', seq: 0, day: 2, at: D2_AT, pattern: 'frozen', speedKmh: 40 }
    const bodies = [
      { runId: RUN_ID, alertEnabled: true, events: [] },
      {
        runId: RUN_ID,
        alertEnabled: true,
        events: Array.from({ length: 51 }, (_, i) => ({ ...ev, seq: i })),
      },
      { runId: RUN_ID, alertEnabled: true, events: [{ ...ev, lat: 43.1, lon: 144.3 }] },
      { runId: RUN_ID, alertEnabled: true, events: [{ ...ev, kind: 'teleport' }] },
      { runId: 'run-1', alertEnabled: true, events: [ev] },
    ]
    for (const body of bodies) expect((await postEvents(a, body)).status).toBe(400)
  })

  it('同じ (runId, seq) で中身が違う → 409 EVENT_CONFLICT', async () => {
    const a = app()
    const ev = { kind: 'collision', seq: 0, day: 2, at: D2_AT, pattern: 'frozen', speedKmh: 40 }
    expect((await postEvents(a, { runId: RUN_ID, alertEnabled: true, events: [ev] })).status).toBe(
      200,
    )
    const res = await postEvents(a, {
      runId: RUN_ID,
      alertEnabled: true,
      events: [{ ...ev, speedKmh: 41 }],
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'EVENT_CONFLICT' } })
  })
})
