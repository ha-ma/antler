import { AlertFlagSchema, readAlertFlag } from '@antler/schema'
import { describe, expect, it } from 'vitest'
import { buildSimFlag } from './sim-flag'
import type { Deer, DriveInput, World } from '../types'
import { NO_INPUT } from '../types'
import { DriveEngine } from './engine'
import { demoScenario } from './scenario'
import { advance, createWorld, MAX_FRAME_MS, setInput, setRate, STEP_MS } from './simulation'
import { ZONES } from './zones-data'

const FRAME_MS = 1000 / 60

function world(search = '', weather: 'clear' | 'cloudy' = 'cloudy'): World {
  return createWorld({ ...demoScenario(ZONES, search), weather }, ZONES)
}

function run(w: World, ms: number, input: DriveInput = NO_INPUT): void {
  setInput(w, input)
  for (let left = ms; left > 1e-9; left -= FRAME_MS) advance(w, Math.min(FRAME_MS, left), ZONES)
}

const entryM = (w: World, i = 0) => (w.plan.intervals[i]?.entryKm ?? 0) * 1000

/** 区間の中に車を置き、偶然の鹿を消して、決めた鹿だけを置く */
function inZoneWith(
  deer: Partial<Deer>[],
  opts: { speedKmh?: number; search?: string } = {},
): World {
  const w = world(opts.search ?? '', 'clear')
  const s = entryM(w) + 500
  w.vehicle = { ...w.vehicle, s, speed: (opts.speedKmh ?? 60) / 3.6 }
  w.playback = { rate: 1, paused: false, locked: true }
  w.candidates = []
  w.internal.detectRng = () => 0 // 必ず捕捉し、遅延は最短（150 ms）
  w.deer = deer.map((d, i) => ({
    id: `t${i}`,
    candidateId: `t${i}`,
    pattern: 'roadside',
    index: 0,
    s: s + 90,
    d: 4.5,
    heading: Math.PI / 2,
    pose: 'idle',
    occluded: false,
    startedAt: null,
    gone: false,
    ...d,
  }))
  return w
}

describe('時間の進め方（R4）', () => {
  it('UC-4a: ゾーン外で 16× にすると、実時間 1 秒で時計が 16 倍進む。一時停止では進まない', () => {
    const w = world()
    w.vehicle = { ...w.vehicle, speed: 15 }
    setRate(w, 16)
    run(w, 1000, { ...NO_INPUT, throttle: true })
    expect(w.t).toBeCloseTo(16_000, -2)
    const one = world()
    one.vehicle = { ...one.vehicle, speed: 15 }
    run(one, 1000, { ...NO_INPUT, throttle: true })
    expect(w.vehicle.s).toBeGreaterThan(one.vehicle.s * 12)
    w.playback = { ...w.playback, paused: true }
    const t = w.t
    run(w, 1000)
    expect(w.t).toBe(t)
  })

  it('UC-4b: 16× で 1 回の更新で入口を越えても、入口で打ち切られ（速さは保つ）、再生速度は 1× になる', () => {
    const w = world()
    w.vehicle = { ...w.vehicle, s: entryM(w) - 3, speed: 100 / 3.6 }
    setRate(w, 16)
    const events = advance(w, FRAME_MS, ZONES)
    expect(events).toContainEqual({ type: 'zone-enter', interval: 0 })
    expect(w.vehicle.s).toBeCloseTo(entryM(w), 6)
    expect(w.vehicle.speed).toBeGreaterThan(99 / 3.6)
    expect(w.playback).toMatchObject({ rate: 1, locked: true })
    expect(setRate(w, 16)).toBe('in-zone')
  })

  it('UC-4e: 1 フレームの実時間が 100 ms を超えても 100 ms 分しか進まない（固定ステップ 1/60 秒）', () => {
    const w = world()
    advance(w, 5000, ZONES)
    expect(MAX_FRAME_MS).toBe(100)
    expect(w.t).toBeCloseTo(6 * STEP_MS, 6)
    expect(w.t).toBeCloseTo(100, 6)
  })
})

describe('終わり（R8）', () => {
  it('UC-8a: 自分の車線の鹿にぶつかると衝突で止まり、記録は collided', () => {
    const w = inZoneWith([{ s: 0, d: -1.75 }], { speedKmh: 50 })
    const deer = w.deer[0]
    if (deer) deer.s = w.vehicle.s + 12
    run(w, 3000)
    expect(w.outcome).toBe('collided')
    expect(w.encounters.find((e) => e.deerId === 't0')?.outcome).toBe('collided')
    const t = w.t
    run(w, 500)
    expect(w.t).toBe(t)
  })

  it('UC-8b: 最後のステージの出口を抜けると完走（drive-tune で「終点」から変更）', () => {
    const w = world()
    const last = w.internal.stages[w.internal.stages.length - 1]
    if (!last) throw new Error('ステージがない')
    w.internal.stageIndex = w.internal.stages.length - 1
    w.vehicle = { ...w.vehicle, s: last.exitM - 20, speed: 20 }
    w.candidates = []
    run(w, 3000, { ...NO_INPUT, throttle: true })
    expect(w.outcome).toBe('completed')
    expect(w.vehicle.s).toBeLessThan(w.internal.frame.lengthM - 100)
  })

  it('UC-8c: 「同じシードでもう一度」で、同じ場面が最初から始まり、同じ鹿の候補になる', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    const candidates = engine.world.candidates
    engine.setRate(16)
    engine.setInput({ ...NO_INPUT, throttle: true })
    for (let i = 0; i < 120; i++) engine.frame(FRAME_MS)
    expect(engine.world.vehicle.s).toBeGreaterThan(0)
    engine.restart()
    expect(engine.world.t).toBe(0)
    expect(engine.world.vehicle.s).toBe(0)
    expect(engine.world.playback.rate).toBe(1)
    expect(engine.world.candidates).toEqual(candidates)
    expect(engine.getSnapshot().outcome).toBe('driving')
  })
})

describe('遭遇の記録（R9）', () => {
  it('UC-9a: 赤から 800 ms 後に Space → アラート→ブレーキ 800 ms、鹿が後ろに過ぎて avoided', () => {
    const w = inZoneWith([{}])
    const cruise = { ...NO_INPUT, throttle: true }
    // 赤が出るまで走る
    for (let i = 0; i < 300 && w.alert.state !== 'danger'; i++) run(w, FRAME_MS, cruise)
    expect(w.alert.state).toBe('danger')
    const e = w.encounters.find((x) => x.deerId === 't0')
    expect(e?.alertAt).not.toBeNull()
    run(w, 800 - (w.t - (e?.alertAt ?? 0)), cruise)
    run(w, FRAME_MS, { ...NO_INPUT, brake: true })
    run(w, 6000, cruise)
    expect(e?.alertToBrakeMs).toBeGreaterThanOrEqual(800)
    expect(e?.alertToBrakeMs).toBeLessThanOrEqual(800 + 2 * STEP_MS)
    expect(e?.outcome).toBe('avoided')
    expect(e?.closestM).toBeGreaterThan(3)
    expect(e?.closestM).toBeLessThan(8)
  })

  it('UC-9a: 赤の前からブレーキを踏んでいれば 0', () => {
    const w = inZoneWith([{}])
    for (let i = 0; i < 300 && w.alert.state !== 'danger'; i++)
      run(w, FRAME_MS, { ...NO_INPUT, brake: true })
    expect(w.encounters.find((x) => x.deerId === 't0')?.alertToBrakeMs).toBe(0)
  })

  it('UC-9b: アラート OFF ではアラート→ブレーキは null。終了の時点で決まっていないものは pending', () => {
    const w = inZoneWith([{}, { s: 0, d: -1.75 }], { search: '?alert=off' })
    const lane = w.deer[1]
    if (lane) lane.s = w.vehicle.s + 60
    run(w, 4000, { ...NO_INPUT, throttle: true })
    expect(w.flag).toBeNull()
    expect(w.outcome).toBe('collided')
    const roadside = w.encounters.find((x) => x.deerId === 't0')
    expect(roadside?.alertAt).toBeNull()
    expect(roadside?.alertToBrakeMs).toBeNull()
    expect(roadside?.outcome).toBe('pending')
    expect(w.encounters.find((x) => x.deerId === 't1')?.outcome).toBe('collided')
  })
})

describe('フラグの形（R6）', () => {
  it('UC-6i: シミュレーターのフラグは AlertFlagSchema を通り（B と同じく zone は outside）、readAlertFlag で strict になる', () => {
    const at = Date.parse('2027-02-15T16:45+09:00')
    const on = buildSimFlag(at, { deerId: 'a', distanceM: 41.6, side: 'L' })
    const off = buildSimFlag(at, null)
    expect(AlertFlagSchema.safeParse(on).success).toBe(true)
    expect(AlertFlagSchema.safeParse(off).success).toBe(true)
    expect(readAlertFlag(on).flag).toMatchObject({
      deer: true,
      strict: true,
      distanceM: 42,
      side: 'L',
      zone: 'outside',
    })
    expect(on.t_frame).toBe('2027-02-15T16:45:00.000+09:00')
  })

  it('UC-6j: 解除の直後に出口を越えても、出口で safe になる（琥珀が 5 秒残らない）', () => {
    const w = inZoneWith([])
    const exit = (w.plan.intervals[0]?.exitKm ?? 0) * 1000
    w.vehicle = { ...w.vehicle, s: exit - 20, speed: 60 / 3.6 }
    w.flag = readAlertFlag(buildSimFlag(w.internal.startMs + w.t, null)).flag
    w.flagAt = w.t
    run(w, 2500, { ...NO_INPUT, throttle: true })
    expect(w.vehicle.s).toBeGreaterThan(exit + 10)
    expect(w.t - (w.flagAt ?? 0)).toBeLessThan(5000)
    expect(w.zone.positionKm * 1000).toBeCloseTo(w.vehicle.s, -1)
    expect(w.alert.state).toBe('safe')
  })
})

describe('鹿の見逃し（R6）', () => {
  it('UC-6e: アラート OFF ではフラグを一度も出さない', () => {
    const w = inZoneWith([{}], { search: '?alert=off' })
    run(w, 5000, { ...NO_INPUT, throttle: true })
    expect(w.flag).toBeNull()
    expect(w.alert.state).not.toBe('danger')
  })
})
