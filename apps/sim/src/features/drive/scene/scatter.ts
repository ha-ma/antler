import { poseAt, toRoadCoords, type RoadFrame } from '../domain/road'
import { between, createRng, deriveSeed } from '../domain/rng'
import { BANK_OUT_M, ROAD_CHUNK_M } from './layout'

// 林と矢羽根の置き場所（R12: InstancedMesh で描く）。区間ごとにシード付き乱数（domain/rng.ts）で決める（R13）。
// 同じシード・同じ区間なら同じ林。区間は車の前後だけ作って使い回す（ルート約 36 km 分を一度に持たない）。

export type TreeKind = 'conifer' | 'bare' | 'birch'
export type Placement = { x: number; z: number; yaw: number; scale: number }
export type ChunkScatter = Record<TreeKind | 'arrow', Placement[]>

/** 片側あたりの木の数（密度 1 のとき、400 m で） */
const TREES_PER_SIDE = 140
/** 林縁（道から、m）と、林の奥行き（指数分布の平均、m） */
const FOREST_START_M = 10
const FOREST_MEAN_DEPTH_M = 22
const FOREST_MAX_M = 110
/** 木が道（ほかの区間も含む）にこれより近ければ置かない（m） */
const KEEP_CLEAR_M = BANK_OUT_M + 0.5
/** 矢羽根の間隔（m）と、道からの位置（m） */
const ARROW_STEP_M = 60
export const ARROW_D_M = 6.2

const KIND_WEIGHTS: [TreeKind, number][] = [
  ['conifer', 0.55],
  ['bare', 0.3],
  ['birch', 0.15],
]

export function scatterChunk(frame: RoadFrame, index: number, seed: number): ChunkScatter {
  const rng = createRng(deriveSeed(seed, `forest-${index}`))
  const out: ChunkScatter = { conifer: [], bare: [], birch: [], arrow: [] }
  const s0 = index * ROAD_CHUNK_M
  const s1 = Math.min(frame.lengthM, s0 + ROAD_CHUNK_M)
  if (s1 <= s0) return out
  // 区間ごとに林の濃さを変える（伐採地・牧草地の切れ目）
  const density = between(rng, 0.35, 1.2)
  for (const sign of [-1, 1] as const) {
    const count = Math.round(TREES_PER_SIDE * density)
    for (let i = 0; i < count; i++) {
      const s = between(rng, s0, s1)
      const depth = Math.min(
        FOREST_MAX_M,
        FOREST_START_M - Math.log(1 - rng() * 0.999) * FOREST_MEAN_DEPTH_M,
      )
      const kindRoll = rng()
      const yaw = between(rng, 0, Math.PI * 2)
      const scale = between(rng, 0.75, 1.3)
      const pose = poseAt(frame, s, sign * depth)
      // 曲がりの内側で、ほかの区間の道の上に木が立たないように
      const near = toRoadCoords(frame, [pose.x, pose.z], s)
      if (Math.abs(near.d) < KEEP_CLEAR_M) continue
      out[pickKind(kindRoll)].push({ x: pose.x, z: pose.z, yaw, scale })
    }
  }
  // 矢羽根（固定式視線誘導柱）: 両側に等間隔。腕は道の方へ向ける
  const first = Math.ceil(s0 / ARROW_STEP_M) * ARROW_STEP_M
  for (let s = first; s < s1; s += ARROW_STEP_M) {
    for (const sign of [-1, 1] as const) {
      const pose = poseAt(frame, s, sign * ARROW_D_M)
      // 形は腕が +X（右）へ伸びる。左の柱は道の向きのまま、右の柱は 180° 回す
      out.arrow.push({
        x: pose.x,
        z: pose.z,
        yaw: sign < 0 ? pose.yaw : pose.yaw + Math.PI,
        scale: 1,
      })
    }
  }
  return out
}

function pickKind(roll: number): TreeKind {
  let acc = 0
  for (const [kind, w] of KIND_WEIGHTS) {
    acc += w
    if (roll < acc) return kind
  }
  return 'conifer'
}
