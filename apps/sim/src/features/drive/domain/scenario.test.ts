import { TripPlanSchema } from '@antler/schema'
import { measureAlongRoute, metersBetween, planRoute, type LonLat } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { createRoadFrame, fromPlane, lonLatAt, poseAt, toPlane, toRoadCoords } from './road'
import { DEMO_TRIP, demoScenario, resolveAlertEnabled } from './scenario'
import { ZONES } from './zones-data'

describe('運転の場面とルート（R1・R2）', () => {
  const scenario = demoScenario(ZONES)
  const plan = planRoute(scenario.route, ZONES)

  it('UC-1a: 見本の旅程が TripPlanSchema を通り、ルートの区間は akan-1・akan-2 の 2 つで、始点と終点はゾーンの外', () => {
    expect(TripPlanSchema.safeParse(scenario.trip).success).toBe(true)
    expect(plan.intervals.map((i) => i.zoneIds)).toEqual([['R240-akan-1'], ['R240-akan-2']])
    const first = plan.intervals[0]
    const last = plan.intervals[plan.intervals.length - 1]
    expect(first?.entryKm).toBeGreaterThan(1)
    expect(plan.totalKm - (last?.exitKm ?? 0)).toBeGreaterThan(0.5)
    expect(measureAlongRoute(plan, scenario.route[0] as LonLat).current).toBeUndefined()
    expect(measureAlongRoute(plan, scenario.route.at(-1) as LonLat).current).toBeUndefined()
  })

  it('UC-1b: 緯度経度 → 平面 → 緯度経度で 0.5 m 以内に戻り、平面の距離が metersBetween と 0.5% 以内で合う', () => {
    const origin: LonLat = [144.2, 43.05]
    const p: LonLat = [144.1, 43.3]
    const back = fromPlane(origin, toPlane(origin, p))
    expect(metersBetween(p, back)).toBeLessThan(0.5)
    const [x, z] = toPlane(origin, p)
    const real = metersBetween(origin, p)
    expect(Math.abs(Math.hypot(x, z) - real) / real).toBeLessThan(0.005)
  })

  it('UC-1c: ?alert=off ならアラート OFF、無ければ旅程の alertEnabled', () => {
    expect(resolveAlertEnabled(DEMO_TRIP, '?alert=off')).toBe(false)
    expect(resolveAlertEnabled(DEMO_TRIP, '')).toBe(true)
    expect(resolveAlertEnabled({ ...DEMO_TRIP, alertEnabled: false }, '?alert=on')).toBe(false)
    expect(demoScenario(ZONES, '?alert=off').alertEnabled).toBe(false)
  })

  it('UC-1d: d が正なら進む向きの右。頂点の角でも位置が飛ばない', () => {
    // 北へ 100 m、東へ 100 m の L 字
    const origin: LonLat = [144, 43]
    const route = [
      [0, 0],
      [0, -100],
      [100, -100],
    ].map(([x, z]) => fromPlane(origin, [x ?? 0, z ?? 0]))
    const frame = createRoadFrame(route)
    const north = poseAt(frame, 50, 2)
    expect(north.x).toBeCloseTo(2, 1) // 北へ進むときの右は東
    const east = poseAt(frame, frame.lengthM - 10, 2)
    expect(east.z).toBeCloseTo(-98, 0) // 東へ進むときの右は南
    // 角の前後 0.5 m で、横 3.5 m の点が 1 m 以上飛ばない
    const s = frame.cumulativeM[1] ?? 0
    const a = poseAt(frame, s - 0.5, 3.5)
    const b = poseAt(frame, s + 0.5, 3.5)
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1)
  })

  it('UC-1d: 平面の点を (s, d) に戻せ、lonLatAt と toPlane が合う', () => {
    const frame = createRoadFrame(scenario.route)
    const pose = poseAt(frame, 5000, -1.75)
    const back = toRoadCoords(frame, [pose.x, pose.z], 5000)
    expect(back.s).toBeCloseTo(5000, 0)
    expect(back.d).toBeCloseTo(-1.75, 1)
    const ll = lonLatAt(frame, 5000, -1.75)
    const [x, z] = toPlane(frame.origin, ll)
    expect(Math.hypot(x - pose.x, z - pose.z)).toBeLessThan(0.01)
  })
})
