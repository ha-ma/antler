import { deriveAlertState, type DerivedAlert } from '@antler/alert-ui'
import { describe, expect, it } from 'vitest'
import type { LonLat } from './geo'
import { judgeZone, toGpsZone, type ZoneJudgement } from './judge'
import { measureAlongRoute, planRoute } from './route'
import { east, LINE_A, TEST_ZONES } from './test-zones'

// 外側ループ。公開 API の使い方で、ルートを 1 km 刻みで進めながら判定する。
// （ペルソナの実経路の検証は zones.geojson の初版がそろってから。ここでは合成ゾーンで同じ流れを確かめる）

function interpolate(route: LonLat[], stepM: number): LonLat[] {
  const out: LonLat[] = []
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i] as LonLat
    const b = route[i + 1] as LonLat
    const lenM = Math.hypot(
      (b[0] - a[0]) * 111_195 * Math.cos((a[1] * Math.PI) / 180),
      (b[1] - a[1]) * 111_195,
    )
    const n = Math.max(1, Math.ceil(lenM / stepM))
    for (let k = 0; k < n; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
    }
  }
  out.push(route[route.length - 1] as LonLat)
  return out
}

describe('受け入れ', () => {
  it('AC-1: ルートを 1 km ごとに進めると、ゾーンの入口で enterZone が 1 回ずつ立ち、通過がルート上のゾーン数と一致し、alert-ui では safe / zone だけが出る', () => {
    const west = LINE_A[0] as LonLat
    const eastEnd = LINE_A[2] as LonLat
    const bSouth: LonLat = [144.2, 43.0]
    const route: LonLat[] = [
      east(west, -5000),
      west,
      eastEnd,
      bSouth,
      [144.2, 43.03],
      [144.2, 43.06],
    ]
    const plan = planRoute(route, TEST_ZONES)
    expect(plan.intervals).toHaveLength(2)

    let t = Date.parse('2027-02-15T15:00:00+09:00')
    let judged: ZoneJudgement | null = null
    let derived: DerivedAlert | null = null
    let enters = 0
    const states = new Set<string>()
    for (const p of interpolate(route, 250)) {
      t += 20_000
      judged = judgeZone({
        fix: { lon: p[0], lat: p[1], accuracyM: 10, timestamp: t, speedMps: 50 / 3.6 },
        now: t,
        previous: judged,
        zones: TEST_ZONES,
      })
      if (judged.enterZone) enters += 1
      const along = measureAlongRoute(plan, p)
      if (judged.status === 'inside') expect(along.current).toBeDefined()
      derived = deriveAlertState({
        flag: null,
        flagReceivedAt: null,
        gps: toGpsZone(judged),
        now: t,
        previous: derived,
      })
      states.add(derived.state)
    }
    expect(enters).toBe(plan.intervals.length)
    expect([...states].sort()).toEqual(['safe', 'zone'])
  })
})
