import { toJst } from '@antler/schema'
import {
  DEPARTURE_PLACE_ID,
  placeById,
  pleasureById,
  type Itinerary,
  type Localized,
  type RiskAssessment,
  type TripInput,
} from '@antler/trip'
import type { MonthDay, TripWritingBrief } from '../../../domain/trips/models/trip-writing.js'
import { DAY_MS } from '../../../domain/trips/rules/trip-rules.js'

// TripInput としおり・リスクから、Claude に渡す材料（TripWritingBrief）を作る（UC-5d）。
// 渡すのはマスターの名前（4 言語）と選択肢由来の値だけ。リスクは区分だけ（根拠文は統計の数字を含むので渡さない）。

function nameOf(slug: string): Localized {
  const place = placeById(slug)
  if (place) return place.name
  return { ja: slug, en: slug, zh: slug, ko: slug }
}

function jstParts(iso: string): { date: MonthDay; time: string; utcDayMs: number } {
  // toJst は「YYYY-MM-DDTHH:mm:ss.sss+09:00」を返す
  const jst = toJst(iso)
  const year = Number(jst.slice(0, 4))
  const month = Number(jst.slice(5, 7))
  const dayOfMonth = Number(jst.slice(8, 10))
  return {
    date: { month, dayOfMonth },
    time: jst.slice(11, 16),
    utcDayMs: Date.UTC(year, month - 1, dayOfMonth),
  }
}

export function toWritingBrief(
  input: TripInput,
  itinerary: Itinerary,
  risk: RiskAssessment,
): TripWritingBrief {
  const depart = jstParts(input.depart.at)
  const ret = jstParts(input.return.at)
  return {
    lang: input.lang,
    area: input.area,
    party: { ...input.party },
    depart: {
      place: nameOf(DEPARTURE_PLACE_ID[input.depart.place]),
      date: depart.date,
      time: depart.time,
    },
    return: {
      place: nameOf(DEPARTURE_PLACE_ID[input.return.place]),
      date: ret.date,
      time: ret.time,
    },
    budgetPerPersonJPY: input.budgetPerPersonJPY,
    days: itinerary.days.map((d) => {
      const date = new Date(depart.utcDayMs + (d.day - 1) * DAY_MS)
      return {
        day: d.day,
        date: { month: date.getUTCMonth() + 1, dayOfMonth: date.getUTCDate() },
        from: nameOf(d.from),
        to: nameOf(d.to),
        stay: d.stay === null ? null : nameOf(d.stay),
        stops: d.stops.flatMap((id) => {
          const p = pleasureById(id)
          return p ? [{ name: p.name, timeOfDay: p.timeOfDay }] : []
        }),
      }
    }),
    skipped: itinerary.skipped.flatMap((id) => {
      const p = pleasureById(id)
      return p ? [p.name] : []
    }),
    riskLevel: risk.level,
  }
}
