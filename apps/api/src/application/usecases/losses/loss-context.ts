import { toJst, type TripPlan } from '@antler/schema'
import { buildItinerary, placeById, pleasureById, tripInputOf, type Localized } from '@antler/trip'
import type { LossDayContext } from '../../../domain/losses/models/loss.js'
import { ItineraryChangedError } from '../../../domain/trips/errors/trip-errors.js'
import { DAY_MS } from '../../../domain/trips/rules/trip-rules.js'

// 保存したしおり（TripPlan）から、喪失の判定と材料に使う日ごとの情報を作る（docs/specs/loss/functional.md R5・R7）。
// 地名・楽しみの名前はマスターの 4 言語。移動は @antler/trip の buildItinerary の legs（DayPlan.legs と同じ数・同じ順）。

function nameOf(slug: string): Localized {
  return placeById(slug)?.name ?? { ja: slug, en: slug, zh: slug, ko: slug }
}

/** タイムゾーン付きの ISO 8601 の JST の暦日（YYYY-MM-DD）。読めなければ null */
export function jstDateOf(iso: string): string | null {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(iso) || Number.isNaN(Date.parse(iso))) return null
  try {
    return toJst(iso).slice(0, 10)
  } catch {
    return null
  }
}

function addDays(date: string, days: number): string {
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  )
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10)
}

/** しおりの日ごとの情報。いまのマスターで作り直した days が保存したものと違えば ItineraryChangedError */
export function lossDaysOf(plan: TripPlan): LossDayContext[] {
  const itinerary = buildItinerary(tripInputOf(plan))
  if (JSON.stringify(itinerary.days) !== JSON.stringify(plan.days))
    throw new ItineraryChangedError()
  const firstDate = jstDateOf(plan.depart.at)
  if (firstDate === null) throw new ItineraryChangedError()
  return plan.days.map((d) => ({
    day: d.day,
    date: addDays(firstDate, d.day - 1),
    legs: itinerary.legs
      .filter((l) => l.day === d.day)
      .map((l) => ({ fromId: l.from, from: nameOf(l.from), to: nameOf(l.to) })),
    stops: d.stops.map((id) => {
      const p = pleasureById(id)
      return {
        id,
        base: p?.base ?? d.to,
        name: p?.name ?? { ja: id, en: id, zh: id, ko: id },
      }
    }),
    stay: d.stay === null ? null : nameOf(d.stay),
  }))
}
