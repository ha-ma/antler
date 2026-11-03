import type { Playback, PlaybackRate } from '../types'

// 再生速度（R4、A3-6）。ゾーン外は 1× / 4× / 16× と一時停止。ゾーンに入ったら 1× に戻し、ゾーン内は速度を上げられない。
// 一時停止はゾーン内でもできる（止めても何も飛ばさない。WCAG 2.2.2）。

export const PLAYBACK_RATES: readonly PlaybackRate[] = [1, 4, 16]

export const INITIAL_PLAYBACK: Playback = { rate: 1, paused: false, locked: false }

export type RateChange = { playback: Playback; rejected: 'in-zone' | null }

/** 利用者が速度を選ぶ。ゾーン内で 1× より速くしようとしたら断る */
export function requestRate(playback: Playback, rate: PlaybackRate): RateChange {
  if (playback.locked && rate !== 1) return { playback, rejected: 'in-zone' }
  return { playback: { ...playback, rate }, rejected: null }
}

export function setPaused(playback: Playback, paused: boolean): Playback {
  return { ...playback, paused }
}

/** ゾーンに入った・出た。入ったら 1× に戻して固定、出たら固定を外す（速度は 1× のまま） */
export function setInZone(playback: Playback, inZone: boolean): Playback {
  if (inZone) return { ...playback, rate: 1, locked: true }
  return playback.locked ? { ...playback, locked: false } : playback
}

/** 実時間の経過（ms）からシミュレーションの経過（ms）。一時停止なら 0 */
export function scaledDt(playback: Playback, realDtMs: number): number {
  return playback.paused ? 0 : realDtMs * playback.rate
}
