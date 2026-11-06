import type { DriveAudioSignals } from './signals'

// ブレーキ音の値（docs/specs/drive-audio-chat/functional.md R4、drive-sound-tourism S8・S9）。純粋関数。
// タイヤのこすれ（900 Hz に絞った雑音）を強さ × 速さで、全力ブレーキの鳴きは CC0 の録音を 1 回ずつ、
// ABS はこすれと鳴きの断続にする。

const SILENT_BELOW_KMH = 3
const FULL_AT_KMH = 60
const NOISE_GAIN = 0.8
/** Space の全力ブレーキだけで鳴かせる（S キーの上限 0.6 から離す。S9） */
const SQUEAL_MIN_BRAKE = 0.7
const SQUEAL_MIN_KMH = 20
const SQUEAL_GAIN = 0.8
/** ABS が効く路面の鳴きの倍率（断続はグラフが掛ける。S9） */
const ABS_SQUEAL = 0.6
/** ABS の断続（1 秒あたり） */
export const ABS_PULSE_HZ = 14
/** 鳴きの録音 1 回の長さ（秒）。踏み続けていれば、これごとに鳴らし直す（S9） */
export const SQUEAL_SAMPLE_S = 1.1

export type BrakeVoice = {
  /** こすれのノイズの大きさ（0〜1） */
  noise: number
  /** 鳴きの大きさ（0〜1）。0 なら鳴らさない */
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
  // ABS が効く路面（雪・凍結・濡れた路面）は小さめに鳴かせ、こすれと同じ断続を掛ける
  const squeal =
    brake >= SQUEAL_MIN_BRAKE && s.speedKmh >= SQUEAL_MIN_KMH
      ? SQUEAL_GAIN * brake * (s.abs ? ABS_SQUEAL : 1)
      : 0
  return { noise, squeal, absHz: s.abs ? ABS_PULSE_HZ : 0 }
}

/**
 * 鳴きの録音をいま鳴らすか（S9）。lastAtS は前に鳴らした時刻（鳴らしていない・条件を外れたら null）。
 * 条件の間は SQUEAL_SAMPLE_S ごとに鳴らし直す
 */
export function squealDue(squeal: number, lastAtS: number | null, nowS: number): boolean {
  if (squeal <= 0) return false
  // 小数の誤差（3 + 1.1 - 3 < 1.1）で 1 回分遅れないよう、1 µs のゆとりを持たせる
  return lastAtS === null || nowS - lastAtS >= SQUEAL_SAMPLE_S - 1e-6
}
