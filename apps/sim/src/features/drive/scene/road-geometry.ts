import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import type { Surface } from '../types'
import { poseAt, type RoadFrame } from '../domain/road'
import {
  BANK_HEIGHT_M,
  BANK_OUT_M,
  BANK_TOP_M,
  LANE_EDGE_M,
  ROAD_CHUNK_M,
  ROAD_SAMPLE_M,
  SHOULDER_EDGE_M,
} from './layout'
import { TERRAIN } from './palette'

// 道路のリボン（R12: 区間ごとに 1 つのメッシュ＝1 描画コール）。ルートの (s, d) に沿って横断面を刻む。
// 左側通行なので、左車線を走る車から中心線（黄）が右手すぐに見える。
// 頂点は区間の始点を原点にした相対座標（遠くでも float32 の精度を保つ）。

type Strip = { d0: number; d1: number; y0: number; y1: number; color: string }

const MARK_W = 0.15
const MARK_Y = 0.012

const ROAD_COLOR: Record<Surface, string> = {
  dry: TERRAIN.roadDry,
  wet: TERRAIN.roadWet,
  'packed-snow': TERRAIN.road,
  ice: TERRAIN.roadIce,
}

function strips(surface: Surface): Strip[] {
  const side = (sign: 1 | -1): Strip[] => {
    const at = (a: number) => sign * a
    const s = (a0: number, a1: number, y0: number, y1: number, color: string): Strip =>
      sign > 0
        ? { d0: at(a0), d1: at(a1), y0, y1, color }
        : { d0: at(a1), d1: at(a0), y0: y1, y1: y0, color }
    return [
      s(LANE_EDGE_M, SHOULDER_EDGE_M, 0, 0, TERRAIN.shoulder),
      s(SHOULDER_EDGE_M, BANK_TOP_M, 0, BANK_HEIGHT_M, TERRAIN.snowBank),
      s(BANK_TOP_M, BANK_OUT_M, BANK_HEIGHT_M, 0, TERRAIN.snowBank),
      // 外側線（白）
      s(LANE_EDGE_M - MARK_W, LANE_EDGE_M, MARK_Y, MARK_Y, TERRAIN.edgeLine),
    ]
  }
  return [
    { d0: -LANE_EDGE_M, d1: LANE_EDGE_M, y0: 0, y1: 0, color: ROAD_COLOR[surface] },
    // 中央線（黄。はみ出し禁止）
    { d0: -MARK_W / 2, d1: MARK_W / 2, y0: MARK_Y, y1: MARK_Y, color: TERRAIN.centerLine },
    ...side(-1),
    ...side(1),
  ]
}

export type RoadChunk = {
  index: number
  s0: number
  s1: number
  /** 頂点の原点（平面、m） */
  origin: [number, number]
  geometry: BufferGeometry
}

/** 区間 index の道路の形を作る */
export function buildRoadChunk(frame: RoadFrame, index: number, surface: Surface): RoadChunk {
  const s0 = index * ROAD_CHUNK_M
  const s1 = Math.min(frame.lengthM, s0 + ROAD_CHUNK_M)
  const start = poseAt(frame, s0)
  const origin: [number, number] = [start.x, start.z]
  const rows: number[] = []
  for (let s = s0; s < s1; s += ROAD_SAMPLE_M) rows.push(s)
  rows.push(s1)
  const poses = rows.map((s) => poseAt(frame, s))
  const list = strips(surface)

  const positions: number[] = []
  const colors: number[] = []
  const color = new Color()
  for (const strip of list) {
    color.set(strip.color)
    for (let i = 0; i + 1 < poses.length; i++) {
      const a = poses[i]
      const b = poses[i + 1]
      if (!a || !b) continue
      // 左右の端（d0 が左、d1 が右）。上から見て反時計回りの三角形にする（面の表が上）
      const aL = [
        a.x + a.right[0] * strip.d0 - origin[0],
        strip.y0,
        a.z + a.right[1] * strip.d0 - origin[1],
      ]
      const aR = [
        a.x + a.right[0] * strip.d1 - origin[0],
        strip.y1,
        a.z + a.right[1] * strip.d1 - origin[1],
      ]
      const bL = [
        b.x + b.right[0] * strip.d0 - origin[0],
        strip.y0,
        b.z + b.right[1] * strip.d0 - origin[1],
      ]
      const bR = [
        b.x + b.right[0] * strip.d1 - origin[0],
        strip.y1,
        b.z + b.right[1] * strip.d1 - origin[1],
      ]
      for (const v of [aL, aR, bL, bL, aR, bR]) {
        positions.push(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0)
        colors.push(color.r, color.g, color.b)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return { index, s0, s1, origin, geometry }
}

/** ルート全体の区間の数 */
export function chunkCount(frame: RoadFrame): number {
  return Math.max(1, Math.ceil(frame.lengthM / ROAD_CHUNK_M))
}
