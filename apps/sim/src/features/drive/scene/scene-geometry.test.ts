import { describe, expect, it } from 'vitest'
import { createRoadFrame, poseAt } from '../domain/road'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { createDeerAssets } from './deer-models'
import {
  BANK_HEIGHT_M,
  DRAW_AHEAD_M,
  DRAW_BEHIND_M,
  ROAD_CHUNK_M,
  deerPlacement,
  terrainHeight,
  visibleChunks,
} from './layout'
import { buildRoadChunk, chunkCount } from './road-geometry'
import { scatterChunk } from './scatter'
import { FOREST_CAPACITY } from './Forest'
import * as palette from './palette'

const frame = createRoadFrame(demoScenario(ZONES).route)

describe('シーンの形（R12・R13）', () => {
  it('R12: 描くのは車の前後の区間だけ（最大 3 区間）', () => {
    const [a, b] = visibleChunks(10_000, frame.lengthM)
    expect(a * ROAD_CHUNK_M).toBeLessThanOrEqual(10_000 - DRAW_BEHIND_M)
    expect((b + 1) * ROAD_CHUNK_M).toBeGreaterThanOrEqual(10_000 + DRAW_AHEAD_M)
    expect(b - a + 1).toBeLessThanOrEqual(3)
    const [, last] = visibleChunks(frame.lengthM, frame.lengthM)
    expect(last).toBe(chunkCount(frame) - 1)
  })

  it('R12: 道路の区間は始点を原点にした相対座標で、隣の区間とつながる', () => {
    const c0 = buildRoadChunk(frame, 3, 'packed-snow')
    const c1 = buildRoadChunk(frame, 4, 'packed-snow')
    expect(c0.s1).toBe(c1.s0)
    const end = poseAt(frame, c0.s1)
    expect(Math.hypot(end.x - c1.origin[0], end.z - c1.origin[1])).toBeLessThan(1e-6)
    const pos = c0.geometry.getAttribute('position')
    // 区間の大きさ（400 m）＋横幅の中に収まる
    let far = 0
    for (let i = 0; i < pos.count; i++) far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)))
    expect(far).toBeLessThan(ROAD_CHUNK_M + 20)
    expect(c0.geometry.getAttribute('color').count).toBe(pos.count)
  })

  it('R13: 林は同じシード・同じ区間なら同じ、シードが違えば違う。道の上に木を立てない。上限に収まる', () => {
    const a = scatterChunk(frame, 10, 918273)
    expect(scatterChunk(frame, 10, 918273)).toEqual(a)
    expect(scatterChunk(frame, 10, 1)).not.toEqual(a)
    const trees = [...a.conifer, ...a.bare, ...a.birch]
    expect(trees.length).toBeGreaterThan(50)
    for (const kind of ['conifer', 'bare', 'birch', 'arrow'] as const) {
      expect(a[kind].length * 3).toBeLessThanOrEqual(FOREST_CAPACITY[kind])
    }
  })

  it('UC-5e: 鹿は雪の壁の上では足が沈まない高さに置き、向きは道の向きから heading だけ右へ', () => {
    expect(terrainHeight(-1.75)).toBe(0)
    expect(terrainHeight(6)).toBeCloseTo(BANK_HEIGHT_M, 6)
    expect(terrainHeight(-12)).toBe(0)
    const s = 3000
    const road = poseAt(frame, s)
    const p = deerPlacement(frame, { s, d: 0, heading: Math.PI / 2 })
    // 右を向く = three.js の yaw が道の yaw より 90° 小さい（rotation.y は左回りが正）
    expect(p.yaw).toBeCloseTo(road.yaw - Math.PI / 2, 9)
  })

  it('UC-5e: 鹿の大きさ: 肩高 約 1 m、体長 約 1.6 m（鼻先から尾。首を前に出した形で）', () => {
    const assets = createDeerAssets()
    assets.body.computeBoundingBox()
    const box = assets.body.boundingBox
    expect(box?.max.y).toBeGreaterThan(0.95)
    expect(box?.max.y).toBeLessThan(1.1)
    const width = (box?.max.x ?? 0) - (box?.min.x ?? 0)
    expect(width).toBeLessThanOrEqual(0.5)
  })

  it('配色: alert-danger の赤はシーンの配色に無い', () => {
    const all = JSON.stringify(palette).toLowerCase()
    expect(all).not.toContain('d83b1e')
    expect(all).not.toContain('e2492c')
  })
})
