import { describe, expect, it } from 'vitest'
import { boundsOf, fitProjection } from './projection'

// 背景なしのときの投影（docs/specs/brief-map/functional.md R9、UC-9d）

describe('fitProjection', () => {
  const line: [number, number][] = [
    [141.69, 42.78],
    [143.2, 42.92],
    [144.38, 42.98],
  ]

  it('UC-9d: ルートの範囲を枠（余白つき）に収め、北が上・東が右', () => {
    const project = fitProjection(boundsOf([line]), { width: 800, height: 480 }, 40)
    for (const p of line) {
      const [x, y] = project(p)
      expect(x).toBeGreaterThanOrEqual(40 - 1e-6)
      expect(x).toBeLessThanOrEqual(760 + 1e-6)
      expect(y).toBeGreaterThanOrEqual(40 - 1e-6)
      expect(y).toBeLessThanOrEqual(440 + 1e-6)
    }
    const [west] = project([141.69, 42.78])
    const [east] = project([144.38, 42.98])
    expect(east).toBeGreaterThan(west)
    const [, south] = project([143, 42.0])
    const [, north] = project([143, 43.5])
    expect(north).toBeLessThan(south)
  })

  it('UC-9d: 縦横の縮尺は同じ（形がゆがまない）', () => {
    const project = fitProjection(boundsOf([line]), { width: 800, height: 480 }, 40)
    const [x0, y0] = project([143, 43])
    const [x1] = project([143.01, 43])
    const [, y1] = project([143, 43.01])
    // メルカトルでは緯度 1 度の長さは経度 1 度の 1 / cos(緯度) 倍
    expect(Math.abs(y1 - y0) / Math.abs(x1 - x0)).toBeCloseTo(1 / Math.cos((43 * Math.PI) / 180), 2)
  })

  it('1 点だけ（移動の無い日）でも枠の中央に置く', () => {
    const project = fitProjection(boundsOf([[[144.38, 42.98]]]), { width: 800, height: 480 }, 40)
    const [x, y] = project([144.38, 42.98])
    expect(x).toBeCloseTo(400, 3)
    expect(y).toBeCloseTo(240, 3)
  })
})
