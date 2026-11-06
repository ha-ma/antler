import type { Deer, DeerCandidate, DeerPose } from '../types'
import { between, createRng, deriveSeed } from './rng'
import { LANE_CENTER_D } from './vehicle'

// 鹿の動き（A5-2、drive-deer R3・R4。12 種）。純粋関数で、固定ステップ（1/60 秒）で進める。
// 位置は道の座標（s 前・d 右、m）、heading は道の向きからの角度（rad、正は右回り。前方 = (cos h, sin h) in (s, d)）。
// collision.ts・detection.ts と同じ規約。
//
// 局面（phase）: wait（待つ）→ go（動く。startedAt が未来なら順番を待つ）→ pause（途中で止まる）→
// resume（また渡る）/ stand（立ちすくむ）/ leave（去る・引き返す・横切る）。渡りきって林の奥へ行くと gone。
// 渡る鹿は「車線に入る時刻と車が着く時刻の差」を狙って動き出す（車が着く前に渡りきってしまわない。R4）。
// 動きの係数は候補の種（deer.seed）と頭の番号から引くので、同じ種なら同じ動き。s が動いても変わらない。

/** 林縁（中心線から、m）。これより外は林の中で、車のカメラから隠れる */
export const FOREST_EDGE_M = 9
/** 渡りきって林の奥のこの位置まで行ったら消える（m） */
export const GONE_D_M = 14
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
/** walk と run の境（m/s） */
const RUN_ABOVE_MPS = 3.4
/** 立ちすくみが去る速さ（m/s） */
const FROZEN_OUT_MPS = 6
/** 動き出してから最高速になるまで（ms）。飛び出しは速い */
const RAMP_MS = 600
const DART_RAMP_MS = 250

/** 渡る鹿が動き出す距離の範囲（m。R4） */
export const TRIGGER_MIN_M = 20
export const TRIGGER_MAX_M = 110
/** 車の速さはこれ以上とみなす（止まった車の前でも、近づけば動き出す） */
export const MIN_CAR_MPS = 4
/** 車線に入る時刻の、車が着く時刻からのずれ（s。正は先に入る） */
export const OFFSET_MIN_S = -0.8
export const OFFSET_MAX_S = 1.2
/** 至近の飛び出し・急に走り出す・立ちすくみの動き出す距離（m） */
export const DART_GAP_M = [15, 40] as const
export const DASH_GAP_M = [25, 50] as const
export const FROZEN_GAP_M = [40, 90] as const
/** 並走: この距離で走り出し、この距離（か 4 秒）で前を横切る */
export const PARALLEL_START_GAP_M = 70
export const PARALLEL_CUT_GAP_M = [12, 30] as const
export const PARALLEL_MAX_MS = 4000
/** 車がこれだけ止まっていると、この距離の中で待つ鹿は渡り出す（ms・m） */
export const WAIT_STOPPED_MS = 4000
export const WAIT_STOPPED_RANGE_M = 60
/** 並走の横切り・斜めの角度（横切る向きから前へ、rad） */
const PARALLEL_CUT_ANGLE = 0.6
/** stop-midway が止まる位置（中央線） */
export const STOP_D = 0
/** turn-back が向きを変える位置（車線の中）と、向きを変える間（ms） */
export const TURN_D = { fromR: -0.6, fromL: -2.9 } as const
const TURN_PAUSE_MS = 350
const TURN_BACK_SPEEDUP = 1.4

export type DeerContext = {
  t: number
  carS: number
  carD: number
  /** m/s */
  carSpeed: number
  /** 車が止まっている時間（ms） */
  carStoppedMs: number
}

/** 動きの係数（R3・R4） */
export type MotionParams = {
  /** 主な動きの速さ（m/s） */
  speedMps: number
  /** 車線に入る時刻のずれ（s。渡る鹿） */
  offsetS: number
  /** 決まった距離で動き出す動きの距離（m。frozen） */
  gapM: number
  /** 途中で止まる時間（ms。stop-midway） */
  pauseMs: number
  /** 群れの順番の遅れ（ms） */
  delayMs: number
  /** 斜めの角度（rad。正は車の方へ向かう斜め） */
  angle: number
}

const lerp = (u: number, [a, b]: readonly [number, number]) => a + (b - a) * u

/** 動きの係数。候補の種と頭の番号から引く（同じ種なら同じ値。s を使わない） */
export function motionOf(deer: Pick<Deer, 'seed' | 'index' | 'motion'>): MotionParams {
  const shared = createRng(deriveSeed(deer.seed, 'motion'))
  const a = [shared(), shared(), shared(), shared()] as const
  const own = createRng(deriveSeed(deer.seed, `motion-${deer.index}`))
  const b = [own(), own(), own()] as const
  const offset = lerp(a[1], [OFFSET_MIN_S, OFFSET_MAX_S])
  const base: MotionParams = {
    speedMps: lerp(a[0], [2.6, 4.6]),
    offsetS: offset,
    gapM: 0,
    pauseMs: 0,
    delayMs: 0,
    angle: 0,
  }
  switch (deer.motion) {
    case 'stop-midway':
      return { ...base, speedMps: lerp(a[0], [2.6, 3.8]), pauseMs: lerp(a[2], [800, 2000]) }
    case 'turn-back':
      return { ...base, speedMps: lerp(a[0], [3.5, 5]) }
    case 'diagonal':
      return {
        ...base,
        speedMps: lerp(a[0], [4, 6]),
        angle: (a[3] < 0.5 ? 1 : -1) * lerp(a[2], [0.45, 0.8]),
      }
    // 並走・飛び出し・急に走り出すの動き出す距離は triggerGapM が車の速さから決める
    case 'parallel':
      return { ...base, speedMps: lerp(a[0], [9, 12]) }
    case 'dart':
      return { ...base, speedMps: lerp(a[0], [8, 10]) }
    case 'graze-dash':
      return { ...base, speedMps: lerp(a[0], [6, 8]) }
    case 'frozen':
      return { ...base, speedMps: lerp(a[0], [2.4, 3.2]), gapM: lerp(a[2], FROZEN_GAP_M) }
    case 'herd':
      return {
        ...base,
        delayMs:
          deer.index === 0
            ? 0
            : deer.index * HERD_DELAY_MS +
              lerp(b[0], [-HERD_DELAY_JITTER_MS, HERD_DELAY_JITTER_MS]),
      }
    case 'follower':
      // 1 頭目は早めに渡りきり、2 頭目（林の陰）は車が着く頃に車線に入る
      return deer.index === 0
        ? { ...base, speedMps: lerp(a[0], [3, 4]), offsetS: lerp(a[1], [2, 2.6]) }
        : { ...base, speedMps: lerp(b[0], [5, 7]), offsetS: lerp(b[1], [-0.3, 0.6]) }
    default:
      return base
  }
}

/** 候補から鹿を出す（群れは herdSize 頭。id は `${candidate.id}-${index}`） */
// _t: 出た時刻（いまは使わない。動き出す時刻は stepDeer が決める）
export function spawnDeer(candidate: DeerCandidate, _t: number): Deer[] {
  const rng = createRng(deriveSeed(candidate.seed, 'spawn'))
  const sign = candidate.side === 'L' ? -1 : 1
  const count =
    candidate.motion === 'herd' || candidate.motion === 'follower'
      ? Math.max(1, candidate.herdSize)
      : 1
  const toRoad = -sign * (Math.PI / 2)
  // 群れは並びの基準を 1 回だけ引く（先頭の位置から後ろの鹿の位置が決まる）
  const herdBase = between(rng, 4.8, 5.8)
  const out: Deer[] = []
  for (let index = 0; index < count; index++) {
    const base = {
      id: `${candidate.id}-${index}`,
      candidateId: candidate.id,
      pattern: candidate.pattern,
      motion: candidate.motion,
      seed: candidate.seed,
      phase: 'wait' as const,
      index,
      pose: 'idle' as DeerPose,
      startedAt: null,
      gone: false,
    }
    const place = (s: number, d: number, heading: number): Deer => ({
      ...base,
      s,
      d,
      heading,
      occluded: Math.abs(d) >= FOREST_EDGE_M,
    })
    switch (candidate.motion) {
      case 'graze': {
        // 路肩の雪の上。道に沿って草をはむか、道の方を向く
        const along = rng() < 0.5
        const heading = along
          ? (rng() < 0.5 ? 0 : Math.PI) + between(rng, -0.3, 0.3)
          : toRoad + between(rng, -0.4, 0.4)
        out.push(place(candidate.s + between(rng, -20, 20), sign * between(rng, 4.4, 6.0), heading))
        break
      }
      case 'eyeshine': {
        // 林の中から道（と近づく車）の方を向いている
        const heading = -sign * (Math.PI * 0.75) + between(rng, -0.25, 0.25)
        out.push(
          place(candidate.s + between(rng, -20, 20), sign * between(rng, 9.5, 13.5), heading),
        )
        break
      }
      case 'dart':
        // 森の陰（林の中、カメラから隠れる）で道の方を向いて待つ
        out.push(place(candidate.s, sign * between(rng, 10, 11.5), toRoad))
        break
      case 'graze-dash':
        // 路肩の奥で道に沿って草をはむ（路肩の鹿に見える）
        out.push(
          place(
            candidate.s,
            sign * between(rng, 5.6, 7),
            (rng() < 0.5 ? 0 : Math.PI) + between(rng, -0.3, 0.3),
          ),
        )
        break
      case 'parallel':
        // 路肩で車と同じ向きを向いている
        out.push(place(candidate.s, sign * between(rng, 5.2, 6.2), between(rng, -0.15, 0.15)))
        break
      case 'herd':
        out.push(place(candidate.s, sign * (herdBase + index * HERD_SPACING_M), toRoad))
        break
      case 'follower':
        // 1 頭目は路肩、2 頭目は林の陰（少し先）
        out.push(
          index === 0
            ? place(candidate.s, sign * herdBase, toRoad)
            : place(candidate.s + between(rng, 1, 4), sign * between(rng, 9.6, 10.6), toRoad),
        )
        break
      default:
        // 横断・途中で止まる・引き返す・斜め・立ちすくみは路肩から道の方を向いて待つ
        out.push(place(candidate.s, sign * herdBase, toRoad))
    }
  }
  return out
}

/** dtS 秒だけ進める（純粋関数） */
export function stepDeer(deer: Deer, ctx: DeerContext, dtS: number): Deer {
  if (deer.gone) return deer
  const gap = deer.s - ctx.carS
  if (deer.motion === 'graze' || deer.motion === 'eyeshine') return withPose(deer, lookPose(gap))
  const m = motionOf(deer)
  switch (deer.phase) {
    case 'wait':
      return stepWait(deer, m, ctx, gap)
    case 'go':
      return stepGo(deer, m, ctx, gap, dtS)
    case 'pause':
      return stepPause(deer, m, ctx)
    case 'stand':
      return stepStand(deer, ctx)
    case 'resume':
      return move(deer, m.speedMps * ramp(ctx.t - (deer.startedAt ?? ctx.t)), dtS)
    case 'leave':
      return move(deer, leaveSpeed(deer, m) * ramp(ctx.t - (deer.startedAt ?? ctx.t)), dtS)
  }
}

/**
 * 動き出す距離（m。R4）。毎ステップ、その時の車の速さ（|速さ|、4 m/s 以上とみなす）で決め、動き出したら固定する。
 * 渡る鹿・飛び出し・並走の横切りは「車線に入る時刻 ＝ 車が着く時刻 − ずれ」になる距離を、動きごとの範囲に収める
 * （至近の飛び出しも車の速さに合わせる。spec-adversary C1）。立ちすくみと並走の走り出しは決まった距離
 */
export function triggerGapM(deer: Deer, ctx: Pick<DeerContext, 'carSpeed'>): number {
  const m = motionOf(deer)
  const carSpeed = Math.max(MIN_CAR_MPS, Math.abs(ctx.carSpeed))
  switch (deer.motion) {
    case 'frozen':
      return m.gapM
    case 'parallel': {
      if (deer.phase === 'wait') return PARALLEL_START_GAP_M
      const side = Math.sign(deer.d) || 1
      const heading = -side * (Math.PI / 2) + side * PARALLEL_CUT_ANGLE
      return syncedGap(deer, m, heading, leaveSpeed(deer, m), carSpeed, RAMP_MS, PARALLEL_CUT_GAP_M)
    }
    case 'dart':
      return syncedGap(
        deer,
        m,
        startHeading(deer, m),
        m.speedMps,
        carSpeed,
        DART_RAMP_MS,
        DART_GAP_M,
      )
    case 'graze-dash':
      return syncedGap(
        deer,
        m,
        startHeading(deer, m),
        m.speedMps,
        carSpeed,
        DART_RAMP_MS,
        DASH_GAP_M,
      )
    default:
      return syncedGap(deer, m, startHeading(deer, m), m.speedMps, carSpeed, RAMP_MS, [
        TRIGGER_MIN_M,
        TRIGGER_MAX_M,
      ])
  }
}

/** 車が着く時刻に合わせて車線に入る距離（m）を range に収める */
function syncedGap(
  deer: Deer,
  m: MotionParams,
  heading: number,
  speed: number,
  carSpeed: number,
  rampMs: number,
  range: readonly [number, number],
): number {
  const vs = speed * Math.cos(heading)
  const vd = Math.max(0.1, speed * Math.abs(Math.sin(heading)))
  const closing = Math.max(0.5, carSpeed - vs)
  const gap = closing * (laneTimeS(deer, m, vd, rampMs) + m.offsetS)
  return Math.min(range[1], Math.max(range[0], gap))
}

/** 動き出してから車線（左車線の中央。引き返す鹿は向きを変える位置）に入るまでの時間（s） */
function laneTimeS(deer: Deer, m: MotionParams, vd: number, rampMs: number): number {
  const side = Math.sign(deer.d) || 1
  // 群れの後ろの鹿は先頭の位置で数える（群れは同じ瞬間に動き出し、順番に遅れて渡る）
  const d0 = deer.motion === 'herd' ? deer.d - side * deer.index * HERD_SPACING_M : deer.d
  const lag = rampMs / 2000
  if (deer.motion === 'turn-back') {
    return Math.abs((side > 0 ? TURN_D.fromR : TURN_D.fromL) - d0) / vd + lag
  }
  if (deer.motion === 'stop-midway' && side > 0) {
    // 右から: 中央線で止まってから車線へ
    return (
      Math.abs(STOP_D - d0) / vd + m.pauseMs / 1000 + Math.abs(LANE_CENTER_D - STOP_D) / vd + lag
    )
  }
  return Math.abs(LANE_CENTER_D - d0) / vd + lag
}

/** 動き出すときの体の向き（道の方へ。斜めは角度をつける） */
function startHeading(deer: Pick<Deer, 'd' | 'motion'>, m: MotionParams): number {
  const side = Math.sign(deer.d) || 1
  const across = -side * (Math.PI / 2)
  if (deer.motion === 'parallel') return 0
  // 角度が正なら車の方へ（cos < 0）
  return deer.motion === 'diagonal' ? across - side * m.angle : across
}

function stepWait(deer: Deer, m: MotionParams, ctx: DeerContext, gap: number): Deer {
  // 車が手前で止まって 4 秒たつと、近くで待つ鹿は渡り出す（止まった車の前で永久に待たない。spec-adversary M2）
  const stoppedNear = ctx.carStoppedMs >= WAIT_STOPPED_MS && gap <= WAIT_STOPPED_RANGE_M && gap > -5
  if (gap > triggerGapM(deer, ctx) && !stoppedNear) {
    // 草をはむ鹿・林の陰の鹿は車を見ない（急に走り出す）
    const still = deer.motion === 'graze-dash' || deer.motion === 'dart'
    return withPose(deer, still ? 'idle' : lookPose(gap))
  }
  const heading = startHeading(deer, m)
  return {
    ...deer,
    phase: 'go',
    heading,
    startedAt: ctx.t + m.delayMs,
    pose: m.delayMs > 0 ? 'look' : movingPose(m.speedMps),
  }
}

function stepGo(deer: Deer, m: MotionParams, ctx: DeerContext, gap: number, dtS: number): Deer {
  const startedAt = deer.startedAt ?? ctx.t
  // 群れの 2 頭目以降は順番を待つ
  if (ctx.t < startedAt) return withPose(deer, 'look')
  const elapsed = ctx.t - startedAt
  const rampMs = deer.motion === 'dart' || deer.motion === 'graze-dash' ? DART_RAMP_MS : RAMP_MS
  const next = withPose(move(deer, m.speedMps * ramp(elapsed, rampMs), dtS), movingPose(m.speedMps))
  const dir = Math.sign(Math.sin(deer.heading)) || 1
  switch (deer.motion) {
    case 'stop-midway':
      if ((next.d - STOP_D) * dir >= 0) {
        return { ...next, d: STOP_D, phase: 'pause', pose: 'look', startedAt: ctx.t, gone: false }
      }
      return next
    case 'turn-back': {
      const turnD = dir < 0 ? TURN_D.fromR : TURN_D.fromL
      if ((next.d - turnD) * dir >= 0) {
        return { ...next, d: turnD, phase: 'pause', pose: 'look', startedAt: ctx.t, gone: false }
      }
      return next
    }
    case 'parallel': {
      // 車が追いつく頃（か 4 秒）で前を横切る。車が遅くて追いつかなくても 4 秒で横切る
      if (gap > triggerGapM(deer, ctx) && elapsed < PARALLEL_MAX_MS) return next
      // 前を斜めに横切る（先へ向かう斜め）
      const side = Math.sign(next.d) || 1
      return {
        ...next,
        phase: 'leave',
        heading: -side * (Math.PI / 2) + side * PARALLEL_CUT_ANGLE,
        startedAt: ctx.t,
        pose: 'run',
      }
    }
    case 'frozen':
      if ((LANE_CENTER_D - next.d) * dir <= 0) {
        // 車線の中央で止まり、車の方へ体を向けて立ちすくむ
        return {
          ...next,
          d: LANE_CENTER_D,
          phase: 'stand',
          pose: 'look',
          heading: dir * (Math.PI * 0.75),
          startedAt: ctx.t,
          occluded: false,
          gone: false,
        }
      }
      return { ...next, pose: 'walk' }
    default:
      return next
  }
}

function stepPause(deer: Deer, m: MotionParams, ctx: DeerContext): Deer {
  const since = ctx.t - (deer.startedAt ?? ctx.t)
  if (deer.motion === 'turn-back') {
    if (since < TURN_PAUSE_MS) return deer
    // 来た側へ跳ねて戻る
    return {
      ...deer,
      phase: 'leave',
      heading: deer.heading + Math.PI,
      startedAt: ctx.t,
      pose: 'run',
    }
  }
  if (since < m.pauseMs) return deer
  return { ...deer, phase: 'resume', startedAt: ctx.t, pose: movingPose(m.speedMps) }
}

/** 立ちすくむ: 車が止まって 3 秒か、12 秒で去る（先に進めなくならない） */
function stepStand(deer: Deer, ctx: DeerContext): Deer {
  const leave =
    ctx.carStoppedMs >= FROZEN_STOPPED_LEAVE_MS ||
    ctx.t - (deer.startedAt ?? ctx.t) >= FROZEN_TIMEOUT_MS
  if (!leave) return deer
  const dir = Math.sign(Math.sin(deer.heading)) || 1
  return { ...deer, phase: 'leave', pose: 'run', heading: dir * (Math.PI / 2), startedAt: ctx.t }
}

function leaveSpeed(deer: Deer, m: MotionParams): number {
  switch (deer.motion) {
    case 'turn-back':
      return m.speedMps * TURN_BACK_SPEEDUP
    case 'parallel':
      return m.speedMps * 0.75
    case 'frozen':
      return FROZEN_OUT_MPS
    default:
      return m.speedMps
  }
}

/** 体の向きに speed で進む。横切る向きに林の奥（GONE_D_M）まで行ったら消える */
function move(deer: Deer, speed: number, dtS: number): Deer {
  const sin = Math.sin(deer.heading)
  const s = deer.s + speed * Math.cos(deer.heading) * dtS
  const d = deer.d + speed * sin * dtS
  const dir = Math.sign(sin)
  const gone = Math.abs(sin) > 0.2 && d * dir >= GONE_D_M
  return { ...deer, s, d, occluded: Math.abs(d) >= FOREST_EDGE_M, gone }
}

function withPose(deer: Deer, pose: DeerPose): Deer {
  return pose === deer.pose ? deer : { ...deer, pose }
}

/** 静止している鹿の姿勢。車が近いと顔を上げる */
function lookPose(gap: number): DeerPose {
  return gap <= LOOK_RANGE_M && gap > -10 ? 'look' : 'idle'
}

function movingPose(speedMps: number): DeerPose {
  return speedMps >= RUN_ABOVE_MPS ? 'run' : 'walk'
}

/** 動き出しの加速（0 → 1） */
function ramp(elapsedMs: number, rampMs = RAMP_MS): number {
  return Math.min(1, Math.max(0.15, elapsedMs / rampMs))
}
