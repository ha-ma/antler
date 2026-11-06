import type { RoutePlan } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { personaDay, personaTrip } from '@/test/trip-day'
import type { Deer, World } from '../types'
import { CRASH_SHAKE_S, crashShake } from './crash'
import { attentiveDriver } from './drive-harness'
import { DriveEngine } from './engine'
import { demoScenario } from './scenario'
import { advance, createWorld, pause, setInput, setRate, type SimEvent } from './simulation'
import { isTap, pickDeer, SPOT_EARLY_M, spotDeer, spotTargets } from './spot'
import { buildStages, STAGE_LEAD_M } from './stages'
import { scenarioFromDay } from './trip-scenario'
import { ZONES } from './zones-data'

// drive-crash-spot（docs/specs/drive-crash-spot/functional.md）の domain の部分:
// 1 km 手前から（R1）・衝突の合図とカメラの揺れ（R3）・鹿の発見（R4）。

const FRAME_MS = 1000 / 60

function driveToEnd(w: World, cruiseKmh = 60, maxFrames = 400_000): SimEvent[] {
  const events: SimEvent[] = []
  for (let f = 0; f < maxFrames && w.outcome === 'driving'; f++) {
    if (!w.playback.locked && w.playback.rate !== 16) setRate(w, 16)
    setInput(w, attentiveDriver(w, cruiseKmh))
    events.push(...advance(w, FRAME_MS, ZONES))
  }
  return events
}

/** ペルソナの旅で、鹿ゾーンの区間がいちばん多い日の場面 */
function busiestTripDay() {
  const tripPlan = personaTrip().plan
  const scenarios = tripPlan.days.flatMap((d) => {
    const s = scenarioFromDay({ plan: tripPlan, day: personaDay(d.day, tripPlan) }, '')
    return s ? [{ s, n: createWorld(s, ZONES).plan.intervals.length }] : []
  })
  const best = scenarios.sort((a, b) => b.n - a.n)[0]
  if (!best || best.n === 0) throw new Error('ゾーンを通る日が無い')
  return best.s
}

function plan(intervals: [number, number][]): RoutePlan {
  return {
    route: [],
    cumulativeM: [],
    totalKm: 100,
    intervals: intervals.map(([entryKm, exitKm], i) => ({ zoneIds: [`z${i}`], entryKm, exitKm })),
  }
}

describe('drive-crash-spot 受け入れ（R1）', () => {
  it('AC-1: 見本の場面と旅の場面（区間のいちばん多い日）は最初の入口の 1 km 手前から始まり、「鹿ゾーンまで」は 1.0 km。見本を走るとどのステージも 1 km 手前から始まって completed', () => {
    expect(STAGE_LEAD_M).toBe(1000)
    const demo = new DriveEngine(demoScenario(ZONES), ZONES)
    const trip = new DriveEngine(busiestTripDay(), ZONES)
    for (const engine of [demo, trip]) {
      const w = engine.world
      const first = w.plan.intervals[0]
      if (!first) throw new Error('区間がない')
      expect(w.vehicle.s).toBeCloseTo(first.entryKm * 1000 - 1000, 0)
      const zone = engine.getSnapshot().zone.gps
      expect(zone.status).toBe('outside')
      expect(zone.status === 'outside' && zone.distanceKm).toBeCloseTo(1, 6)
    }

    const w = createWorld(demoScenario(ZONES), ZONES)
    const starts: number[] = [w.vehicle.s]
    const events: SimEvent[] = []
    for (let f = 0; f < 400_000 && w.outcome === 'driving'; f++) {
      const stage = w.internal.stageIndex
      events.push(...driveToEnd(w, 60, 1))
      if (w.internal.stageIndex !== stage && w.outcome === 'driving') starts.push(w.vehicle.s)
    }
    expect(w.outcome).toBe('completed')
    expect(events.filter((e) => e.type === 'stage-clear')).toHaveLength(2)
    w.plan.intervals.forEach((v, i) => {
      // 移ったフレームで 1 ステップ以内（60 km/h で 0.3 m）だけ進んでいてよい
      expect((starts[i] ?? 0) - (v.entryKm * 1000 - 1000)).toBeGreaterThanOrEqual(0)
      expect((starts[i] ?? 0) - (v.entryKm * 1000 - 1000)).toBeLessThan(3)
    })
  }, 120_000)
})

describe('1 km 手前から（R1）', () => {
  it('UC-1a: ステージは [入口 − 1 km, 出口]。始点より前にはしない。1 km より近い 2 つの区間はまとめる', () => {
    expect(buildStages(plan([[0.4, 3]]))).toEqual([{ startM: 0, exitM: 3000, intervals: [0] }])
    expect(
      buildStages(
        plan([
          [10, 12],
          [20, 22],
        ]),
      ),
    ).toEqual([
      { startM: 9000, exitM: 12000, intervals: [0] },
      { startM: 19000, exitM: 22000, intervals: [1] },
    ])
    expect(
      buildStages(
        plan([
          [10, 12],
          [12.8, 14],
        ]),
      ),
    ).toEqual([{ startM: 9000, exitM: 14000, intervals: [0, 1] }])
  })

  it('UC-1b: 旅の場面のどのステージの始まりも、それぞれの入口の 1 km 手前', () => {
    const w = createWorld(busiestTripDay(), ZONES)
    expect(w.internal.stages.length).toBeGreaterThanOrEqual(1)
    w.internal.stages.forEach((stage) => {
      const entry = w.plan.intervals[stage.intervals[0] ?? -1]
      expect(stage.startM).toBeCloseTo((entry?.entryKm ?? 0) * 1000 - 1000, 6)
    })
  })
})

/** 区間の中に車を置き、偶然の鹿を消して、決めた鹿だけを置く（車の前 dsM ごとに 1 頭） */
function inZoneWith(deer: Partial<Deer>[], speedKmh = 40): World {
  const w = createWorld({ ...demoScenario(ZONES), weather: 'clear' }, ZONES)
  const s = (w.plan.intervals[0]?.entryKm ?? 0) * 1000 + 500
  w.vehicle = { ...w.vehicle, s, speed: speedKmh / 3.6 }
  w.playback = { rate: 1, paused: false, locked: true }
  w.candidates = []
  w.deer = deer.map((d, i) => ({
    id: `t${String(i)}`,
    candidateId: `t${String(i)}`,
    pattern: 'roadside',
    motion: 'graze',
    seed: 1,
    phase: 'wait',
    index: 0,
    s: s + 90,
    d: 5,
    heading: Math.PI / 2,
    pose: 'idle',
    occluded: false,
    startedAt: null,
    gone: false,
    ...d,
  }))
  return w
}

describe('衝突の合図とカメラの揺れ（R3）', () => {
  it('UC-3a: collided の合図は、HUD の outcome が collided になる同じ frame() で届く', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    const w = engine.world
    const s = (w.plan.intervals[0]?.entryKm ?? 0) * 1000 + 500
    w.vehicle = { ...w.vehicle, s, d: -1.75, speed: 60 / 3.6 }
    w.playback = { rate: 1, paused: false, locked: true }
    w.candidates = []
    w.deer = [
      {
        id: 'hit',
        candidateId: 'hit',
        pattern: 'frozen',
        motion: 'frozen',
        seed: 1,
        phase: 'stand',
        index: 0,
        s: s + 3,
        d: -1.75,
        heading: Math.PI / 2,
        pose: 'look',
        occluded: false,
        startedAt: 0,
        gone: false,
      },
    ]
    const seen: string[] = []
    engine.onCue((events) => {
      if (events.some((e) => e.type === 'collided')) seen.push(engine.getSnapshot().outcome)
    })
    let frames = 0
    while (engine.getSnapshot().outcome === 'driving' && frames < 120) {
      engine.frame(FRAME_MS)
      frames += 1
    }
    expect(engine.getSnapshot().outcome).toBe('collided')
    expect(seen).toEqual(['collided'])
  })

  it('UC-3e: 揺れは衝突からの実時間で弱まり 0.8 秒で 0。reduced-motion では 0', () => {
    const at = (s: number) => {
      const k = crashShake(s, false)
      return Math.hypot(k.yaw, k.pitch, k.roll)
    }
    const peak = Math.max(...[0.01, 0.02, 0.03, 0.04, 0.05].map(at))
    const late = Math.max(...[0.6, 0.62, 0.64, 0.66, 0.68].map(at))
    expect(peak).toBeGreaterThan(0.01)
    expect(late).toBeLessThan(peak)
    expect(at(CRASH_SHAKE_S)).toBe(0)
    expect(at(2)).toBe(0)
    for (const s of [0, 0.02, 0.3]) expect(crashShake(s, true)).toEqual({ yaw: 0, pitch: 0, roll: 0 })
    // 乱数を使わない（同じ時刻なら同じ揺れ）
    expect(crashShake(0.1, false)).toEqual(crashShake(0.1, false))
  })
})

describe('鹿の発見（R4）', () => {
  it('UC-4a: 出ている鹿を発見すると found が 1 増え、同じ鹿は 2 回目に増えない', () => {
    const w = inZoneWith([{}, { s: 0, d: -5 }])
    const d1 = w.deer[1]
    if (d1) d1.s = w.vehicle.s + 30
    expect(spotDeer(w, 't0')).toBe('early')
    expect(spotDeer(w, 't0')).toBeNull()
    expect(spotDeer(w, 't1')).toBe('late')
    expect(w.spotting).toMatchObject({ found: 2, early: 1 })
  })

  it('UC-4b: 一時停止の間・衝突のあと・いない鹿・去った鹿・見えていない鹿は数えない', () => {
    const w = inZoneWith([
      {},
      { gone: true },
      { occluded: true },
      { s: 0 },
      { motion: 'eyeshine', pattern: 'eyeshine', occluded: true, d: 9 },
    ])
    const far = w.deer[3]
    if (far) far.s = w.vehicle.s + 200
    expect(spotDeer(w, 'nobody')).toBeNull()
    expect(spotDeer(w, 't1')).toBeNull()
    // 林に隠れた鹿・150 m より遠い鹿
    expect(spotDeer(w, 't2')).toBeNull()
    expect(spotDeer(w, 't3')).toBeNull()
    // 昼は目が光らないので、目の反射だけの鹿は見えない
    w.light = 'day'
    expect(spotDeer(w, 't4')).toBeNull()
    pause(w, true)
    expect(spotDeer(w, 't0')).toBeNull()
    pause(w, false)
    w.outcome = 'collided'
    expect(spotDeer(w, 't0')).toBeNull()
    expect(w.spotting).toMatchObject({ found: 0, early: 0 })
  })

  it('UC-4c: 60 m 以上前の鹿は early、60 m より近いか車より後ろの鹿は early にならない', () => {
    const w = inZoneWith([{}, {}, {}, {}])
    const car = w.vehicle.s
    const place = (i: number, s: number) => {
      const d = w.deer[i]
      if (d) d.s = s
    }
    // 中心線から 5 m 横なので、道のりで 60 m 先でも直線の距離は 60 m を少し超える
    place(0, car + SPOT_EARLY_M)
    place(1, car + SPOT_EARLY_M - 2)
    place(2, car - 5)
    place(3, car + 140)
    expect(spotDeer(w, 't0')).toBe('early')
    expect(spotDeer(w, 't1')).toBe('late')
    expect(spotDeer(w, 't2')).toBe('late')
    expect(spotDeer(w, 't3')).toBe('early')
    expect(w.spotting).toMatchObject({ found: 4, early: 2 })
  })

  it('UC-4d: appeared は一度でも見えた鹿の頭数で、見えないまま消えた鹿は入らない', () => {
    const w = inZoneWith([{ occluded: true }, { s: 0 }])
    const later = w.deer[1]
    if (later) later.s = w.vehicle.s + 400
    // 0.1 秒ごとの判定を何度か回す。隠れた鹿と遠い鹿は見えない
    for (let i = 0; i < 6; i++) advance(w, 100, ZONES)
    expect(w.spotting.appeared).toBe(0)
    const hidden = w.deer[0]
    if (hidden) hidden.occluded = false
    for (let i = 0; i < 3; i++) advance(w, 100, ZONES)
    expect(w.spotting.appeared).toBe(1)
    // 同じ鹿は何度見えても 1 頭
    for (let i = 0; i < 3; i++) advance(w, 100, ZONES)
    expect(w.spotting.appeared).toBe(1)
  })

  it('AC-1（R4）: 見本の場面を走りながら見えた鹿を見つけると、目の反射だけの鹿も数え、found ≤ appeared ≤ 出た頭数。結果に spotting が残る', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    const w = engine.world
    const events: SimEvent[] = []
    const found = new Set<string>()
    for (let f = 0; f < 400_000 && w.outcome === 'driving'; f++) {
      if (!w.playback.locked && w.playback.rate !== 16) engine.setRate(16)
      engine.setInput(attentiveDriver(w, 40))
      events.push(...engine.frame(FRAME_MS))
      for (const d of w.deer) if (engine.spot(d.id) !== null) found.add(d.id)
    }
    const heads = events.reduce((n, e) => (e.type === 'deer-appear' ? n + e.deerIds.length : n), 0)
    expect(w.outcome).toBe('completed')
    expect(heads).toBeGreaterThan(0)
    expect(w.spotting.found).toBe(found.size)
    expect(w.spotting.found).toBeGreaterThan(0)
    expect(w.spotting.found).toBeLessThanOrEqual(w.spotting.appeared)
    expect(w.spotting.appeared).toBeLessThanOrEqual(heads)
    const result = engine.result()
    expect(result?.spotting).toEqual(w.spotting)
    expect(engine.getSnapshot().spotting).toEqual(w.spotting)
  }, 120_000)

  it('UC-4j: 「同じシードでもう一度」で発見は 0 に戻り、同じ鹿をまた数えられる', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    const place = () => {
      const w = inZoneWith([{}])
      engine.world.vehicle = w.vehicle
      engine.world.playback = w.playback
      engine.world.candidates = []
      engine.world.deer = w.deer
    }
    place()
    expect(engine.spot('t0')).toBe('early')
    expect(engine.getSnapshot().spotting.found).toBe(1)
    engine.restart()
    expect(engine.getSnapshot().spotting).toEqual({ appeared: 0, found: 0, early: 0 })
    place()
    expect(engine.spot('t0')).toBe('early')
  })

  it('UC-4e: レイが当たりの球に当たる鹿のうち近い方を返す。外れは null。遠い鹿ほど球が大きい', () => {
    const ray = { origin: [0, 1, 0] as const, dir: [0, 0, -1] as const }
    const near = { id: 'near', center: [0.5, 1, -20] as const }
    const far = { id: 'far', center: [0, 1, -60] as const }
    expect(pickDeer(ray, [far, near])).toBe('near')
    expect(pickDeer(ray, [far])).toBe('far')
    // 20 m 先で横に 1.5 m ずれると外れ（球は 1.2 m）
    expect(pickDeer(ray, [{ id: 'x', center: [1.5, 1, -20] }])).toBeNull()
    // 100 m 先なら球は 2 m なので 1.5 m のずれでも当たる
    expect(pickDeer(ray, [{ id: 'y', center: [1.5, 1, -100] }])).toBe('y')
    // 後ろの鹿には当たらない
    expect(pickDeer(ray, [{ id: 'z', center: [0, 1, 20] }])).toBeNull()
  })

  it('UC-4f: 押してから 8 px を超えて動いたらタップではない。的は見えていてまだ見つけていない鹿だけ', () => {
    expect(isTap({ x: 10, y: 10 }, { x: 15, y: 16 })).toBe(true)
    expect(isTap({ x: 10, y: 10 }, { x: 19, y: 10 })).toBe(false)
    const w = inZoneWith([{}, { occluded: true }, {}])
    spotDeer(w, 't2')
    expect(spotTargets(w).map((t) => t.id)).toEqual(['t0'])
    // 的の中心は体の中心の高さ（目の反射だけの鹿は目の高さ）
    const [t0] = spotTargets(w)
    expect(t0?.center[1]).toBeGreaterThan(0.5)
  })
})
