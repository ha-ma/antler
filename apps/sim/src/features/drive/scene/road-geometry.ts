import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import type { Surface } from '../types'
import type { SceneSeason } from '../domain/season'
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
import { SEASON, SURFACE, TERRAIN } from './palette'
import { mix } from './mesh-utils'

// 道路のリボン（R12: 区間ごとに 1 つのメッシュ＝1 描画コール）。ルートの (s, d) に沿って横断面を刻む。
// 左側通行なので、左車線を走る車から中心線（黄）が右手すぐに見える。
// 頂点は区間の始点を原点にした相対座標（遠くでも float32 の精度を保つ）。
// 色は路面（車道・轍・線のかすれ）と景色の季節（路肩・法面）で決める（drive-season R3・UC-3b・UC-3c）。

export type StripKind = 'road' | 'rut' | 'line' | 'shoulder' | 'bank'
/** 横断面の 1 本の帯。d0 < d1（左 → 右）、y は左右の端の高さ */
export type Strip = {
  kind: StripKind
  d0: number
  d1: number
  y0: number
  y1: number
  color: string
}

const MARK_W = 0.15
const MARK_Y = 0.012
/**
 * 圧雪の轍（車輪の通る所）。車線の中心 |d| = 1.75 から輪距 1.5 m の半分ずつ外と内 → |d| = 1.0 と 2.5。
 * 車道の幅を分けて作る（重ねると遠くでちらつく）
 */
export const RUT_CENTERS_M = [1.0, 2.5] as const
export const RUT_W_M = 0.4

/** 線の色を路面の色へ fade だけ寄せる（圧雪・凍結で線がかすれる） */
function fadedLine(line: string, road: string, fade: number): string {
  return `#${mix(line, road, fade).getHexString()}`
}

/** 車道の帯（中心線から右へ 0 → LANE_EDGE_M）。轍のある路面は轍の所で分ける */
function carriageway(surface: Surface): { d0: number; d1: number; kind: 'road' | 'rut' }[] {
  const look = SURFACE[surface]
  if (!look.rut) return [{ d0: 0, d1: LANE_EDGE_M, kind: 'road' }]
  const out: { d0: number; d1: number; kind: 'road' | 'rut' }[] = []
  let at = 0
  for (const c of RUT_CENTERS_M) {
    out.push({ d0: at, d1: c - RUT_W_M / 2, kind: 'road' })
    out.push({ d0: c - RUT_W_M / 2, d1: c + RUT_W_M / 2, kind: 'rut' })
    at = c + RUT_W_M / 2
  }
  out.push({ d0: at, d1: LANE_EDGE_M, kind: 'road' })
  return out
}

/** 道路の横断面（左右対称。路面と景色の季節で色が決まる。形と高さは季節・路面で変えない） */
export function roadCrossSection(surface: Surface, season: SceneSeason): Strip[] {
  const road = SURFACE[surface]
  const scene = SEASON[season]
  const edge = fadedLine(TERRAIN.edgeLine, road.road, road.lineFade)
  const center = fadedLine(TERRAIN.centerLine, road.road, road.lineFade)
  const half: Strip[] = [
    ...carriageway(surface).map(({ d0, d1, kind }) => ({
      kind,
      d0,
      d1,
      y0: 0,
      y1: 0,
      color: kind === 'rut' ? (road.rut ?? road.road) : road.road,
    })),
    { kind: 'shoulder', d0: LANE_EDGE_M, d1: SHOULDER_EDGE_M, y0: 0, y1: 0, color: scene.shoulder },
    {
      kind: 'bank',
      d0: SHOULDER_EDGE_M,
      d1: BANK_TOP_M,
      y0: 0,
      y1: BANK_HEIGHT_M,
      color: scene.bank,
    },
    { kind: 'bank', d0: BANK_TOP_M, d1: BANK_OUT_M, y0: BANK_HEIGHT_M, y1: 0, color: scene.bank },
    // 外側線（白）
    {
      kind: 'line',
      d0: LANE_EDGE_M - MARK_W,
      d1: LANE_EDGE_M,
      y0: MARK_Y,
      y1: MARK_Y,
      color: edge,
    },
  ]
  // 左の半分は右の半分を中心線で折り返す（端の高さも入れ替える）
  const left = half.map((s) => ({ ...s, d0: -s.d1, d1: -s.d0, y0: s.y1, y1: s.y0 }))
  return [
    ...half,
    ...left,
    // 中央線（黄。はみ出し禁止）
    { kind: 'line', d0: -MARK_W / 2, d1: MARK_W / 2, y0: MARK_Y, y1: MARK_Y, color: center },
  ]
}

/** 車道の材質のパラメータ（MeshPhong 1 つを使い回し、路面で照り返しだけ変える。UC-3c） */
export function roadMaterialParams(surface: Surface): {
  shininess: number
  specular: string
  skyReflect: number
} {
  const { shininess, specular, skyReflect } = SURFACE[surface]
  return { shininess, specular, skyReflect }
}

/** 照り返す帯か（車道・轍・線は 1、路肩・法面は 0）。頂点の属性 gloss に入れ、材質が照り返しに掛ける */
export function glossOf(kind: StripKind): number {
  return kind === 'road' || kind === 'rut' || kind === 'line' ? 1 : 0
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
export function buildRoadChunk(
  frame: RoadFrame,
  index: number,
  surface: Surface,
  season: SceneSeason = 'winter',
): RoadChunk {
  const s0 = index * ROAD_CHUNK_M
  const s1 = Math.min(frame.lengthM, s0 + ROAD_CHUNK_M)
  const start = poseAt(frame, s0)
  const origin: [number, number] = [start.x, start.z]
  const rows: number[] = []
  for (let s = s0; s < s1; s += ROAD_SAMPLE_M) rows.push(s)
  rows.push(s1)
  const poses = rows.map((s) => poseAt(frame, s))
  const list = roadCrossSection(surface, season)

  const positions: number[] = []
  const colors: number[] = []
  const glosses: number[] = []
  const color = new Color()
  for (const strip of list) {
    color.set(strip.color)
    const gloss = glossOf(strip.kind)
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
        glosses.push(gloss)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setAttribute('gloss', new Float32BufferAttribute(glosses, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return { index, s0, s1, origin, geometry }
}

/** ルート全体の区間の数 */
export function chunkCount(frame: RoadFrame): number {
  return Math.max(1, Math.ceil(frame.lengthM / ROAD_CHUNK_M))
}
