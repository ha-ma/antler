import type { RoadCatalog } from '@antler/trip'
import { FixedClock, MemoryLog } from '../../../../tests/factories/trips.js'
import {
  NOW,
  OTHER_TOKEN,
  OWNER_TOKEN,
  ROAD_DATA,
  SLOW_TEST_MS,
  ScriptedSceneWriter,
  TRIP_ID,
  openTestDb,
  personaTrip,
  type TestDb,
} from '../../../../tests/factories/stop-events.js'
import {
  OwnerRequiredError,
  SceneWriterError,
} from '../../../domain/stop-events/errors/stop-event-errors.js'
import {
  DailyLimitError,
  ItineraryChangedError,
  TripDayNotFoundError,
  TripInProgressError,
  TripNotFoundError,
  TripWriterBusyError,
} from '../../../domain/trips/errors/trip-errors.js'
import { NodeSha256Hasher } from '../../../infrastructure/security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../../infrastructure/system/in-process-concurrency-limiter.js'
import { PrepareStopDeckUseCase } from './prepare-stop-deck.usecase.js'

// POST /api/trips/:id/day/:n/stop-deck の UseCase（docs/specs/stop-events/functional.md R2〜R9、resilience.md）。
// DB はメモリの SQLite（本物の repository）、Claude はフェイク、データは同梱の routes.json と zones.geojson。

const realData = ROAD_DATA

async function setup(
  over: {
    writer?: ScriptedSceneWriter
    slots?: number
    limit?: number
    data?: { load: () => { roads: RoadCatalog; zones: ReturnType<typeof realData.load>['zones'] } }
  } = {},
) {
  const db: TestDb = await openTestDb()
  const writer = over.writer ?? new ScriptedSceneWriter()
  const clock = new FixedClock(NOW)
  const log = new MemoryLog()
  const usecase = new PrepareStopDeckUseCase({
    trips: db.trips,
    decks: db.decks,
    data: over.data ?? realData,
    writer,
    writerSlots: new InProcessConcurrencyLimiter(over.slots ?? 4),
    hasher: new NodeSha256Hasher(),
    clock,
    log,
    dailyWriterCallLimit: over.limit ?? 400,
  })
  const run = (day: number, ownerToken: string | undefined = OWNER_TOKEN) =>
    usecase.execute({ tripId: TRIP_ID, day, ownerToken })
  return { db, writer, clock, log, usecase, run }
}

describe('PrepareStopDeckUseCase', { timeout: SLOW_TEST_MS }, () => {
  it('D2（タンチョウ）: 楽しみの場面と選択肢、Claude の文を保存して返す', async () => {
    const { run, writer, db } = await setup()
    const out = await run(2)
    expect(out.replayed).toBe(false)
    const crane = out.deck.scenes.find((s) => s.id === 'p-red-crowned-crane')
    expect(crane?.choices.map((c) => c.kind)).toEqual(['leave', 'linger'])
    expect(out.writing.scenes.map((s) => s.id)).toEqual(out.deck.scenes.map((s) => s.id))
    expect(writer.calls).toHaveLength(1)
    const row = await db.decks.find(TRIP_ID, 2)
    expect(row?.status).toBe('done')
    expect(row?.deck).toEqual(out.deck)
  })

  it('D1: 鹿ゾーンのある移動のランダムの場面には、遅れでずれた入口の時刻と光が付く', async () => {
    const { run } = await setup()
    const { deck } = await run(1)
    const road = deck.scenes.filter((s) => s.trigger.kind === 'road')
    expect(road.length).toBeGreaterThan(0)
    for (const scene of road) {
      for (const c of scene.choices) {
        if (c.endsDay) continue
        expect(c.zone).not.toBeNull()
        expect(['day', 'dusk', 'dawn', 'night']).toContain(c.zone?.light)
      }
    }
  })

  it('IDEM-31: 束を作り終えた日の 2 回目 → 保存済みを返し、Claude は 1 回だけ', async () => {
    const { run, writer } = await setup()
    const first = await run(2)
    const second = await run(2)
    expect(second.replayed).toBe(true)
    expect(second.deck).toEqual(first.deck)
    expect(writer.calls).toHaveLength(1)
  })

  it('IDEM-34: 保存した束の data の版がいまの DayPlan と違う → 作り直す', async () => {
    const roads = realData.load()
    const { run, writer, db, usecase } = await setup()
    await run(2)
    const row = await db.decks.find(TRIP_ID, 2)
    if (!row?.deck || !row.writing) throw new Error('束が無い')
    await db.decks.reclaim(TRIP_ID, 2, { status: 'done', updatedAtMs: row.updatedAtMs }, NOW)
    await db.decks.markDone({
      tripId: TRIP_ID,
      day: 2,
      deck: { ...row.deck, data: { ...row.deck.data, zones: 'old-hash' } },
      writing: row.writing,
      claimedAtMs: NOW,
      nowMs: NOW,
    })
    expect(roads.zones.hash).not.toBe('old-hash')
    const again = await usecase.execute({ tripId: TRIP_ID, day: 2, ownerToken: OWNER_TOKEN })
    expect(again.replayed).toBe(false)
    expect(again.deck.data.zones).toBe(roads.zones.hash)
    expect(writer.calls).toHaveLength(2)
  })

  it('AUTH-31: トークンが無い・形が違う → OwnerRequiredError、Claude を呼ばず行も作らない', async () => {
    const { run, writer, db, usecase } = await setup()
    await expect(
      usecase.execute({ tripId: TRIP_ID, day: 2, ownerToken: undefined }),
    ).rejects.toBeInstanceOf(OwnerRequiredError)
    await expect(run(2, 'not-a-token')).rejects.toBeInstanceOf(OwnerRequiredError)
    expect(writer.calls).toHaveLength(0)
    expect(await db.decks.find(TRIP_ID, 2)).toBeNull()
  })

  it('AUTH-32: 別の旅のトークン → OwnerRequiredError', async () => {
    const { run, writer } = await setup()
    await expect(run(2, OTHER_TOKEN)).rejects.toBeInstanceOf(OwnerRequiredError)
    expect(writer.calls).toHaveLength(0)
  })

  it('旅が無い・id の形が違う → TripNotFoundError。日が無い → TripDayNotFoundError', async () => {
    const { usecase, run } = await setup()
    await expect(
      usecase.execute({ tripId: 'Zz9yXx8w', day: 1, ownerToken: OWNER_TOKEN }),
    ).rejects.toBeInstanceOf(TripNotFoundError)
    await expect(
      usecase.execute({ tripId: '../etc', day: 1, ownerToken: OWNER_TOKEN }),
    ).rejects.toBeInstanceOf(TripNotFoundError)
    await expect(run(6)).rejects.toBeInstanceOf(TripDayNotFoundError)
  })

  it('AUTH-36: 1 日の上限に達したあと → DailyLimitError、Claude を呼ばない、束は failed', async () => {
    const { run, writer, db } = await setup({ limit: 0 })
    await expect(run(2)).rejects.toBeInstanceOf(DailyLimitError)
    expect(writer.calls).toHaveLength(0)
    expect((await db.decks.find(TRIP_ID, 2))?.status).toBe('failed')
  })

  it('FAIL-31: Claude が時間切れ → SceneWriterError、束は failed、次の POST で作り直せる', async () => {
    const writer = new ScriptedSceneWriter([new SceneWriterError('timeout')])
    const { run, db } = await setup({ writer })
    await expect(run(2)).rejects.toBeInstanceOf(SceneWriterError)
    expect((await db.decks.find(TRIP_ID, 2))?.status).toBe('failed')
    const again = await run(2)
    expect(again.replayed).toBe(false)
    expect(writer.calls).toHaveLength(2)
  })

  it('FAIL-32: 1 回目だけ外れたら 2 回目の文で保存、2 回とも外れたら SceneWriterError', async () => {
    const once = new ScriptedSceneWriter([{ kind: 'rejected', reason: 'malformed' }])
    const ok = await (await setup({ writer: once })).run(2)
    expect(ok.writing.scenes.length).toBe(ok.deck.scenes.length)
    expect(once.calls[1]?.previousProblems).toEqual(['malformed'])

    const broken = (req: Parameters<ScriptedSceneWriter['write']>[0]) => ({
      kind: 'draft' as const,
      writing: {
        scenes: req.brief.scenes.slice(1).map(() => ({
          id: 'x',
          headline: { ja: '', en: '', zh: '', ko: '' },
          body: { ja: '', en: '', zh: '', ko: '' },
          choices: [],
        })),
      },
    })
    const twice = new ScriptedSceneWriter([broken, broken])
    const { run, db } = await setup({ writer: twice })
    await expect(run(2)).rejects.toBeInstanceOf(SceneWriterError)
    expect(twice.calls).toHaveLength(2)
    expect(twice.calls[1]?.previousProblems).toContain('scene-count@scenes')
    expect((await db.decks.find(TRIP_ID, 2))?.status).toBe('failed')
  })

  it('FAIL-33: 同時呼び出しの枠が無い → TripWriterBusyError、束は failed', async () => {
    const { run, writer, db } = await setup({ slots: 0 })
    await expect(run(2)).rejects.toBeInstanceOf(TripWriterBusyError)
    expect(writer.calls).toHaveLength(0)
    expect((await db.decks.find(TRIP_ID, 2))?.status).toBe('failed')
  })

  it('FAIL-34: しおりをいまのマスターで作り直せない → ItineraryChangedError、Claude を呼ばない', async () => {
    const { db, writer, usecase } = await setup()
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

  it('CONC-31: 同じ日の束を作っている最中の 2 つ目 → TripInProgressError', async () => {
    const { run, db } = await setup()
    await db.decks.insertPending({ tripId: TRIP_ID, day: 2, nowMs: NOW - 10_000 })
    await expect(run(2)).rejects.toBeInstanceOf(TripInProgressError)
  })

  it('CONC-32: pending が 2 分を過ぎた束 → 作り直せる', async () => {
    const { run, db } = await setup()
    await db.decks.insertPending({ tripId: TRIP_ID, day: 2, nowMs: NOW - 121_000 })
    const out = await run(2)
    expect(out.replayed).toBe(false)
    expect((await db.decks.find(TRIP_ID, 2))?.status).toBe('done')
  })

  it('CONC-33: 生成中に作り直しに取られたら、古い生成の done は書かない', async () => {
    let dbRef: TestDb | null = null
    const writer = new ScriptedSceneWriter([
      async (req) => {
        // 生成の途中で、2 分後の別の要求が行を取り直した
        const row = await dbRef?.decks.find(TRIP_ID, 2)
        if (row)
          await dbRef?.decks.reclaim(
            TRIP_ID,
            2,
            { status: row.status, updatedAtMs: row.updatedAtMs },
            NOW + 200_000,
          )
        const { validStopWriting } = await import('../../../../tests/factories/stop-events.js')
        return { kind: 'draft', writing: validStopWriting(req.brief) }
      },
    ])
    const { run, db, log } = await setup({ writer })
    dbRef = db
    const out = await run(2)
    expect(out.deck.scenes.length).toBeGreaterThan(0)
    const row = await db.decks.find(TRIP_ID, 2)
    expect(row?.status).toBe('pending')
    expect(row?.updatedAtMs).toBe(NOW + 200_000)
    expect(log.has('stop_deck.claim_lost')).toBe(true)
  })

  it('WRITE-2d: Claude の材料は選択肢由来の値だけ（時刻・金額・TripPlan の文・自由入力が無い）', async () => {
    const { run, writer } = await setup()
    await run(1)
    const brief = writer.calls[0]?.brief
    const text = JSON.stringify(brief)
    expect(text).not.toMatch(/\d{1,2}:\d{2}/) // 時刻
    expect(text).not.toMatch(/\+09:00/)
    expect(text).not.toContain('流氷とタンチョウ') // TripPlan のタイトル
    expect(text).not.toContain('budget')
    expect(text).not.toMatch(/jpy|JPY/)
    expect(brief?.scenes[0]?.choices[0]).toHaveProperty('zoneLight')
  })
})
