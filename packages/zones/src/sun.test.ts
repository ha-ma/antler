import { describe, expect, it } from 'vitest'
import { lightPeriod, sunAltitude } from './sun'

const KUSHIRO = { lat: 42.985, lon: 144.381 }
const SAPPORO = { lat: 43.062, lon: 141.354 }

describe('UC-5 光の区分（太陽の高さで決める）', () => {
  it('UC-5a: 釧路 2027-02-15 12:00 → day、21:00 → night', () => {
    expect(lightPeriod('2027-02-15T12:00:00+09:00', KUSHIRO)).toBe('day')
    expect(lightPeriod('2027-02-15T21:00:00+09:00', KUSHIRO)).toBe('night')
  })

  it('UC-5b: 釧路 2026-11-16 15:45 → dusk、06:00 → dawn、2026-10-20 17:30 → night', () => {
    expect(lightPeriod('2026-11-16T15:45:00+09:00', KUSHIRO)).toBe('dusk')
    expect(lightPeriod('2026-11-16T06:00:00+09:00', KUSHIRO)).toBe('dawn')
    expect(lightPeriod('2026-10-20T17:30:00+09:00', KUSHIRO)).toBe('night')
  })

  it('UC-5c: 太陽の高さが参照値（astropy、大気差なし）と 0.5° 以内', () => {
    const cases: [string, { lat: number; lon: number }, number][] = [
      ['2027-02-15T12:00:00+09:00', KUSHIRO, 33.97],
      ['2027-02-15T16:30:00+09:00', KUSHIRO, 3.11],
      ['2026-07-15T12:00:00+09:00', KUSHIRO, 67.56],
      ['2026-11-16T15:45:00+09:00', SAPPORO, 3.28],
    ]
    for (const [at, where, expected] of cases) {
      expect(Math.abs(sunAltitude(at, where) - expected), at).toBeLessThan(0.5)
    }
  })

  it('UC-5d: 同じ瞬間を +09:00 と Z で渡しても同じ結果（端末のタイムゾーンに左右されない）', () => {
    expect(lightPeriod('2026-11-16T06:45:00.000Z', KUSHIRO)).toBe(
      lightPeriod('2026-11-16T15:45:00+09:00', KUSHIRO),
    )
    expect(sunAltitude(Date.parse('2026-11-16T06:45:00Z'), KUSHIRO)).toBeCloseTo(
      sunAltitude('2026-11-16T15:45:00+09:00', KUSHIRO),
      6,
    )
  })

  it('UC-5e: [ADDED code-reviewer] 読めない日時は例外（NaN を黙って dusk にしない）', () => {
    expect(() => lightPeriod('2026-11-16 15:45', KUSHIRO)).toThrow(RangeError)
    expect(() => lightPeriod(Number.NaN, KUSHIRO)).toThrow(RangeError)
    expect(() => lightPeriod(new Date('x'), KUSHIRO)).toThrow(RangeError)
  })
})
