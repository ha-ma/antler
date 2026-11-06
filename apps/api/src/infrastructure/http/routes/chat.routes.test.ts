import {
  openChatTestDb,
  ScriptedChatWriter,
  type ChatTestDb,
} from '../../../../tests/factories/chats.js'
import {
  NOW,
  OTHER_TOKEN,
  OWNER_TOKEN,
  ROAD_DATA,
  SLOW_TEST_MS,
  TRIP_ID,
} from '../../../../tests/factories/stop-events.js'
import { FixedClock, MemoryLog } from '../../../../tests/factories/trips.js'
import { PrepareChatUseCase } from '../../../application/usecases/chats/prepare-chat.usecase.js'
import { createLogger } from '../../logging/logger.js'
import { NodeSha256Hasher } from '../../security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../system/in-process-concurrency-limiter.js'
import { createApp } from '../app.js'
import { chatResponseSchema } from '../schemas/chat.schema.js'
import { CHATS_PER_MINUTE_PER_IP } from './chat.routes.js'

// drive-audio-chat の e2e（Hono の app.request ＋ メモリの SQLite ＋ 同梱データ。Claude はフェイク）。
// docs/specs/drive-audio-chat/functional.md AC-41・「エラーパターン」、threat.md AUTH-41〜AUTH-45

let db: ChatTestDb
beforeEach(async () => {
  db = await openChatTestDb()
})
afterEach(() => {
  db.connection.client.close()
})

function app(
  over: { writer?: ScriptedChatWriter; slots?: number; limit?: number; ip?: () => string } = {},
) {
  const writer = over.writer ?? new ScriptedChatWriter()
  const prepareChat = new PrepareChatUseCase({
    trips: db.trips,
    chats: db.chats,
    data: ROAD_DATA,
    writer,
    writerSlots: new InProcessConcurrencyLimiter(over.slots ?? 4),
    hasher: new NodeSha256Hasher(),
    clock: new FixedClock(NOW),
    log: new MemoryLog(),
    dailyWriterCallLimit: over.limit ?? 400,
  })
  const a = createApp({
    logger: createLogger('error', { sink: () => undefined }),
    corsOrigins: ['http://localhost:5173'],
    readinessChecks: [],
    exposeErrorDetails: false,
    chats: { prepareChat, rateLimitKey: over.ip ?? (() => '203.0.113.7'), now: () => NOW },
  })
  return { a, writer }
}

const url = (day: number | string = 1, id = TRIP_ID) => `/api/trips/${id}/day/${String(day)}/chat`
function post(
  a: ReturnType<typeof app>['a'],
  day: number | string = 1,
  token: string | null = OWNER_TOKEN,
  init: RequestInit = {},
  id = TRIP_ID,
) {
  return a.request(url(day, id), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...init,
  })
}
async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code
}

describe('POST /api/trips/:id/day/:n/chat', { timeout: SLOW_TEST_MS }, () => {
  it('AC-41: ペルソナの D1 → 201。各移動に depart、話の行は鹿ゾーンの外、話し手は p1〜p3、text は 4 言語。2 回目は 200 で Claude を呼ばない', async () => {
    const { a, writer } = app()
    const first = await post(a, 1)
    expect(first.status).toBe(201)
    const body = chatResponseSchema.parse(await first.json())
    const { lines } = body.chat
    expect(body.chat).toMatchObject({ tripId: TRIP_ID, day: 1 })
    expect(lines.filter((l) => l.topic === 'depart').map((l) => l.cue.leg)).toEqual([0])
    expect(lines.length).toBeGreaterThan(1)
    // D1 の鹿ゾーン（同梱データで 269〜272 km 付近）に行を置かない
    for (const l of lines) {
      expect(l.cue.km < 268 || l.cue.km > 273).toBe(true)
      expect(['p1', 'p2', 'p3']).toContain(l.speaker)
    }
    const second = await post(a, 1)
    expect(second.status).toBe(200)
    expect(second.headers.get('Idempotent-Replayed')).toBe('true')
    expect(chatResponseSchema.parse(await second.json())).toEqual(body)
    expect(writer.calls).toHaveLength(1)
  })

  it('SAVE-2c: 応答は { chat } だけ（鍵のハッシュ・作成時刻を返さない）。移動の無い日は空の束', async () => {
    const { a, writer } = app()
    const res = await post(a, 3)
    expect(res.status).toBe(201)
    const text = await res.text()
    expect(chatResponseSchema.parse(JSON.parse(text)).chat.lines).toEqual([])
    expect(text).not.toMatch(/key|createdAt|owner/i)
    expect(writer.calls).toHaveLength(0)
  })

  it('AUTH-41: トークンが無い・形が違う → 403 OWNER_REQUIRED、Claude を呼ばない', async () => {
    const { a, writer } = app()
    const none = await post(a, 1, null)
    expect(none.status).toBe(403)
    expect(await code(none)).toBe('OWNER_REQUIRED')
    const bad = await post(a, 1, 'not-a-token')
    expect(bad.status).toBe(403)
    expect(writer.calls).toHaveLength(0)
  })

  it('AUTH-42: 別の旅のトークン → 403 OWNER_REQUIRED', async () => {
    const { a, writer } = app()
    const res = await post(a, 1, OTHER_TOKEN)
    expect(res.status).toBe(403)
    expect(await code(res)).toBe('OWNER_REQUIRED')
    expect(writer.calls).toHaveLength(0)
  })

  it('AUTH-43: 1 分に 11 件目 → 429 RATE_LIMITED（トークンの確かめより前）', async () => {
    const { a } = app()
    for (let i = 0; i < CHATS_PER_MINUTE_PER_IP; i++) {
      expect((await post(a, 1, null)).status).toBe(403)
    }
    const res = await post(a, 1, OWNER_TOKEN)
    expect(res.status).toBe(429)
    expect(await code(res)).toBe('RATE_LIMITED')
  })

  it('AUTH-44: 1 日の上限に達したあと → 429 DAILY_LIMIT、Claude を呼ばない', async () => {
    const { a, writer } = app({ limit: 0 })
    const res = await post(a, 1)
    expect(res.status).toBe(429)
    expect(await code(res)).toBe('DAILY_LIMIT')
    expect(writer.calls).toHaveLength(0)
  })

  it('AUTH-45: 1 つの旅の会話の束が 30 に達したあと、新しい鍵 → 409 CHAT_LIMIT', async () => {
    const { a, writer } = app()
    const deck = chatResponseSchema.parse(await (await post(a, 1)).json()).chat
    for (let i = 0; i < 29; i++) {
      await db.chats.insertChat({
        keyHash: `other-${String(i)}`,
        tripId: TRIP_ID,
        day: 1,
        deck,
        createdAtMs: NOW,
      })
    }
    const res = await post(a, 2)
    expect(res.status).toBe(409)
    expect(await code(res)).toBe('CHAT_LIMIT')
    expect(writer.calls).toHaveLength(1)
  })

  it('FAIL-42: 同時の枠が埋まっている → 503 WRITER_BUSY', async () => {
    const { a, writer } = app({ slots: 0 })
    const res = await post(a, 1)
    expect(res.status).toBe(503)
    expect(await code(res)).toBe('WRITER_BUSY')
    expect(writer.calls).toHaveLength(0)
  })

  it('WRITE-2f・FAIL-45: 2 回とも外れ → 502 WRITER_FAILED。直後にもう一度 → Claude を呼ばず 502', async () => {
    const invalid = { kind: 'draft' as const, writing: { lines: [] } }
    const { a, writer } = app({ writer: new ScriptedChatWriter([invalid, invalid]) })
    const res = await post(a, 1)
    expect(res.status).toBe(502)
    expect(await code(res)).toBe('WRITER_FAILED')
    const again = await post(a, 1)
    expect(again.status).toBe(502)
    expect(writer.calls).toHaveLength(2)
  })

  it('エラーパターン: 旅が無い・id の形 → 404 TRIP_NOT_FOUND、日が無い → 404 DAY_NOT_FOUND、n の形 → 400、大きな body → 413', async () => {
    const { a } = app()
    const missing = await post(a, 1, OWNER_TOKEN, {}, 'Nope1234')
    expect([missing.status, await code(missing)]).toEqual([404, 'TRIP_NOT_FOUND'])
    const badId = await post(a, 1, OWNER_TOKEN, {}, 'x_y')
    expect([badId.status, await code(badId)]).toEqual([404, 'TRIP_NOT_FOUND'])
    const day = await post(a, 6)
    expect([day.status, await code(day)]).toEqual([404, 'DAY_NOT_FOUND'])
    for (const n of ['0', 'abc', '1000', '01']) {
      const res = await post(a, n)
      expect([res.status, await code(res)]).toEqual([400, 'INVALID_INPUT'])
    }
    const big = await post(a, 1, OWNER_TOKEN, {
      body: 'x'.repeat(2048),
      headers: { Authorization: `Bearer ${OWNER_TOKEN}`, 'Content-Type': 'text/plain' },
    })
    expect(big.status).toBe(413)
  })
})
