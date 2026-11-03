import { describe, expect, it } from 'vitest'
import type { Deer, DeerCandidate, DeerPattern } from '../types'
import {
  FOREST_EDGE_M,
  FROZEN_STOPPED_LEAVE_MS,
  FROZEN_TIMEOUT_MS,
  TRIGGER_MAX_M,
  TRIGGER_MIN_M,
  spawnDeer,
  stepDeer,
  type DeerContext,
} from './deer-motion'
import { LANE_CENTER_D, ROAD_EDGE_M } from './vehicle'

const DT = 1 / 60
const STEP_MS = 1000 / 60

function candidate(pattern: DeerPattern, overrides: Partial<DeerCandidate> = {}): DeerCandidate {
  return {
    id: 'd0-3',
    interval: 0,
    s: 2000,
    u: 0.1,
    pattern,
    side: 'L',
    herdSize: pattern === 'herd' ? 4 : 1,
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

describe('spawnDeer（R5）', () => {
  it('UC-5e: 群れは herdSize 頭で、id は 候補の id-番号。同じ候補からは同じ鹿', () => {
    const c = candidate('herd', { herdSize: 5 })
    const herd = spawnDeer(c, 1000)
    expect(herd.map((d) => d.id)).toEqual(['d0-3-0', 'd0-3-1', 'd0-3-2', 'd0-3-3', 'd0-3-4'])
    expect(herd.every((d) => d.candidateId === 'd0-3' && d.pattern === 'herd')).toBe(true)
    expect(spawnDeer(c, 1000)).toEqual(herd)
    // 群れは同じ側に、少しずつ奥に並ぶ
    expect(herd.every((d) => d.d < 0)).toBe(true)
    expect(spawnDeer(candidate('crossing'), 0)).toHaveLength(1)
  })

  it('UC-5e: 出た直下の位置: 路肩は路肩、林縁は林の中（遮蔽）、右側の候補は d が正', () => {
    const [road] = spawnDeer(candidate('roadside'), 0)
    expect(Math.abs(road?.d ?? 0)).toBeGreaterThanOrEqual(4)
    expect(Math.abs(road?.d ?? 0)).toBeLessThanOrEqual(6.5)
    expect(road?.occluded).toBe(false)

    const [eye] = spawnDeer(candidate('eyeshine', { side: 'R' }), 0)
    expect(eye?.d).toBeGreaterThanOrEqual(9)
    expect(eye?.d).toBeLessThanOrEqual(14)
    expect(eye?.occluded).toBe(true)
  })

  it('UC-5e: 揺らぎは候補の seed から（seed が違えば位置が変わる）', () => {
    const a = spawnDeer(candidate('roadside', { seed: 1 }), 0)[0]
    const b = spawnDeer(candidate('roadside', { seed: 2 }), 0)[0]
    expect(a).not.toEqual(b)
  })
})

describe('stepDeer（R5）', () => {
  it('UC-5e: 路肩は動かない（車が近づいて通り過ぎても位置が同じ）', () => {
    const c = candidate('roadside')
    const [first] = spawnDeer(c, 0)
    const trace = simulate(c, 25, 1700, cruise(60))
    for (const { deer } of trace) {
      expect(deer[0]?.s).toBe(first?.s)
      expect(deer[0]?.d).toBe(first?.d)
      expect(deer[0]?.gone).toBe(false)
    }
    // 車が近いと顔を上げる
    expect(trace.some(({ deer }) => deer[0]?.pose === 'look')).toBe(true)
  })

  it('UC-5e: 林縁は林の中（|d| 9〜14 m、遮蔽あり）から動かない', () => {
    const c = candidate('eyeshine')
    const [first] = spawnDeer(c, 0)
    for (const { deer } of simulate(c, 25, 1700, cruise(60))) {
      const d = deer[0] as Deer
      expect(d.s).toBe(first?.s)
      expect(d.d).toBe(first?.d)
      expect(Math.abs(d.d)).toBeGreaterThanOrEqual(9)
      expect(Math.abs(d.d)).toBeLessThanOrEqual(14)
      expect(d.occluded).toBe(true)
    }
  })

  it('UC-5e: 横断は車が遠くで止まっていると始まらない', () => {
    const c = candidate('crossing')
    const trace = simulate(c, 60, c.s - 150, () => 0)
    const last = trace.at(-1)?.deer[0]
    expect(last?.startedAt).toBeNull()
    expect(last?.d).toBe(spawnDeer(c, 0)[0]?.d)
  })

  it.each(['L', 'R'] as const)(
    'UC-5e: 横断は車が 80〜100 m に来たら、%s の路肩から反対側へ渡りきって去る',
    (side) => {
      const c = candidate('crossing', { side })
      const trace = simulate(c, 40, c.s - 300, cruise(30))
      const startIndex = trace.findIndex(({ deer }) => deer[0]?.startedAt !== null)
      expect(startIndex).toBeGreaterThan(0)
      const gap = c.s - (trace[startIndex]?.car.s ?? 0)
      expect(gap).toBeGreaterThanOrEqual(TRIGGER_MIN_M - 1)
      expect(gap).toBeLessThanOrEqual(TRIGGER_MAX_M + 1)

      const sign = side === 'L' ? -1 : 1
      const start = trace[0]?.deer[0] as Deer
      expect(Math.sign(start.d)).toBe(sign)
      expect(Math.abs(start.d)).toBeLessThan(FOREST_EDGE_M)
      const goneAt = trace.find(({ deer }) => deer[0]?.gone)
      const end = goneAt?.deer[0] as Deer
      expect(end).toBeDefined()
      // 反対側の林の中まで渡りきる。s は変わらない（道を真横に渡る）
      expect(Math.sign(end.d)).toBe(-sign)
      expect(Math.abs(end.d)).toBeGreaterThanOrEqual(FOREST_EDGE_M)
      expect(end.s).toBe(start.s)
      expect(end.occluded).toBe(true)
    },
  )

  it('UC-5e: 群れは 1 頭ずつ約 1 秒遅れて渡る', () => {
    const c = candidate('herd', { herdSize: 4 })
    const trace = simulate(c, 40, c.s - 300, cruise(30))
    // それぞれが初めて横に動いた時刻
    const initial = spawnDeer(c, 0)
    const moveAt = initial.map((d0, i) => {
      const hit = trace.find(({ deer }) => deer[i]?.d !== d0.d)
      return hit?.t ?? Number.NaN
    })
    for (let i = 1; i < moveAt.length; i++) {
      const lag = (moveAt[i] ?? 0) - (moveAt[i - 1] ?? 0)
      expect(lag).toBeGreaterThan(700)
      expect(lag).toBeLessThan(1300)
    }
    // 全頭が反対側へ渡りきる
    expect(trace.at(-1)?.deer.every((d) => d.gone && d.d > 0)).toBe(true)
  })

  it('UC-5e: 立ちすくみは自分の車線（d ≈ -1.75）に出て止まる', () => {
    for (const side of ['L', 'R'] as const) {
      const c = candidate('frozen', { side })
      // 車は 75 m 手前まで来て、ゆっくり走り続ける（止まらない）
      const trace = simulate(c, 8, c.s - 120, (car) => (c.s - car.s > 75 ? 15 : 0.6))
      const d = trace.at(-1)?.deer[0] as Deer
      expect(d.d).toBeCloseTo(LANE_CENTER_D, 5)
      expect(d.pose).toBe('look')
      expect(d.gone).toBe(false)
    }
  })

  it('UC-5g: 立ちすくみは、車が止まって 3 秒で車線の外へ去る', () => {
    const c = candidate('frozen')
    // 70 m 手前で止まる
    const trace = simulate(c, 20, c.s - 120, (car) => (car.s < c.s - 70 ? 10 : 0))
    const frozenAt = trace.find(
      ({ deer }) => deer[0]?.pose === 'look' && deer[0]?.startedAt !== null,
    )
    expect(frozenAt).toBeDefined()
    const leaveAt = trace.find(({ deer }) => deer[0]?.pose === 'run')
    expect(leaveAt).toBeDefined()
    // 去り始めたとき、車は 3 秒以上止まっている（12 秒より早い）
    expect(leaveAt?.car.stoppedMs).toBeGreaterThanOrEqual(FROZEN_STOPPED_LEAVE_MS)
    expect((leaveAt?.t ?? 0) - (frozenAt?.t ?? 0)).toBeLessThan(FROZEN_TIMEOUT_MS)
    // 少しあとには車線（路肩の内側）の外にいて、やがて消える
    const later = trace.find(({ t }) => t > (leaveAt?.t ?? 0) + 1500)?.deer[0]
    expect(Math.abs(later?.d ?? 0)).toBeGreaterThan(ROAD_EDGE_M)
    expect(trace.at(-1)?.deer[0]?.gone).toBe(true)
  })

  it('UC-5g: 立ちすくみは、車が止まらなくても 12 秒で去る', () => {
    const c = candidate('frozen')
    // 車は 75 m 手前からじわじわ進む（0.6 m/s。止まってはいない）
    const trace = simulate(c, 25, c.s - 120, (car) => (c.s - car.s > 75 ? 15 : 0.6))
    const frozenAt = trace.find(
      ({ deer }) => deer[0]?.pose === 'look' && deer[0]?.startedAt !== null,
    )
    const leaveAt = trace.find(({ deer }) => deer[0]?.pose === 'run')
    expect(frozenAt).toBeDefined()
    expect(leaveAt).toBeDefined()
    expect(leaveAt?.car.stoppedMs).toBe(0)
    const frozenFor = (leaveAt?.t ?? 0) - (frozenAt?.t ?? 0)
    expect(frozenFor).toBeGreaterThanOrEqual(FROZEN_TIMEOUT_MS - STEP_MS)
    expect(frozenFor).toBeLessThan(FROZEN_TIMEOUT_MS + 100)
  })

  it('UC-5e: 同じ候補・同じ運転なら同じ動き', () => {
    const c = candidate('herd', { herdSize: 3 })
    const a = simulate(c, 15, c.s - 300, cruise(40)).at(-1)
    const b = simulate(c, 15, c.s - 300, cruise(40)).at(-1)
    expect(a).toEqual(b)
  })
})
