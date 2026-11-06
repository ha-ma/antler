import { createRng, deriveSeed } from '../domain/rng'
import { FALLBACK_TEXT } from './chat-text'
import { speakersFor } from './chat-track'
import type { ChatDeck, ChatLine, RoadTopic, Speaker } from './chat-types'

// 見本の会話（docs/specs/drive-audio-chat/functional.md R19）。旅の無い運転・トークンの無い端末・api の失敗のときに使う。
// api の束（R11）と同じ形を端末で作る: 各移動の 0.2 km に depart、20 km ごとの話の行（ゾーンの外）。文は固定の表から。

export type FallbackInput = {
  tripId: string
  day: number
  /** 各移動の始まりの道のり（m） */
  legStartsM: readonly number[]
  totalM: number
  /** 鹿ゾーンの区間（ルートの道のり km の [入口, 出口]） */
  zonesKm: readonly (readonly [number, number])[]
  partySize: number
  seed: number
}

const DEPART_KM = 0.2
const EVERY_KM = 20
const MARGIN_KM = 1
type FallbackTopic = Exclude<RoadTopic, 'pleasure' | 'depart'>
const TOPICS: FallbackTopic[] = ['weather', 'light', 'scenery', 'snack', 'music']

function zoneAt(routeKm: number, zonesKm: FallbackInput['zonesKm']) {
  return zonesKm.find(([entry, exit]) => entry <= routeKm && routeKm <= exit)
}

/** ゾーンの中なら入口の 1 km 手前へ（また別のゾーンなら繰り返す） */
function outsideZones(routeKm: number, zonesKm: FallbackInput['zonesKm']): number {
  let km = routeKm
  for (let zone = zoneAt(km, zonesKm); zone; zone = zoneAt(km, zonesKm)) km = zone[0] - MARGIN_KM
  return km
}

export function fallbackChatDeck(input: FallbackInput): ChatDeck {
  const rng = createRng(deriveSeed(input.seed, `chat-fallback:${String(input.day)}`))
  const speakers = speakersFor(input.partySize)
  let lastSpeaker: Speaker | null = null
  let lastTopic: FallbackTopic | null = null
  const nextSpeaker = (): Speaker => {
    const pool = speakers.length > 1 ? speakers.filter((s) => s !== lastSpeaker) : speakers
    lastSpeaker = pool[Math.floor(rng() * pool.length)] ?? 'radio'
    return lastSpeaker
  }
  const nextTopic = (): FallbackTopic => {
    const pool = TOPICS.filter((t) => t !== lastTopic)
    lastTopic = pool[Math.floor(rng() * pool.length)] ?? 'scenery'
    return lastTopic
  }
  const variant = () => (rng() < 0.5 ? 0 : 1)

  const lines: Omit<ChatLine, 'id'>[] = []
  input.legStartsM.forEach((startM, leg) => {
    const startKm = startM / 1000
    const endKm = (input.legStartsM[leg + 1] ?? input.totalM) / 1000
    const lengthKm = endKm - startKm
    const placed: number[] = []

    // 出発の行。ゾーンの中なら出口の 0.2 km 先（終わりの 1 km 手前より先なら作らない）
    const departZone = zoneAt(startKm + DEPART_KM, input.zonesKm)
    const departKm = departZone ? departZone[1] - startKm + DEPART_KM : DEPART_KM
    if (departKm <= lengthKm - MARGIN_KM || !departZone) {
      placed.push(departKm)
      lines.push({
        cue: { kind: 'road', leg, km: round1(departKm) },
        topic: 'depart',
        speaker: nextSpeaker(),
        text: FALLBACK_TEXT.depart[variant()],
      })
    }

    for (let km = EVERY_KM; km <= lengthKm - MARGIN_KM; km += EVERY_KM) {
      const moved = outsideZones(startKm + km, input.zonesKm) - startKm
      if (moved < MARGIN_KM || placed.some((p) => Math.abs(p - moved) < MARGIN_KM)) continue
      placed.push(moved)
      const topic = nextTopic()
      lines.push({
        cue: { kind: 'road', leg, km: round1(moved) },
        topic,
        speaker: nextSpeaker(),
        text: FALLBACK_TEXT[topic][variant()],
      })
    }
  })

  return {
    tripId: input.tripId,
    day: input.day,
    lines: lines
      .sort((a, b) => a.cue.leg - b.cue.leg || a.cue.km - b.cue.km)
      .map((l, i) => ({ ...l, id: `l${String(i + 1).padStart(2, '0')}` })),
    data: null,
  }
}

function round1(km: number): number {
  return Math.round(km * 10) / 10
}
