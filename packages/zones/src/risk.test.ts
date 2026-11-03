import { CaptureSchema } from '@antler/schema'
import { describe, expect, it } from 'vitest'
import { zoneRisk } from './risk'
import { toRoadSegment } from './road-segment'
import { LINE_A, north, TEST_ZONES } from './test-zones'
import { LIGHT_PERIODS } from './zone-db'

const zoneA = () => {
  const z = TEST_ZONES.features.find((f) => f.properties.id === 'R240-test-1')
  if (!z) throw new Error('見本が無い')
  return z
}

describe('UC-6 危険度', () => {
  it('UC-6a: 全ゾーン・全月・全区分で 0〜1', () => {
    for (const z of TEST_ZONES.features) {
      expect(z.properties.weights).toHaveLength(12)
      for (const month of z.properties.weights) {
        for (const p of LIGHT_PERIODS) {
          expect(month[p]).toBeGreaterThanOrEqual(0)
          expect(month[p]).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('UC-6b: 全ゾーンで 11 月 dusk ＞ 7 月 day', () => {
    for (const z of TEST_ZONES.features) {
      const w = z.properties.weights
      expect(w[10]?.dusk).toBeGreaterThan(w[6]?.day ?? 1)
    }
  })

  it('UC-6c: zoneRisk はゾーンの中心付近の光の区分と JST の月で表を引く', () => {
    const z = zoneA()
    // 2026-11-16 16:00 の釧路付近は dusk（太陽が -1° 付近）
    expect(zoneRisk(z, '2026-11-16T16:00:00+09:00')).toBe(z.properties.weights[10]?.dusk)
    // UTC では 10 月 31 日だが JST では 11 月 1 日の 1 時 → 11 月の night（10 月の値ではない）
    expect(zoneRisk(z, '2026-10-31T16:00:00Z')).toBe(z.properties.weights[10]?.night)
    expect(zoneRisk(z, '2026-10-31T16:00:00Z')).not.toBe(z.properties.weights[9]?.night)
  })
})

describe('UC-7 位置の丸め（Capture.roadSegment）', () => {
  const mid = LINE_A[1] as [number, number]

  it('UC-7a: ゾーン内・ゾーンから 1 km 以内 → ゾーン id、1 km より遠い → unknown', () => {
    expect(toRoadSegment(mid, TEST_ZONES)).toBe('R240-test-1')
    expect(toRoadSegment(north(mid, 150 + 999), TEST_ZONES)).toBe('R240-test-1')
    expect(toRoadSegment(north(mid, 150 + 1001), TEST_ZONES)).toBe('unknown')
  })

  it('UC-7b: 返す値は Capture の roadSegment の検証を通る', () => {
    const base = {
      id: 'cap_1',
      source: 'vehicle',
      image: 'captures/cap_1.jpg',
      imageSize: [640, 480],
      boxes: [],
      conditions: {
        season: 'winter',
        month: 2,
        weather: 'clear',
        surface: 'packed_snow',
        light: 'dusk',
        fog: 'none',
        traffic: 'low',
        vehicle: 'compact_suv',
      },
      distanceM: null,
      side: null,
      pose: 'standing',
      reactionMs: null,
      outcome: 'missed',
      consent: true,
      createdAt: '2027-02-15T16:00:00+09:00',
    }
    for (const p of [mid, north(mid, 5000)] as [number, number][]) {
      const roadSegment = toRoadSegment(p, TEST_ZONES)
      expect(CaptureSchema.safeParse({ ...base, roadSegment }).success, roadSegment).toBe(true)
    }
  })
})
