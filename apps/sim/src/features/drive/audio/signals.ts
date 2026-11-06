import type { AlertStateName } from '@antler/alert-ui'
import type { DriveSnapshot, DriveTelemetry } from '../domain/engine'
import type { DriveOutcome } from '../types'

// 運転の音が受け取る合図（docs/specs/drive-audio-chat/functional.md R3・R4・R6）。
// 回転数・ブレーキの強さ・ABS・アクセルは drive-tune の DriveEngine.telemetry()（R6）から、
// 鹿の警告の状態・一時停止・走行の終わりはスナップショットから取る。

export type DriveAudioSignals = {
  /** 速さの絶対値（km/h） */
  speedKmh: number
  /** アクセル（0〜1） */
  throttle: number
  /** ブレーキの強さ（0〜1） */
  brake: number
  /** ABS が効いているか */
  abs: boolean
  /** エンジン回転数。無ければ速さから仮のギアで作る */
  rpm: number | null
  /** 鹿の警告の 3 状態 */
  alert: AlertStateName
  /** アラート ON の走行か（OFF ではゾーンで BGM を下げない。R6a） */
  alertEnabled: boolean
  paused: boolean
  outcome: DriveOutcome
}

/** 止まっていて何も押していない（音の初期値） */
export const IDLE_SIGNALS: DriveAudioSignals = {
  speedKmh: 0,
  throttle: 0,
  brake: 0,
  abs: false,
  rpm: null,
  alert: 'safe',
  alertEnabled: true,
  paused: false,
  outcome: 'driving',
}

export function driveAudioSignals(
  telemetry: DriveTelemetry,
  snapshot: Pick<DriveSnapshot, 'alert' | 'alertEnabled' | 'playback' | 'outcome'>,
): DriveAudioSignals {
  return {
    speedKmh: Math.abs(telemetry.speedKmh),
    throttle: telemetry.throttle ? 1 : 0,
    brake: Math.min(1, Math.max(0, telemetry.brake)),
    abs: telemetry.abs,
    rpm: telemetry.rpm,
    alert: snapshot.alert.state,
    alertEnabled: snapshot.alertEnabled,
    paused: snapshot.playback.paused,
    outcome: snapshot.outcome,
  }
}
