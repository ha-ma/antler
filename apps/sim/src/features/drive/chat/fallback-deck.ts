import { createRng, deriveSeed } from '../domain/rng'
import {
  FALLBACK_PLEASURE_TEXT,
  FALLBACK_TEXT,
  RADIO_FALLBACK_TEXT,
  RADIO_PLEASURE_TEXT,
} from './chat-text'
import { speakersFor } from './chat-track'
import type { ChatDeck, ChatLine, LocalizedLine, RoadTopic, Speaker } from './chat-types'

// 見本の会話（docs/specs/drive-audio-chat/functional.md R19、drive-tourism T9）。旅の無い運転・トークンの無い端末・api の失敗のときに使う。
// api の束（R11）と同じ形を端末で作る: 各移動の 0.2 km に depart、20 km ごとの話の行（ゾーンの外）。文は固定の表から。
// 話の行の 3 分の 2 は楽しみの話（その日の楽しみ、無ければ到着地の楽しみ。名前を決まった表に差し込む）。

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
  /** 話題にする楽しみ（drive-tourism T9。tourismPleasures の順）。無ければ楽しみの話をしない */
  pleasures?: readonly { id: string; name: LocalizedLine }[]
}

/** 楽しみの話の周期（api の PLEASURE_CYCLE と同じ。話の行の i mod 3 が 0・1 は楽しみ） */
const PLEASURE_CYCLE = 3

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
  // 1 人旅はラジオの DJ の文を順に（同乗者の言い方をラジオにさせない）
  const solo = speakers.length === 1 && speakers[0] === 'radio'
  let radioIndex = 0
  const textFor = (topic: Exclude<RoadTopic, 'pleasure'>) => {
    if (!solo) return FALLBACK_TEXT[topic][variant()]
    const text = RADIO_FALLBACK_TEXT[radioIndex % RADIO_FALLBACK_TEXT.length]
    radioIndex += 1
    return text ?? FALLBACK_TEXT[topic][0]
  }

  // 楽しみの話（T9）: 話の行の通し番号で、i mod 3 が 0・1 の行を楽しみに。楽しみは順に回す
  const pleasures = input.pleasures ?? []
  let talkIndex = 0
  let pleasureIndex = 0
  const talk = (): Pick<ChatLine, 'topic' | 'pleasure' | 'text'> => {
    const i = talkIndex
    talkIndex += 1
    const p = pleasures[pleasureIndex % Math.max(1, pleasures.length)]
    if (p && i % PLEASURE_CYCLE !== PLEASURE_CYCLE - 1) {
      const table = solo ? RADIO_PLEASURE_TEXT : FALLBACK_PLEASURE_TEXT
      const make = table[pleasureIndex % table.length]
      pleasureIndex += 1
      if (make) return { topic: 'pleasure', pleasure: p.id, text: make(p.name) }
    }
    const topic = nextTopic()
    return { topic, pleasure: null, text: textFor(topic) }
  }

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
        pleasure: null,
        text: textFor('depart'),
      })
    }

    for (let km = EVERY_KM; km <= lengthKm - MARGIN_KM; km += EVERY_KM) {
      const moved = outsideZones(startKm + km, input.zonesKm) - startKm
      if (moved < MARGIN_KM || placed.some((p) => Math.abs(p - moved) < MARGIN_KM)) continue
      placed.push(moved)
      lines.push({
        cue: { kind: 'road', leg, km: round1(moved) },
        speaker: nextSpeaker(),
        ...talk(),
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
