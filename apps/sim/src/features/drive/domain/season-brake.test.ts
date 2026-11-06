import { describe, expect, it } from 'vitest'
import type { DriveScenario, Surface } from '../types'
import { NO_INPUT } from '../types'
import { DriveEngine } from './engine'
import { demoScenario } from './scenario'
import { sceneLookOf } from './season'
import { ZONES } from './zones-data'

// docs/specs/drive-season/functional.md R4（UC-4a・UC-4b）と受け入れ AC-1。
// 場面の路面がエンジンの車両力学に渡り、雨・雪の日は乾燥より止まりにくいことを、場面から通して固定する。

const FRAME_MS = 1000 / 60

/** 40 km/h まで加速してから Space を踏みきり、止まるまでの距離（m）と、途中で ABS が点いたか */
function brakeFrom40(scenario: DriveScenario): { distance: number; abs: boolean } {
  const engine = new DriveEngine(scenario, ZONES)
  engine.setInput({ ...NO_INPUT, throttle: true })
  for (let f = 0; f < 600 && engine.world.vehicle.speed * 3.6 < 40; f++) engine.frame(FRAME_MS)
  expect(engine.world.vehicle.speed * 3.6).toBeGreaterThanOrEqual(40)
  const start = engine.world.vehicle.s
  engine.setInput({ ...NO_INPUT, brake: true })
  let abs = false
  for (let f = 0; f < 60 * 30 && engine.world.vehicle.speed * 3.6 >= 0.5; f++) {
    engine.frame(FRAME_MS)
    abs ||= engine.telemetry().abs
  }
  return { distance: engine.world.vehicle.s - start, abs }
}

const withSurface = (surface: Surface): DriveScenario => ({ ...demoScenario(ZONES), surface })

describe('ブレーキは場面の路面で効きが変わる（drive-season R4）', () => {
  it.each([
    ['dry', 7.9],
    ['wet', 11],
    ['packed-snow', 17.3],
    ['ice', 78.5],
  ] as const)(
    'UC-4a: 場面の路面（%s）がエンジンに渡り、40 km/h からの停止距離が実測 %d m の ±10%%（加速で 40 を少し越える分を含む）',
    (surface, measured) => {
      const { distance } = brakeFrom40(withSurface(surface))
      expect(distance).toBeGreaterThan(measured * 0.9)
      expect(distance).toBeLessThan(measured * 1.12)
    },
  )

  it('UC-4b: 雨の日の場面（7 月・雨 → 濡れ）は乾燥の場面より止まるまで長く、ABS の灯が点く。乾燥では点かない', () => {
    const rain = demoScenario(ZONES, '?month=7&weather=rain')
    const dry = demoScenario(ZONES, '?month=7&weather=clear')
    expect(rain.surface).toBe('wet')
    expect(dry.surface).toBe('dry')
    const r = brakeFrom40(rain)
    const d = brakeFrom40(dry)
    expect(r.distance).toBeGreaterThan(d.distance * 1.3)
    expect(r.abs).toBe(true)
    expect(d.abs).toBe(false)
  })
})

describe('受け入れ（drive-season）', () => {
  it('AC-1: 既定・夏の晴れ・夏の雨・冬の雪で、停止距離は 乾燥 < 濡れ < 雪の日、景色は 冬・緑・緑・冬、降るものは なし・なし・雨・雪', () => {
    const cases = ['', '?month=7&weather=clear', '?month=7&weather=rain', '?month=2&weather=snow']
    const scenarios = cases.map((search) => demoScenario(ZONES, search))
    const looks = scenarios.map((s) => sceneLookOf(s))
    expect(looks.map((l) => l.season)).toEqual(['winter', 'green', 'green', 'winter'])
    expect(looks.map((l) => l.precipitation)).toEqual(['none', 'none', 'rain', 'snow'])
    const [, dry, rain, snow] = scenarios.map((s) => brakeFrom40(s).distance)
    expect(scenarios[3]?.surface).toMatch(/^(packed-snow|ice)$/)
    expect(dry).toBeLessThan(rain ?? 0)
    expect(rain).toBeLessThan(snow ?? 0)
  })
})
