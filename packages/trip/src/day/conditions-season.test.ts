import { describe, expect, it } from 'vitest'
import { dayConditions, type Weather } from './conditions'
import { DayConditionsSchema } from './schema'

// docs/specs/drive-season/functional.md R1（UC-1a〜UC-1e）。当日の条件 v2（雨を足した月ごとの表）

const persona = { size: 4, drivers: 2 }
const of = (seed: number, day: number, month: number, weather?: Weather) =>
  dayConditions({ seed, day, month, departMonth: month, party: persona, weather })

const seeds = Array.from({ length: 200 }, (_, i) => (i + 1) * 7919)
const all = (month: number) => seeds.map((seed) => of(seed, 1, month))

describe('当日の条件 v2（drive-season R1）', () => {
  it('UC-1a: 版は 2。同じ種・日・月なら同じ条件。2 月は v1 と同じ（見本の種・2 日目は晴れ・凍結）', () => {
    expect(of(918273, 2, 7)).toEqual(of(918273, 2, 7))
    expect(of(918273, 2, 2)).toMatchObject({ version: 2, weather: 'clear', surface: 'ice' })
  })

  it('UC-1a: 冬（12〜3 月）は 200 シード × 1〜5 日で v1 と同じ条件（v1 の実装で作った指紋と照らす）', () => {
    // 指紋は cff9f43（v1）の conditions.ts で同じ式を回した値（docs/reports/2026-11-06-spec-adversary-drive-season.md M4）
    const text: string[] = []
    for (let seed = 1; seed <= 200; seed++)
      for (const month of [12, 1, 2, 3])
        for (let day = 1; day <= 5; day++) {
          const { version, ...rest } = dayConditions({
            seed: seed * 7919,
            day,
            month,
            departMonth: month,
            party: persona,
          })
          expect(version).toBe(2)
          text.push(JSON.stringify(rest))
        }
    const joined = text.join('\n')
    let h = 0x811c9dc5
    for (let i = 0; i < joined.length; i++) {
      h ^= joined.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    expect(text).toHaveLength(4000)
    expect(h.toString(16)).toBe('7f9b0c8d')
  })

  it('UC-1f: 雨の日の条件が DayConditionsSchema を通る（A-2・drive・A-6 の safeParse で落ちない）', () => {
    const rainy = all(7).find((c) => c.weather === 'rain')
    expect(rainy).toBeDefined()
    expect(DayConditionsSchema.safeParse(rainy).success).toBe(true)
  })

  it('UC-1b: 雨の日に乾燥は出ない。12〜3 月に雨・濡れは出ない。5〜10 月に雪・圧雪・凍結は出ない', () => {
    for (let month = 1; month <= 12; month++) {
      for (const c of all(month)) {
        if (c.weather === 'rain') expect(c.surface, `${month} 月`).not.toBe('dry')
        if (month === 12 || month <= 3) {
          expect(c.weather, `${month} 月`).not.toBe('rain')
          expect(c.surface, `${month} 月`).not.toBe('wet')
        }
        if (month >= 5 && month <= 10) {
          expect(c.weather, `${month} 月`).not.toBe('snow')
          expect(['packed-snow', 'ice'], `${month} 月`).not.toContain(c.surface)
        }
      }
    }
  })

  it('UC-1c: 4・11 月は雨・雪・凍結のどれも出る。7・8 月は雨と霧が出て、乾燥が最多の路面', () => {
    for (const month of [4, 11]) {
      const list = all(month)
      expect(list.some((c) => c.weather === 'rain')).toBe(true)
      expect(list.some((c) => c.weather === 'snow')).toBe(true)
      expect(list.some((c) => c.surface === 'ice')).toBe(true)
    }
    for (const month of [7, 8]) {
      const list = all(month)
      expect(list.some((c) => c.weather === 'rain')).toBe(true)
      expect(list.some((c) => c.weather === 'fog')).toBe(true)
      const dry = list.filter((c) => c.surface === 'dry').length
      expect(dry).toBeGreaterThan(list.length / 2)
    }
  })

  it('UC-1d: 雨の日は窓の曇りが 1 段上がる（4 人は light → medium）', () => {
    const rainy = all(7).find((c) => c.weather === 'rain')
    const clear = all(7).find((c) => c.weather === 'clear')
    expect(rainy?.windowFog).toBe('medium')
    expect(clear?.windowFog).toBe('light')
  })

  it('UC-1e: 天候の指定: その月にあれば指定どおり、無い天候（8 月の雪）は無視。運転者・車は指定なしと同じ', () => {
    for (const seed of seeds.slice(0, 50)) {
      const free = of(seed, 2, 7)
      const rain = of(seed, 2, 7, 'rain')
      expect(rain.weather).toBe('rain')
      expect(rain.surface).toBe('wet')
      expect({ driver: rain.driver, vehicle: rain.vehicle, fourWd: rain.fourWd }).toEqual({
        driver: free.driver,
        vehicle: free.vehicle,
        fourWd: free.fourWd,
      })
      expect(of(seed, 2, 8, 'snow')).toEqual(of(seed, 2, 8))
      expect(of(seed, 2, 2, 'snow').surface).not.toBe('dry')
    }
  })
})
