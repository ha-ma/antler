import type { TripPlan } from '@antler/schema'
import { placeById, pleasureById, pointAtKm, type DayPlan, type Localized } from '@antler/trip'
import { lightPeriod } from '@antler/zones'
import type {
  ChatPlan,
  ChatWritingBrief,
  PleasureBrief,
} from '../../../domain/chats/models/chat-deck.js'
import type { ChatMaterial, LightOnRoad } from '../../../domain/chats/models/chat-material.js'

// 保存した旅と DayPlan（@antler/trip）から、domain の束の入力と Claude の材料を作る（docs/specs/drive-audio-chat/functional.md R11・R16）。
// domain は @antler/* を import しないので、値をここで写す。

export function toChatMaterial(plan: TripPlan, dayPlan: DayPlan): ChatMaterial {
  return {
    tripId: plan.id,
    seed: plan.seed,
    day: dayPlan.day,
    partySize: plan.party.size,
    legs: dayPlan.legs.map((leg) => ({
      from: leg.from,
      to: leg.to,
      departMs: Date.parse(leg.departAt),
      arriveMs: Date.parse(leg.arriveAt),
      distanceKm: leg.distanceKm,
    })),
    zones: dayPlan.zones.map((z) => ({ leg: z.leg, entryKm: z.entryKm, exitKm: z.exitKm })),
    stops: dayPlan.stops.map((s) => ({ id: s.id, base: s.base })),
    laterStops: laterStopsOf(plan, dayPlan),
    // DayPlan.data の conditions は混ぜない（応答の data は routes・zones の 2 欄）
    data: { routes: dayPlan.data.routes, zones: dayPlan.data.zones },
  }
}

/** 後の日の楽しみ（しおりの日の順。その日の楽しみと重ねない。数の上限は domain。drive-tourism T2） */
function laterStopsOf(plan: TripPlan, dayPlan: DayPlan): { id: string }[] {
  const today = new Set(dayPlan.stops.map((s) => s.id))
  const ids = plan.days
    .filter((d) => d.day > dayPlan.day)
    .flatMap((d) => d.stops)
    .filter((id) => !today.has(id) && pleasureById(id) !== undefined)
  return [...new Set(ids)].map((id) => ({ id }))
}

/** 所要の区分（drive-tourism T4。時間の数は渡さない） */
function lengthOf(hours: number): PleasureBrief['length'] {
  if (hours <= 2) return 'short'
  if (hours <= 4) return 'half'
  return 'long'
}

function pleasureBrief(line: ChatPlan['lines'][number]): PleasureBrief | null {
  const pleasure = line.pleasure ? pleasureById(line.pleasure) : undefined
  if (!pleasure || !line.timing || !line.angle) return null
  return {
    name: pleasure.name,
    place: placeName(pleasure.base),
    timeOfDay: pleasure.timeOfDay,
    length: lengthOf(pleasure.hours),
    timing: line.timing,
    angle: line.angle,
  }
}

/** その移動のルートの km 地点を、その時刻に通るときの光（@antler/zones の lightPeriod） */
export function lightOnRoad(dayPlan: DayPlan): LightOnRoad {
  return (leg, km, atMs) => {
    const route = dayPlan.legs[leg]?.route ?? []
    const [lon, lat] = pointAtKm(route, km)
    return lightPeriod(atMs, { lat, lon })
  }
}

function placeName(id: string | undefined): Localized | null {
  if (!id) return null
  return placeById(id)?.name ?? null
}

/**
 * Claude に渡す材料（R16・WRITE-2d）。名前はマスターの 4 言語（楽しみは name だけ。note には時刻・数が入るので渡さない）。
 * 自由入力・統計の数字・金額・時刻・距離を渡さない
 */
export function toChatWritingBrief(
  plan: TripPlan,
  dayPlan: DayPlan,
  chatPlan: ChatPlan,
): ChatWritingBrief {
  return {
    lang: plan.lang,
    partySize: plan.party.size,
    experience: plan.party.experience,
    month: Number(dayPlan.date.slice(5, 7)),
    conditions: { weather: dayPlan.conditions.weather, surface: dayPlan.conditions.surface },
    lines: chatPlan.lines.map((line) => {
      const leg = dayPlan.legs[line.cue.leg]
      return {
        id: line.id,
        topic: line.topic,
        speaker: line.speaker,
        from: placeName(leg?.from),
        to: placeName(leg?.to),
        pleasure: pleasureBrief(line),
        light: line.light,
      }
    }),
  }
}
