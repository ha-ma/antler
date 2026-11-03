import { metersBetween, polylineLengthM, type LonLat } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { pointAtKm } from './day-plan'
import { sliceByKm } from './slice'

// ゾーンの帯を描くために、移動のルートを道のりで切る（functional.md R9）

const line: LonLat[] = [
  [144, 43],
  [144.01, 43],
  [144.02, 43],
  [144.03, 43],
]
const totalKm = polylineLengthM(line) / 1000

describe('sliceByKm と pointAtKm', () => {
  it('両端は pointAtKm の点で、途中の頂点を含む', () => {
    const part = sliceByKm(line, 0.5, totalKm - 0.5)
    expect(metersBetween(part[0] as LonLat, pointAtKm(line, 0.5))).toBeLessThan(0.01)
    expect(part.slice(1, -1)).toEqual([line[1], line[2]])
    expect(polylineLengthM(part) / 1000).toBeCloseTo(totalKm - 1, 3)
  })

  it('同じ線分の中なら 2 点、範囲を越えたら端で止まる', () => {
    expect(sliceByKm(line, 0.1, 0.2)).toHaveLength(2)
    expect(sliceByKm(line, -1, totalKm + 5).length).toBe(line.length)
    expect(pointAtKm(line, totalKm + 5)).toEqual(line[3])
    expect(pointAtKm([], 1)).toEqual([0, 0])
  })
})
