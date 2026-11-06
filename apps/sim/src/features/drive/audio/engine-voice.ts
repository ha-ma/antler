import type { DriveAudioSignals } from './signals'

// エンジン音の値（docs/specs/drive-audio-chat/functional.md R3）。純粋関数。
// 回転数で音の高さ、回転数とアクセルで大きさを決める。合図に回転数が無ければ速さから仮のギアで作る。

/** 仮のギアの幅（km/h）。0〜20・20〜40・40〜60・60〜80・80 km/h〜 の 5 段 */
const GEAR_SPAN_KMH = 20
const TOP_GEAR = 5
export const IDLE_RPM = 900
/** ギアの中で上がる回転数（900 → 3,600 rpm） */
const GEAR_RPM_RANGE = 2700
const THROTTLE_RPM = 400
export const MAX_RPM = 6000
/** 大きさの割合を 1 にする回転数（900 rpm で 0、4,000 rpm で 1） */
const LOUD_RPM = 4000
const IDLE_GAIN = 0.25
const RPM_GAIN = 0.35
const THROTTLE_GAIN = 0.3
const MAX_GAIN = 0.9

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function virtualGear(speedKmh: number): number {
  return Math.min(TOP_GEAR, Math.floor(Math.max(0, speedKmh) / GEAR_SPAN_KMH) + 1)
}

export function engineRpm(s: Pick<DriveAudioSignals, 'speedKmh' | 'throttle' | 'rpm'>): number {
  if (s.rpm !== null) return Math.min(MAX_RPM, Math.max(0, s.rpm))
  const gear = virtualGear(s.speedKmh)
  const low = (gear - 1) * GEAR_SPAN_KMH
  const frac = clamp01((s.speedKmh - low) / GEAR_SPAN_KMH)
  return Math.min(MAX_RPM, IDLE_RPM + frac * GEAR_RPM_RANGE + clamp01(s.throttle) * THROTTLE_RPM)
}

export type EngineVoice = {
  /** 基音（Hz）。4 気筒の爆発の周波数 = rpm ÷ 60 × 2 */
  freqHz: number
  /** 大きさ（0〜1 の相対値） */
  gain: number
}

export function engineVoice(s: DriveAudioSignals): EngineVoice {
  const rpm = engineRpm(s)
  const freqHz = rpm / 30
  if (s.paused || s.outcome !== 'driving') return { freqHz, gain: 0 }
  const rpmFrac = clamp01((rpm - IDLE_RPM) / (LOUD_RPM - IDLE_RPM))
  const gain = Math.min(
    MAX_GAIN,
    IDLE_GAIN + rpmFrac * RPM_GAIN + clamp01(s.throttle) * THROTTLE_GAIN,
  )
  return { freqHz, gain }
}
