import type { Light } from '../../stop-events/models/stop-deck.js'
import type { ChatDataVersion } from './chat-deck.js'

// 束の組み立ての入力（docs/specs/drive-audio-chat/functional.md R11）。
// domain は @antler/* を import しないので、application が DayPlan と旅から値を写して渡す。

export type ChatMaterialLeg = {
  /** 地点の id（楽しみの拠点との照合に使う） */
  from: string
  to: string
  departMs: number
  arriveMs: number
  distanceKm: number
}

export type ChatMaterialZone = {
  /** legs の添字 */
  leg: number
  entryKm: number
  exitKm: number
}

export type ChatMaterial = {
  tripId: string
  seed: number
  day: number
  partySize: number
  legs: ChatMaterialLeg[]
  zones: ChatMaterialZone[]
  /** その日の楽しみ（しおりの順）。base は拠点の地点 id */
  stops: { id: string; base: string }[]
  data: ChatDataVersion
}

/** leg 番目の移動の km 地点を、atMs に通るときの光（application が地点と @antler/zones の lightPeriod で測る） */
export type LightOnRoad = (leg: number, km: number, atMs: number) => Light
