import type { Pleasure } from '@antler/trip'
import { hasDeerWord, nearbyPleasures } from '../../chat/tourism'
import type { DriveSnapshot } from '../../domain/engine'
import type { DriveScenario } from '../../types'
import { STAGE_BANNER_MS } from './StageBanner'

// 鹿ゾーンの外のおすすめ（docs/specs/drive-tourism/functional.md T11〜T13、drive-sound-tourism S16〜S19）。純粋関数。
// - 出しどき（S16）: 走行中・ゾーンの外・赤でない・ステージの帯が消えた後。ゾーンを出た後・赤の後は実時間で 4 秒あけてから
// - 出す楽しみ（S17）: 先のその日の楽しみ（近い順）→ 到着地の楽しみ を、出していた実時間で 12 秒ごとに入れ替える
// - 実時間は、フレームごとの「経過の差 ÷ 再生速度」の和（タイムラプスで入れ替えが速くならない）

export { STOP_MATCH_M, stopPositionsM } from '../../chat/tourism'

export type RecommendFrame = {
  /** シミュレーションの経過（ms） */
  t: number
  /** 再生速度（1・4・16） */
  rate: number
  stage: { index: number; count: number }
  stageClearedAt: number | null
  inside: boolean
  danger: boolean
  driving: boolean
}

export type RecommendState = {
  lastT: number
  /** 走り始めからの実時間（ms） */
  realMs: number
  /** 前のフレームでゾーンの中か赤だった */
  blocked: boolean
  /** この実時間より前は出さない（ゾーンを出た・赤が終わった後の間。S16） */
  resumeAtMs: number
  /** カードを出していた実時間の和（入れ替えはこれで数える。出していない間は進めない。code-reviewer W2） */
  visibleMs: number
}

export const INITIAL_RECOMMEND: RecommendState = {
  lastT: 0,
  realMs: 0,
  blocked: false,
  resumeAtMs: 0,
  visibleMs: 0,
}

/** ゾーンを出た後・赤の後に出し直すまでの実時間（S16） */
export const RESUME_AFTER_MS = 4000
/** 候補を入れ替える実時間の間（S17） */
export const ROTATE_MS = 12_000

export function recommendFrameOf(
  s: Pick<
    DriveSnapshot,
    't' | 'stage' | 'stageClearedAt' | 'zone' | 'alert' | 'outcome' | 'playback'
  >,
): RecommendFrame {
  return {
    t: s.t,
    rate: s.playback.rate,
    stage: s.stage,
    stageClearedAt: s.stageClearedAt,
    inside: s.zone.gps.status === 'inside',
    danger: s.alert.state === 'danger',
    driving: s.outcome === 'driving',
  }
}

/** 1 フレーム進める。visible はこのフレームでカードを出すか */
export function advanceRecommend(
  previous: RecommendState,
  f: RecommendFrame,
): { state: RecommendState; visible: boolean } {
  // restart（t が戻る）は最初から
  const base = f.t < previous.lastT ? INITIAL_RECOMMEND : previous
  const stepMs = Math.max(0, f.t - base.lastT) / Math.max(1, f.rate)
  const realMs = base.realMs + stepMs
  const blocked = f.inside || f.danger
  const resumeAtMs = base.blocked && !blocked ? realMs + RESUME_AFTER_MS : base.resumeAtMs
  const bannerShown = f.stageClearedAt !== null && f.t - f.stageClearedAt <= STAGE_BANNER_MS
  const visible = f.driving && f.stage.count > 0 && !blocked && !bannerShown && realMs >= resumeAtMs
  // 入れ替えは出していた間だけ数える（ゾーンの後に出し直してすぐ替わらない。code-reviewer W2）
  const visibleMs = base.visibleMs + (visible ? stepMs : 0)
  const state: RecommendState = { lastT: f.t, realMs, blocked, resumeAtMs, visibleMs }
  return { state, visible }
}

/** いまの入れ替えの番号（S17）。カードを出していた実時間の和（RecommendState.visibleMs）から */
export function rotationSlot(visibleMs: number): number {
  return Math.floor(Math.max(0, visibleMs) / ROTATE_MS)
}

export type Recommendation = {
  pleasure: Pleasure
  /** 拠点がその日の到着地なら、到着地の時刻を出す（T13） */
  atDestination: boolean
}

/**
 * 出す楽しみ（T12・S17）。候補は今の位置より先のその日の楽しみ（近い順）、続けて旅の月に合う到着地の楽しみ
 * （その日の楽しみを除く）。slot（入れ替えの番号）で順に回す。どれも無ければ null
 */
export function pickRecommendation(
  scenario: Pick<DriveScenario, 'stops' | 'to' | 'startAt'>,
  stops: readonly { pleasure: Pleasure; atM: number }[],
  positionM: number,
  slot: number,
): Recommendation | null {
  const ahead = stops
    .filter((s) => s.atM > positionM)
    .sort((a, b) => a.atM - b.atM)
    .map((s) => s.pleasure)
  const candidates = [...ahead, ...nearbyPleasures(scenario)]
  const pleasure = candidates[Math.max(0, slot) % Math.max(1, candidates.length)]
  if (!pleasure) return null
  return { pleasure, atDestination: pleasure.base === scenario.to }
}

/** カードに出す一言（note）。鹿の語が入るなら出さない（T13） */
export function cardNote(note: string): string | null {
  return hasDeerWord(note) ? null : note
}
