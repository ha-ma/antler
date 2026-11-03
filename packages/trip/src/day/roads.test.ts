import { distanceToPolyline, metersBetween, polylineLengthM, type LonLat } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { travelHours } from '../itinerary'
import { placeById } from '../places'
import { CLOSURE_RADIUS_M, roadKey, roadPairs, WINTER_CLOSURES } from './road-pairs'
import { roadBetween, type RoadCatalog } from './roads'
import { ROAD_CATALOG } from './roads-data'

// docs/specs/brief-map/functional.md R1（UC-1b〜UC-1e）

const near = (a: LonLat | undefined, b: { lat: number; lon: number }, m: number) =>
  expect(metersBetween(a as LonLat, [b.lon, b.lat])).toBeLessThan(m)

describe('routes.json と roadBetween', () => {
  it('UC-1b: 全てのエリアの組（玄関口 ＋ エリアの拠点）がある。距離・所要が正で、線は 2 点以上', () => {
    const pairs = roadPairs()
    expect(pairs.length).toBeGreaterThan(150)
    const missing = pairs.filter(([a, b]) => !ROAD_CATALOG.roads[roadKey(a, b)])
    expect(missing).toEqual([])
    for (const [a, b] of pairs) {
      const road = roadBetween(ROAD_CATALOG, a, b)
      expect(road.source).toBe('osrm')
      expect(road.distanceKm).toBeGreaterThan(0)
      expect(road.durationMin).toBeGreaterThan(0)
      expect(road.line.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('UC-1b: 線は出発地の近くで始まり、到着地の近くで終わる（道に吸着するので 5 km 以内）', () => {
    const road = roadBetween(ROAD_CATALOG, 'cts', 'kushiro')
    near(road.line[0], placeById('cts') as { lat: number; lon: number }, 5000)
    near(
      road.line[road.line.length - 1],
      placeById('kushiro') as { lat: number; lon: number },
      5000,
    )
    // 新千歳 → 釧路はおよそ 250〜320 km
    expect(road.distanceKm).toBeGreaterThan(250)
    expect(road.distanceKm).toBeLessThan(320)
    // 間引いた線の長さは OSRM の距離と 3% 以内
    expect(
      Math.abs(polylineLengthM(road.line) / 1000 - road.distanceKm) / road.distanceKm,
    ).toBeLessThan(0.03)
  })

  it('UC-1c: 逆向きは同じ線を逆にたどり、距離・所要は同じ', () => {
    const go = roadBetween(ROAD_CATALOG, 'cts', 'kushiro')
    const back = roadBetween(ROAD_CATALOG, 'kushiro', 'cts')
    expect(back.line).toEqual([...go.line].reverse())
    expect(back.distanceKm).toBe(go.distanceKm)
    expect(back.durationMin).toBe(go.durationMin)
  })

  it('UC-1d: 組が無ければ直線・source "straight"・所要は plan-trip の目安', () => {
    const empty: RoadCatalog = { ...ROAD_CATALOG, roads: {} }
    const road = roadBetween(empty, 'cts', 'kushiro')
    expect(road.source).toBe('straight')
    expect(road.line).toHaveLength(2)
    expect(road.durationMin).toBeCloseTo(travelHours('cts', 'kushiro') * 60, 6)
  })

  it('UC-1e: 所要は OSRM の秒 × 係数 1.2', () => {
    expect(ROAD_CATALOG.meta.durationFactor).toBe(1.2)
    const entry = ROAD_CATALOG.roads[roadKey('cts', 'kushiro')]
    expect(roadBetween(ROAD_CATALOG, 'cts', 'kushiro').durationMin).toBeCloseTo(
      ((entry?.durationS ?? 0) * 1.2) / 60,
      6,
    )
  })

  it('UC-1g: どの線も冬に閉まる道（知床峠）の 2 km 以内を通らず、端点は地点の 5 km 以内', () => {
    for (const [a, b] of roadPairs()) {
      const road = roadBetween(ROAD_CATALOG, a, b)
      for (const closure of WINTER_CLOSURES)
        expect(distanceToPolyline(closure.at, road.line).distanceM, `${a}→${b}`).toBeGreaterThan(
          CLOSURE_RADIUS_M,
        )
      near(road.line[0], placeById(a) as { lat: number; lon: number }, 5000)
      near(road.line[road.line.length - 1], placeById(b) as { lat: number; lon: number }, 5000)
    }
  })

  it('UC-1h: OSRM × 1.2 の所要と plan-trip の目安は、比が 0.4〜2.5（直線 10 km 未満の近い組は差が 20 分以内）', () => {
    for (const [a, b] of roadPairs()) {
      const osrm = roadBetween(ROAD_CATALOG, a, b).durationMin
      const rough = travelHours(a, b) * 60
      const pa = placeById(a) as { lat: number; lon: number }
      const pb = placeById(b) as { lat: number; lon: number }
      if (metersBetween([pa.lon, pa.lat], [pb.lon, pb.lat]) < 10_000) {
        expect(Math.abs(osrm - rough), `${a}→${b}`).toBeLessThan(20)
        continue
      }
      expect(osrm / rough, `${a}→${b}`).toBeGreaterThan(0.4)
      expect(osrm / rough, `${a}→${b}`).toBeLessThan(2.5)
    }
  })

  it('知らない地点は例外', () => {
    expect(() => roadBetween(ROAD_CATALOG, 'cts', 'nowhere')).toThrow(RangeError)
  })
})
