import type { Deer, World } from '../types'
import { deerEyeshine } from './eyeshine'
import { poseAt } from './road'

// 鹿の発見（drive-crash-spot R4・A5-5）。利用者が 3D の鹿をクリック / タップすると「発見」に数える。
// 判定（見えているか・何回目か・事前か）はここが持ち、画面（scene/）はレイで選んだ鹿の id を渡すだけ。乱数は使わない。

/** これより遠くで見つけたら「事前に発見」（m）。圧雪で 60 km/h から止まれる距離（反応 0.75 秒＋制動 約 40 m）より遠い所 */
export const SPOT_EARLY_M = 60
/** 見えているとみなす距離の上限（m） */
export const SPOT_MAX_M = 150
/** 押してから離すまでにこれを超えて動いたら、タップではなくドラッグ（視線）（px） */
export const SPOT_DRAG_PX = 8
/** 当たりの球の半径（m）: 近くはこの大きさ、遠いほど距離 × SPOT_HIT_PER_M */
export const SPOT_HIT_MIN_M = 1.2
export const SPOT_HIT_PER_M = 0.02
/** 当たりの球の中心の高さ（m）: 体の中心と、目の反射だけの鹿の目 */
const BODY_CENTER_Y = 0.95
const EYE_Y = 1.3
/** 目が光って見える強さの下限（scene の DeerModel が光の板を出す下限と同じ） */
const EYESHINE_VISIBLE = 0.02

type V3 = readonly [number, number, number]
export type SpotTarget = { id: string; center: V3 }
/** カメラからのレイ（dir は長さ 1） */
export type SpotRay = { origin: V3; dir: V3 }

/** 車から鹿まで（平面の直線、m） */
function distanceToCar(world: World, deer: Deer): number {
  const { frame } = world.internal
  const car = poseAt(frame, world.vehicle.s, world.vehicle.d)
  const p = poseAt(frame, deer.s, deer.d)
  return Math.hypot(p.x - car.x, p.z - car.z)
}

/**
 * 運転者から見えている鹿か（spec-adversary C2）。150 m 以内で林に隠れていない。
 * 目の反射だけの鹿は、ヘッドライトを点ける時間（昼でない）に目が光っている間だけ
 */
export function deerVisible(world: World, deer: Deer): boolean {
  if (deer.gone || distanceToCar(world, deer) > SPOT_MAX_M) return false
  if (deer.motion === 'eyeshine') {
    return (
      world.light !== 'day' &&
      deerEyeshine(deer, world.vehicle.s, world.vehicle.d) > EYESHINE_VISIBLE
    )
  }
  return !deer.occluded
}

/** 0.1 秒ごと: 見えた鹿を「出た数」に数える（spec-adversary M2。同じ鹿は 1 回） */
export function countSeen(world: World): void {
  for (const deer of world.deer) {
    if (world.internal.seen.has(deer.id) || !deerVisible(world, deer)) continue
    world.internal.seen.add(deer.id)
    world.spotting.appeared += 1
  }
}

/**
 * 鹿を見つけた（UC-4a〜UC-4c）。数えたら 'early'（車の前 60 m 以上）か 'late'、数えなければ null。
 * 走っている間（一時停止でない）に、見えていてまだ見つけていない鹿だけ
 */
export function spotDeer(world: World, deerId: string): 'early' | 'late' | null {
  if (world.outcome !== 'driving' || world.playback.paused) return null
  if (world.internal.spotted.has(deerId)) return null
  const deer = world.deer.find((d) => d.id === deerId)
  if (!deer || !deerVisible(world, deer)) return null
  world.internal.spotted.add(deerId)
  // 見つけた鹿は見えた鹿でもある（0.1 秒の判定の前に押されても分母を下回らない）
  if (!world.internal.seen.has(deerId)) {
    world.internal.seen.add(deerId)
    world.spotting.appeared += 1
  }
  world.spotting.found += 1
  const early = deer.s > world.vehicle.s && distanceToCar(world, deer) >= SPOT_EARLY_M
  if (early) world.spotting.early += 1
  return early ? 'early' : 'late'
}

/** レイで選べる的（UC-4f）: 見えていてまだ見つけていない鹿の、体の中心（目の反射だけの鹿は目の高さ） */
export function spotTargets(world: World): SpotTarget[] {
  const out: SpotTarget[] = []
  for (const deer of world.deer) {
    if (world.internal.spotted.has(deer.id) || !deerVisible(world, deer)) continue
    const p = poseAt(world.internal.frame, deer.s, deer.d)
    out.push({
      id: deer.id,
      center: [p.x, deer.motion === 'eyeshine' ? EYE_Y : BODY_CENTER_Y, p.z],
    })
  }
  return out
}

/** レイが当たりの球に当たる的のうち、いちばん近いもの（UC-4e）。無ければ null */
export function pickDeer(ray: SpotRay, targets: readonly SpotTarget[]): string | null {
  let best: { id: string; t: number } | null = null
  for (const target of targets) {
    const to = [
      target.center[0] - ray.origin[0],
      target.center[1] - ray.origin[1],
      target.center[2] - ray.origin[2],
    ] as const
    const t = to[0] * ray.dir[0] + to[1] * ray.dir[1] + to[2] * ray.dir[2]
    if (t <= 0) continue
    const dist = Math.hypot(to[0], to[1], to[2])
    const off = Math.sqrt(Math.max(0, dist * dist - t * t))
    const radius = Math.max(SPOT_HIT_MIN_M, dist * SPOT_HIT_PER_M)
    if (off <= radius && (!best || t < best.t)) best = { id: target.id, t }
  }
  return best?.id ?? null
}

/** 押した位置と離した位置（px）から、タップか（UC-4f） */
export function isTap(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= SPOT_DRAG_PX
}
