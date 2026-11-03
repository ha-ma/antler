import { describe, expect, it } from 'vitest'
import type { LonLat } from './geo'
import { measureAlongRoute, planRoute } from './route'
import { east, LINE_A, north, TEST_ZONES } from './test-zones'

const west = LINE_A[0] as LonLat
const eastEnd = LINE_A[2] as LonLat
// 区間 A の中心線に沿って、西へ 3 km の地点から東へ 3 km の地点まで（全長 約 10 km）
const ROUTE: LonLat[] = [east(west, -3000), west, eastEnd, east(eastEnd, 3000)]

describe('UC-3 ルート沿いの距離', () => {
  it('UC-3a: 現在地から次のゾーンの入口までの道のり km', () => {
    const plan = planRoute(ROUTE, TEST_ZONES)
    const m = measureAlongRoute(plan, east(west, -1000))
    expect(m.current).toBeUndefined()
    expect(m.next?.zoneIds).toEqual(['R240-test-1'])
    // 入口はゾーンの縁（中心線の端から 150 m 手前）
    expect(m.next?.distanceKm).toBeCloseTo(0.85, 1)
  })

  it('UC-3b: ゾーン内なら出口までの残り km', () => {
    const plan = planRoute(ROUTE, TEST_ZONES)
    const m = measureAlongRoute(plan, east(west, 1000))
    expect(m.current?.zoneIds).toEqual(['R240-test-1'])
    expect(m.current?.remainingKm).toBeCloseTo(3.22, 1)
  })

  it('UC-3c: 200 m 以内の隙間で続く 2 ゾーン（別の路線）→ 1 つの走行区間', () => {
    // 区間 A の東端から 100 m の隙間をあけて、区間 B の南端へ向かうルートを作るため、B の南端を A の延長上に置いた合成ルート
    const start = east(west, -1000)
    const bStart: LonLat = [144.2, 43.0]
    const route: LonLat[] = [start, west, eastEnd, bStart, north(bStart, 3300)]
    const plan = planRoute(route, TEST_ZONES)
    // A と B は 15 km 近く離れているので別区間（隙間 200 m を超える）
    expect(plan.intervals.map((i) => i.zoneIds)).toEqual([['R240-test-1'], ['R44-test-1']])
    // 200 m 以内なら 1 区間: 区間 A の中で一度外へ 50 m 出てすぐ戻るルート
    const wiggle: LonLat[] = [
      start,
      east(west, 1000),
      north(east(west, 1100), 200),
      east(west, 1200),
      eastEnd,
    ]
    const p2 = planRoute(wiggle, TEST_ZONES)
    expect(p2.intervals).toHaveLength(1)
  })

  it('UC-3d: 往復ルートで同じゾーンを 2 回通る → 通過の一覧に 2 件', () => {
    const roundTrip: LonLat[] = [...ROUTE, ...[...ROUTE].reverse()]
    const plan = planRoute(roundTrip, TEST_ZONES)
    expect(plan.intervals.filter((i) => i.zoneIds.includes('R240-test-1'))).toHaveLength(2)
  })

  it('UC-3e: ルートがどのゾーンも通らない → 次のゾーンなし', () => {
    const far: LonLat[] = [north(west, 5000), north(eastEnd, 5000)]
    const m = measureAlongRoute(planRoute(far, TEST_ZONES), north(west, 5000))
    expect(m.next).toBeUndefined()
    expect(m.current).toBeUndefined()
  })
})
