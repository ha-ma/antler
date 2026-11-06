import type { DriveAudioSignals } from './signals'

// ブレーキ音の値（docs/specs/drive-audio-chat/functional.md R4）。純粋関数。
// タイヤのこすれ（ノイズ）を強さ × 速さで、強いブレーキの鳴き（高い音）を少し、ABS は断続にする。

const SILENT_BELOW_KMH = 3
const FULL_AT_KMH = 60
const NOISE_GAIN = 0.6
const SQUEAL_MIN_BRAKE = 0.6
const SQUEAL_MIN_KMH = 20
const SQUEAL_GAIN = 0.15
/** ABS の断続（1 秒あたり） */
export const ABS_PULSE_HZ = 14

export type BrakeVoice = {
  /** こすれのノイズの大きさ（0〜1） */
  noise: number
  /** 鳴きの大きさ（0〜1） */
  squeal: number
  /** ABS の断続の速さ（Hz）。効いていなければ 0 */
  absHz: number
}

const SILENT: BrakeVoice = { noise: 0, squeal: 0, absHz: 0 }

export function brakeVoice(s: DriveAudioSignals): BrakeVoice {
  if (s.paused || s.outcome !== 'driving' || s.speedKmh < SILENT_BELOW_KMH) return SILENT
  const brake = Math.min(1, Math.max(0, s.brake))
  if (brake === 0) return SILENT
  const noise = brake * Math.min(1, s.speedKmh / FULL_AT_KMH) * NOISE_GAIN
  const squeal = brake >= SQUEAL_MIN_BRAKE && s.speedKmh >= SQUEAL_MIN_KMH ? SQUEAL_GAIN * brake : 0
  return { noise, squeal, absHz: s.abs ? ABS_PULSE_HZ : 0 }
}
