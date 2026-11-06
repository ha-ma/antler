import type { AlertStateName } from '@antler/alert-ui'
import type { DriveSnapshot } from '../domain/engine'
import type { DriveOutcome } from '../types'
import type { ChatTrack, LocalizedLine, ReactionKind, Speaker } from './chat-types'

// 会話を出すタイミング（docs/specs/drive-audio-chat/functional.md R12）。純粋関数。
// 時間はシミュレーションの経過 t（一時停止の間は進まないので、待ちも止まる）。
// - 話の行: 前の道のり〜いまの道のりの間に越えた行を、道のりの順に。出した行は覚え、後退して戻っても 2 回出さない
// - 反応: ゾーンに入って 2.5 秒後に zone-enter、出たら zone-exit（区間ごとに 1 回）、avoided は増えたぶん。アラート OFF は avoided だけ
// - 赤の間は待たせ、赤が終わって 1.5 秒後にまとめて出す（新しい 3 行まで。また赤なら数え直す）
// - 束が替わったら、いまの道のりより先だけを新しい束から出し、待ち行列は捨てる
// - t が戻ったら（restart）最初から

/** 1 フレームの入力（スナップショットから作る） */
export type ChatFrame = {
  /** シミュレーションの経過（ms） */
  t: number
  /** ルートの道のり（km） */
  positionKm: number
  /** いる鹿ゾーンの区間の番号（外なら null） */
  zoneInterval: number | null
  alert: AlertStateName
  alertEnabled: boolean
  paused: boolean
  outcome: DriveOutcome
  /** avoided になった遭遇の数 */
  avoidedCount: number
}

export type EmittedLine = { key: string; speaker: Speaker; text: LocalizedLine }

export type ChatState = {
  trackKey: string | null
  /** これより手前（m）の話の行は出さない（束の差し替え） */
  minM: number
  prevM: number | null
  lastT: number
  shown: ReadonlySet<string>
  zoneInterval: number | null
  entered: ReadonlySet<number>
  exited: ReadonlySet<number>
  /** zone-enter を出す時刻（t） */
  pendingEnterAt: number | null
  counts: Record<ReactionKind, number>
  avoidedSeen: number
  held: EmittedLine[]
  wasDanger: boolean
  releaseAt: number | null
  seq: number
}

export const ZONE_ENTER_DELAY_MS = 2500
export const RELEASE_AFTER_DANGER_MS = 1500
export const MAX_HELD = 3

export function initialChatState(): ChatState {
  return {
    trackKey: null,
    minM: -Infinity,
    prevM: null,
    lastT: 0,
    shown: new Set(),
    zoneInterval: null,
    entered: new Set(),
    exited: new Set(),
    pendingEnterAt: null,
    counts: { 'zone-enter': 0, 'zone-exit': 0, avoided: 0 },
    avoidedSeen: 0,
    held: [],
    wasDanger: false,
    releaseAt: null,
    seq: 0,
  }
}

export function chatFrameFromSnapshot(
  s: Pick<
    DriveSnapshot,
    't' | 'zone' | 'alert' | 'alertEnabled' | 'playback' | 'outcome' | 'encounters'
  >,
): ChatFrame {
  return {
    t: s.t,
    positionKm: s.zone.positionKm,
    zoneInterval: s.zone.gps.status === 'inside' ? s.zone.interval : null,
    alert: s.alert.state,
    alertEnabled: s.alertEnabled,
    paused: s.playback.paused,
    outcome: s.outcome,
    avoidedCount: s.encounters.filter((e) => e.outcome === 'avoided').length,
  }
}

export function advanceChat(
  previous: ChatState,
  track: ChatTrack,
  f: ChatFrame,
): { state: ChatState; emitted: EmittedLine[] } {
  // restart（同じ場面を最初から）
  let state = f.t < previous.lastT ? initialChatState() : previous
  if (state.trackKey !== track.key) {
    state = {
      ...state,
      trackKey: track.key,
      minM: state.trackKey === null ? -Infinity : (state.prevM ?? -Infinity),
      held: [],
    }
  }
  if (f.paused || f.outcome !== 'driving') return { state, emitted: [] }

  const posM = f.positionKm * 1000
  let seq = state.seq
  const make = (speaker: Speaker, text: LocalizedLine): EmittedLine => {
    seq += 1
    return { key: `c${String(seq)}`, speaker, text }
  }
  const due: EmittedLine[] = []

  // 話の行
  const shown = new Set(state.shown)
  if (state.prevM !== null) {
    const from = Math.max(state.prevM, state.minM)
    for (const r of track.road) {
      if (r.atM > from && r.atM <= posM && !shown.has(r.id)) {
        shown.add(r.id)
        due.push(make(r.speaker, r.text))
      }
    }
  }

  // 反応
  const counts = { ...state.counts }
  const react = (kind: ReactionKind) => {
    counts[kind] += 1
    const line = track.reactions[kind][(counts[kind] - 1) % 2]
    if (line) due.push(make(line.speaker, line.text))
  }
  const entered = new Set(state.entered)
  const exited = new Set(state.exited)
  let pendingEnterAt = state.pendingEnterAt
  if (f.zoneInterval !== state.zoneInterval) {
    const left = state.zoneInterval
    if (left !== null && !exited.has(left)) {
      exited.add(left)
      // 2.5 秒の前に出たら、入った行は出さない
      pendingEnterAt = null
      if (f.alertEnabled) react('zone-exit')
    }
    if (f.zoneInterval !== null && !entered.has(f.zoneInterval)) {
      entered.add(f.zoneInterval)
      pendingEnterAt = f.alertEnabled ? f.t + ZONE_ENTER_DELAY_MS : null
    }
  }
  if (pendingEnterAt !== null && f.t >= pendingEnterAt) {
    pendingEnterAt = null
    react('zone-enter')
  }
  for (let n = state.avoidedSeen; n < f.avoidedCount; n++) react('avoided')

  // 赤の間は待たせる
  let held = state.held
  let releaseAt = state.releaseAt
  let wasDanger = state.wasDanger
  let emitted: EmittedLine[] = []
  if (f.alert === 'danger') {
    held = [...held, ...due].slice(-MAX_HELD)
    releaseAt = null
    wasDanger = true
  } else {
    if (wasDanger) {
      releaseAt = f.t + RELEASE_AFTER_DANGER_MS
      wasDanger = false
    }
    if (releaseAt === null) {
      emitted = due
    } else if (f.t >= releaseAt) {
      emitted = [...held, ...due].slice(-Math.max(MAX_HELD, due.length))
      held = []
      releaseAt = null
    } else {
      held = [...held, ...due].slice(-MAX_HELD)
    }
  }

  return {
    state: {
      ...state,
      prevM: posM,
      lastT: f.t,
      shown,
      zoneInterval: f.zoneInterval,
      entered,
      exited,
      pendingEnterAt,
      counts,
      avoidedSeen: Math.max(state.avoidedSeen, f.avoidedCount),
      held,
      wasDanger,
      releaseAt,
      seq,
    },
    emitted,
  }
}
