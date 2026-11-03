import { planRoute } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import type { DeerPattern } from '../types'
import {
  appearProbability,
  candidatesToDecide,
  createCandidates,
  DECIDE_AHEAD_M,
  decideAppear,
  PATTERN_WEIGHTS,
} from './deer-spawn'
import { demoScenario } from './scenario'
import { ZONES } from './zones-data'

const scenario = demoScenario(ZONES)
const plan = planRoute(scenario.route, ZONES)

describe('鹿の出現（R5）', () => {
  it('UC-5a: 同じシードなら同じ候補、違うシードなら違う。候補はすべて区間の中で、最初は入口から 280〜580 m', () => {
    const a = createCandidates(plan, 918273)
    expect(createCandidates(plan, 918273)).toEqual(a)
    expect(createCandidates(plan, 1)).not.toEqual(a)
    for (const c of a) {
      const v = plan.intervals[c.interval]
      expect(v).toBeDefined()
      expect(c.s / 1000).toBeGreaterThanOrEqual(v?.entryKm ?? Infinity)
      expect(c.s / 1000).toBeLessThanOrEqual(v?.exitKm ?? -Infinity)
    }
    for (let seed = 0; seed < 100; seed++) {
      const first = createCandidates(plan, seed).find((c) => c.interval === 0)
      const offset = (first?.s ?? 0) - (plan.intervals[0]?.entryKm ?? 0) * 1000
      expect(offset).toBeGreaterThanOrEqual(280 - 1e-6)
      expect(offset).toBeLessThanOrEqual(580 + 1e-6)
    }
  })

  it('UC-5b: 同じ候補で、11 月の dusk は 7 月の day より多く出る（zoneRisk）', () => {
    const candidates = createCandidates(plan, 42)
    // 釧路の日没前後: 11 月 16:00 は薄暮、7 月 12:00 は昼
    const nov = candidates.filter((c) => decideAppear(c, plan, ZONES, '2026-11-16T16:00+09:00'))
    const jul = candidates.filter((c) => decideAppear(c, plan, ZONES, '2026-07-15T12:00+09:00'))
    expect(nov.length).toBeGreaterThan(jul.length)
    expect(appearProbability(0.79)).toBeGreaterThan(0.9)
    expect(appearProbability(0.1)).toBeCloseTo(0.295, 2)
  })

  it('UC-5c: 200 のシードで 5 パターンがすべて出て、割合は ±5 ポイント以内、群れは 2〜5 頭', () => {
    const counts: Record<DeerPattern, number> = {
      roadside: 0,
      eyeshine: 0,
      crossing: 0,
      herd: 0,
      frozen: 0,
    }
    let total = 0
    for (let seed = 0; seed < 200; seed++) {
      for (const c of createCandidates(plan, seed)) {
        counts[c.pattern] += 1
        total += 1
        if (c.pattern === 'herd') {
          expect(c.herdSize).toBeGreaterThanOrEqual(2)
          expect(c.herdSize).toBeLessThanOrEqual(5)
        } else {
          expect(c.herdSize).toBe(1)
        }
      }
    }
    for (const pattern of Object.keys(counts) as DeerPattern[]) {
      expect(counts[pattern]).toBeGreaterThan(0)
      expect(Math.abs(counts[pattern] / total - PATTERN_WEIGHTS[pattern])).toBeLessThan(0.05)
    }
  })

  it('UC-5d: 候補は車が 300 m 手前に来たときに決まる（それより遠い・決めたものは返さない）', () => {
    const candidates = createCandidates(plan, 7)
    const c = candidates[0]
    if (!c) throw new Error('候補がない')
    expect(candidatesToDecide(candidates, new Set(), c.s - DECIDE_AHEAD_M - 1)).not.toContain(c)
    expect(candidatesToDecide(candidates, new Set(), c.s - DECIDE_AHEAD_M)).toContain(c)
    expect(candidatesToDecide(candidates, new Set([c.id]), c.s - 100)).not.toContain(c)
  })
})
