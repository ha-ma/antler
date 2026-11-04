import { deriveAlertState } from '@antler/alert-ui'
import { readAlertFlag, toJst, type ReceivedFlag } from '@antler/schema'
import { lightPeriod, planRoute, toInstant, type ZoneCollection } from '@antler/zones'
import type {
  DriveInput,
  DriveResult,
  DriveScenario,
  Encounter,
  PlaybackRate,
  World,
} from '../types'
import { NO_INPUT } from '../types'
import { boxesOverlap, carBox, deerBox } from './collision'
import { candidatesToDecide, createCandidates, decideAppear } from './deer-spawn'
import { spawnDeer, stepDeer } from './deer-motion'
import {
  CAMERA_FORWARD_M,
  DETECT_RANGE_M,
  DETECT_TICK_MS,
  INITIAL_DETECTOR,
  cameraSees,
  detectProbability,
  stepDetector,
  type Sighting,
} from './detection'
import { INITIAL_PLAYBACK, requestRate, scaledDt, setInZone, setPaused } from './playback'
import { createRng, deriveSeed } from './rng'
import { createRoadFrame, lonLatAt, poseAt } from './road'
import { buildSimFlag } from './sim-flag'
import { firstEntryBetween, intervalAt, withoutRanges, zoneStatusFromS } from './zone-status'
import { initialVehicle, stepVehicle } from './vehicle'

// シミュレーションの 1 歩（R4）。R3F から切り離した関数で、固定ステップ（1/60 秒）で World を進める。
// World は毎フレーム作り直さず、その場で書き換える（60 fps でゴミを出さない）。同じ場面・シード・入力の列なら同じ結果。

/** 固定ステップ（ms） */
export const STEP_MS = 1000 / 60
/** 1 フレームの実時間の上限（ms）。タブを戻したときに入口や鹿を飛び越えない */
export const MAX_FRAME_MS = 100
/** 止まっているとみなす速さ（m/s、0.5 km/h） */
export const STOPPED_MPS = 0.5 / 3.6
/** 鹿が車の後ろにこれだけ過ぎたら回避（m） */
export const PASSED_BEHIND_M = 10

export type SimEvent =
  | { type: 'zone-enter'; interval: number }
  | { type: 'zone-exit'; interval: number }
  | { type: 'deer-appear'; deerIds: string[] }
  | { type: 'alert-start'; deerId: string }
  | { type: 'alert-release' }
  | { type: 'collided'; deerId: string }
  | { type: 'completed' }

export function createWorld(scenario: DriveScenario, zones: ZoneCollection): World {
  // 直線で引いた概算の移動にはゾーンの区間を作らない（brief-map R1 と同じ。drive-link R5）
  const plan = withoutRanges(planRoute(scenario.route, zones), scenario.straightRangesM)
  const frame = createRoadFrame(scenario.route)
  const startMs = toInstant(scenario.startAt)
  const vehicle = initialVehicle(0)
  const position = lonLatAt(frame, vehicle.s, vehicle.d)
  const zone = zoneStatusFromS(plan, vehicle.s)
  const playback = setInZone(INITIAL_PLAYBACK, zone.gps.status === 'inside')
  return {
    scenario,
    plan,
    t: 0,
    vehicle,
    input: NO_INPUT,
    playback,
    zone,
    light: lightPeriod(startMs, { lon: position[0], lat: position[1] }),
    // 種は旅のシードと日から（drive-link R4。同じ旅・同じ日なら同じ鹿）
    candidates: createCandidates(plan, scenario.seed),
    decided: new Set(),
    deer: [],
    flag: null,
    flagAt: null,
    // 最初のフレームから inside / outside を渡す（unknown を渡さない。C-1）
    alert: deriveAlertState({
      flag: null,
      flagReceivedAt: null,
      gps: zone.gps,
      now: 0,
      previous: null,
    }),
    encounters: [],
    outcome: 'driving',
    internal: {
      frame,
      startMs,
      accumulatorMs: 0,
      nextTickAt: DETECT_TICK_MS,
      stoppedMs: 0,
      braking: false,
      detector: INITIAL_DETECTOR,
      detectRng: createRng(deriveSeed(scenario.seed, 'detect')),
      clockShiftMs: 0,
      inputLog: [],
      collidedDeerId: null,
    },
  }
}

/** シミュレーションの時計（epoch ms）。移動の始まりで進めたぶんを含む */
export function clockMs(world: World): number {
  return world.internal.startMs + world.t + world.internal.clockShiftMs
}

/** 走行の結果（drive-link R8）。衝突か完走のときだけ作る */
export function driveResult(world: World, frames: DriveResult['frames']): DriveResult | null {
  if (world.outcome === 'driving') return null
  const { scenario, internal, vehicle } = world
  return {
    tripId: scenario.trip.id,
    day: scenario.day,
    seed: scenario.seed,
    source: scenario.source,
    data: scenario.data,
    alertEnabled: scenario.alertEnabled,
    outcome: world.outcome,
    endS: vehicle.s,
    legIndex: scenario.legStarts.filter((l) => l.sM <= vehicle.s).length,
    endedAt: toJst(new Date(clockMs(world)).toISOString()),
    collidedDeerId: internal.collidedDeerId,
    encounters: world.encounters.map((e) => ({ ...e })),
    inputs: internal.inputLog.map((l) => ({ t: l.t, input: { ...l.input } })),
    frames,
  }
}

/** 利用者の操作（再生速度・一時停止・キー入力） */
export function setRate(world: World, rate: PlaybackRate): 'in-zone' | null {
  const change = requestRate(world.playback, rate)
  world.playback = change.playback
  return change.rejected
}

export function pause(world: World, paused: boolean): void {
  world.playback = setPaused(world.playback, paused)
}

export function setInput(world: World, input: DriveInput): void {
  // 変わったときだけ時刻つきで残す（A-6 の「衝突の 3 秒前を見る」用）
  const prev = world.input
  const changed = (Object.keys(input) as (keyof DriveInput)[]).some((k) => input[k] !== prev[k])
  world.input = input
  if (changed) world.internal.inputLog.push({ t: world.t, input: { ...input } })
}

/** 1 フレーム進める（UC-4a・UC-4b・UC-4e）。realDtMs は実時間の経過 */
export function advance(world: World, realDtMs: number, zones: ZoneCollection): SimEvent[] {
  const events: SimEvent[] = []
  if (world.outcome !== 'driving') return events
  if (world.playback.paused) {
    world.internal.accumulatorMs = 0
    return events
  }
  world.internal.accumulatorMs += Math.min(Math.max(0, realDtMs), MAX_FRAME_MS)
  // 1e-6 ms の余裕: 100 ms ＝ 6 ステップが浮動小数の誤差で 5 ステップにならないように
  while (world.internal.accumulatorMs >= STEP_MS - 1e-6) {
    world.internal.accumulatorMs -= STEP_MS
    // 倍速はステップ数を増やす（scaledDt が rate 倍）
    const steps = Math.round(scaledDt(world.playback, STEP_MS) / STEP_MS)
    for (let k = 0; k < steps; k++) {
      const fast = world.playback.rate > 1
      const entered = stepOnce(world, zones, events, fast)
      if (world.outcome !== 'driving') return events
      // 倍速で入口を越えたら、残りのステップを打ち切る（ゾーンの中を早送りしない）
      if (entered) break
    }
  }
  return events
}

/** 固定ステップ 1 つ。入口を越えたら true */
function stepOnce(world: World, zones: ZoneCollection, events: SimEvent[], fast: boolean): boolean {
  const { internal } = world
  world.t += STEP_MS
  const t = world.t
  const before = world.vehicle.s
  world.vehicle = stepVehicle(world.vehicle, world.input, world.scenario.surface, STEP_MS / 1000)
  internal.stoppedMs =
    Math.abs(world.vehicle.speed) < STOPPED_MPS ? internal.stoppedMs + STEP_MS : 0
  advanceClockAtLegStart(world, before)

  // ゾーンの出入り（再生速度の固定）は道のり s で毎ステップ見る
  let entered = false
  const entryM = firstEntryBetween(world.plan, before, world.vehicle.s)
  if (entryM !== null && fast) world.vehicle = { ...world.vehicle, s: entryM }
  const wasIn = world.playback.locked
  const nowIn = intervalAt(world.plan, world.vehicle.s)
  if (nowIn !== null && !wasIn) {
    world.playback = setInZone(world.playback, true)
    events.push({ type: 'zone-enter', interval: nowIn })
    entered = true
  } else if (nowIn === null && wasIn) {
    world.playback = setInZone(world.playback, false)
    events.push({ type: 'zone-exit', interval: intervalAt(world.plan, before) ?? -1 })
  }

  trackBrake(world)
  spawnAndMoveDeer(world, zones, events)
  if (checkCollision(world, events)) return entered
  if (t >= internal.nextTickAt) {
    internal.nextTickAt += DETECT_TICK_MS
    tick(world, events)
  }
  if (world.vehicle.s >= internal.frame.lengthM - 1) {
    world.outcome = 'completed'
    settlePending(world)
    events.push({ type: 'completed' })
  }
  return entered
}

/**
 * 2 つ目以降の移動の始まりに着いたら、時計をしおりの出発時刻まで進める（drive-link R3・UC-3g）。
 * 立ち寄り・待ちの時間を飛ばす。既に過ぎていれば進めない
 */
function advanceClockAtLegStart(world: World, before: number): void {
  const after = world.vehicle.s
  if (after <= before) return
  for (const leg of world.scenario.legStarts) {
    if (before < leg.sM && leg.sM <= after) {
      const wait = toInstant(leg.departAt) - clockMs(world)
      if (wait > 0) world.internal.clockShiftMs += wait
    }
  }
}

/** アラートのあとに Space / S を押した時刻（R9） */
function trackBrake(world: World): void {
  const braking = world.input.brake || world.input.back
  if (braking && !world.internal.braking) {
    for (const e of world.encounters) {
      if (e.alertAt !== null && e.brakeAt === null) setBrake(e, world.t)
    }
  }
  world.internal.braking = braking
}

function setBrake(e: Encounter, at: number): void {
  e.brakeAt = at
  e.alertToBrakeMs = e.alertAt === null ? null : Math.max(0, Math.round(at - e.alertAt))
}

function spawnAndMoveDeer(world: World, zones: ZoneCollection, events: SimEvent[]): void {
  const { vehicle, internal } = world
  for (const c of candidatesToDecide(world.candidates, world.decided, vehicle.s)) {
    world.decided.add(c.id)
    if (decideAppear(c, world.plan, zones, clockMs(world))) {
      const herd = spawnDeer(c, world.t)
      world.deer.push(...herd)
      events.push({ type: 'deer-appear', deerIds: herd.map((d) => d.id) })
    }
  }
  if (world.deer.length === 0) return
  const ctx = {
    t: world.t,
    carS: vehicle.s,
    carD: vehicle.d,
    carSpeed: vehicle.speed,
    carStoppedMs: internal.stoppedMs,
  }
  world.deer = world.deer
    .map((d) => (d.gone ? d : stepDeer(d, ctx, STEP_MS / 1000)))
    // 車の後ろへ遠く過ぎた鹿と、去った鹿はシーンから消す
    .filter((d) => !d.gone && d.s > vehicle.s - 60)
}

function checkCollision(world: World, events: SimEvent[]): boolean {
  const car = carBox(world.vehicle.s, world.vehicle.d)
  const hit = world.deer.find((d) => boxesOverlap(car, deerBox(d.s, d.d, d.heading)))
  if (!hit) return false
  world.outcome = 'collided'
  world.internal.collidedDeerId = hit.id
  const e = encounterFor(world, hit.id, hit.pattern)
  e.outcome = 'collided'
  e.closestM = 0
  settlePending(world)
  events.push({ type: 'collided', deerId: hit.id })
  return true
}

/** 0.1 秒ごと: ゾーン状態・光・検知・フラグ・アラート・遭遇の記録 */
function tick(world: World, events: SimEvent[]): void {
  const { internal, vehicle, scenario } = world
  const t = world.t
  const position = lonLatAt(internal.frame, vehicle.s, vehicle.d)
  // ゾーン状態は車の道のり s から区間を引く（drive-link R5）。measureAlongRoute は毎回全線分を走査し、
  // 前回の位置を手がかりにすると最大 30 m 遅れる（drive-3d UC-6j）
  world.zone = zoneStatusFromS(world.plan, vehicle.s)
  world.light = lightPeriod(clockMs(world), { lon: position[0], lat: position[1] })

  const car = poseAt(internal.frame, vehicle.s, vehicle.d)
  const camera = {
    x: car.x + car.forward[0] * CAMERA_FORWARD_M,
    z: car.z + car.forward[1] * CAMERA_FORWARD_M,
    forward: car.forward,
    right: car.right,
  }
  const sightings: Sighting[] = []
  for (const d of world.deer) {
    const p = poseAt(internal.frame, d.s, d.d)
    const distanceM = Math.hypot(p.x - car.x, p.z - car.z)
    // 120 m 以内に来た鹿は記録する（見逃しも含む）
    if (distanceM <= DETECT_RANGE_M) {
      const e = encounterFor(world, d.id, d.pattern)
      e.closestM = Math.min(e.closestM, distanceM)
    } else {
      const e = world.encounters.find((x) => x.deerId === d.id)
      if (e) e.closestM = Math.min(e.closestM, distanceM)
    }
    const seen = cameraSees(camera, { id: d.id, x: p.x, z: p.z, occluded: d.occluded })
    if (seen) sightings.push(seen)
  }

  if (scenario.alertEnabled) {
    const probability = detectProbability(world.light, scenario.weather, scenario.windowFog)
    const step = stepDetector(internal.detector, t, sightings, probability, internal.detectRng)
    internal.detector = step.state
    const out = step.out
    if (out.kind === 'deer' && out.sighting) {
      world.flag = makeFlag(world, out.sighting)
      world.flagAt = t
      if (out.started) events.push({ type: 'alert-start', deerId: out.sighting.deerId })
      // 赤の間に検知している鹿は、自分のアラートの時刻を持つ（群れの 2 頭目以降も）
      for (const id of out.detected) {
        const deer = world.deer.find((d) => d.id === id)
        if (!deer) continue
        const e = encounterFor(world, id, deer.pattern)
        if (e.alertAt === null) {
          e.alertAt = t
          if (internal.braking) setBrake(e, t)
        }
      }
    } else if (out.kind === 'release') {
      world.flag = makeFlag(world, null)
      world.flagAt = t
      events.push({ type: 'alert-release' })
    }
  }
  world.alert = deriveAlertState({
    flag: world.flag,
    flagReceivedAt: world.flagAt,
    gps: world.zone.gps,
    now: t,
    previous: world.alert,
  })

  // 鹿が車の後ろ 10 m に過ぎたか去ったら回避
  for (const e of world.encounters) {
    if (e.outcome !== 'pending') continue
    const deer = world.deer.find((d) => d.id === e.deerId)
    if (!deer || deer.s < vehicle.s - PASSED_BEHIND_M) e.outcome = 'avoided'
  }
}

/** シミュレーターが作るフラグを、B のフラグを受けるときと同じ readAlertFlag で読む（sim-flag.ts） */
function makeFlag(world: World, sighting: Sighting | null): ReceivedFlag | null {
  return readAlertFlag(buildSimFlag(clockMs(world), sighting)).flag
}

function encounterFor(world: World, deerId: string, pattern: Encounter['pattern']): Encounter {
  let e = world.encounters.find((x) => x.deerId === deerId)
  if (!e) {
    e = {
      deerId,
      pattern,
      alertAt: null,
      brakeAt: null,
      alertToBrakeMs: null,
      closestM: Number.POSITIVE_INFINITY,
      outcome: 'pending',
    }
    world.encounters.push(e)
  }
  return e
}

/** 終了の時点で、もう車の後ろに過ぎた鹿だけ回避にする（ほかは pending のまま） */
function settlePending(world: World): void {
  for (const e of world.encounters) {
    if (e.outcome !== 'pending') continue
    const deer = world.deer.find((d) => d.id === e.deerId)
    if (!deer || deer.s < world.vehicle.s - PASSED_BEHIND_M) e.outcome = 'avoided'
  }
}
