import { describe, expect, it } from 'vitest'
import { distanceToPolyline, type LonLat } from '@antler/zones'
import { decodePolyline, encodePolyline, simplify } from './polyline'

// docs/specs/brief-map/functional.md R1（UC-1a・UC-1f）

describe('encoded polyline（精度 5）', () => {
  it('UC-1a: encode して decode すると、小数 5 桁に丸めた元の点に戻る', () => {
    const line: LonLat[] = [
      [141.69234, 42.77521],
      [141.70001, 42.78012],
      [144.38143, 42.98491],
    ]
    expect(decodePolyline(encodePolyline(line))).toEqual(line)
  })

  it('UC-1a: Google の見本の文字列を読める（緯度・経度の順で入っている）', () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm の例
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })

  it('UC-1a: 空の線は空の文字列', () => {
    expect(encodePolyline([])).toBe('')
    expect(decodePolyline('')).toEqual([])
  })
})

describe('simplify（Douglas–Peucker、メートル）', () => {
  it('UC-1f: 端点を残し、一直線の中の点を落とす', () => {
    const line: LonLat[] = [
      [144, 43],
      [144.001, 43],
      [144.002, 43],
      [144.003, 43],
    ]
    expect(simplify(line, 15)).toEqual([
      [144, 43],
      [144.003, 43],
    ])
  })

  it('UC-1f: 許容を超えて曲がる点は残し、間引いた線から元の点までは許容以内', () => {
    // 約 1 km 東へ、途中で 50 m 北にふくらむ
    const line: LonLat[] = Array.from({ length: 41 }, (_, i) => {
      const t = i / 40
      return [144 + 0.012 * t, 43 + 0.00045 * Math.sin(Math.PI * t)] as LonLat
    })
    const out = simplify(line, 15)
    expect(out[0]).toEqual(line[0])
    expect(out[out.length - 1]).toEqual(line[line.length - 1])
    expect(out.length).toBeGreaterThan(2)
    expect(out.length).toBeLessThan(line.length)
    for (const p of line) expect(distanceToPolyline(p, out).distanceM).toBeLessThanOrEqual(15.5)
  })

  it('UC-1f: 2 点以下はそのまま', () => {
    const two: LonLat[] = [
      [144, 43],
      [145, 44],
    ]
    expect(simplify(two, 15)).toEqual(two)
  })
})
