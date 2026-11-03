import type { Deer, DeerCandidate, DeerPose } from '../types'
import { between, createRng, deriveSeed, type Rng } from './rng'
import { LANE_CENTER_D } from './vehicle'

// 鹿の動き（R5、A5-2。ch9 ② の 5 パターン）。純粋関数で、固定ステップ（1/60 秒）で進める。
// 位置は道の座標（s 前・d 右、m）、heading は道の向きからの角度（rad、正は右回り。前方 = (cos h, sin h) in (s, d)）。
// collision.ts・detection.ts と同じ規約。
//
// 道を渡る鹿（横断・群れ・立ちすくみ）は d だけを動かし、s は出てから消えるまで変えない（道を真横に渡る）。
// 動きの係数（動き出す距離・速さ・群れの遅れ）は「候補の seed から決まった s」と id から引き直す。
// Deer 型に seed の欄が無いため（types.ts を変えずに、同じシードで同じ動きにする）。
//
// 段階（pose と startedAt で表す。startedAt は「いまの段階が始まった t」）:
//   横断・群れ: idle/look（startedAt null、待つ）→ look（startedAt が未来。群れの後ろの鹿が順番を待つ）→ walk/run（渡る）→ gone
//   立ちすくみ: idle/look（待つ）→ walk（車線へ出る）→ look（startedAt あり。立ちすくむ）→ run（去る）→ gone

/** 林縁（中心線から、m）。これより外は林の中で、車のカメラから隠れる */
export const FOREST_EDGE_M = 9
/** 渡りきって林の奥のこの位置まで行ったら消える（m） */
export const GONE_D_M = 14
/** 車がこの距離（道のりの差、m）に来たら動き出す */
export const TRIGGER_MIN_M = 80
export const TRIGGER_MAX_M = 100
/** 群れの 1 頭ごとの遅れ（ms、± HERD_DELAY_JITTER_MS） */
export const HERD_DELAY_MS = 1000
const HERD_DELAY_JITTER_MS = 150
/** 群れの鹿の並び（奥へ、m） */
const HERD_SPACING_M = 2.1
/** 立ちすくみは、車が止まってこれだけたつか、立ちすくんでこれだけたったら去る（ms） */
export const FROZEN_STOPPED_LEAVE_MS = 3000
export const FROZEN_TIMEOUT_MS = 12000
/** 車がこの距離より近いと、静止している鹿は顔を上げて車を見る（m） */
const LOOK_RANGE_M = 130
/** 渡る速さ（m/s）。walk と run の境 */
const CROSS_SPEED_MIN = 2.6
const CROSS_SPEED_MAX = 4.6
const RUN_ABOVE_MPS = 3.4
/** 立ちすくみが車線へ出る速さと、去る速さ（m/s） */
const FROZEN_IN_MIN = 2.4
const FROZEN_IN_MAX = 3.2
const FROZEN_OUT_MPS = 6
/** 動き出してから最高速になるまで（ms） */
const RAMP_MS = 600

export type DeerContext = {
  t: number
  carS: number
  carD: number
  /** m/s */
  carSpeed: number
  /** 車が止まっている時間（ms） */
  carStoppedMs: number
}

/** 候補から鹿を出す（群れは herdSize 頭。id は `${candidate.id}-${index}`） */
// _t: 出た時刻（いまは使わない。出た直後は待つだけなので、動き出す時刻は stepDeer が決める）
export function spawnDeer(candidate: DeerCandidate, _t: number): Deer[] {
  const rng = createRng(deriveSeed(candidate.seed, 'spawn'))
  const sign = candidate.side === 'L' ? -1 : 1
  const count = candidate.pattern === 'herd' ? Math.max(1, candidate.herdSize) : 1
  const base = {
    candidateId: candidate.id,
    pattern: candidate.pattern,
    pose: 'idle' as DeerPose,
    startedAt: null,
    gone: false,
  }
  const out: Deer[] = []
  for (let index = 0; index < count; index++) {
    const id = `${candidate.id}-${index}`
    switch (candidate.pattern) {
      case 'roadside': {
        // 路肩の雪の上。道に沿って草をはむか、道の方を向く
        const along = rng() < 0.5
        const heading = along
          ? (rng() < 0.5 ? 0 : Math.PI) + between(rng, -0.3, 0.3)
          : -sign * (Math.PI / 2) + between(rng, -0.4, 0.4)
        out.push({
          ...base,
          id,
          index,
          s: candidate.s + between(rng, -20, 20),
          d: sign * between(rng, 4.4, 6.0),
          heading,
          occluded: false,
        })
        break
      }
      case 'eyeshine': {
        // 林の中から道（と近づく車）の方を向いている
        const heading = -sign * (Math.PI * 0.75) + between(rng, -0.25, 0.25)
        out.push({
          ...base,
          id,
          index,
          s: candidate.s + between(rng, -20, 20),
          d: sign * between(rng, 9.5, 13.5),
          heading,
          occluded: true,
        })
        break
      }
      default: {
        // 横断・群れ・立ちすくみは路肩（群れの後ろの鹿は林の中）から道の方を向いて待つ。s は候補の s のまま
        const d = sign * (between(rng, 4.8, 5.8) + index * HERD_SPACING_M)
        out.push({
          ...base,
          id,
          index,
          s: candidate.s,
          d,
          heading: -sign * (Math.PI / 2),
          occluded: Math.abs(d) >= FOREST_EDGE_M,
        })
      }
    }
  }
  return out
}

/** dtS 秒だけ進める（純粋関数） */
export function stepDeer(deer: Deer, ctx: DeerContext, dtS: number): Deer {
  if (deer.gone) return deer
  const gap = deer.s - ctx.carS
  switch (deer.pattern) {
    case 'roadside':
    case 'eyeshine': {
      const pose = lookPose(gap)
      return pose === deer.pose ? deer : { ...deer, pose }
    }
    case 'crossing':
    case 'herd':
      return stepCrossing(deer, ctx, gap, dtS)
    case 'frozen':
      return stepFrozen(deer, ctx, gap, dtS)
  }
}

/** 動きの係数。s（候補の seed から決まる）と id から引くので、同じシードなら同じ値 */
export function motionOf(deer: Pick<Deer, 's' | 'candidateId' | 'id' | 'index'>): {
  triggerM: number
  speedMps: number
  delayMs: number
} {
  const key = Math.round(deer.s * 100)
  // 群れで共有するもの（動き出す距離・速さ）は候補の単位で引く
  const shared: Rng = createRng(deriveSeed(key, deer.candidateId))
  const triggerM = between(shared, TRIGGER_MIN_M, TRIGGER_MAX_M)
  const speedMps = between(shared, CROSS_SPEED_MIN, CROSS_SPEED_MAX)
  const own: Rng = createRng(deriveSeed(key, deer.id))
  const delayMs =
    deer.index === 0
      ? 0
      : deer.index * HERD_DELAY_MS + between(own, -HERD_DELAY_JITTER_MS, HERD_DELAY_JITTER_MS)
  return { triggerM, speedMps, delayMs }
}

function stepCrossing(deer: Deer, ctx: DeerContext, gap: number, dtS: number): Deer {
  const motion = motionOf(deer)
  if (deer.startedAt === null) {
    if (gap > motion.triggerM) {
      const pose = lookPose(gap)
      return pose === deer.pose ? deer : { ...deer, pose }
    }
    // 群れの 2 頭目以降は、先頭から約 1 秒ずつ遅れて動き出す
    return {
      ...deer,
      startedAt: ctx.t + motion.delayMs,
      pose: motion.delayMs > 0 ? 'look' : movingPose(motion.speedMps),
    }
  }
  if (ctx.t < deer.startedAt) return deer.pose === 'look' ? deer : { ...deer, pose: 'look' }
  const dir = Math.sign(Math.sin(deer.heading)) || 1
  const speed = motion.speedMps * ramp(ctx.t - deer.startedAt)
  return moveAcross(deer, dir, speed, movingPose(motion.speedMps), dtS)
}

function stepFrozen(deer: Deer, ctx: DeerContext, gap: number, dtS: number): Deer {
  const motion = motionOf(deer)
  // 待つ
  if (deer.startedAt === null) {
    if (gap > motion.triggerM) {
      const pose = lookPose(gap)
      return pose === deer.pose ? deer : { ...deer, pose }
    }
    return { ...deer, startedAt: ctx.t, pose: 'walk' }
  }
  const dir = Math.sign(Math.sin(deer.heading)) || 1
  // 車線へ出る
  if (deer.pose === 'walk') {
    const inSpeed =
      FROZEN_IN_MIN +
      (FROZEN_IN_MAX - FROZEN_IN_MIN) *
        ((motion.speedMps - CROSS_SPEED_MIN) / (CROSS_SPEED_MAX - CROSS_SPEED_MIN))
    const nextD = deer.d + dir * inSpeed * ramp(ctx.t - deer.startedAt) * dtS
    if ((LANE_CENTER_D - nextD) * dir <= 0) {
      // 車線の中央で止まり、車の方へ体を向けて立ちすくむ
      return {
        ...deer,
        d: LANE_CENTER_D,
        pose: 'look',
        heading: dir * (Math.PI * 0.75),
        startedAt: ctx.t,
        occluded: false,
      }
    }
    return { ...deer, d: nextD, occluded: Math.abs(nextD) >= FOREST_EDGE_M }
  }
  // 立ちすくむ: 車が止まって 3 秒か、12 秒で去る（先に進めなくならない）
  if (deer.pose === 'look') {
    const leave =
      ctx.carStoppedMs >= FROZEN_STOPPED_LEAVE_MS || ctx.t - deer.startedAt >= FROZEN_TIMEOUT_MS
    if (!leave) return deer
    return { ...deer, pose: 'run', heading: dir * (Math.PI / 2), startedAt: ctx.t }
  }
  // 去る（来た向きのまま走り抜ける）
  return moveAcross(deer, dir, FROZEN_OUT_MPS * ramp(ctx.t - deer.startedAt), 'run', dtS)
}

function moveAcross(deer: Deer, dir: number, speed: number, pose: DeerPose, dtS: number): Deer {
  const d = deer.d + dir * speed * dtS
  const gone = d * dir >= GONE_D_M
  return { ...deer, d, pose, occluded: Math.abs(d) >= FOREST_EDGE_M, gone }
}

/** 静止している鹿の姿勢。車が近いと顔を上げる */
function lookPose(gap: number): DeerPose {
  return gap <= LOOK_RANGE_M && gap > -10 ? 'look' : 'idle'
}

function movingPose(speedMps: number): DeerPose {
  return speedMps >= RUN_ABOVE_MPS ? 'run' : 'walk'
}

/** 動き出しの加速（0 → 1） */
function ramp(elapsedMs: number): number {
  return Math.min(1, Math.max(0.15, elapsedMs / RAMP_MS))
}
