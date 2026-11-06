import { describe, expect, it } from 'vitest'
import type { Deer, DeerCandidate, DeerMotion } from '../types'
import {
  DART_GAP_M,
  DASH_GAP_M,
  FOREST_EDGE_M,
  FROZEN_STOPPED_LEAVE_MS,
  FROZEN_TIMEOUT_MS,
  motionOf,
  STOP_D,
  TRIGGER_MAX_M,
  TRIGGER_MIN_M,
  TURN_D,
  spawnDeer,
  stepDeer,
  triggerGapM,
  type DeerContext,
} from './deer-motion'
import { MOTION_PATTERN } from './deer-spawn'
import { LANE_CENTER_D, ROAD_EDGE_M } from './vehicle'

const DT = 1 / 60
const STEP_MS = 1000 / 60

function candidate(motion: DeerMotion, overrides: Partial<DeerCandidate> = {}): DeerCandidate {
  return {
    id: 'd0-3',
    interval: 0,
    s: 2000,
    pattern: MOTION_PATTERN[motion],
    motion,
    side: 'L',
    herdSize: motion === 'herd' ? 4 : motion === 'follower' ? 2 : 1,
    seed: 123456,
    ...overrides,
  }
}

type Car = { s: number; speed: number; stoppedMs: number }
type Trace = { t: number; car: Car; deer: Deer[] }

/**
 * 車を走らせながら鹿を進める。driver は毎ステップ車の速さ（m/s）を返す。
 * 鹿の状態は 1/60 秒ごとに stepDeer に渡す（simulation.ts と同じ進め方）
 */
function simulate(
  c: DeerCandidate,
  seconds: number,
  startCarS: number,
  driver: (car: Car, t: number) => number,
): Trace[] {
  let deer = spawnDeer(c, 0)
  const car: Car = { s: startCarS, speed: 0, stoppedMs: 0 }
  const out: Trace[] = []
  const steps = Math.round(seconds * 60)
  for (let i = 1; i <= steps; i++) {
    const t = i * STEP_MS
    car.speed = driver(car, t)
    car.s += car.speed * DT
    car.stoppedMs = Math.abs(car.speed) < 0.5 / 3.6 ? car.stoppedMs + STEP_MS : 0
    const ctx: DeerContext = {
      t,
      carS: car.s,
      carD: LANE_CENTER_D,
      carSpeed: car.speed,
      carStoppedMs: car.stoppedMs,
    }
    deer = deer.map((d) => (d.gone ? d : stepDeer(d, ctx, DT)))
    out.push({ t, car: { ...car }, deer })
  }
  return out
}

const cruise = (kmh: number) => () => kmh / 3.6
const sides = ['L', 'R'] as const
const signOf = (side: 'L' | 'R') => (side === 'L' ? -1 : 1)

/** 鹿 i が初めて動いた（局面が wait から変わった）ときの車との距離 */
function startGap(trace: Trace[], c: DeerCandidate, i = 0): number {
  const at = trace.find(({ deer }) => deer[i]?.phase !== 'wait')
  return (at?.deer[i]?.s ?? c.s) - (at?.car.s ?? 0)
}

describe('spawnDeer（drive-3d R5、drive-deer R3）', () => {
  it('UC-5e: 群れは herdSize 頭で、id は 候補の id-番号。同じ候補からは同じ鹿', () => {
    const c = candidate('herd', { herdSize: 5 })
    const herd = spawnDeer(c, 1000)
    expect(herd.map((d) => d.id)).toEqual(['d0-3-0', 'd0-3-1', 'd0-3-2', 'd0-3-3', 'd0-3-4'])
    expect(herd.every((d) => d.candidateId === 'd0-3' && d.pattern === 'herd')).toBe(true)
    expect(herd.every((d) => d.motion === 'herd' && d.phase === 'wait')).toBe(true)
    expect(spawnDeer(c, 1000)).toEqual(herd)
    // 群れは同じ側に、少しずつ奥に並ぶ
    expect(herd.every((d) => d.d < 0)).toBe(true)
    expect(spawnDeer(candidate('cross'), 0)).toHaveLength(1)
    expect(spawnDeer(candidate('follower'), 0)).toHaveLength(2)
  })

  it('UC-5e: 出た直下の位置: 路肩は路肩、林縁は林の中（遮蔽）、右側の候補は d が正', () => {
    const [road] = spawnDeer(candidate('graze'), 0)
    expect(Math.abs(road?.d ?? 0)).toBeGreaterThanOrEqual(4)
    expect(Math.abs(road?.d ?? 0)).toBeLessThanOrEqual(6.5)
    expect(road?.occluded).toBe(false)

    const [eye] = spawnDeer(candidate('eyeshine', { side: 'R' }), 0)
    expect(eye?.d).toBeGreaterThanOrEqual(9)
    expect(eye?.d).toBeLessThanOrEqual(14)
    expect(eye?.occluded).toBe(true)
  })

  it('UC-5e: 揺らぎは候補の seed から（seed が違えば位置が変わる）', () => {
    const a = spawnDeer(candidate('graze', { seed: 1 }), 0)[0]
    const b = spawnDeer(candidate('graze', { seed: 2 }), 0)[0]
    expect(a).not.toEqual(b)
  })
})

describe('動き（drive-deer R3）', () => {
  it('UC-3a: graze は動かない（車が近づいて通り過ぎても位置が同じ）。車が近いと顔を上げる', () => {
    const c = candidate('graze')
    const [first] = spawnDeer(c, 0)
    const trace = simulate(c, 25, 1700, cruise(60))
    for (const { deer } of trace) {
      expect(deer[0]?.s).toBe(first?.s)
      expect(deer[0]?.d).toBe(first?.d)
      expect(deer[0]?.gone).toBe(false)
    }
    expect(trace.some(({ deer }) => deer[0]?.pose === 'look')).toBe(true)
  })

  it('UC-3a: eyeshine は林の中（|d| 9〜14 m、遮蔽あり）から動かない', () => {
    const c = candidate('eyeshine')
    const [first] = spawnDeer(c, 0)
    for (const { deer } of simulate(c, 25, 1700, cruise(60))) {
      const d = deer[0] as Deer
      expect(d.s).toBe(first?.s)
      expect(d.d).toBe(first?.d)
      expect(Math.abs(d.d)).toBeGreaterThanOrEqual(9)
      expect(d.occluded).toBe(true)
    }
  })

  it('UC-3b: cross は車が遠くで止まっていると始まらない', () => {
    const c = candidate('cross')
    const trace = simulate(c, 60, c.s - 150, () => 0)
    const last = trace.at(-1)?.deer[0]
    expect(last?.phase).toBe('wait')
    expect(last?.d).toBe(spawnDeer(c, 0)[0]?.d)
  })

  it.each(sides)(
    'UC-3b: cross は %s の路肩から、20〜110 m で動き出し、s を変えずに反対側の林へ渡りきる',
    (side) => {
      const c = candidate('cross', { side })
      const trace = simulate(c, 60, c.s - 300, cruise(30))
      const gap = startGap(trace, c)
      expect(gap).toBeGreaterThanOrEqual(TRIGGER_MIN_M - 1)
      expect(gap).toBeLessThanOrEqual(TRIGGER_MAX_M + 1)
      const sign = signOf(side)
      const start = trace[0]?.deer[0] as Deer
      expect(Math.sign(start.d)).toBe(sign)
      expect(Math.abs(start.d)).toBeLessThan(FOREST_EDGE_M)
      const end = trace.find(({ deer }) => deer[0]?.gone)?.deer[0] as Deer
      expect(end).toBeDefined()
      expect(Math.sign(end.d)).toBe(-sign)
      expect(Math.abs(end.d)).toBeGreaterThanOrEqual(FOREST_EDGE_M)
      expect(end.s).toBe(start.s)
      expect(end.occluded).toBe(true)
    },
  )

  it.each(sides)(
    'UC-3c: stop-midway（%s）は中央線で止まって車を見て、0.8〜2 秒後にまた渡る',
    (side) => {
      const c = candidate('stop-midway', { side })
      const trace = simulate(c, 60, c.s - 300, cruise(30))
      const pausedAt = trace.findIndex(({ deer }) => deer[0]?.phase === 'pause')
      expect(pausedAt).toBeGreaterThan(0)
      expect(trace[pausedAt]?.deer[0]?.d).toBe(STOP_D)
      expect(trace[pausedAt]?.deer[0]?.pose).toBe('look')
      const resumedAt = trace.findIndex(({ deer }) => deer[0]?.phase === 'resume')
      const pauseMs = (trace[resumedAt]?.t ?? 0) - (trace[pausedAt]?.t ?? 0)
      expect(pauseMs).toBeGreaterThanOrEqual(800 - STEP_MS)
      expect(pauseMs).toBeLessThanOrEqual(2000 + STEP_MS)
      const end = trace.find(({ deer }) => deer[0]?.gone)?.deer[0]
      expect(Math.sign(end?.d ?? 0)).toBe(-signOf(side))
    },
  )

  it.each(sides)('UC-3d: turn-back（%s）は車線に入ってから向きを変え、来た側の林へ戻る', (side) => {
    const c = candidate('turn-back', { side })
    const trace = simulate(c, 60, c.s - 300, cruise(30))
    const ds = trace.map(({ deer }) => deer[0]?.d ?? 0)
    const deepest = side === 'R' ? Math.min(...ds) : Math.max(...ds)
    expect(deepest).toBeCloseTo(side === 'R' ? TURN_D.fromR : TURN_D.fromL, 5)
    // 左車線（-2.6〜-0.9）に体がかかるところまで入る
    expect(Math.abs(deepest - LANE_CENTER_D)).toBeLessThan(1.3)
    const end = trace.find(({ deer }) => deer[0]?.gone)?.deer[0]
    expect(end).toBeDefined()
    expect(Math.sign(end?.d ?? 0)).toBe(signOf(side))
  })

  it.each(sides)('UC-3e: diagonal（%s）は s と d の両方が動いて横切る', (side) => {
    for (const seed of [1, 2, 3, 4]) {
      const c = candidate('diagonal', { side, seed })
      const trace = simulate(c, 60, c.s - 300, cruise(30))
      const start = trace[0]?.deer[0] as Deer
      const end = trace.find(({ deer }) => deer[0]?.gone)?.deer[0] as Deer
      expect(end).toBeDefined()
      expect(Math.abs(end.s - start.s)).toBeGreaterThan(3)
      expect(Math.sign(end.d)).toBe(-signOf(side))
    }
  })

  it.each(sides)(
    'UC-3f: parallel（%s）は路肩を車と同じ向きに走り、車が近づくと前を横切る',
    (side) => {
      const c = candidate('parallel', { side })
      const trace = simulate(c, 40, c.s - 300, cruise(60))
      const goAt = trace.findIndex(({ deer }) => deer[0]?.phase === 'go')
      const leaveAt = trace.findIndex(({ deer }) => deer[0]?.phase === 'leave')
      expect(goAt).toBeGreaterThan(0)
      expect(leaveAt).toBeGreaterThan(goAt)
      const atGo = trace[goAt]?.deer[0] as Deer
      const atLeave = trace[leaveAt]?.deer[0] as Deer
      // 並走の間は s が増え、d は路肩のまま
      expect(atLeave.s - atGo.s).toBeGreaterThan(5)
      expect(Math.sign(atLeave.d)).toBe(signOf(side))
      expect(Math.abs(atLeave.d)).toBeGreaterThan(ROAD_EDGE_M)
      const end = trace.find(({ deer }) => deer[0]?.gone)?.deer[0]
      expect(Math.sign(end?.d ?? 0)).toBe(-signOf(side))
    },
  )

  it.each(sides)(
    'UC-3g: dart（%s）は動き出すまで林の中（遮蔽）で、15〜40 m で走り出て林から出る',
    (side) => {
      for (const seed of [11, 12, 13, 14, 15]) {
        const c = candidate('dart', { side, seed })
        const trace = simulate(c, 30, c.s - 300, cruise(60))
        const startAt = trace.findIndex(({ deer }) => deer[0]?.phase !== 'wait')
        expect(trace.slice(0, startAt).every(({ deer }) => deer[0]?.occluded)).toBe(true)
        const gap = startGap(trace, c)
        expect(gap).toBeGreaterThanOrEqual(DART_GAP_M[0] - 1)
        expect(gap).toBeLessThanOrEqual(DART_GAP_M[1] + 1)
        expect(trace.slice(startAt).some(({ deer }) => deer[0]?.occluded === false)).toBe(true)
      }
    },
  )

  it.each(sides)('UC-3h: graze-dash（%s）は草をはみ（idle）、25〜50 m で急に走り出す', (side) => {
    const c = candidate('graze-dash', { side })
    const trace = simulate(c, 30, c.s - 300, cruise(60))
    const startAt = trace.findIndex(({ deer }) => deer[0]?.phase !== 'wait')
    expect(trace.slice(0, startAt).every(({ deer }) => deer[0]?.pose === 'idle')).toBe(true)
    const gap = startGap(trace, c)
    expect(gap).toBeGreaterThanOrEqual(DASH_GAP_M[0] - 1)
    expect(gap).toBeLessThanOrEqual(DASH_GAP_M[1] + 1)
    expect(trace[startAt]?.deer[0]?.pose).toBe('run')
  })

  it('UC-3i: herd は 1 頭ずつ約 1 秒遅れて渡る', () => {
    const c = candidate('herd', { herdSize: 4 })
    const trace = simulate(c, 60, c.s - 300, cruise(30))
    const initial = spawnDeer(c, 0)
    const moveAt = initial.map((d0, i) => trace.find(({ deer }) => deer[i]?.d !== d0.d)?.t ?? NaN)
    for (let i = 1; i < moveAt.length; i++) {
      const lag = (moveAt[i] ?? 0) - (moveAt[i - 1] ?? 0)
      expect(lag).toBeGreaterThan(700)
      expect(lag).toBeLessThan(1300)
    }
    expect(trace.at(-1)?.deer.every((d) => d.gone && d.d > 0)).toBe(true)
  })

  it.each(sides)(
    'UC-3j: follower（%s）は 2 頭で、1 頭目が先に車線を渡り、2 頭目（林の陰）が遅れて続く',
    (side) => {
      const c = candidate('follower', { side })
      const trace = simulate(c, 40, c.s - 300, cruise(60))
      expect(trace[0]?.deer[1]?.occluded).toBe(true)
      const crossLane = (i: number) =>
        trace.find(({ deer }) => {
          const d = deer[i]
          return d !== undefined && (d.d - LANE_CENTER_D) * signOf(side) <= 0
        })?.t ?? NaN
      expect(crossLane(1) - crossLane(0)).toBeGreaterThan(1000)
      expect(trace.at(-1)?.deer.every((d) => d.gone)).toBe(true)
    },
  )

  it('UC-3k: frozen は自分の車線（d ≈ -1.75）に出て立ちすくむ', () => {
    for (const side of sides) {
      const c = candidate('frozen', { side })
      // 車は 30 m 手前まで来て、ゆっくり走り続ける（止まらない）
      const trace = simulate(c, 8, c.s - 120, (car) => (c.s - car.s > 30 ? 15 : 0.6))
      const d = trace.at(-1)?.deer[0] as Deer
      expect(d.d).toBeCloseTo(LANE_CENTER_D, 5)
      expect(d.phase).toBe('stand')
      expect(d.pose).toBe('look')
      expect(d.gone).toBe(false)
    }
  })

  it('UC-3k: frozen は、車が止まって 3 秒で車線の外へ去る', () => {
    const c = candidate('frozen')
    const trace = simulate(c, 20, c.s - 120, (car) => (car.s < c.s - 35 ? 10 : 0))
    const frozenAt = trace.find(({ deer }) => deer[0]?.phase === 'stand')
    const leaveAt = trace.find(({ deer }) => deer[0]?.phase === 'leave')
    expect(frozenAt).toBeDefined()
    expect(leaveAt).toBeDefined()
    expect(leaveAt?.car.stoppedMs).toBeGreaterThanOrEqual(FROZEN_STOPPED_LEAVE_MS)
    expect((leaveAt?.t ?? 0) - (frozenAt?.t ?? 0)).toBeLessThan(FROZEN_TIMEOUT_MS)
    const later = trace.find(({ t }) => t > (leaveAt?.t ?? 0) + 1500)?.deer[0]
    expect(Math.abs(later?.d ?? 0)).toBeGreaterThan(ROAD_EDGE_M)
    expect(trace.at(-1)?.deer[0]?.gone).toBe(true)
  })

  it('UC-5g: frozen は、車が止まらなくても 12 秒で去る', () => {
    const c = candidate('frozen')
    const trace = simulate(c, 25, c.s - 120, (car) => (c.s - car.s > 30 ? 15 : 0.6))
    const frozenAt = trace.find(({ deer }) => deer[0]?.phase === 'stand')
    const leaveAt = trace.find(({ deer }) => deer[0]?.phase === 'leave')
    expect(leaveAt?.car.stoppedMs).toBe(0)
    const frozenFor = (leaveAt?.t ?? 0) - (frozenAt?.t ?? 0)
    expect(frozenFor).toBeGreaterThanOrEqual(FROZEN_TIMEOUT_MS - STEP_MS)
    expect(frozenFor).toBeLessThan(FROZEN_TIMEOUT_MS + 100)
  })

  it('UC-3l: 動きの係数は鹿の種から決まり、s が動いても変わらない。同じ候補・同じ運転なら同じ動き', () => {
    const [deer] = spawnDeer(candidate('parallel'), 0)
    if (!deer) throw new Error('鹿がない')
    const moved: Deer = { ...deer, s: deer.s + 37.5, d: deer.d + 1 }
    expect(motionOf(moved)).toEqual(motionOf(deer))
    const c = candidate('herd', { herdSize: 3 })
    expect(simulate(c, 15, c.s - 300, cruise(40)).at(-1)).toEqual(
      simulate(c, 15, c.s - 300, cruise(40)).at(-1),
    )
  })
})

describe('動き出す距離（drive-deer R4）', () => {
  it('UC-4a: 渡る鹿は車の速さから動き出す距離を決める（速いほど遠く。20〜110 m）', () => {
    let strict = 0
    for (let seed = 0; seed < 40; seed++) {
      for (const motion of ['cross', 'stop-midway', 'turn-back', 'diagonal', 'herd'] as const) {
        const [deer] = spawnDeer(candidate(motion, { seed, side: seed % 2 ? 'L' : 'R' }), 0)
        if (!deer) throw new Error('鹿がない')
        const slow = triggerGapM(deer, { carSpeed: 30 / 3.6 })
        const fast = triggerGapM(deer, { carSpeed: 80 / 3.6 })
        expect(slow).toBeGreaterThanOrEqual(TRIGGER_MIN_M)
        expect(fast).toBeLessThanOrEqual(TRIGGER_MAX_M)
        expect(fast).toBeGreaterThanOrEqual(slow)
        if (fast > slow) strict++
      }
    }
    expect(strict).toBeGreaterThan(100)
  })
})
