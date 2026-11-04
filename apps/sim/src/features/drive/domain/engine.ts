import type { DerivedAlert } from '@antler/alert-ui'
import type { Lang } from '@antler/schema'
import type { LightPeriod, ZoneCollection } from '@antler/zones'
import type {
  DriveInput,
  DriveOutcome,
  DriveResult,
  DriveScenario,
  Encounter,
  Playback,
  PlaybackRate,
  Surface,
  Weather,
  World,
  ZoneStatus,
} from '../types'
import { etaMs, sunsetOf } from './clock'
import { summarizeFrames, type FrameSummary } from './frame-stats'
import {
  advance,
  clockMs as simClockMs,
  createWorld,
  driveResult,
  pause,
  setInput,
  setRate,
  type SimEvent,
} from './simulation'

// シミュレーションの持ち手（React から使う）。World を持ち、フレームごとに進め、HUD に出す値（スナップショット）を配る。
// HUD は useSyncExternalStore で購読する（hooks/use-drive-snapshot.ts）。3D は world() を毎フレーム読む。

/** HUD に配る間隔（実時間 ms）。アラートの状態が変わったときはすぐ配る */
const PUBLISH_MS = 100
/** フレーム時間を覚えておく数（約 2 分） */
const MAX_FRAMES = 7200

export type DriveSnapshot = {
  /** シミュレーションの経過（ms） */
  t: number
  /** いまの時刻（epoch ms） */
  clockMs: number
  /** 日没（epoch ms） */
  sunsetMs: number | null
  speedKmh: number
  playback: Playback
  zone: ZoneStatus
  /** 次のゾーンの到達予定（epoch ms） */
  nextZoneEtaMs: number | null
  alert: DerivedAlert
  light: LightPeriod
  outcome: DriveOutcome
  alertEnabled: boolean
  lang: Lang
  weather: Weather
  surface: Surface
  encounters: readonly Encounter[]
}

export class DriveEngine {
  readonly zones: ZoneCollection
  private current: World
  private snapshot: DriveSnapshot
  private readonly listeners = new Set<() => void>()
  private sincePublish = 0
  private readonly frameMs: number[] = []
  private sunsetMs: number | null

  constructor(scenario: DriveScenario, zones: ZoneCollection) {
    this.zones = zones
    this.current = createWorld(scenario, zones)
    // 日没はその日の到着地で測る（A-2 の日没と同じ地点。brief-map の sun.place）
    const end = scenario.route[scenario.route.length - 1]
    this.sunsetMs = end ? sunsetOf(this.current.internal.startMs, end) : null
    this.snapshot = this.makeSnapshot()
  }

  /** いまの World（3D が毎フレーム読む。書き換えない） */
  get world(): World {
    return this.current
  }

  /** 1 フレーム進める。realDtMs は前のフレームからの実時間 */
  frame(realDtMs: number): SimEvent[] {
    if (realDtMs > 0 && !this.current.playback.paused) {
      this.frameMs.push(realDtMs)
      if (this.frameMs.length > MAX_FRAMES) this.frameMs.shift()
    }
    const before = this.current.alert.state
    const outcome = this.current.outcome
    const paused = this.current.playback.paused
    const events = advance(this.current, realDtMs, this.zones)
    this.sincePublish += realDtMs
    const changed =
      before !== this.current.alert.state ||
      outcome !== this.current.outcome ||
      paused !== this.current.playback.paused ||
      events.length > 0
    if (changed || this.sincePublish >= PUBLISH_MS) this.publish()
    return events
  }

  setInput(input: DriveInput): void {
    setInput(this.current, input)
  }

  /** 再生速度を選ぶ。ゾーン内で速くしようとしたら 'in-zone' を返す */
  setRate(rate: PlaybackRate): 'in-zone' | null {
    const rejected = setRate(this.current, rate)
    this.publish()
    return rejected
  }

  setPaused(paused: boolean): void {
    if (this.current.playback.paused === paused) return
    pause(this.current, paused)
    this.publish()
  }

  /** 同じ場面を最初からやり直す（同じシード） */
  restart(): void {
    this.current = createWorld(this.current.scenario, this.zones)
    this.frameMs.length = 0
    this.publish()
  }

  frameSummary(): FrameSummary | null {
    return summarizeFrames(this.frameMs)
  }

  /** 走行の結果（drive-link R8）。衝突か完走のあとだけ。走っている間は null */
  result(): DriveResult | null {
    return driveResult(this.current, this.frameSummary())
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): DriveSnapshot => this.snapshot

  private publish(): void {
    this.sincePublish = 0
    this.snapshot = this.makeSnapshot()
    for (const listener of this.listeners) listener()
  }

  private makeSnapshot(): DriveSnapshot {
    const w = this.current
    const clockMs = simClockMs(w)
    const toNextKm = w.zone.nextEntryKm === null ? null : w.zone.nextEntryKm - w.zone.positionKm
    return {
      t: w.t,
      clockMs,
      sunsetMs: this.sunsetMs,
      speedKmh: Math.abs(w.vehicle.speed) * 3.6,
      playback: w.playback,
      zone: w.zone,
      nextZoneEtaMs:
        w.zone.gps.status === 'outside' && toNextKm !== null
          ? etaMs(clockMs, toNextKm, w.vehicle.speed)
          : null,
      alert: w.alert,
      light: w.light,
      outcome: w.outcome,
      alertEnabled: w.scenario.alertEnabled,
      lang: w.scenario.trip.lang,
      weather: w.scenario.weather,
      surface: w.scenario.surface,
      encounters: w.encounters.map((e) => ({ ...e })),
    }
  }
}
