import type {
  ChatDataVersion,
  ChatPlan,
  ChatPlanLine,
  ChatSpeaker,
  PleasureAngle,
  PleasureTiming,
  PleasureWhen,
  TalkTopic,
} from '../models/chat-deck.js'
import type { ChatMaterial, ChatMaterialZone, LightOnRoad } from '../models/chat-material.js'
import {
  CHAT_KEY_VERSION,
  DEPART_AFTER_EXIT_KM,
  DEPART_KM,
  EDGE_MARGIN_KM,
  KM_DIGITS,
  MAX_LATER_STOPS,
  MAX_TALKS_PER_DAY,
  MAX_TALKS_PER_LEG,
  MIN_GAP_KM,
  PLEASURE_CYCLE,
  TALK_INTERVAL_KM,
  TALK_JITTER_RATIO,
  ZONE_MARGIN_KM,
} from '../rules/chat-rules.js'
import { chatRandom } from './chat-random.js'

// 会話の束の組み立て（docs/specs/drive-audio-chat/functional.md R10・R11）。同じ入力なら同じ束（純粋関数）。
// road の行だけを作る（ゾーンに入った・出た・避けたの反応の行は端末の固定の表）。
// 位置をすべて決めて → 1 日 10 行に削って → 移動・km の順に並べてから、その順で id・話し手・話題を割り当てる
// （先に割り当てると、削る・並べ替えるで「同じ話題・同じ人を続けない」が崩れる）。
// 楽しみの行どうしは続いてよい（切り口で文を変える。drive-tourism T1）。楽しみ以外の話題は直前の楽しみ以外の話題と変える。

type OtherTopic = Exclude<TalkTopic, 'pleasure'>
/** 楽しみ以外の話題（drive-tourism T1。話の行の 3 つに 1 つ、または楽しみの候補が無いとき） */
const OTHER_TOPICS: readonly OtherTopic[] = ['weather', 'light', 'scenery', 'snack', 'music']
/** これからの楽しみの切り口の順（drive-tourism T3） */
const AHEAD_ANGLES: readonly PleasureAngle[] = ['anticipation', 'highlight', 'tip']
const SEATS: readonly ChatSpeaker[] = ['p1', 'p2', 'p3']
const SCALE = 10 ** KM_DIGITS
/** 浮動小数の誤差で、丸めが 1 段ずれないように */
const EPSILON = 1e-9

type Placed = { leg: number; km: number; depart: boolean }

/** 保存の鍵の材料（R15）。ハッシュは usecase が Hasher で取る */
export function chatKeyMaterial(tripId: string, day: number, data: ChatDataVersion): string {
  return [CHAT_KEY_VERSION, tripId, String(day), data.routes, data.zones].join('|')
}

/** 話し手の候補（R10）。同乗者は人数 − 1 人（最大 3 人）、1 人旅はラジオの DJ だけ */
export function speakersFor(partySize: number): ChatSpeaker[] {
  const passengers = Math.min(SEATS.length, Math.max(0, partySize - 1))
  return passengers === 0 ? ['radio'] : SEATS.slice(0, passengers)
}

export function buildChatPlan(m: ChatMaterial, lightAt: LightOnRoad): ChatPlan {
  const random = chatRandom(m.seed, m.day)
  const placed: Placed[] = []
  const talks: Placed[] = []
  m.legs.forEach((leg, i) => {
    const zones = m.zones.filter((z) => z.leg === i)
    const depart = departKm(leg.distanceKm, zones)
    const taken: number[] = depart === null ? [] : [depart]
    if (depart !== null) placed.push({ leg: i, km: depart, depart: true })
    const legTalks: Placed[] = []
    for (const km of talkKms(leg.distanceKm, zones, random)) {
      if (km === null || taken.some((t) => Math.abs(t - km) <= MIN_GAP_KM + EPSILON)) continue
      taken.push(km)
      legTalks.push({ leg: i, km, depart: false })
    }
    talks.push(...legTalks.sort((a, b) => a.km - b.km))
  })
  // 1 日 10 行まで。移動の順・km の順に並んでいるので、後ろの移動（同じ移動なら遠い方）から減る
  placed.push(...talks.slice(0, MAX_TALKS_PER_DAY))
  placed.sort((a, b) => a.leg - b.leg || a.km - b.km)

  const speakers = speakersFor(m.partySize)
  const pauses = pausesOf(m)
  let previousSpeaker: ChatSpeaker | null = null
  let previousOther: OtherTopic | null = null
  // 楽しみの話（drive-tourism T1〜T3）: 話の行の通し番号・楽しみごとの話した回数・ahead の回数
  let talkIndex = 0
  const usedCount = new Map<string, number>()
  const aheadCount = new Map<string, number>()
  const lines: ChatPlanLine[] = placed.map((p, index) => {
    const speaker = pick(
      speakers.length > 1 ? speakers.filter((s) => s !== previousSpeaker) : speakers,
      random,
    )
    previousSpeaker = speaker
    const base = {
      id: `l${String(index + 1).padStart(2, '0')}`,
      cue: { kind: 'road' as const, leg: p.leg, km: p.km },
      speaker,
    }
    const none = { pleasure: null, timing: null, angle: null, when: null, light: null }
    if (p.depart) return { ...base, topic: 'depart', ...none }
    const i = talkIndex
    talkIndex += 1
    // 順に回す: 話した回数のいちばん少ない候補（同じなら候補の順）。移動ごとに候補が変わっても飛ばされる楽しみを作らない
    // （code-reviewer W3）
    const candidates = pleasureCandidates(m, pauses, p.leg)
    const chosen = candidates.reduce<(typeof candidates)[number] | undefined>(
      (best, c) => (!best || (usedCount.get(c.id) ?? 0) < (usedCount.get(best.id) ?? 0) ? c : best),
      undefined,
    )
    if (i % PLEASURE_CYCLE !== PLEASURE_CYCLE - 1 && chosen) {
      usedCount.set(chosen.id, (usedCount.get(chosen.id) ?? 0) + 1)
      let angle: PleasureAngle = 'memory'
      if (chosen.timing === 'ahead') {
        const n = aheadCount.get(chosen.id) ?? 0
        aheadCount.set(chosen.id, n + 1)
        angle = AHEAD_ANGLES[n % AHEAD_ANGLES.length] ?? 'anticipation'
      }
      return {
        ...base,
        topic: 'pleasure',
        ...none,
        pleasure: chosen.id,
        timing: chosen.timing,
        angle,
        when: chosen.when,
      }
    }
    const topic = pick(
      OTHER_TOPICS.filter((t) => t !== previousOther),
      random,
    )
    previousOther = topic
    return {
      ...base,
      topic,
      ...none,
      light: topic === 'light' ? lightAt(p.leg, p.km, passingMs(m, p.leg, p.km)) : null,
    }
  })
  return { tripId: m.tripId, day: m.day, lines, data: m.data }
}

/**
 * leg 番目の移動を走る間の楽しみの候補（drive-tourism T2）。
 * その日のこれから → なければ、いちばん最近に済んだもの（done）＋後の日 → なければ後の日
 */
function pleasureCandidates(
  m: ChatMaterial,
  pauses: readonly number[],
  leg: number,
): { id: string; timing: PleasureTiming; when: PleasureWhen }[] {
  const later = m.laterStops
    .slice(0, MAX_LATER_STOPS)
    .map((s) => ({ id: s.id, timing: 'ahead' as const, when: 'later' as const }))
  const ahead = m.stops.filter((_, j) => (pauses[j] ?? 0) > leg)
  if (ahead.length > 0) {
    return ahead.map((s) => ({ id: s.id, timing: 'ahead' as const, when: 'today' as const }))
  }
  const last = m.stops.filter((_, j) => (pauses[j] ?? 0) <= leg).at(-1)
  return last ? [{ id: last.id, timing: 'done' as const, when: 'today' as const }, ...later] : later
}

/** 出発の行の道のり。ゾーンの中なら出口の 0.2 km 先（繰り返す）。終わりの 1 km 手前より先になれば作らない */
function departKm(distanceKm: number, zones: ChatMaterialZone[]): number | null {
  let km = Math.min(DEPART_KM, distanceKm)
  for (;;) {
    const inside = zoneAt(zones, km)
    if (!inside) return km
    km = ceilKm(inside.exitKm + DEPART_AFTER_EXIT_KM)
    if (km > distanceKm - EDGE_MARGIN_KM + EPSILON) return null
  }
}

/** 話の行の候補の道のり（作らない候補は null）。乱数は候補ごとに必ず 1 回引く（同じ旅は同じ列） */
function talkKms(
  distanceKm: number,
  zones: ChatMaterialZone[],
  random: () => number,
): (number | null)[] {
  const k = Math.min(MAX_TALKS_PER_LEG, Math.floor(distanceKm / TALK_INTERVAL_KM))
  const upper = floorKm(distanceKm - EDGE_MARGIN_KM)
  const kms: (number | null)[] = []
  for (let j = 1; j <= k; j++) {
    const jitter = (random() * 2 - 1) * TALK_JITTER_RATIO * distanceKm
    let km: number | null = Math.min(
      Math.max(roundKm((distanceKm * j) / (k + 1) + jitter), EDGE_MARGIN_KM),
      upper,
    )
    // ゾーンの中なら入口の 1 km 手前へ。動かした先がまた別のゾーンなら繰り返す
    for (let inside = zoneAt(zones, km); inside; inside = zoneAt(zones, km)) {
      km = floorKm(inside.entryKm - ZONE_MARGIN_KM)
      if (km < EDGE_MARGIN_KM - EPSILON) {
        km = null
        break
      }
    }
    kms.push(km)
  }
  return kms
}

function zoneAt(zones: ChatMaterialZone[], km: number): ChatMaterialZone | undefined {
  return zones.find((z) => z.entryKm <= km + EPSILON && km <= z.exitKm + EPSILON)
}

/**
 * 楽しみごとの止まり場所（k = k 番目の移動の前）。stop-events の束と同じ考え（しおりの順を保ち、前には戻らない）。
 * 拠点がどの移動の始まりにも終わりにも無い楽しみは、その日の最後の移動の後（どの移動でもこれから。drive-tourism T2・M4）。
 * そのときは順の位置（cursor）を進めない
 */
function pausesOf(m: ChatMaterial): number[] {
  const placeAt = (k: number) => (k === 0 ? m.legs[0]?.from : m.legs[k - 1]?.to)
  const pauses: number[] = []
  let cursor = 0
  for (const stop of m.stops) {
    let k = cursor
    while (k <= m.legs.length && placeAt(k) !== stop.base) k++
    if (k > m.legs.length) {
      pauses.push(m.legs.length)
      continue
    }
    pauses.push(k)
    cursor = k
  }
  return pauses
}

/** しおりどおりに走ったときに、その地点を通る時刻 */
function passingMs(m: ChatMaterial, leg: number, km: number): number {
  const l = m.legs[leg]
  if (!l) return 0
  const ratio = l.distanceKm > 0 ? Math.min(1, km / l.distanceKm) : 0
  return Math.floor(l.departMs + ratio * (l.arriveMs - l.departMs))
}

function pick<T>(options: readonly T[], random: () => number): T {
  const chosen = options[Math.floor(random() * options.length)] ?? options[0]
  if (chosen === undefined) throw new Error('選べる候補がありません')
  return chosen
}

function roundKm(km: number): number {
  return Math.round(km * SCALE) / SCALE
}
function floorKm(km: number): number {
  return Math.floor(km * SCALE + EPSILON) / SCALE
}
function ceilKm(km: number): number {
  return Math.ceil(km * SCALE - EPSILON) / SCALE
}
