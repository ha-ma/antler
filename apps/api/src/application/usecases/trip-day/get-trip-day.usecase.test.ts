import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { TripDetailsSchema, type TripDetails, type TripPlan } from '@antler/schema'
import {
  assessRisk,
  buildItinerary,
  buildTripPlan,
  DayPlanSchema,
  PERSONA_INPUT,
  type RoadCatalog,
} from '@antler/trip'
import { ROAD_CATALOG } from '@antler/trip/roads'
import { parseZoneCollection } from '@antler/zones'
import { InMemoryTripRepository, MemoryLog } from '../../../../tests/factories/trips.js'
import {
  ItineraryChangedError,
  TripDayNotFoundError,
  TripInputError,
  TripNotFoundError,
} from '../../../domain/trips/errors/trip-errors.js'
import { GetTripDayUseCase } from './get-trip-day.usecase.js'

// GET /api/trips/:id/day/:n の UseCase（docs/specs/brief-map/functional.md R5、UC-5a〜UC-5d）

const require = createRequire(import.meta.url)
const zones = parseZoneCollection(
  readFileSync(require.resolve('@antler/zones/zones.geojson'), 'utf8'),
)

const ID = 'K7m2abcd'

function personaTrip(): { plan: TripPlan; details: TripDetails } {
  const itinerary = buildItinerary(PERSONA_INPUT)
  const plan = buildTripPlan(PERSONA_INPUT, itinerary, assessRisk(PERSONA_INPUT, itinerary), {
    id: ID,
    seed: 918273,
    title: '流氷とタンチョウ',
  })
  const note = { ja: '移動', en: 'Drive', zh: '移動', ko: '이동' }
  const details = TripDetailsSchema.parse({
    tripId: ID,
    titles: { ja: '流氷とタンチョウ', en: 'Drift ice', zh: '流冰', ko: '유빙' },
    dayNotes: plan.days.map((d) => ({ day: d.day, note })),
    skipped: [],
    createdAt: '2026-11-03T12:00:00+09:00',
  })
  return { plan, details }
}

function setup(roads: RoadCatalog = ROAD_CATALOG) {
  const trips = new InMemoryTripRepository()
  const { plan, details } = personaTrip()
  trips.trips.set(ID, { plan, details, ownerTokenHash: 'secret-hash', createdAtMs: 0 })
  const log = new MemoryLog()
  const clock = new SteppingClock()
  const usecase = new GetTripDayUseCase({
    trips,
    data: { load: () => ({ roads, zones }) },
    clock,
    log,
  })
  return { usecase, trips, plan, log, clock }
}

/** 読むたびに step ms 進む時計（計算の所要を決めてテストする） */
class SteppingClock {
  t = 0
  step = 10
  nowMs(): number {
    this.t += this.step
    return this.t
  }
}

describe('GetTripDayUseCase', () => {
  it('UC-5a: 保存した旅の n 日目 → plan・details・day。所有者の印を含まない', async () => {
    const { usecase, plan } = setup()
    const out = await usecase.execute({ id: ID, day: 2 })
    expect(out.plan).toEqual(plan)
    expect(out.details.tripId).toBe(ID)
    expect(DayPlanSchema.parse(out.day).day).toBe(2)
    expect(JSON.stringify(out)).not.toContain('secret-hash')
    expect(Object.keys(out).sort()).toEqual(['day', 'details', 'plan'])
  })

  it('IDEM-1: 同じ旅・同じ日を 2 回 → 同じ結果', async () => {
    const { usecase } = setup()
    expect(await usecase.execute({ id: ID, day: 3 })).toEqual(
      await usecase.execute({ id: ID, day: 3 }),
    )
  })

  it('UC-5b: n が 1 以上の整数でない → TripInputError', async () => {
    const { usecase } = setup()
    for (const day of [0, -1, 1.5, Number.NaN]) {
      await expect(usecase.execute({ id: ID, day })).rejects.toBeInstanceOf(TripInputError)
    }
  })

  it('UC-5c: 日数を超える n → TripDayNotFoundError、無い id・形の違う id → TripNotFoundError', async () => {
    const { usecase } = setup()
    await expect(usecase.execute({ id: ID, day: 6 })).rejects.toBeInstanceOf(TripDayNotFoundError)
    for (const id of ['Zz9yXx8w', '../x', 'K7m!', 'a'.repeat(17), 'abc']) {
      await expect(usecase.execute({ id, day: 1 })).rejects.toBeInstanceOf(TripNotFoundError)
    }
  })

  it('UC-5d: 保存した days が作り直しと違う → ItineraryChangedError と warn', async () => {
    const { usecase, trips, log } = setup()
    const stored = trips.trips.get(ID)
    if (!stored) throw new Error('setup')
    trips.trips.set(ID, {
      ...stored,
      plan: { ...stored.plan, days: stored.plan.days.map((d) => ({ ...d, stops: ['furano'] })) },
    })
    await expect(usecase.execute({ id: ID, day: 1 })).rejects.toBeInstanceOf(ItineraryChangedError)
    expect(log.has('trip_day.itinerary_changed')).toBe(true)
  })

  it('計算が 200 ms を越えたら trip_day.slow を warn（越えなければ出さない）', async () => {
    const { usecase, log, clock } = setup()
    await usecase.execute({ id: ID, day: 1 })
    expect(log.has('trip_day.slow')).toBe(false)
    clock.step = 300
    await usecase.execute({ id: ID, day: 1 })
    expect(log.has('trip_day.slow')).toBe(true)
  })

  it('組がルートのデータに無い → 直線で返し、warn を残す', async () => {
    const { usecase, log } = setup({ ...ROAD_CATALOG, roads: {} })
    const out = await usecase.execute({ id: ID, day: 1 })
    expect(out.day.legs.every((l) => l.source === 'straight')).toBe(true)
    expect(log.has('trip_day.road_missing')).toBe(true)
  })
})
