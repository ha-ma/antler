import { planRoute } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import type { Deer, DeerMotion, World } from '../types'
import { NO_INPUT } from '../types'
import { boxesOverlap, carBox, CAR_WIDTH_M, deerBox, DEER_LENGTH_M } from './collision'
import { DEFAULT_REACTION_MS, runDeerCase, type DeerCase } from './deer-cases'
import {
  DART_GAP_M,
  DASH_GAP_M,
  FROZEN_GAP_M,
  motionOf,
  PARALLEL_START_GAP_M,
  spawnDeer,
  TRIGGER_MAX_M,
  TRIGGER_MIN_M,
} from './deer-motion'
import { MAX_ENCOUNTERS, MIN_ENCOUNTERS, MOTION_PATTERN } from './deer-spawn'
import {
  bandProbability,
  cameraSees,
  detectBand,
  INITIAL_DETECTOR,
  stepDetector,
  type Sighting,
} from './detection'
import { attentiveDriver } from './drive-harness'
import { poseAt } from './road'
import { demoScenario } from './scenario'
import { advance, createWorld, driveResult, setInput, setRate, type SimEvent } from './simulation'
import { buildStages, capIntervals, MAX_ZONE_M } from './stages'
import { LANE_CENTER_D, SURFACE_MU } from './vehicle'
import { zoneStatusFromS } from './zone-status'
import { ZONES } from './zones-data'

// drive-deer（docs/specs/drive-deer/functional.md）: 遭遇の回数・ゾーンの長さ・動き 12 種・至近の飛び出し・当たり判定・左右の検知。
// 動きの単体は deer-motion.test.ts、候補は deer-spawn.test.ts。ここはシミュレーション全体で見る。

const FRAME_MS = 1000 / 60
const MOVING: DeerMotion[] = [
  'cross',
  'stop-midway',
  'turn-back',
  'diagonal',
  'parallel',
  'dart',
  'graze-dash',
  'herd',
  'follower',
  'frozen',
]
const ALL: DeerMotion[] = [...MOVING, 'graze']
const SIDES = ['L', 'R'] as const

/** 頭なしで最後まで走らせる（ゾーンの外は 16×）。出来事を集める */
function driveToEnd(w: World, cruiseKmh: number): SimEvent[] {
  const events: SimEvent[] = []
  for (let f = 0; f < 400_000 && w.outcome === 'driving'; f++) {
    if (!w.playback.locked && w.playback.rate !== 16) setRate(w, 16)
    setInput(w, attentiveDriver(w, cruiseKmh))
    events.push(...advance(w, FRAME_MS, ZONES))
  }
  return events
}

const candidateOf = (deerId: string) => deerId.split('-').slice(0, 2).join('-')

describe('drive-deer 受け入れ', () => {
  it('AC-1: 見本の場面を慎重な運転者（30 km/h）で走ると、区間ごとに 3〜8 回の遭遇があり、区間は 8 km 以下、手前（drive-crash-spot で 1 km）から出口でクリアする', () => {
    const w = createWorld(demoScenario(ZONES), ZONES)
    for (const v of w.plan.intervals) expect(v.exitKm - v.entryKm).toBeLessThanOrEqual(8 + 1e-9)
    const events = driveToEnd(w, 30)
    expect(w.outcome).toBe('completed')
    expect(events.filter((e) => e.type === 'stage-clear')).toHaveLength(2)
    const byId = new Map(w.candidates.map((c) => [c.id, c]))
    const met: Record<number, number> = {}
    for (const e of events) {
      if (e.type !== 'deer-appear') continue
      const c = byId.get(candidateOf(e.deerIds[0] ?? ''))
      if (c && c.motion !== 'eyeshine') met[c.interval] = (met[c.interval] ?? 0) + 1
    }
    for (let i = 0; i < w.plan.intervals.length; i++) {
      expect(met[i]).toBeGreaterThanOrEqual(MIN_ENCOUNTERS)
      expect(met[i]).toBeLessThanOrEqual(MAX_ENCOUNTERS)
    }
  }, 120_000)

  it('AC-2: 動き × 左右 × 速さの表。何もしないと渡る鹿の 4 割以上に当たり、赤から 0.75 秒でブレーキを踏むと至近の飛び出し（dart）のほかはすべて避けられる。どれも赤になり、赤の始まりの side は出た側', () => {
    let noneHits = 0
    let noneRuns = 0
    const brakeHits: string[] = []
    for (const motion of ALL)
      for (const side of SIDES)
        for (const seed of [1, 2])
          for (const kmh of [40, 80]) {
            const base: DeerCase = {
              motion,
              side,
              kmh,
              surface: 'packed-snow',
              driver: 'none',
              seed,
            }
            const none = runDeerCase(base, ZONES)
            const brake = runDeerCase({ ...base, driver: 'brake' }, ZONES)
            const label = `${motion} ${side} ${String(kmh)} km/h seed ${String(seed)}`
            // UC-6d: 左右どちらから来ても赤になり、赤の始まりの side は出た側（捉える確率 1）
            expect(brake.red, label).toBe(true)
            expect(brake.firstSide, label).toBe(side)
            if (motion === 'graze') {
              expect(none.collided, label).toBe(false)
              continue
            }
            noneRuns++
            if (none.collided) noneHits++
            if (brake.collided) brakeHits.push(label)
            // UC-4b: 動き出す距離は動きごとの範囲
            const [lo, hi] = gapRange(motion)
            expect(none.startGapM, label).not.toBeNull()
            expect(none.startGapM ?? 0, label).toBeGreaterThanOrEqual(lo - 1)
            expect(none.startGapM ?? 0, label).toBeLessThanOrEqual(hi + 1)
          }
    expect(noneHits / noneRuns).toBeGreaterThanOrEqual(0.4)
    expect(brakeHits.every((label) => label.startsWith('dart'))).toBe(true)
    // 至近の飛び出しは、赤で踏んでも避けられないことがある
    expect(brakeHits.length).toBeGreaterThan(0)
  }, 120_000)
})

function gapRange(motion: DeerMotion): readonly [number, number] {
  switch (motion) {
    case 'dart':
      return DART_GAP_M
    case 'graze-dash':
      return DASH_GAP_M
    case 'frozen':
      return FROZEN_GAP_M
    case 'parallel':
      return [PARALLEL_START_GAP_M, PARALLEL_START_GAP_M]
    default:
      return [TRIGGER_MIN_M, TRIGGER_MAX_M]
  }
}

describe('ゾーンの長さ（R2）', () => {
  it('UC-2a: 8 km より長い区間は入口 + 8 km で切る。8 km 以下はそのまま', () => {
    const plan = {
      ...planRoute(demoScenario(ZONES).route, ZONES),
      intervals: [
        { zoneIds: ['a'], entryKm: 2, exitKm: 14.5 },
        { zoneIds: ['b'], entryKm: 20, exitKm: 26 },
      ],
    }
    const capped = capIntervals(plan)
    expect(capped.intervals).toEqual([
      { zoneIds: ['a'], entryKm: 2, exitKm: 2 + MAX_ZONE_M / 1000 },
      { zoneIds: ['b'], entryKm: 20, exitKm: 26 },
    ])
    // 切らなくてよい区間しか無ければ同じもの
    expect(capIntervals(capped)).toBe(capped)
  })

  it('UC-2b: 見本の 1 つ目の区間（8 km を越える）は切られ、ステージの出口・ゾーン状態・候補が揃う', () => {
    const raw = planRoute(demoScenario(ZONES).route, ZONES)
    const first = raw.intervals[0]
    if (!first) throw new Error('区間がない')
    expect(first.exitKm - first.entryKm).toBeGreaterThan(8)
    const w = createWorld(demoScenario(ZONES), ZONES)
    const cut = (first.entryKm + 8) * 1000
    expect(w.plan.intervals[0]?.exitKm).toBeCloseTo(first.entryKm + 8, 9)
    expect(w.internal.stages[0]?.exitM).toBeCloseTo(cut, 6)
    expect(buildStages(w.plan)).toEqual(w.internal.stages)
    expect(zoneStatusFromS(w.plan, cut - 100).gps.status).toBe('inside')
    expect(zoneStatusFromS(w.plan, cut + 100).gps.status).toBe('outside')
    expect(w.candidates.filter((c) => c.interval === 0).every((c) => c.s <= cut)).toBe(true)
  })
})

describe('回数（R1）', () => {
  it('UC-1e: すべての候補が出る（7 月の昼で危険度が低くても）', () => {
    const july = { ...demoScenario(ZONES), startAt: '2026-07-15T11:00+09:00' }
    const w = createWorld(
      { ...july, legPace: [{ sM: 0, departAt: july.startAt, mps: 50 / 3.6 }] },
      ZONES,
    )
    const appeared = new Set(
      driveToEnd(w, 30).flatMap((e) =>
        e.type === 'deer-appear' ? [candidateOf(e.deerIds[0] ?? '')] : [],
      ),
    )
    expect(w.outcome).toBe('completed')
    expect(w.candidates.every((c) => appeared.has(c.id))).toBe(true)
  }, 120_000)
})

describe('出る距離と境目（R4）', () => {
  /** 区間の中を speedKmh で走る車の gap m 先に、車線で立つ鹿を急に置く。赤から 0.75 秒で全力ブレーキ */
  function suddenDeer(surface: 'dry' | 'packed-snow', speedKmh: number, gap: number): boolean {
    const w = createWorld({ ...demoScenario(ZONES), surface, weather: 'clear' }, ZONES)
    const s = (w.plan.intervals[0]?.entryKm ?? 0) * 1000 + 500
    w.vehicle = { ...w.vehicle, s, speed: speedKmh / 3.6 }
    w.playback = { rate: 1, paused: false, locked: true }
    w.candidates = []
    w.internal.detectRng = () => 0
    const [deer] = spawnDeer(
      {
        id: 'z0-0',
        interval: 0,
        s: s + gap,
        pattern: 'frozen',
        motion: 'frozen',
        side: 'L',
        herdSize: 1,
        seed: 5,
      },
      0,
    )
    if (!deer) throw new Error('鹿がない')
    w.deer = [
      { ...deer, d: LANE_CENTER_D, phase: 'stand', pose: 'look', startedAt: 0, occluded: false },
    ]
    let redAt: number | null = null
    for (let f = 0; f < 60 * 10 && w.outcome === 'driving'; f++) {
      if (redAt === null && w.alert.state === 'danger') redAt = w.t
      const brake = redAt !== null && w.t - redAt >= DEFAULT_REACTION_MS
      setInput(
        w,
        brake
          ? { ...NO_INPUT, brake: true }
          : { ...NO_INPUT, throttle: w.vehicle.speed * 3.6 < speedKmh },
      )
      advance(w, FRAME_MS, ZONES)
    }
    return w.outcome === 'collided'
  }

  it('UC-4b: 停止距離の境目: 60 km/h で車線の鹿が 45 m 先に現れると、乾燥では止まれ、圧雪では止まれない。30 m はどちらも、70 m はどちらも止まれる', () => {
    expect(SURFACE_MU.dry).toBeGreaterThan(SURFACE_MU['packed-snow'])
    expect(suddenDeer('dry', 60, 30)).toBe(true)
    expect(suddenDeer('packed-snow', 60, 30)).toBe(true)
    expect(suddenDeer('dry', 60, 45)).toBe(false)
    expect(suddenDeer('packed-snow', 60, 45)).toBe(true)
    expect(suddenDeer('dry', 60, 70)).toBe(false)
    expect(suddenDeer('packed-snow', 60, 70)).toBe(false)
  })
})

describe('当たり判定（R5）', () => {
  /** ずれ（offsetS）が 0 に近い候補の種 */
  function seedNearZeroOffset(motion: DeerMotion): number {
    for (let seed = 1; seed < 5000; seed++) {
      const [deer] = spawnDeer(
        {
          id: 'c0-0',
          interval: 0,
          s: 0,
          pattern: MOTION_PATTERN[motion],
          motion,
          side: 'L',
          herdSize: 1,
          seed,
        },
        0,
      )
      if (deer && Math.abs(motionOf(deer).offsetS) < 0.1) return seed
    }
    throw new Error('種が見つからない')
  }

  it.each(SIDES)('UC-5a: 何もせず 60 km/h で直進すると、ずれ 0 の cross（%s）に当たる', (side) => {
    const seed = seedNearZeroOffset('cross')
    const r = runDeerCase(
      { motion: 'cross', side, kmh: 60, surface: 'dry', driver: 'none', seed },
      ZONES,
    )
    expect(r.collided).toBe(true)
  })

  it.each(SIDES)('UC-5b: 路肩の graze（%s）の鹿へハンドルで寄せると当たる', (side) => {
    const r = runDeerCase(
      { motion: 'graze', side, kmh: 30, surface: 'dry', driver: 'steer', seed: 3 },
      ZONES,
    )
    expect(r.collided).toBe(true)
  })

  it('UC-5c: 当たると collided の合図・遭遇の記録 collided・走行の結果（outcome collided、collidedDeerId）が出る', () => {
    const w = createWorld(demoScenario(ZONES), ZONES)
    const s = (w.plan.intervals[0]?.entryKm ?? 0) * 1000 + 500
    w.vehicle = { ...w.vehicle, s, speed: 50 / 3.6 }
    w.playback = { rate: 1, paused: false, locked: true }
    w.candidates = []
    const [deer] = spawnDeer(
      {
        id: 'h0-0',
        interval: 0,
        s: s + 6,
        pattern: 'frozen',
        motion: 'frozen',
        side: 'L',
        herdSize: 1,
        seed: 9,
      },
      0,
    )
    if (!deer) throw new Error('鹿がない')
    w.deer = [{ ...deer, d: LANE_CENTER_D, phase: 'stand', pose: 'look', startedAt: 0 }]
    const events: SimEvent[] = []
    for (let f = 0; f < 60 && w.outcome === 'driving'; f++)
      events.push(...advance(w, FRAME_MS, ZONES))
    expect(events).toContainEqual({ type: 'collided', deerId: deer.id })
    expect(w.encounters.find((e) => e.deerId === deer.id)?.outcome).toBe('collided')
    expect(driveResult(w, null)).toMatchObject({ outcome: 'collided', collidedDeerId: deer.id })
  })

  it('UC-5d: 箱の境目: 車の右端と鹿が 0.05 m 重なると当たり、0.05 m 離れると当たらない', () => {
    const car = carBox(100, LANE_CENTER_D)
    const edge = LANE_CENTER_D + CAR_WIDTH_M / 2 + DEER_LENGTH_M / 2
    // 鹿は道を横切る向き（体の長さが d の向き）
    expect(boxesOverlap(car, deerBox(100, edge - 0.05, Math.PI / 2))).toBe(true)
    expect(boxesOverlap(car, deerBox(100, edge + 0.05, Math.PI / 2))).toBe(false)
  })

  it('UC-5e: 5 km/h 未満の車に鹿の方から触れても衝突にしない', () => {
    const w = createWorld(demoScenario(ZONES), ZONES)
    const s = (w.plan.intervals[0]?.entryKm ?? 0) * 1000 + 500
    w.vehicle = { ...w.vehicle, s, speed: 3 / 3.6 }
    w.playback = { rate: 1, paused: false, locked: true }
    w.candidates = []
    const [deer] = spawnDeer(
      {
        id: 'q0-0',
        interval: 0,
        s: s + 1,
        pattern: 'frozen',
        motion: 'frozen',
        side: 'L',
        herdSize: 1,
        seed: 9,
      },
      0,
    )
    if (!deer) throw new Error('鹿がない')
    w.deer = [{ ...deer, d: LANE_CENTER_D, phase: 'stand', pose: 'look', startedAt: 0 } as Deer]
    advance(w, 100, ZONES)
    expect(w.outcome).toBe('driving')
  })
})

describe('左右の検知（R6）', () => {
  const camera = {
    x: 0,
    z: 0,
    forward: [0, -1] as [number, number],
    right: [1, 0] as [number, number],
  }

  it('UC-6a: 左車線の車から、右の林の際（d = +9）で 15 m 先の鹿も、左の同じ鹿も画角の内（左右 50°）。side は R・L', () => {
    // 車（カメラ）は d = -1.75。右の鹿は横に 10.75 m、左の鹿は 7.25 m
    const at = (d: number) => ({ id: 'x', x: d - LANE_CENTER_D, z: -15, occluded: false })
    expect(cameraSees(camera, at(9))?.side).toBe('R')
    expect(cameraSees(camera, at(-9))?.side).toBe('L')
    // シーンの座標でも同じ（poseAt の右が d の正）
    const w = createWorld(demoScenario(ZONES), ZONES)
    const car = poseAt(w.internal.frame, 6000, LANE_CENTER_D)
    const right = poseAt(w.internal.frame, 6015, 9)
    const left = poseAt(w.internal.frame, 6015, -9)
    const cam = { x: car.x, z: car.z, forward: car.forward, right: car.right }
    expect(cameraSees(cam, { id: 'r', x: right.x, z: right.z, occluded: false })?.side).toBe('R')
    expect(cameraSees(cam, { id: 'l', x: left.x, z: left.z, occluded: false })?.side).toBe('L')
  })

  it('UC-6b: 遠くで見逃した鹿も、60 m・30 m の帯に入るときに引き直す。同じ帯・遠い帯へ戻っても引き直さない。近い帯ほど捉えやすい', () => {
    expect(detectBand(80)).toBe(0)
    expect(detectBand(45)).toBe(1)
    expect(detectBand(20)).toBe(2)
    expect(bandProbability(0.5, 0)).toBeCloseTo(0.5, 9)
    expect(bandProbability(0.5, 1)).toBeCloseTo(0.75, 9)
    expect(bandProbability(0.5, 2)).toBeCloseTo(0.875, 9)
    const draws: number[] = []
    // 0.9 は 0.5・0.75・0.875 のどれでも外れ、0.8 は 30 m 未満（0.875）でだけ当たる
    const seq = [0.9, 0.9, 0.8]
    const rng = () => {
      const x = seq[draws.length] ?? 0.99
      draws.push(x)
      return x
    }
    let state = INITIAL_DETECTOR
    const at = (t: number, distanceM: number) => {
      const s: Sighting = { deerId: 'a', distanceM, side: 'R' }
      return (state = stepDetector(state, t, [s], 0.5, rng).state)
    }
    at(100, 90) // 帯 0: 0.9 で外れ
    at(200, 85) // 同じ帯: 引かない
    at(300, 50) // 帯 1: 0.9 で外れ
    at(400, 70) // 遠い帯へ戻る: 引かない
    at(500, 55) // 帯 1 にまた入る: 引かない
    expect(draws).toHaveLength(2)
    expect(state.captured.a).toBe(false)
    at(600, 25) // 帯 2: 0.8 < 0.875 で捉える
    expect(state.captured.a).toBe(true)
    // 3 回目の抽選のあとは検知の遅延の 1 回（捉えた後は引き直さない）
    const afterCapture = draws.length
    at(700, 10)
    expect(draws.length).toBe(afterCapture)
  })

  it.each(SIDES)(
    'UC-6c: 60 km/h で %s から来る dart・cross で赤になり、赤の始まりの side は出た側',
    (side) => {
      for (const motion of ['dart', 'cross'] as const) {
        for (const seed of [1, 2, 3]) {
          const r = runDeerCase(
            { motion, side, kmh: 60, surface: 'dry', driver: 'none', seed },
            ZONES,
          )
          expect(r.red, `${motion} seed ${String(seed)}`).toBe(true)
          expect(r.firstSide, `${motion} seed ${String(seed)}`).toBe(side)
        }
      }
    },
  )
})
