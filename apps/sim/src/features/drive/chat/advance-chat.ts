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
// - 観光の行を足す（drive-sound-tourism S13〜S15）: ゾーンの外・赤でないとき、最後の行から実時間で 15 秒あいたら、
//   まだ出していない楽しみの行（無ければ補いの行）を 1 行。実時間は経過 ÷ 再生速度（タイムラプスで流れ込まない）

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
  /** いまのステージ（drive-tune R1。ステージを移ると道のりが先へ飛ぶ） */
  stage: number
  /** 再生速度（1・4・16）。実時間 = 経過 ÷ 速度（S13） */
  rate: number
  /** 次の鹿ゾーンの入口までの道のり（m）。無ければ null（S13） */
  toZoneM: number | null
}

export type EmittedLine = {
  key: string
  speaker: Speaker
  /** 楽しみの話の行の楽しみの id（写真を出す。drive-tourism T8）。反応の行は null */
  pleasure: string | null
  text: LocalizedLine
}

export type ChatState = {
  trackKey: string | null
  /** これより手前（m）の話の行は出さない（束の差し替え） */
  minM: number
  prevM: number | null
  /** 前のフレームのステージ（初めは null） */
  stage: number | null
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
  /** 走り始めからの実時間（ms。S13） */
  realMs: number
  /** 最後に行を出した実時間（ms） */
  lastLineRealMs: number
  /** 次に出す補いの行の番号 */
  fillerIndex: number
}

export const ZONE_ENTER_DELAY_MS = 2500
export const RELEASE_AFTER_DANGER_MS = 1500
export const MAX_HELD = 3
/** 観光の行を足すまでの実時間の間（S13） */
export const CHAT_GAP_MS = 15_000
/** 次のゾーンの入口がこれより近ければ観光の行を足さない（入口のチャイムと重ねない。S13） */
export const NO_FILL_BEFORE_ZONE_M = 300

export function initialChatState(): ChatState {
  return {
    trackKey: null,
    minM: -Infinity,
    prevM: null,
    stage: null,
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
    realMs: 0,
    lastLineRealMs: 0,
    fillerIndex: 0,
  }
}

export function chatFrameFromSnapshot(
  s: Pick<
    DriveSnapshot,
    't' | 'zone' | 'alert' | 'alertEnabled' | 'playback' | 'outcome' | 'encounters' | 'stage'
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
    stage: s.stage.index,
    rate: s.playback.rate,
    toZoneM:
      s.zone.nextEntryKm === null
        ? null
        : Math.max(0, (s.zone.nextEntryKm - s.zone.positionKm) * 1000),
  }
}

/** 足す観光の行（S13・S14）。過ぎたのに出していない楽しみの行、無ければ位置を過ぎていない補いの行 */
function nextTourismLine(
  track: ChatTrack,
  shown: ReadonlySet<string>,
  posM: number,
  minM: number,
  fillerIndex: number,
): { road: ChatTrack['road'][number] | null; filler: number | null } {
  // 束が替わったときの手前（minM 以前）の行は出さない（code-reviewer W7）
  const skipped = track.road.find(
    (r) => r.pleasure !== null && r.atM > minM && r.atM <= posM && !shown.has(r.id),
  )
  if (skipped) return { road: skipped, filler: null }
  const n = track.filler.length
  for (let k = 0; k < n; k++) {
    const i = (fillerIndex + k) % n
    const line = track.filler[i]
    if (line && line.untilM > posM) return { road: null, filler: i }
  }
  return { road: null, filler: null }
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
  // 実時間（S13）。走り始めの 1 フレーム目は数えない
  const realMs =
    state.prevM === null
      ? state.realMs
      : state.realMs + Math.max(0, f.t - state.lastT) / Math.max(1, f.rate)
  let seq = state.seq
  const make = (speaker: Speaker, text: LocalizedLine, pleasure: string | null): EmittedLine => {
    seq += 1
    return { key: `c${String(seq)}`, speaker, pleasure, text }
  }
  const due: EmittedLine[] = []

  // 話の行
  // 集合と数は、変わるときだけ作り直す（約 10 Hz で呼ばれるので割り当てを減らす）
  // 走り始めと、ステージを移って道のりが飛んだとき（drive-tune R1）は、飛ばした区間の行をまとめて出さず、
  // 最後の 1 行だけを出す（移動の間に交わした話として）。ほかの行は出したことにする
  const jumped = state.prevM === null || (state.stage !== null && f.stage !== state.stage)
  const from = Math.max(state.prevM ?? -Infinity, state.minM)
  const crossed = track.road.filter((r) => r.atM > from && r.atM <= posM && !state.shown.has(r.id))
  const spoken = jumped ? crossed.slice(-1) : crossed
  // 飛ばした楽しみの行は出したことにしない（後で S13 の観光の行として出せる。S15）
  const newlyShown = crossed.filter((r) => !r.pleasure || spoken.includes(r)).map((r) => r.id)
  for (const r of spoken) {
    due.push(make(r.speaker, r.text, r.pleasure))
  }
  let shown = newlyShown.length > 0 ? new Set([...state.shown, ...newlyShown]) : state.shown

  // 反応
  let counts = state.counts
  const react = (kind: ReactionKind) => {
    counts = { ...counts, [kind]: counts[kind] + 1 }
    const line = track.reactions[kind][(counts[kind] - 1) % 2]
    if (line) due.push(make(line.speaker, line.text, null))
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

  // 観光の行を足す（S13・S14）。ゾーンの中・入口の手前・赤・待たせている行があるときは足さない
  let fillerIndex = state.fillerIndex
  if (
    due.length === 0 &&
    realMs - state.lastLineRealMs >= CHAT_GAP_MS &&
    f.zoneInterval === null &&
    (f.toZoneM === null || f.toZoneM > NO_FILL_BEFORE_ZONE_M) &&
    f.alert !== 'danger' &&
    state.held.length === 0 &&
    state.releaseAt === null
  ) {
    const next = nextTourismLine(track, shown, posM, state.minM, fillerIndex)
    if (next.road) {
      shown = new Set(shown).add(next.road.id)
      due.push(make(next.road.speaker, next.road.text, next.road.pleasure))
    } else if (next.filler !== null) {
      const line = track.filler[next.filler]
      fillerIndex = next.filler + 1
      if (line) due.push(make(line.speaker, line.text, line.pleasure))
    }
  }

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
      stage: f.stage,
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
      realMs,
      lastLineRealMs: emitted.length > 0 ? realMs : state.lastLineRealMs,
      fillerIndex,
    },
    emitted,
    reset,
  }
}
