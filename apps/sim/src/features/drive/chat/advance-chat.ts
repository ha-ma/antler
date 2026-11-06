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
  /** zone-enter を出した区間（出した区間だけ zone-exit を出す） */
  announced: ReadonlySet<number>
  exited: ReadonlySet<number>
  /** zone-enter を出す予定（区間と時刻 t） */
  pendingEnter: { interval: number; at: number } | null
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
    announced: new Set(),
    exited: new Set(),
    pendingEnter: null,
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
): { state: ChatState; emitted: EmittedLine[]; reset: boolean } {
  // restart（同じ場面を最初から）。呼ぶ側は reset で表示も消す
  const reset = f.t < previous.lastT
  let state = reset ? initialChatState() : previous
  if (state.trackKey !== track.key) {
    // 束が替わった: いまの道のりより手前は出さない（minM）。id は束ごとなので、出した行の記録も替える
    state = {
      ...state,
      trackKey: track.key,
      minM: state.trackKey === null ? -Infinity : (state.prevM ?? -Infinity),
      shown: new Set(),
      held: [],
    }
  }
  if (f.paused || f.outcome !== 'driving') return { state, emitted: [], reset }

  const posM = f.positionKm * 1000
  let seq = state.seq
  const make = (speaker: Speaker, text: LocalizedLine): EmittedLine => {
    seq += 1
    return { key: `c${String(seq)}`, speaker, text }
  }
  const due: EmittedLine[] = []

  // 話の行
  // 集合と数は、変わるときだけ作り直す（約 10 Hz で呼ばれるので割り当てを減らす）
  const newlyShown: string[] = []
  if (state.prevM !== null) {
    const from = Math.max(state.prevM, state.minM)
    for (const r of track.road) {
      if (r.atM > from && r.atM <= posM && !state.shown.has(r.id)) {
        newlyShown.push(r.id)
        due.push(make(r.speaker, r.text))
      }
    }
  }
  const shown = newlyShown.length > 0 ? new Set([...state.shown, ...newlyShown]) : state.shown

  // 反応
  let counts = state.counts
  const react = (kind: ReactionKind) => {
    counts = { ...counts, [kind]: counts[kind] + 1 }
    const line = track.reactions[kind][(counts[kind] - 1) % 2]
    if (line) due.push(make(line.speaker, line.text))
  }
  let entered = state.entered
  let announced = state.announced
  let exited = state.exited
  let pendingEnter = state.pendingEnter
  if (f.zoneInterval !== state.zoneInterval) {
    const left = state.zoneInterval
    // 2.5 秒の前に出たら、入った行も出た行も出さない（短い出入りでは何も言わない）
    if (pendingEnter && pendingEnter.interval === left) pendingEnter = null
    if (left !== null && announced.has(left) && !exited.has(left)) {
      exited = new Set(exited).add(left)
      react('zone-exit')
    }
    if (f.zoneInterval !== null && !entered.has(f.zoneInterval)) {
      entered = new Set(entered).add(f.zoneInterval)
      if (f.alertEnabled) pendingEnter = { interval: f.zoneInterval, at: f.t + ZONE_ENTER_DELAY_MS }
    }
  }
  if (pendingEnter && f.t >= pendingEnter.at) {
    announced = new Set(announced).add(pendingEnter.interval)
    pendingEnter = null
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
      // 待たせた行（3 行まで）と、このフレームで来た行をそのまま出す
      emitted = [...held, ...due]
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
      announced,
      exited,
      pendingEnter,
      counts,
      avoidedSeen: Math.max(state.avoidedSeen, f.avoidedCount),
      held,
      wasDanger,
      releaseAt,
      seq,
    },
    emitted,
    reset,
  }
}
