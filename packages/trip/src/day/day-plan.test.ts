import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { TripPlan } from '@antler/schema'
import { distanceToPolyline, lightPeriod, parseZoneCollection } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { PERSONA_INPUT } from '../input'
import { buildItinerary } from '../itinerary'
import { buildTripPlan } from '../plan'
import { assessRisk } from '../risk'
import type { TripInput } from '../types'
import { buildDayPlan, ItineraryChangedError, pointAtKm, tripInputOf } from './day-plan'
import { roadBetween } from './roads'
import { ROAD_CATALOG } from './roads-data'
import { DayPlanSchema } from './schema'
import { jstMinute } from './sun-times'

// docs/specs/brief-map/functional.md R2・R3（UC-2a〜UC-2d、UC-3a・UC-3b）

const require = createRequire(import.meta.url)
const zones = parseZoneCollection(
  readFileSync(require.resolve('@antler/zones/zones.geojson'), 'utf8'),
)

function planOf(input: TripInput, seed = 918273): TripPlan {
  const itinerary = buildItinerary(input)
  return buildTripPlan(input, itinerary, assessRisk(input, itinerary), {
    id: 'K7m2abcd',
    seed,
    title: 't',
  })
}

const persona = planOf(PERSONA_INPUT)
const build = (plan: TripPlan, day: number) =>
  buildDayPlan({ plan, day, roads: ROAD_CATALOG, zones })
const ms = (iso: string) => Date.parse(iso)

describe('buildDayPlan（その日の行程）', () => {
  it('UC-2a: 各日の移動は buildItinerary の legs と同じ順・同じ出発で、到着 = 出発 ＋ 所要。形は DayPlanSchema', () => {
    const legs = buildItinerary(PERSONA_INPUT).legs
    for (const d of persona.days) {
      const plan = build(persona, d.day)
      expect(DayPlanSchema.parse(plan)).toEqual(plan)
      const expected = legs.filter((l) => l.day === d.day)
      expect(plan.legs.map((l) => [l.from, l.to])).toEqual(expected.map((l) => [l.from, l.to]))
      expect(plan.legs[0]?.departAt).toBe(expected[0] ? jstMinute(expected[0].startMs) : undefined)
      for (const leg of plan.legs) {
        expect(leg.source).toBe('osrm')
        expect(leg.durationMin).toBeCloseTo(
          roadBetween(ROAD_CATALOG, leg.from, leg.to).durationMin,
          1,
        )
        expect(ms(leg.arriveAt) - ms(leg.departAt)).toBeCloseTo(leg.durationMin * 60_000, -5)
      }
    }
    expect(build(persona, 1).legs[0]?.from).toBe('cts')
  })

  it('UC-2b: 移動の無い日は legs が空で、stayAt がその日の滞在地。日没はその地点で測る', () => {
    // 釧路空港に 16:00 に着く 3 日の旅。湿原（釧路、重さ 5 ＝ 丸 1 日）は翌朝に移るので、1 日目は空港で泊まる
    const plan = planOf({
      ...PERSONA_INPUT,
      depart: { at: '2027-02-14T16:00:00+09:00', place: 'KUH' },
      return: { at: '2027-02-16T17:00:00+09:00', place: 'KUH' },
      pleasures: [{ id: 'kushiro-marsh', weight: 5 }],
    })
    const idle = build(plan, 1)
    expect(idle.legs).toEqual([])
    expect(idle.stayAt).toBe('kuh')
    expect(idle.sun.place).toBe('kuh')
    expect(idle.zones).toEqual([])
    expect(build(plan, 2).stayAt).toBeNull()
  })

  it('UC-2c: 保存した days が作り直しと違う → ItineraryChangedError', () => {
    const changed: TripPlan = {
      ...persona,
      days: persona.days.map((d, i) => (i === 0 ? { ...d, stops: ['washo-market-donburi'] } : d)),
    }
    expect(() => build(changed, 1)).toThrow(ItineraryChangedError)
  })

  it('UC-2d: 日付は JST の暦日、stops はその日の楽しみとその拠点', () => {
    expect(build(persona, 1).date).toBe('2027-02-14')
    expect(build(persona, 5).date).toBe('2027-02-18')
    const late = planOf({
      ...PERSONA_INPUT,
      depart: { at: '2027-02-14T23:30:00+08:00', place: 'CTS' },
    })
    expect(build(late, 1).date).toBe('2027-02-15')
    const withStops = persona.days.find((d) => d.stops.length > 0)
    const plan = build(persona, withStops?.day ?? 1)
    expect(plan.stops.map((s) => s.id)).toEqual(withStops?.stops)
    expect(plan.stops.find((s) => s.id === 'red-crowned-crane')?.base ?? 'tsurui').toBe('tsurui')
  })

  it('UC-2e: その日の 2 本目以降の出発は、しおりの出発と前の到着の遅い方（移動が重ならない）', () => {
    // 道東を詰めて回る旅（1 日に 2 本以上の移動がある日を作る）
    const busy = planOf({
      ...PERSONA_INPUT,
      pleasures: [
        { id: 'washo-market-donburi', weight: 1 },
        { id: 'red-crowned-crane', weight: 1 },
        { id: 'akan-onsen-snow', weight: 1 },
        { id: 'mashu-iozan', weight: 1 },
      ],
    })
    const legs = buildItinerary(tripInputOf(busy)).legs
    const days = busy.days.map((d) => build(busy, d.day))
    expect(days.some((d) => d.legs.length >= 2)).toBe(true)
    for (const d of days) {
      const planned = legs.filter((l) => l.day === d.day)
      d.legs.forEach((leg, i) => {
        const prev = d.legs[i - 1]
        const want = Math.max(planned[i]?.startMs ?? 0, prev ? ms(prev.arriveAt) : 0)
        expect(ms(leg.departAt)).toBe(ms(jstMinute(want)))
        if (prev) expect(ms(prev.arriveAt)).toBeLessThanOrEqual(ms(leg.departAt))
      })
    }
  })

  it('UC-2f: 直線でつないだ移動（組が無い）はゾーンを出さない', () => {
    const plan = buildDayPlan({
      plan: persona,
      day: 1,
      roads: { ...ROAD_CATALOG, roads: {} },
      zones,
    })
    expect(plan.legs.every((l) => l.source === 'straight')).toBe(true)
    expect(plan.zones).toEqual([])
  })

  it('UC-2g: data に routes の取得日・zones の hash・条件の版がある', () => {
    expect(build(persona, 1).data).toEqual({
      routes: ROAD_CATALOG.meta.fetchedAt,
      zones: zones.hash,
      conditions: 1,
    })
  })

  it('UC-2d: 範囲外の日は RangeError', () => {
    expect(() => build(persona, 0)).toThrow(RangeError)
    expect(() => build(persona, 6)).toThrow(RangeError)
  })
})

describe('ゾーンの通過と光', () => {
  const all = persona.days.map((d) => build(persona, d.day))

  it('UC-3a: ペルソナの旅はどこかの日でゾーンを通る。区間は入口 < 出口、時刻は移動の中、名前は 4 言語', () => {
    const passages = all.flatMap((d) => d.zones.map((z) => ({ z, leg: d.legs[z.leg] })))
    expect(passages.length).toBeGreaterThan(0)
    for (const { z, leg } of passages) {
      expect(leg).toBeDefined()
      expect(z.entryKm).toBeLessThan(z.exitKm)
      expect(z.exitKm).toBeLessThanOrEqual((leg?.distanceKm ?? 0) * 1.05)
      expect(ms(z.entryAt)).toBeGreaterThanOrEqual(ms(leg?.departAt ?? ''))
      expect(ms(z.entryAt)).toBeLessThanOrEqual(ms(z.exitAt))
      expect(ms(z.exitAt)).toBeLessThanOrEqual(ms(leg?.arriveAt ?? '') + 60_000)
      expect(Object.keys(z.roadName).sort()).toEqual(['en', 'ja', 'ko', 'zh'])
    }
  })

  it('UC-3b: 光は入口の地点と、分に切り捨てた入口の時刻（entryAt）の lightPeriod', () => {
    for (const d of all) {
      for (const z of d.zones) {
        const leg = d.legs[z.leg]
        const [lon, lat] = pointAtKm(leg?.route ?? [], z.entryKm)
        expect(z.light).toBe(lightPeriod(z.entryAt, { lat, lon }))
      }
    }
  })

  it('UC-3d: 区間の名前は入口に最も近いゾーンの道路名', () => {
    for (const d of all) {
      for (const z of d.zones) {
        const entry = pointAtKm(d.legs[z.leg]?.route ?? [], z.entryKm)
        const nearest = z.zoneIds
          .map((id) => zones.features.find((f) => f.id === id))
          .sort(
            (a, b) =>
              distanceToPolyline(entry, a?.properties.centerline ?? []).distanceM -
              distanceToPolyline(entry, b?.properties.centerline ?? []).distanceM,
          )[0]
        expect(z.roadName).toEqual(nearest?.properties.roadName)
      }
    }
  })

  it('同じ旅・同じ日なら同じ結果（シードで再現できる）', () => {
    expect(build(persona, 2)).toEqual(build(persona, 2))
  })
})
