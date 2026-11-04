import { FixedClock, MemoryLog } from '../../../../tests/factories/trips.js'
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
} from '../../../../tests/factories/stop-events.js'
import {
  EventConflictError,
  EventLimitError,
  OwnerRequiredError,
} from '../../../domain/stop-events/errors/stop-event-errors.js'
import type { TripEventInput } from '../../../domain/stop-events/models/trip-event.js'
import { TripInputError, TripNotFoundError } from '../../../domain/trips/errors/trip-errors.js'
import { NodeSha256Hasher } from '../../../infrastructure/security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../../infrastructure/system/in-process-concurrency-limiter.js'
import { PrepareStopDeckUseCase } from './prepare-stop-deck.usecase.js'
import { RecordTripEventsUseCase } from './record-trip-events.usecase.js'

// POST /api/trips/:id/events の UseCase（docs/specs/stop-events/functional.md R9・R10、resilience.md）。

/** ペルソナの D2 は 2027-02-15（出発 2027-02-14） */
const D2_AT = '2027-02-15T09:00:00+09:00'

async function setup() {
  const db = await openTestDb()
  const clock = new FixedClock(NOW)
  const log = new MemoryLog()
  const hasher = new NodeSha256Hasher()
  const prepare = new PrepareStopDeckUseCase({
    trips: db.trips,
    decks: db.decks,
    data: ROAD_DATA,
    writer: new ScriptedSceneWriter(),
    writerSlots: new InProcessConcurrencyLimiter(4),
    hasher,
    clock,
    log,
    dailyWriterCallLimit: 400,
  })
  const usecase = new RecordTripEventsUseCase({
    trips: db.trips,
    decks: db.decks,
    events: db.events,
    hasher,
    clock,
    log,
  })
  const record = (
    events: TripEventInput[],
    over: { ownerToken?: string | undefined; runId?: string; alertEnabled?: boolean } = {},
  ) =>
    usecase.execute({
      tripId: TRIP_ID,
      ownerToken: 'ownerToken' in over ? over.ownerToken : OWNER_TOKEN,
      runId: over.runId ?? RUN_ID,
      alertEnabled: over.alertEnabled ?? true,
      events,
    })
  return { db, clock, prepare, record }
}

const encounter = (seq: number, over: Partial<TripEventInput> = {}): TripEventInput =>
  ({
    kind: 'encounter',
    seq,
    day: 2,
    at: D2_AT,
    leg: 0,
    km: 12.5,
    pattern: 'crossing',
    alerted: true,
    alertDistanceM: 80,
    userSpotted: false,
    ...over,
  }) as TripEventInput

describe('RecordTripEventsUseCase', { timeout: SLOW_TEST_MS }, () => {
  it('LOG-3a: choice は束の値（種類・遅れ・泊まるか・光・失うもの）を写して保存する', async () => {
    const { prepare, record, db } = await setup()
    const { deck } = await prepare.execute({ tripId: TRIP_ID, day: 2, ownerToken: OWNER_TOKEN })
    const out = await record([
      {
        kind: 'choice',
        seq: 0,
        day: 2,
        at: D2_AT,
        sceneId: 'p-red-crowned-crane',
        choiceId: 'linger',
      },
    ])
    expect(out).toEqual({ accepted: 1, duplicates: 0 })
    const linger = deck.scenes[0]?.choices.find((c) => c.id === 'linger')
    const [row] = await db.events.listByTrip(TRIP_ID)
    expect(row).toMatchObject({
      tripId: TRIP_ID,
      runId: RUN_ID,
      seq: 0,
      kind: 'choice',
      alertEnabled: true,
      leg: null,
      km: null,
      data: {
        sceneId: 'p-red-crowned-crane',
        choiceId: 'linger',
        sceneKind: 'pleasure',
        choiceKind: 'linger',
        delayMin: 60,
        endsDay: false,
        plannedLight: linger?.zone?.light ?? null,
        lostJPY: 0,
        lostWeight: 0,
        lostPleasures: [],
        lateReturn: false,
      },
    })
  })

  it('LOG-3b: その日の束が無い・知らない sceneId / choiceId → TripInputError、何も保存しない', async () => {
    const { prepare, record, db } = await setup()
    const choice = (sceneId: string, choiceId: string): TripEventInput => ({
      kind: 'choice',
      seq: 0,
      day: 2,
      at: D2_AT,
      sceneId,
      choiceId,
    })
    await expect(record([choice('p-red-crowned-crane', 'leave')])).rejects.toBeInstanceOf(
      TripInputError,
    )
    await prepare.execute({ tripId: TRIP_ID, day: 2, ownerToken: OWNER_TOKEN })
    await expect(record([choice('p-nowhere', 'leave')])).rejects.toBeInstanceOf(TripInputError)
    await expect(record([choice('p-red-crowned-crane', 'stay')])).rejects.toBeInstanceOf(
      TripInputError,
    )
    expect(await db.events.listByTrip(TRIP_ID)).toEqual([])
  })

  it('LOG-3c: encounter・collision・avoidance を保存し、listByTrip は run の受信順 → seq', async () => {
    const { record, db, clock } = await setup()
    const RUN_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    await record([
      encounter(1),
      {
        kind: 'avoidance',
        seq: 2,
        day: 2,
        at: D2_AT,
        pattern: 'crossing',
        closestM: 6.5,
        alertToBrakeMs: 820,
      },
    ])
    clock.t = NOW + 1000
    await record(
      [{ kind: 'collision', seq: 0, day: 2, at: D2_AT, pattern: 'frozen', speedKmh: 54 }],
      {
        runId: RUN_B,
        alertEnabled: false,
      },
    )
    clock.t = NOW + 2000
    await record([encounter(0, { alerted: false, alertDistanceM: null, userSpotted: true })])
    const rows = await db.events.listByTrip(TRIP_ID)
    expect(rows.map((r) => `${r.runId.slice(0, 4)}:${String(r.seq)}:${r.kind}`)).toEqual([
      '3f2b:0:encounter',
      '3f2b:1:encounter',
      '3f2b:2:avoidance',
      '9a8b:0:collision',
    ])
    expect(rows[3]).toMatchObject({
      alertEnabled: false,
      data: { pattern: 'frozen', speedKmh: 54 },
    })
    expect(rows[2]?.data).toEqual({ pattern: 'crossing', closestM: 6.5, alertToBrakeMs: 820 })
  })

  it('LOG-3d: 1 つの POST の中で seq が重なる → TripInputError', async () => {
    const { record } = await setup()
    await expect(record([encounter(1), encounter(1)])).rejects.toBeInstanceOf(TripInputError)
    await expect(record([])).rejects.toBeInstanceOf(TripInputError)
  })

  it('LOG-3e: day が旅の日数を超える → TripInputError', async () => {
    const { record } = await setup()
    await expect(record([encounter(0, { day: 6 })])).rejects.toBeInstanceOf(TripInputError)
  })

  it('LOG-3f: at の暦日が day の日付でも翌日でもない・alerted の整合 → TripInputError', async () => {
    const { record, db } = await setup()
    await expect(
      record([encounter(0, { at: '2027-02-17T09:00:00+09:00' })]),
    ).rejects.toBeInstanceOf(TripInputError)
    // 深夜（翌日の 0 時台）は通る
    await expect(record([encounter(0, { at: '2027-02-16T00:30:00+09:00' })])).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
    })
    await expect(
      record([encounter(1, { alerted: false, alertDistanceM: 40 })]),
    ).rejects.toBeInstanceOf(TripInputError)
    await expect(record([encounter(2)], { alertEnabled: false })).rejects.toBeInstanceOf(
      TripInputError,
    )
    await expect(
      record(
        [
          {
            kind: 'avoidance',
            seq: 3,
            day: 2,
            at: D2_AT,
            pattern: 'herd',
            closestM: 3,
            alertToBrakeMs: 500,
          },
        ],
        { alertEnabled: false },
      ),
    ).rejects.toBeInstanceOf(TripInputError)
    expect(await db.events.listByTrip(TRIP_ID)).toHaveLength(1)
  })

  it('IDEM-32: 同じ (runId, seq) の再送 → duplicates に数え、行は 1 つ', async () => {
    const { record, db } = await setup()
    await record([encounter(0), encounter(1)])
    const again = await record([encounter(1), encounter(2)])
    expect(again).toEqual({ accepted: 1, duplicates: 1 })
    expect(await db.events.listByTrip(TRIP_ID)).toHaveLength(3)
  })

  it('IDEM-33: 同じ (runId, seq) で中身が違う → EventConflictError、その POST の新しい行も入らない', async () => {
    const { record, db } = await setup()
    await record([encounter(0)])
    await expect(record([encounter(1), encounter(0, { pattern: 'herd' })])).rejects.toBeInstanceOf(
      EventConflictError,
    )
    expect(await db.events.listByTrip(TRIP_ID)).toHaveLength(1)
  })

  it('AUTH-33: トークンが無い・違う → OwnerRequiredError、保存しない。旅が無い → TripNotFoundError', async () => {
    const { record, db } = await setup()
    await expect(record([encounter(0)], { ownerToken: undefined })).rejects.toBeInstanceOf(
      OwnerRequiredError,
    )
    await expect(record([encounter(0)], { ownerToken: OTHER_TOKEN })).rejects.toBeInstanceOf(
      OwnerRequiredError,
    )
    expect(await db.events.listByTrip(TRIP_ID)).toEqual([])
    const missing = new RecordTripEventsUseCase({
      trips: db.trips,
      decks: db.decks,
      events: db.events,
      hasher: new NodeSha256Hasher(),
      clock: new FixedClock(NOW),
      log: new MemoryLog(),
    })
    await expect(
      missing.execute({
        tripId: 'Nope1234',
        ownerToken: OWNER_TOKEN,
        runId: RUN_ID,
        alertEnabled: true,
        events: [encounter(0)],
      }),
    ).rejects.toBeInstanceOf(TripNotFoundError)
  })

  it('AUTH-37: 旅のイベントが 5,000 件に達したあと → EventLimitError（重複だけの再送は通る）', async () => {
    const { record, db } = await setup()
    await record([encounter(0)])
    const filler = Array.from({ length: 4999 }, (_, i) => ({
      tripId: TRIP_ID,
      runId: '00000000-0000-4000-8000-000000000000',
      seq: i,
      day: 2,
      kind: 'collision' as const,
      at: D2_AT,
      alertEnabled: true,
      leg: null,
      km: null,
      data: { pattern: 'frozen' as const, speedKmh: 10 },
      receivedAtMs: NOW,
    }))
    for (let i = 0; i < filler.length; i += 500)
      await db.events.insertMany(filler.slice(i, i + 500))
    expect(await db.events.countByTrip(TRIP_ID)).toBe(5000)
    await expect(record([encounter(1)])).rejects.toBeInstanceOf(EventLimitError)
    await expect(record([encounter(0)])).resolves.toEqual({ accepted: 0, duplicates: 1 })
  })
})
