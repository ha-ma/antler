import { deriveAlertState, type DerivedAlert } from '@antler/alert-ui'
import type { ReceivedFlag } from '@antler/schema'
import { describe, expect, it } from 'vitest'
import {
  cameraSees,
  DELAY_MAX_MS,
  DELAY_MIN_MS,
  DETECT_TICK_MS,
  detectProbability,
  INITIAL_DETECTOR,
  stepDetector,
  type CameraPose,
  type DetectorState,
  type Sighting,
  WINDOW_FOG_FACTOR,
} from './detection'
import { createRng } from './rng'
import { demoScenario } from './scenario'
import { ZONES } from './zones-data'

// 北（-z）を向いた車。右は東（+x）
const camera: CameraPose = { x: 0, z: 0, forward: [0, -1], right: [1, 0] }
const deerAt = (x: number, z: number, occluded = false) => ({ id: 'a', x, z, occluded })
const always = () => 0 // rng() < p が常に真

describe('カメラの検知条件（R6）', () => {
  it('UC-6a: 120 m は対象、121 m は対象外。画角の外・後ろ・林縁（遮蔽）は対象外', () => {
    expect(cameraSees(camera, deerAt(0, -120))).not.toBeNull()
    expect(cameraSees(camera, deerAt(0, -121))).toBeNull()
    // 画角は左右 50°（drive-deer R6。35° から広げた）
    expect(cameraSees(camera, deerAt(65, -50))).toBeNull() // 約 52° は ±50° の外
    expect(cameraSees(camera, deerAt(50, -50))).not.toBeNull() // 45° は内
    expect(cameraSees(camera, deerAt(20, -50))).not.toBeNull() // 約 22°
    expect(cameraSees(camera, deerAt(0, 30))).toBeNull() // 後ろ
    expect(cameraSees(camera, deerAt(0, -50, true))).toBeNull() // 遮蔽
  })

  it('UC-6f: 左右は車から見た横の位置。真正面は R', () => {
    expect(cameraSees(camera, deerAt(-3, -60))?.side).toBe('L')
    expect(cameraSees(camera, deerAt(3, -60))?.side).toBe('R')
    expect(cameraSees(camera, deerAt(0, -60))?.side).toBe('R')
    expect(cameraSees(camera, deerAt(3, -60))?.distanceM).toBeCloseTo(Math.hypot(3, 60), 5)
  })

  it('UC-6b: 捕捉の確率は昼・晴れ・曇りなしで 0.95、夜・雪・窓 medium で 0.7 × 0.8 × 0.9。捕捉しない鹿は検知されない', () => {
    expect(detectProbability('day', 'clear', 'none')).toBeCloseTo(0.95, 6)
    expect(detectProbability('night', 'snow', 'medium')).toBeCloseTo(0.7 * 0.8 * 0.9, 6)
    // 確率 0 で引くと捕捉されず、その後ずっと検知されない（引き直さない）
    const seen: Sighting = { deerId: 'a', distanceM: 80, side: 'L' }
    let state = INITIAL_DETECTOR
    for (let t = 100; t <= 3000; t += 100) {
      const p = t === 100 ? 0 : 1
      const r = stepDetector(state, t, [seen], p, always)
      state = r.state
      expect(r.out.kind).toBe('none')
    }
    expect(state.captured['a']).toBe(false)
  })
})

/** 決まった鹿の列を 0.1 秒ごとに流す */
function run(frames: (t: number) => Sighting[], untilMs: number, seed = 1) {
  const rng = createRng(seed)
  let state: DetectorState = INITIAL_DETECTOR
  const log: { t: number; kind: string; sighting: Sighting | null }[] = []
  for (let t = DETECT_TICK_MS; t <= untilMs; t += DETECT_TICK_MS) {
    const r = stepDetector(state, t, frames(t), 1, rng)
    state = r.state
    if (r.out.kind !== 'none') log.push({ t, kind: r.out.kind, sighting: r.out.sighting })
  }
  return log
}

const toFlag = (s: Sighting | null): ReceivedFlag =>
  s
    ? {
        deer: true,
        strict: true,
        distanceM: s.distanceM,
        side: s.side,
        zone: 'inside',
        zoneRemainingKm: 3,
      }
    : { deer: false, strict: true, zone: 'inside', zoneRemainingKm: 3 }

describe('車内の窓の曇り（drive-link R6）', () => {
  it('UC-3f: 窓の曇りの係数は none 1.0・light 0.95・medium 0.9・heavy 0.85。見本の場面は light', () => {
    expect(WINDOW_FOG_FACTOR).toEqual({ none: 1, light: 0.95, medium: 0.9, heavy: 0.85 })
    expect(detectProbability('day', 'clear', 'heavy')).toBeCloseTo(0.95 * 0.85, 6)
    expect(demoScenario(ZONES).windowFog).toBe('light')
  })
})

describe('フラグ（R6）', () => {
  it('UC-6c: 最初の検知から 150〜400 ms 後に deer:true（距離と左右）。遅延はシードで決まる', () => {
    const deer: Sighting = { deerId: 'a', distanceM: 90, side: 'R' }
    for (let seed = 1; seed <= 50; seed++) {
      const log = run((t) => (t >= 1000 ? [deer] : []), 3000, seed)
      const first = log[0]
      expect(first?.kind).toBe('deer')
      const delay = (first?.t ?? 0) - 1000
      expect(delay).toBeGreaterThanOrEqual(DELAY_MIN_MS)
      expect(delay).toBeLessThanOrEqual(DELAY_MAX_MS)
      expect(first?.sighting).toEqual(deer)
      expect(run((t) => (t >= 1000 ? [deer] : []), 3000, seed)).toEqual(log)
    }
  })

  it('UC-6d: どの鹿も検知していない時間が 1.5 秒続くと deer:false。deriveAlertState は zone に戻る', () => {
    const deer: Sighting = { deerId: 'a', distanceM: 60, side: 'L' }
    const log = run((t) => (t >= 1000 && t < 3000 ? [deer] : []), 6000)
    const release = log.find((e) => e.kind === 'release')
    // 最後の検知は 2900 ms。その 1.5 秒後
    expect(release?.t).toBe(4400)
    let previous: DerivedAlert | null = null
    for (const e of log) {
      previous = deriveAlertState({
        flag: toFlag(e.sighting),
        flagReceivedAt: e.t,
        gps: { status: 'inside', remainingKm: 3 },
        now: e.t,
        previous,
      })
    }
    expect(previous?.state).toBe('zone')
  })

  it('UC-6g: 7 秒続けて検知している間、0.1 秒ごとに出し直し、deriveAlertState は danger のまま', () => {
    const deer: Sighting = { deerId: 'a', distanceM: 100, side: 'R' }
    const log = run(() => [deer], 8000)
    const shown = log.filter((e) => e.kind === 'deer')
    expect(shown.length).toBeGreaterThan(70)
    let previous: DerivedAlert | null = null
    let lastAt = 0
    for (let now = shown[0]?.t ?? 0; now <= 8000; now += 100) {
      const e = shown.find((x) => x.t === now)
      if (e) lastAt = e.t
      previous = deriveAlertState({
        flag: toFlag(deer),
        flagReceivedAt: lastAt,
        gps: { status: 'inside', remainingKm: 3 },
        now,
        previous,
      })
      expect(previous.state).toBe('danger')
    }
  })

  it('UC-6h: 2 頭のとき距離と左右は近い方から。片方が見えなくなっても deer:false にならない', () => {
    const near: Sighting = { deerId: 'a', distanceM: 40, side: 'L' }
    const far: Sighting = { deerId: 'b', distanceM: 90, side: 'R' }
    const log = run((t) => (t < 2000 ? [far, near] : [far]), 4000)
    const before = log.filter((e) => e.kind === 'deer' && e.t < 2000)
    expect(before.at(-1)?.sighting).toEqual(near)
    const after = log.filter((e) => e.t >= 2000)
    expect(after.every((e) => e.kind === 'deer')).toBe(true)
    expect(after.at(-1)?.sighting).toEqual(far)
  })
})
