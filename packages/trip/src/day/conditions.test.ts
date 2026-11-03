import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONDITIONS_VERSION, dayConditions, type DayConditions } from './conditions'

// docs/specs/brief-map/functional.md R4（UC-4a〜UC-4e）

const persona = { size: 4, drivers: 2 }
const of = (seed: number, day: number, month: number, party = persona, departMonth = month) =>
  dayConditions({ seed, day, month, departMonth, party })

function count<K extends keyof DayConditions>(month: number, key: K) {
  const counts = new Map<DayConditions[K], number>()
  for (let seed = 1; seed <= 200; seed++) {
    const value = of(seed * 7919, 1, month)[key]
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

const most = <T>(counts: Map<T, number>): T =>
  [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as T

describe('dayConditions（当日の条件）', () => {
  it('UC-4a: 同じシード・同じ日なら同じ条件、版は 1', () => {
    expect(of(918273, 2, 2)).toEqual(of(918273, 2, 2))
    expect(of(918273, 2, 2).version).toBe(CONDITIONS_VERSION)
    expect(CONDITIONS_VERSION).toBe(1)
  })

  it('UC-4a: 日が違えば別の乱数の列（200 シードで、どこかの欄が違う日がある）', () => {
    const differs = Array.from({ length: 200 }, (_, i) => i + 1).filter(
      (seed) => JSON.stringify(of(seed, 1, 2)) !== JSON.stringify(of(seed, 2, 2)),
    )
    expect(differs.length).toBeGreaterThan(100)
  })

  it('UC-4b: 車種は人数で決まり、11〜4 月は 4WD', () => {
    expect(of(1, 1, 2, { size: 2, drivers: 1 }).vehicle).toBe('compact')
    expect(of(1, 1, 2, { size: 3, drivers: 1 }).vehicle).toBe('compact-suv')
    expect(of(1, 1, 2, { size: 5, drivers: 1 }).vehicle).toBe('compact-suv')
    expect(of(1, 1, 2, { size: 6, drivers: 1 }).vehicle).toBe('minivan')
    expect(of(1, 1, 2).fourWd).toBe(true)
    expect(of(1, 1, 11).fourWd).toBe(true)
    expect(of(1, 1, 4).fourWd).toBe(true)
    expect(of(1, 1, 5).fourWd).toBe(false)
    expect(of(1, 1, 10).fourWd).toBe(false)
  })

  it('UC-4b: 10/31 に出る旅は 11 月の日も 4WD でない（車は旅全体で 1 台）', () => {
    expect(of(1, 2, 11, persona, 10)).toMatchObject({ fourWd: false, vehicle: 'compact-suv' })
    expect(of(1, 1, 10, persona, 10).fourWd).toBe(false)
  })

  it('UC-4f: 雪の日に路面 dry は出ない（どの月も 200 シード）', () => {
    for (const month of [1, 2, 3, 4, 11, 12]) {
      for (let seed = 1; seed <= 200; seed++) {
        const c = of(seed, 1, month)
        if (c.weather === 'snow') expect(c.surface).not.toBe('dry')
      }
    }
  })

  it('UC-4c: 窓の曇りは人数の段で、雪か霧の日は 1 段上（上限 heavy）。車内の人数は party.size', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const [size, base] of [
        [1, 0],
        [2, 0],
        [4, 1],
        [6, 2],
        [8, 3],
      ] as const) {
        const c = of(seed, 1, 2, { size, drivers: 1 })
        const bump = c.weather === 'snow' || c.weather === 'fog' ? 1 : 0
        const levels = ['none', 'light', 'medium', 'heavy'] as const
        expect(c.windowFog).toBe(levels[Math.min(3, base + bump)])
        expect(c.occupants).toBe(size)
      }
    }
  })

  it('UC-4c: ペルソナ（4 人・2 月）の雪の日は medium', () => {
    const snowy = Array.from({ length: 200 }, (_, i) => of(i + 1, 1, 2)).find(
      (c) => c.weather === 'snow',
    )
    expect(snowy?.windowFog).toBe('medium')
  })

  it('UC-4d: 2 月は snow が最多の天候・packed-snow が最多の路面。8 月は snow・ice が出ない', () => {
    expect(most(count(2, 'weather'))).toBe('snow')
    expect(most(count(2, 'surface'))).toBe('packed-snow')
    expect(count(8, 'weather').has('snow')).toBe(false)
    expect(count(8, 'surface').has('ice')).toBe(false)
    expect(count(8, 'weather').has('fog')).toBe(true)
  })

  it('UC-4e: 運転者は 1〜drivers（1 人なら常に 1）', () => {
    const drivers = new Set(Array.from({ length: 200 }, (_, i) => of(i + 1, 1, 2).driver))
    expect([...drivers].sort()).toEqual([1, 2])
    expect(of(5, 1, 2, { size: 1, drivers: 1 })).toMatchObject({ driver: 1, drivers: 1 })
  })

  it('UC-4e: day/ のソースに Math.random が無い', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.includes('.test.')))
      expect(readFileSync(path.join(dir, name), 'utf8'), name).not.toContain('Math.random')
  })
})
