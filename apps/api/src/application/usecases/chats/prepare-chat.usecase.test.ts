import {
  openChatTestDb,
  ScriptedChatWriter,
  validChatWriting,
  type ChatTestDb,
} from '../../../../tests/factories/chats.js'
import {
  NOW,
  OTHER_TOKEN,
  OWNER_TOKEN,
  personaTrip,
  ROAD_DATA,
  SLOW_TEST_MS,
  TRIP_ID,
} from '../../../../tests/factories/stop-events.js'
import { FixedClock, MemoryLog } from '../../../../tests/factories/trips.js'
import { ChatLimitError, ChatWriterError } from '../../../domain/chats/errors/chat-errors.js'
import type { StoredChat } from '../../../domain/chats/models/chat-deck.js'
import { CHAT_FAILURE_MEMORY_MS } from '../../../domain/chats/rules/chat-rules.js'
import { OwnerRequiredError } from '../../../domain/stop-events/errors/stop-event-errors.js'
import {
  DailyLimitError,
  ItineraryChangedError,
  TripDayNotFoundError,
  TripInputError,
  TripNotFoundError,
  TripWriterBusyError,
} from '../../../domain/trips/errors/trip-errors.js'
import { NodeSha256Hasher } from '../../../infrastructure/security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../../infrastructure/system/in-process-concurrency-limiter.js'
import type { RoadCatalogGateway } from '../../ports/gateways/road-catalog.gateway.js'
import type { ChatRepository } from '../../ports/repositories/chat.repository.js'
import { PrepareChatUseCase } from './prepare-chat.usecase.js'

// POST /api/trips/:id/day/:n/chat の UseCase（docs/specs/drive-audio-chat/functional.md R10・R11・R15〜R17、resilience.md）。
// DB はメモリの SQLite（本物の repository）、Claude はフェイク、データは同梱の routes.json と zones.geojson。
// ペルソナ（台湾から 4 人・zh）の D1 は新千歳 → 鶴居の 1 本（約 304 km、終わり近くに鹿ゾーン）、D3 は移動の無い日。

const INVALID = { kind: 'draft' as const, writing: { lines: [] } }

let db: ChatTestDb
afterEach(() => {
  db.connection.client.close()
})

async function setup(
  over: {
    writer?: ScriptedChatWriter
    slots?: number
    limit?: number
    data?: RoadCatalogGateway
    chats?: ChatRepository
  } = {},
) {
  db = await openChatTestDb()
  const writer = over.writer ?? new ScriptedChatWriter()
  const clock = new FixedClock(NOW)
  const log = new MemoryLog()
  const usecase = new PrepareChatUseCase({
    trips: db.trips,
    chats: over.chats ?? db.chats,
    data: over.data ?? ROAD_DATA,
    writer,
    writerSlots: new InProcessConcurrencyLimiter(over.slots ?? 4),
    hasher: new NodeSha256Hasher(),
    clock,
    log,
    dailyWriterCallLimit: over.limit ?? 400,
  })
  const run = (day: number, ownerToken: string | undefined = OWNER_TOKEN) =>
    usecase.execute({ tripId: TRIP_ID, day, ownerToken })
  const writerCalls = async () => {
    const rows = await db.connection.client.execute('SELECT calls FROM trip_writer_calls')
    return rows.rows.reduce((sum, r) => sum + Number(r['calls']), 0)
  }
  const savedRows = async () => {
    const rows = await db.connection.client.execute('SELECT COUNT(*) AS n FROM trip_chats')
    return Number(rows.rows[0]?.['n'] ?? 0)
  }
  return { writer, clock, log, usecase, run, writerCalls, savedRows }
}

describe('PrepareChatUseCase', { timeout: SLOW_TEST_MS }, () => {
  it('UC-1（ペルソナ D1）: 各移動に depart、話の行は鹿ゾーンの外、話し手は p1〜p3、4 言語の一言を保存して返す', async () => {
    const { run, writer, savedRows } = await setup()
    const out = await run(1)
    expect(out.replayed).toBe(false)
    const { lines } = out.chat
    expect(lines[0]).toMatchObject({ id: 'l01', topic: 'depart', cue: { leg: 0, km: 0.2 } })
    // 約 304 km の 1 本 → depart ＋ 話の行 3（ゾーンは終わり近くなので動かない）
    expect(lines.map((l) => l.topic === 'depart')).toEqual([true, false, false, false])
    const dayPlan = (await import('@antler/trip')).buildDayPlan({
      plan: personaTrip().plan,
      day: 1,
      ...ROAD_DATA.load(),
    })
    for (const l of lines) {
      const inZone = dayPlan.zones.some(
        (z) => z.leg === l.cue.leg && z.entryKm <= l.cue.km && l.cue.km <= z.exitKm,
      )
      expect(inZone).toBe(false)
      expect(['p1', 'p2', 'p3']).toContain(l.speaker)
      expect(Object.keys(l.text).sort()).toEqual(['en', 'ja', 'ko', 'zh'])
    }
    expect(out.chat.data).toEqual({ routes: dayPlan.data.routes, zones: dayPlan.data.zones })
    expect(writer.calls).toHaveLength(1)
    expect(await savedRows()).toBe(1)
  })

  it('WRITE-2d: Claude に渡す材料は、話題・席・人数・経験・月・天気・路面・光・マスターの名前だけ', async () => {
    const { run, writer } = await setup()
    await run(1)
    const brief = writer.calls[0]?.brief
    if (!brief) throw new Error('材料が無い')
    expect(Object.keys(brief).sort()).toEqual(
      ['conditions', 'experience', 'lang', 'lines', 'month', 'partySize'].sort(),
    )
    expect(brief).toMatchObject({ lang: 'zh', partySize: 4, experience: 'first', month: 2 })
    expect(Object.keys(brief.conditions).sort()).toEqual(['surface', 'weather'])
    for (const line of brief.lines) {
      expect(Object.keys(line).sort()).toEqual(
        ['from', 'id', 'light', 'pleasure', 'speaker', 'to', 'topic'].sort(),
      )
    }
    expect(brief.lines[0]?.from).toEqual({
      ja: '新千歳空港',
      en: 'New Chitose Airport',
      zh: '新千歲機場',
      ko: '신치토세 공항',
    })
    // 時刻・距離・道のり・予算・所有者の印・楽しみの説明（note）を含まない
    const json = JSON.stringify(brief)
    expect(json).not.toMatch(/\d{2}:\d{2}|2027|303|km|budget|JPY|owner|note|9:00/i)
  })

  it('SAVE-2a・IDEM-41・FAIL-43: 同じ旅・同じ日の 2 回目は 200 で同じ束。Claude を呼ばず、1 日の上限も数えない', async () => {
    const { run, writer, writerCalls } = await setup()
    const first = await run(1)
    expect(await writerCalls()).toBe(1)
    const second = await run(1)
    expect(second.replayed).toBe(true)
    expect(second.chat).toEqual(first.chat)
    expect(writer.calls).toHaveLength(1)
    expect(await writerCalls()).toBe(1)
  })

  it('SAVE-2a: data の版が変われば作り直す', async () => {
    const loaded = ROAD_DATA.load()
    let zonesHash = loaded.zones.hash
    const data: RoadCatalogGateway = {
      load: () => ({ ...loaded, zones: { ...loaded.zones, hash: zonesHash } }),
    }
    const { run, writer, savedRows } = await setup({ data })
    await run(1)
    zonesHash = 'other-zones-hash'
    const again = await run(1)
    expect(again.replayed).toBe(false)
    expect(again.chat.data.zones).toBe('other-zones-hash')
    expect(writer.calls).toHaveLength(2)
    expect(await savedRows()).toBe(2)
  })

  it('IDEM-41: 同じ鍵の同時の 2 要求 → Claude は 1 回、同じ束', async () => {
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const { run, writer } = await setup({ writer: new ScriptedChatWriter([], gate) })
    const a = run(1)
    const b = run(1)
    await vi.waitFor(() => {
      expect(writer.calls).toHaveLength(1)
    })
    open()
    const [ra, rb] = await Promise.all([a, b])
    expect(rb.chat).toEqual(ra.chat)
    expect(writer.calls).toHaveLength(1)
  })

  it('SAVE-2b: 移動の無い日は空の束を保存して返し、Claude を呼ばない', async () => {
    const { run, writer, savedRows, writerCalls } = await setup()
    const out = await run(3)
    expect(out.chat.lines).toEqual([])
    expect(out.replayed).toBe(false)
    expect(writer.calls).toHaveLength(0)
    expect(await writerCalls()).toBe(0)
    expect(await savedRows()).toBe(1)
    expect((await run(3)).replayed).toBe(true)
  })

  it('SAVE-2c: 応答は欄を明示して組み立てる（鍵のハッシュ・作成時刻・材料の欄を返さない）', async () => {
    const { run } = await setup()
    for (const out of [await run(1), await run(1)]) {
      expect(Object.keys(out).sort()).toEqual(['chat', 'replayed'])
      expect(Object.keys(out.chat).sort()).toEqual(['data', 'day', 'lines', 'tripId'])
      expect(Object.keys(out.chat.data).sort()).toEqual(['routes', 'zones'])
      expect(out.chat).toMatchObject({ tripId: TRIP_ID, day: 1 })
      for (const l of out.chat.lines) {
        expect(Object.keys(l).sort()).toEqual(['cue', 'id', 'pleasure', 'speaker', 'text', 'topic'])
        expect(Object.keys(l.cue).sort()).toEqual(['kind', 'km', 'leg'])
      }
      expect(JSON.stringify(out)).not.toMatch(/keyHash|createdAt|"light":|"timing":|"angle":/)
    }
  })

  it('AC-1・UC-1e・AUTH-61（drive-tourism）: ペルソナの D1 → 話の行の 3 分の 2 以上が楽しみの話で、id はしおりの楽しみ（D1 は立ち寄りが無いので後の日の楽しみ）。ほかの行は null。材料に名前・拠点・切り口', async () => {
    const { run, writer } = await setup()
    const out = await run(1)
    const plan = personaTrip().plan
    const dayPlan = (await import('@antler/trip')).buildDayPlan({
      plan,
      day: 1,
      ...ROAD_DATA.load(),
    })
    const today = [
      ...dayPlan.stops.map((s) => s.id),
      ...plan.days.filter((d) => d.day > 1).flatMap((d) => d.stops),
    ].slice(0, dayPlan.stops.length + 3)
    expect(today.length).toBeGreaterThan(0)
    const talks = out.chat.lines.filter((l) => l.topic !== 'depart')
    const pleasures = talks.filter((l) => l.topic === 'pleasure')
    expect(pleasures.length * 3).toBeGreaterThanOrEqual(talks.length * 2)
    for (const l of out.chat.lines) {
      if (l.topic === 'pleasure') expect(today).toContain(l.pleasure)
      else expect(l.pleasure).toBeNull()
    }
    const brief = writer.calls[0]?.brief
    const material = brief?.lines.find((l) => l.topic === 'pleasure')?.pleasure
    expect(material).toMatchObject({ timing: 'ahead', angle: 'anticipation' })
    expect(material?.name.zh).toBeTruthy()
    expect(material?.place?.ja).toBeTruthy()
    // 2 回目（保存済み）も同じ pleasure を返す
    const again = await run(1)
    expect(again.chat.lines.map((l) => l.pleasure)).toEqual(out.chat.lines.map((l) => l.pleasure))
  })

  it('WRITE-2f: 1 回目が外れ → 理由のコードだけを渡して作り直し → 通れば保存して 201', async () => {
    const digits = (request: Parameters<ScriptedChatWriter['write']>[0]) => {
      const writing = validChatWriting(request.brief)
      const line = writing.lines[0]
      if (line) line.text = { ...line.text, ja: '3回目の休憩' }
      return { kind: 'draft' as const, writing }
    }
    const { run, writer, writerCalls } = await setup({ writer: new ScriptedChatWriter([digits]) })
    const out = await run(1)
    expect(out.replayed).toBe(false)
    expect(writer.calls).toHaveLength(2)
    expect(writer.calls[1]?.previousProblems).toEqual(['digit@lines.0.ja'])
    expect(JSON.stringify(writer.calls[1]?.previousProblems)).not.toContain('休憩')
    expect(await writerCalls()).toBe(2)
  })

  it('WRITE-2f: 2 回目も外れ → ChatWriterError（502）、保存しない。rejected も外れとして数える', async () => {
    const { run, writer, savedRows } = await setup({
      writer: new ScriptedChatWriter([{ kind: 'rejected', reason: 'truncated' }, INVALID]),
    })
    const error = await run(1).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChatWriterError)
    expect((error as ChatWriterError).reason).toBe('invalid')
    expect(writer.calls[1]?.previousProblems).toEqual(['truncated'])
    expect(await savedRows()).toBe(0)
  })

  it('FAIL-45: 2 回とも外れた鍵に 10 分以内 → Claude を呼ばず 502。10 分たてば呼び直す', async () => {
    const { run, writer, clock, log } = await setup({
      writer: new ScriptedChatWriter([INVALID, INVALID]),
    })
    await expect(run(1)).rejects.toBeInstanceOf(ChatWriterError)
    expect(writer.calls).toHaveLength(2)
    clock.t = NOW + CHAT_FAILURE_MEMORY_MS - 1
    await expect(run(1)).rejects.toBeInstanceOf(ChatWriterError)
    expect(writer.calls).toHaveLength(2)
    expect(log.has('chat.writer.remembered_failure')).toBe(true)
    // 別の日（別の鍵）は塞がない
    expect((await run(2)).replayed).toBe(false)
    clock.t = NOW + CHAT_FAILURE_MEMORY_MS
    expect((await run(1)).replayed).toBe(false)
    expect(writer.calls).toHaveLength(4)
  })

  it('FAIL-41: Claude が時間切れ → 502、保存しない。もう一度送ると Claude を呼び直して 201', async () => {
    const { run, writer, savedRows } = await setup({
      writer: new ScriptedChatWriter([new ChatWriterError('timeout')]),
    })
    await expect(run(1)).rejects.toBeInstanceOf(ChatWriterError)
    expect(await savedRows()).toBe(0)
    const again = await run(1)
    expect(again.replayed).toBe(false)
    expect(writer.calls).toHaveLength(2)
  })

  it('FAIL-42: 同時の枠が埋まっている → TripWriterBusyError（503）、Claude を呼ばず、鍵も覚えない', async () => {
    const { run, writer } = await setup({ slots: 0 })
    await expect(run(1)).rejects.toBeInstanceOf(TripWriterBusyError)
    await expect(run(1)).rejects.toBeInstanceOf(TripWriterBusyError)
    expect(writer.calls).toHaveLength(0)
  })

  it('CONC-41: 保存の INSERT が衝突した（負け側）→ 先に保存した束を返す（200）', async () => {
    const winnerText = { ja: '先の束', en: 'First deck', zh: '先前的', ko: '먼저' }
    let raced = false
    const chats: ChatRepository = {
      findChat: (k) => db.chats.findChat(k),
      countChats: (t) => db.chats.countChats(t),
      insertChat: async (chat: StoredChat) => {
        if (!raced) {
          raced = true
          const lines = chat.deck.lines.map((l) => ({ ...l, text: winnerText }))
          await db.chats.insertChat({ ...chat, deck: { ...chat.deck, lines } })
        }
        return db.chats.insertChat(chat)
      },
    }
    const { run, log } = await setup({ chats })
    const out = await run(1)
    expect(out.replayed).toBe(true)
    expect(out.chat.lines[0]?.text).toEqual(winnerText)
    expect(log.events.some((e) => e.event === 'chat.replayed' && e.fields['race'] === true)).toBe(
      true,
    )
  })

  it('AUTH-41: トークンが無い・形が違う → OwnerRequiredError（403）、Claude を呼ばず保存もしない', async () => {
    const { run, usecase, writer, savedRows } = await setup()
    await expect(
      usecase.execute({ tripId: TRIP_ID, day: 1, ownerToken: undefined }),
    ).rejects.toBeInstanceOf(OwnerRequiredError)
    await expect(run(1, 'not-a-token')).rejects.toBeInstanceOf(OwnerRequiredError)
    expect(writer.calls).toHaveLength(0)
    expect(await savedRows()).toBe(0)
  })

  it('AUTH-42: 別の旅のトークン → OwnerRequiredError（403）', async () => {
    const { run, writer } = await setup()
    await expect(run(1, OTHER_TOKEN)).rejects.toBeInstanceOf(OwnerRequiredError)
    expect(writer.calls).toHaveLength(0)
  })

  it('AUTH-44: 1 日の上限に達している → DailyLimitError（429）、Claude を呼ばない', async () => {
    const { run, writer, savedRows } = await setup({ limit: 0 })
    await expect(run(1)).rejects.toBeInstanceOf(DailyLimitError)
    expect(writer.calls).toHaveLength(0)
    expect(await savedRows()).toBe(0)
  })

  it('AUTH-62（drive-tourism）: v1 の束を保存した旅・日でも、トークンが無ければ OwnerRequiredError（403）。Claude を呼ばない', async () => {
    const { run, usecase, writer, savedRows } = await setup()
    const saved = await run(1)
    // v1 の鍵（版の違う鍵のハッシュ）で保存された束がある状態
    await db.chats.insertChat({
      keyHash: 'v1-key',
      tripId: TRIP_ID,
      day: 1,
      deck: saved.chat,
      createdAtMs: NOW,
    })
    const before = await savedRows()
    await expect(
      usecase.execute({ tripId: TRIP_ID, day: 1, ownerToken: undefined }),
    ).rejects.toBeInstanceOf(OwnerRequiredError)
    expect(writer.calls).toHaveLength(1)
    expect(await savedRows()).toBe(before)
  })

  it('AUTH-63（drive-tourism）: v1 の束も数えて 30 に達していたら、v2 の鍵の作成は ChatLimitError（409）。Claude を呼ばない', async () => {
    const { run, writer } = await setup()
    const saved = await run(1)
    const deck = saved.chat
    for (let i = 0; i < 30; i++) {
      await db.chats.insertChat({
        keyHash: `v1-${String(i)}`,
        tripId: TRIP_ID,
        day: 2,
        deck,
        createdAtMs: NOW,
      })
    }
    await expect(run(2)).rejects.toBeInstanceOf(ChatLimitError)
    expect(writer.calls).toHaveLength(1)
  })

  it('AUTH-45: 1 つの旅の会話の束が 30 に達したあと、新しい鍵 → ChatLimitError（409）。保存済みの鍵は返す', async () => {
    const { run, writer } = await setup()
    const saved = await run(1)
    for (let i = 0; i < 29; i++) {
      await db.chats.insertChat({
        keyHash: `other-${String(i)}`,
        tripId: TRIP_ID,
        day: 1,
        deck: saved.chat,
        createdAtMs: NOW,
      })
    }
    await expect(run(2)).rejects.toBeInstanceOf(ChatLimitError)
    expect(writer.calls).toHaveLength(1)
    expect((await run(1)).replayed).toBe(true)
  })

  it('旅が無い・id の形が違う → TripNotFoundError。日が無い → TripDayNotFoundError。n が 0 → TripInputError', async () => {
    const { usecase, run } = await setup()
    await expect(
      usecase.execute({ tripId: 'Nope1234', day: 1, ownerToken: OWNER_TOKEN }),
    ).rejects.toBeInstanceOf(TripNotFoundError)
    await expect(
      usecase.execute({ tripId: '../x', day: 1, ownerToken: OWNER_TOKEN }),
    ).rejects.toBeInstanceOf(TripNotFoundError)
    await expect(run(6)).rejects.toBeInstanceOf(TripDayNotFoundError)
    await expect(run(0)).rejects.toBeInstanceOf(TripInputError)
  })

  it('しおりをいまのマスターで作り直せない → ItineraryChangedError（409）、Claude を呼ばない', async () => {
    const { usecase, writer } = await setup()
    const { plan, details } = personaTrip()
    const changed = { ...plan, id: 'Chg0d4ys', days: plan.days.map((d) => ({ ...d, stops: [] })) }
    await db.trips.insertTrip({
      plan: changed,
      details: { ...details, tripId: changed.id },
      ownerTokenHash: new NodeSha256Hasher().sha256Hex(OWNER_TOKEN),
      createdAtMs: NOW,
    })
    await expect(
      usecase.execute({ tripId: changed.id, day: 2, ownerToken: OWNER_TOKEN }),
    ).rejects.toBeInstanceOf(ItineraryChangedError)
    expect(writer.calls).toHaveLength(0)
  })
})
