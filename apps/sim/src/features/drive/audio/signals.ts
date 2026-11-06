import type { AlertStateName } from '@antler/alert-ui'
import type { DriveSnapshot } from '../domain/engine'
import type { DriveInput, DriveOutcome } from '../types'

// 運転の音が受け取る合図（docs/specs/drive-audio-chat/functional.md R3・R4・R6）。
// drive-tune（運転の中身）が回転数・ブレーキの強さ・ABS を出したら、signalsFromSnapshot をそれに合わせる（PR 2）。
// それまでは、スナップショットと入力から作る（回転数は仮のギア、ブレーキは押しているかの 0 / 1、ABS は効いていない）。

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

/** スナップショットと入力から合図を作る（R4: Space か、前進中の S を押していればブレーキ 1） */
export function signalsFromSnapshot(
  snapshot: Pick<DriveSnapshot, 'speedKmh' | 'alert' | 'alertEnabled' | 'playback' | 'outcome'>,
  input: Pick<DriveInput, 'throttle' | 'brake' | 'back'>,
): DriveAudioSignals {
  const braking = input.brake || (input.back && snapshot.speedKmh > 0.5)
  return {
    speedKmh: Math.abs(snapshot.speedKmh),
    throttle: input.throttle ? 1 : 0,
    brake: braking ? 1 : 0,
    abs: false,
    rpm: null,
    alert: snapshot.alert.state,
    alertEnabled: snapshot.alertEnabled,
    paused: snapshot.playback.paused,
    outcome: snapshot.outcome,
  }
}
