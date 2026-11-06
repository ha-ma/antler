import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { planRoute, type RoutePlan } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { personaDay, personaTrip } from '@/test/trip-day'
import { NO_INPUT, type World } from '../types'
import { navHint, outsideTempC } from './dashboard'
import { createCandidates, MAX_DEER_PER_INTERVAL, MIN_DEER_PER_INTERVAL } from './deer-spawn'
import { attentiveDriver } from './drive-harness'
import { DriveEngine } from './engine'
import { IDLE_RPM, INITIAL_POWERTRAIN, MAX_RPM, SHIFT_UP_RPM, stepPowertrain } from './powertrain'
import { demoScenario } from './scenario'
import { advance, clockMs, createWorld, setInput, setRate, type SimEvent } from './simulation'
import { buildStages, scheduledClockAt, STAGE_LEAD_M } from './stages'
import { scenarioFromDay } from './trip-scenario'
import { ZONES } from './zones-data'

// drive-tune（docs/specs/drive-tune/functional.md）: ステージ・必ず出る鹿・ダッシュボード・音の合図。
// ブレーキ（UC-3a〜UC-3e）は vehicle.test.ts。

const FRAME_MS = 1000 / 60

/** 頭なしで最後まで走らせる（ゾーンの外は 16×）。出来事を集める */
function driveToEnd(w: World, maxFrames = 400_000): SimEvent[] {
  const events: SimEvent[] = []
  for (let f = 0; f < maxFrames && w.outcome === 'driving'; f++) {
    if (!w.playback.locked && w.playback.rate !== 16) setRate(w, 16)
    setInput(w, attentiveDriver(w))
    events.push(...advance(w, FRAME_MS, ZONES))
  }
  return events
}

/** 区間ごとに出た鹿の頭数（deer-appear の出来事から） */
function headsPerInterval(w: World): Record<number, number> {
  return w.internal.spawnedHeads
}

function plan(intervals: [number, number][]): RoutePlan {
  return {
    route: [],
    cumulativeM: [],
    totalKm: 100,
    intervals: intervals.map(([entryKm, exitKm], i) => ({ zoneIds: [`z${i}`], entryKm, exitKm })),
  }
}

describe('drive-tune 受け入れ', () => {
  it('AC-1: 見本の場面は 1 つ目の区間の 5 km 手前から始まり、区間を出たらクリアして 2 つ目の 5 km 手前へ移り、2 つ目を出たら completed。各区間で 3 頭以上', () => {
    const w = createWorld(demoScenario(ZONES), ZONES)
    const [first, second] = w.plan.intervals
    // 見本の手前は 5 km（入口は線から 150 m の帯に入る所なので 5 km より少し手前）。始点より前にはしない
    expect(w.vehicle.s).toBeCloseTo(Math.max(0, (first?.entryKm ?? 0) * 1000 - STAGE_LEAD_M), 0)
    // 2 つ目のステージは丸めずに 5 km 手前から
    expect(w.internal.stages[1]?.startM).toBeCloseTo(
      (second?.entryKm ?? 0) * 1000 - STAGE_LEAD_M,
      0,
    )
    const events = driveToEnd(w)
    expect(w.outcome).toBe('completed')
    const clears = events.filter((e) => e.type === 'stage-clear')
    expect(clears).toEqual([
      { type: 'stage-clear', stage: 1, of: 2 },
      { type: 'stage-clear', stage: 2, of: 2 },
    ])
    expect(events.at(-1)).toEqual({ type: 'completed' })
    const heads = headsPerInterval(w)
    expect(heads[0]).toBeGreaterThanOrEqual(3)
    expect(heads[1]).toBeGreaterThanOrEqual(3)
    expect(second).toBeDefined()
  }, 120_000)

  it('AC-2: ペルソナの 1 日目でもステージで走りきり、ゾーンの無い日は出発ですぐに completed（ゾーン通過 0）', () => {
    const tripPlan = personaTrip().plan
    const day1 = scenarioFromDay({ plan: tripPlan, day: personaDay(1, tripPlan) }, '')
    if (!day1) throw new Error('場面がない')
    const w = createWorld(day1, ZONES)
    expect(w.internal.stages.length).toBeGreaterThan(0)
    driveToEnd(w)
    expect(w.outcome).toBe('completed')
    expect(w.internal.zoneEnters).toBe(w.plan.intervals.length)

    const noZone = createWorld({ ...day1, straightRangesM: [[0, 1e9]] }, ZONES)
    expect(noZone.internal.stages).toEqual([])
    const events = advance(noZone, FRAME_MS, ZONES)
    expect(events).toEqual([{ type: 'completed' }])
    expect(noZone.internal.zoneEnters).toBe(0)
  }, 120_000)
})

describe('ステージ（R1）', () => {
  it('UC-1a: 区間ごとに [入口 − 5 km, 出口]。始点より前にはしない。重なる・続くステージはまとめる', () => {
    expect(buildStages(plan([[3, 6]]))).toEqual([{ startM: 0, exitM: 6000, intervals: [0] }])
    expect(
      buildStages(
        plan([
          [10, 12],
          [20, 22],
        ]),
      ),
    ).toEqual([
      { startM: 5000, exitM: 12000, intervals: [0] },
      { startM: 15000, exitM: 22000, intervals: [1] },
    ])
    // 2 つ目の 5 km 手前（16 km）が 1 つ目の出口（17 km）より前 → まとめる
    expect(
      buildStages(
        plan([
          [10, 17],
          [21, 23],
        ]),
      ),
    ).toEqual([{ startM: 5000, exitM: 23000, intervals: [0, 1] }])
  })

  it('UC-1b: 運転はステージ 1 の始まりから。時計はその移動の出発時刻 + 平均の速さで始まりまで走った時間', () => {
    const scenario = demoScenario(ZONES)
    const w = createWorld(scenario, ZONES)
    const startM = w.internal.stages[0]?.startM ?? 0
    expect(w.vehicle.s).toBe(startM)
    // 見本は 50 km/h の目安
    const expected = Date.parse(scenario.startAt) + (startM / (50 / 3.6)) * 1000
    expect(clockMs(w)).toBeCloseTo(expected, -1)
    expect(scheduledClockAt(scenario, startM)).toBeCloseTo(expected, -1)
  })

  it('UC-1c: ステージの出口を越えるとクリア。赤の最中なら alert-release が先。鹿が消えて safe、次の始まりへ移り、時計は戻らず 1×', () => {
    const w = createWorld(demoScenario(ZONES), ZONES)
    const stage = w.internal.stages[0]
    const next = w.internal.stages[1]
    if (!stage || !next) throw new Error('ステージが 2 つない')
    w.vehicle = { ...w.vehicle, s: stage.exitM - 1, speed: 20 }
    w.playback = { rate: 1, paused: false, locked: true }
    // 赤の最中にする
    w.internal.detector = { ...w.internal.detector, showing: true }
    w.flag = { deer: true, strict: true, distanceM: 40, side: 'L', zone: 'outside' }
    w.flagAt = w.t
    const before = clockMs(w)
    const events = advance(w, 100, ZONES)
    const types = events.map((e) => e.type)
    expect(types.indexOf('alert-release')).toBeLessThan(types.indexOf('stage-clear'))
    expect(w.flag).toBeNull()
    expect(w.deer).toEqual([])
    expect(w.alert.state).toBe('safe')
    expect(w.vehicle.s).toBeGreaterThanOrEqual(next.startM)
    expect(w.vehicle.s).toBeLessThan(next.startM + 20)
    expect(clockMs(w)).toBeGreaterThanOrEqual(before)
    expect(w.playback.rate).toBe(1)
    expect(w.internal.stageIndex).toBe(1)
  })

  it('UC-1d: 最後のステージのクリアで completed（zonePasses は区間の数）', () => {
    const w = createWorld(demoScenario(ZONES), ZONES)
    const last = w.internal.stages[w.internal.stages.length - 1]
    if (!last) throw new Error('ステージがない')
    w.internal.stageIndex = w.internal.stages.length - 1
    w.internal.zoneEnters = w.plan.intervals.length
    w.vehicle = { ...w.vehicle, s: last.exitM - 1, speed: 20 }
    const events = advance(w, 100, ZONES)
    expect(events.map((e) => e.type)).toContain('completed')
    expect(w.outcome).toBe('completed')
  })

  it('UC-1e: ゾーンの無い日は出発ですぐに completed（zonePasses 0）', () => {
    const scenario = { ...demoScenario(ZONES), straightRangesM: [[0, 1e9]] as [number, number][] }
    const engine = new DriveEngine(scenario, ZONES)
    expect(engine.getSnapshot().stage).toEqual({ index: 0, count: 0 })
    engine.frame(16)
    expect(engine.result()).toMatchObject({ outcome: 'completed', zonePasses: 0 })
  })
})

describe('鹿（R2）', () => {
  const routePlan = planRoute(demoScenario(ZONES).route, ZONES)

  it('UC-2a: 区間ごとに先頭から合わせて 3 頭に届くまでの候補が必ず出る（林縁の目の反射だけは除く）。危険度が 0 でも 3 頭以上', () => {
    for (let seed = 0; seed < 50; seed++) {
      const candidates = createCandidates(routePlan, seed)
      for (let i = 0; i < routePlan.intervals.length; i++) {
        const inInterval = candidates.filter((c) => c.interval === i)
        const guaranteed = inInterval.filter((c) => c.guaranteed)
        const heads = guaranteed.reduce((sum, c) => sum + c.herdSize, 0)
        expect(heads).toBeGreaterThanOrEqual(MIN_DEER_PER_INTERVAL)
        // 必ず出る候補は先頭から続いている
        expect(inInterval.slice(0, guaranteed.length).every((c) => c.guaranteed)).toBe(true)
        expect(guaranteed.every((c) => c.pattern !== 'eyeshine')).toBe(true)
      }
    }
    // 7 月の昼（危険度がいちばん低い頃）でも、走れば 3 頭以上出る
    const july = { ...demoScenario(ZONES), startAt: '2026-07-15T11:00+09:00' }
    const w = createWorld(
      { ...july, legPace: [{ sM: 0, departAt: july.startAt, mps: 50 / 3.6 }] },
      ZONES,
    )
    driveToEnd(w)
    expect(headsPerInterval(w)[0]).toBeGreaterThanOrEqual(3)
    expect(headsPerInterval(w)[1]).toBeGreaterThanOrEqual(3)
  }, 120_000)

  it('UC-2b: 区間で出した頭数が 100 頭を越えない（候補を詰めた区間でも）', () => {
    const w = createWorld(demoScenario(ZONES), ZONES)
    // 区間 0 に候補を 300 個（必ず出る・群れ 5 頭）詰める
    const base = w.candidates.find((c) => c.interval === 0)
    if (!base) throw new Error('候補がない')
    w.candidates = Array.from({ length: 300 }, (_, k) => ({
      ...base,
      id: `x${String(k)}`,
      s: base.s + k * 5,
      pattern: 'herd' as const,
      herdSize: 5,
      guaranteed: true,
    }))
    w.vehicle = { ...w.vehicle, s: base.s - 310, speed: 0 }
    for (let k = 0; k < 300; k++) {
      w.vehicle = { ...w.vehicle, s: base.s + k * 5 - 100 }
      advance(w, FRAME_MS, ZONES)
      w.deer = [] // ぶつからないように消す（数だけ見る）
    }
    expect(headsPerInterval(w)[0]).toBeLessThanOrEqual(MAX_DEER_PER_INTERVAL)
    expect(headsPerInterval(w)[0]).toBeGreaterThan(90)
  })

  it('UC-2c: 短い区間（1.0 km）でも候補が 3 つ以上ある', () => {
    const short = plan([[10, 11]])
    for (let seed = 0; seed < 20; seed++) {
      const c = createCandidates(short, seed)
      expect(c.length).toBeGreaterThanOrEqual(3)
      expect(c.every((x) => x.s >= 10_000 && x.s <= 11_000)).toBe(true)
    }
  })

  it('UC-2d: 同じ種なら同じ候補（必ず出る印も同じ）', () => {
    expect(createCandidates(routePlan, 7)).toEqual(createCandidates(routePlan, 7))
    expect(createCandidates(routePlan, 7)).not.toEqual(createCandidates(routePlan, 8))
  })
})

describe('ダッシュボード（R5）', () => {
  it('UC-4b: 止まって 750 rpm・1 速。速さが上がるとシフトアップし 3,000 rpm を越えない、6 速まで。後退は R', () => {
    expect(stepPowertrain(INITIAL_POWERTRAIN, 0, false)).toEqual({ gear: 1, rpm: IDLE_RPM })
    let p = INITIAL_POWERTRAIN
    let maxRpm = 0
    const gears: number[] = []
    for (let kmh = 0; kmh <= 100; kmh += 0.5) {
      p = stepPowertrain(p, kmh, true)
      maxRpm = Math.max(maxRpm, p.rpm)
      if (typeof p.gear === 'number' && gears.at(-1) !== p.gear) gears.push(p.gear)
    }
    expect(gears).toEqual([1, 2, 3, 4, 5, 6])
    expect(maxRpm).toBeLessThanOrEqual(MAX_RPM)
    expect(SHIFT_UP_RPM).toBe(2500)
    expect(stepPowertrain(p, -10, false).gear).toBe('R')
    // 減速するとシフトダウンする
    let down = p
    for (let kmh = 100; kmh >= 5; kmh -= 0.5) down = stepPowertrain(down, kmh, false)
    expect(down.gear).toBe(1)
  })

  it('UC-4c: 外気温は月と光の区分の表から（2 月の昼 −4 °C、夜 −14 °C、薄暮はその間）', () => {
    const feb = Date.parse('2027-02-15T12:00+09:00')
    expect(outsideTempC(feb, 'day')).toBe(-4)
    expect(outsideTempC(feb, 'night')).toBe(-14)
    expect(outsideTempC(feb, 'dusk')).toBe(-9)
  })

  it('UC-4d: ナビの次の案内（ゾーンの外は n km 先、中は残り、ゾーンの後は目的地まで）', () => {
    const w = createWorld(demoScenario(ZONES), ZONES)
    expect(navHint(w)).toMatchObject({ kind: 'zone-ahead' })
    w.zone = { ...w.zone, gps: { status: 'inside', remainingKm: 3.2 } }
    expect(navHint(w)).toEqual({ kind: 'in-zone', km: 3.2 })
    w.zone = { ...w.zone, gps: { status: 'outside' } }
    w.vehicle = { ...w.vehicle, s: w.plan.totalKm * 1000 - 1500 }
    expect(navHint(w)).toEqual({ kind: 'destination', km: expect.closeTo(1.5, 3) as number })
  })

  it('UC-4e: HUD の右側（会話の表示の 360 px）に HUD を置かない（CSS の決まり）', () => {
    const css = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../components/drive.css'),
      'utf-8',
    )
    expect(css).toMatch(/--drive-chat-w:\s*360px/)
    // 画面の右端に寄せる HUD の指定（right: var(--space-…)）が無い
    expect(css).not.toMatch(/\bright:\s*var\(--space-\d\)/)
    expect(css).toMatch(/\.drive-hud__bottom\s*\{[^}]*right:\s*calc\(var\(--drive-chat-w\)/)
  })
})

describe('音の合図（R6）', () => {
  it('UC-5a: 合図を購読すると、ゾーンの出入り・鹿の出現・ステージのクリア・旅程のクリアが届く。やめたら届かない', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    const got: SimEvent['type'][] = []
    const stop = engine.onCue((events) => got.push(...events.map((e) => e.type)))
    for (let f = 0; f < 400_000 && engine.world.outcome === 'driving'; f++) {
      const w = engine.world
      if (!w.playback.locked && w.playback.rate !== 16) engine.setRate(16)
      engine.setInput(attentiveDriver(w))
      engine.frame(FRAME_MS)
    }
    for (const type of [
      'zone-enter',
      'zone-exit',
      'deer-appear',
      'stage-clear',
      'completed',
    ] as const) {
      expect(got).toContain(type)
    }
    stop()
    const count = got.length
    engine.restart()
    engine.frame(FRAME_MS)
    expect(got).toHaveLength(count)
  }, 120_000)

  it('UC-5b: 毎フレームの値（回転数・ギア・アクセル・ブレーキの強さ・速さ・ABS）。ブレーキの強さは立ち上がりで 0 から 1 へ', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    expect(engine.telemetry()).toEqual({
      rpm: IDLE_RPM,
      gear: 1,
      throttle: false,
      brake: 0,
      speedKmh: 0,
      abs: false,
    })
    engine.setInput({ ...NO_INPUT, throttle: true })
    for (let i = 0; i < 300; i++) engine.frame(FRAME_MS)
    const fast = engine.telemetry()
    expect(fast.speedKmh).toBeGreaterThan(30)
    expect(fast.rpm).toBeGreaterThan(IDLE_RPM)
    expect(fast.throttle).toBe(true)
    engine.setInput({ ...NO_INPUT, brake: true })
    engine.frame(FRAME_MS)
    const first = engine.telemetry().brake
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(0.5)
    for (let i = 0; i < 20; i++) engine.frame(FRAME_MS)
    expect(engine.telemetry().brake).toBe(1)
    // 見本は圧雪なので ABS が働く
    expect(engine.telemetry().abs).toBe(true)
  })
})
