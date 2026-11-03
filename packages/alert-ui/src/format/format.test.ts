import { describe, expect, it } from 'vitest'
import { formatKm, formatM } from './format'

describe('UC-12 数値の表示', () => {
  it('UC-12a: km は 10 未満で小数 1 桁、10 以上で整数、0 は「0.0」、無しは「--」', () => {
    expect(formatKm(9.44)).toBe('9.4')
    expect(formatKm(9.96)).toBe('10')
    expect(formatKm(10)).toBe('10')
    expect(formatKm(14.2)).toBe('14')
    expect(formatKm(38.6)).toBe('39')
    expect(formatKm(0)).toBe('0.0')
    expect(formatKm(undefined)).toBe('--')
    expect(formatKm(null)).toBe('--')
    expect(formatKm(-1)).toBe('--')
    expect(formatKm(Number.NaN)).toBe('--')
  })

  it('UC-12b: m は整数、0 は「0」、負・NaN・無しは「--」', () => {
    expect(formatM(58.4)).toBe('58')
    expect(formatM(0)).toBe('0')
    expect(formatM(-3)).toBe('--')
    expect(formatM(Number.NaN)).toBe('--')
    expect(formatM(Number.POSITIVE_INFINITY)).toBe('--')
    expect(formatM(undefined)).toBe('--')
  })
})
