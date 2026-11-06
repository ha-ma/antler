import { planRoute } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import type { DeerMotion } from '../types'
import {
  candidatesToDecide,
  createCandidates,
  DECIDE_AHEAD_M,
  encounterCount,
  MAX_ENCOUNTERS,
  MIN_ENCOUNTERS,
  MOTION_PATTERN,
  MOTION_WEIGHTS,
  NEAR_MOTIONS,
} from './deer-spawn'
import { demoScenario } from './scenario'
import { ZONES } from './zones-data'

const scenario = demoScenario(ZONES)
const plan = planRoute(scenario.route, ZONES)

function intervals(list: [number, number][]) {
  return { intervals: list.map(([entryKm, exitKm]) => ({ entryKm, exitKm })) }
}

const meet = (c: { motion: DeerMotion }) => c.motion !== 'eyeshine'

describe('鹿の出現（drive-3d R5、drive-deer R1）', () => {
  it('UC-5a: 同じシードなら同じ候補、違うシードなら違う。候補はすべて区間の中', () => {
    const a = createCandidates(plan, 918273)
    expect(createCandidates(plan, 918273)).toEqual(a)
    expect(createCandidates(plan, 1)).not.toEqual(a)
    for (const c of a) {
      const v = plan.intervals[c.interval]
      expect(v).toBeDefined()
      expect(c.s / 1000).toBeGreaterThanOrEqual(v?.entryKm ?? Infinity)
      expect(c.s / 1000).toBeLessThanOrEqual(v?.exitKm ?? -Infinity)
    }
  })

  it('UC-5c: 200 のシードで 12 種の動きがすべて出る。記録の語は動きから、群れは 2〜5 頭、follower は 2 頭', () => {
    const seen = new Set<DeerMotion>()
    for (let seed = 0; seed < 200; seed++) {
      for (const c of createCandidates(plan, seed)) {
        seen.add(c.motion)
        expect(c.pattern).toBe(MOTION_PATTERN[c.motion])
        if (c.motion === 'herd') {
          expect(c.herdSize).toBeGreaterThanOrEqual(2)
          expect(c.herdSize).toBeLessThanOrEqual(5)
        } else {
          expect(c.herdSize).toBe(c.motion === 'follower' ? 2 : 1)
        }
      }
    }
    expect([...seen].sort()).toEqual(
      [...Object.keys(MOTION_WEIGHTS), 'eyeshine'].sort() as DeerMotion[],
    )
  })

  it('UC-5d: 候補は車が 300 m 手前に来たときに鹿を置く（それより遠い・置いたものは返さない）', () => {
    const candidates = createCandidates(plan, 7)
    const c = candidates[0]
    if (!c) throw new Error('候補がない')
    expect(candidatesToDecide(candidates, new Set(), c.s - DECIDE_AHEAD_M - 1)).not.toContain(c)
    expect(candidatesToDecide(candidates, new Set(), c.s - DECIDE_AHEAD_M)).toContain(c)
    expect(candidatesToDecide(candidates, new Set([c.id]), c.s - 100)).not.toContain(c)
  })
})

describe('回数（drive-deer R1）', () => {
  it('UC-1a: 区間ごとの遭遇（目の反射を除く）は 3〜8 回（種 200 通り。見本・8 km・0.3 km の区間）', () => {
    const plans = [plan, intervals([[10, 18]]), intervals([[10, 10.3]])]
    for (const p of plans) {
      for (let seed = 0; seed < 200; seed++) {
        const all = createCandidates(p, seed, () => (seed % 11) / 10)
        p.intervals.forEach((v, i) => {
          const inInterval = all.filter((c) => c.interval === i)
          const n = inInterval.filter(meet).length
          expect(n).toBeGreaterThanOrEqual(MIN_ENCOUNTERS)
          expect(n).toBeLessThanOrEqual(MAX_ENCOUNTERS)
          for (const c of inInterval) {
            expect(c.s).toBeGreaterThanOrEqual(v.entryKm * 1000)
            expect(c.s).toBeLessThanOrEqual(v.exitKm * 1000)
          }
        })
      }
    }
  })

  it('UC-1b: 危険度が高いほど回数が多い（0.1 で 3〜6、0.8 で 5〜8、平均も 0.1 < 0.8）', () => {
    const p = intervals([[10, 18]])
    const count = (risk: number, seed: number) =>
      createCandidates(p, seed, () => risk).filter(meet).length
    let low = 0
    let high = 0
    for (let seed = 0; seed < 200; seed++) {
      const a = count(0.1, seed)
      const b = count(0.8, seed)
      expect(a).toBeGreaterThanOrEqual(3)
      expect(a).toBeLessThanOrEqual(6)
      expect(b).toBeGreaterThanOrEqual(5)
      expect(b).toBeLessThanOrEqual(8)
      low += a
      high += b
    }
    expect(low).toBeLessThan(high)
    expect(encounterCount(0, 0)).toBe(3)
    expect(encounterCount(1, 1)).toBe(8)
  })

  it('UC-1c: 1 区間の動きは重ならず、dart か graze-dash が少なくとも 1 つ。目の反射は 0〜2 頭で回数に入らない', () => {
    for (let seed = 0; seed < 200; seed++) {
      const all = createCandidates(plan, seed)
      plan.intervals.forEach((_, i) => {
        const inInterval = all.filter((c) => c.interval === i)
        const motions = inInterval.filter(meet).map((c) => c.motion)
        expect(new Set(motions).size).toBe(motions.length)
        expect(motions.some((m) => NEAR_MOTIONS.includes(m))).toBe(true)
        const eyes = inInterval.filter((c) => c.motion === 'eyeshine').length
        expect(eyes).toBeGreaterThanOrEqual(0)
        expect(eyes).toBeLessThanOrEqual(2)
      })
    }
  })

  it('UC-1d: 同じ種なら同じ候補（位置・動き・左右）、種が違えば違う', () => {
    const a = createCandidates(plan, 42, () => 0.4)
    expect(createCandidates(plan, 42, () => 0.4)).toEqual(a)
    const b = createCandidates(plan, 43, () => 0.4)
    expect(b.map((c) => [c.s, c.motion, c.side])).not.toEqual(a.map((c) => [c.s, c.motion, c.side]))
  })
})
