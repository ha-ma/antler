import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { TripDetailsSchema, type TripDetails, type TripPlan } from '@antler/schema'
import {
  assessRisk,
  buildDayPlan,
  buildItinerary,
  buildTripPlan,
  PERSONA_INPUT,
  type DayPlan,
} from '@antler/trip'
import { ROAD_CATALOG } from '@antler/trip/roads'
import { parseZoneCollection } from '@antler/zones'

// A-2 のテスト用: ペルソナの旅と、api と同じ関数で作ったその日の行程（GET /api/trips/:id/day/:n の応答）。
// 同梱のルート（routes.json）はテストの中だけで読む（画面のバンドルには入れない）。

const require = createRequire(import.meta.url)
const zones = parseZoneCollection(
  readFileSync(require.resolve('@antler/zones/zones.geojson'), 'utf8'),
)

export const TRIP_ID = 'K7m2abcd'

export function personaTrip(lang: TripPlan['lang'] = 'ja'): {
  plan: TripPlan
  details: TripDetails
} {
  const input = { ...PERSONA_INPUT, lang }
  const itinerary = buildItinerary(input)
  const plan = buildTripPlan(input, itinerary, assessRisk(input, itinerary), {
    id: TRIP_ID,
    seed: 918273,
    title: '流氷とタンチョウと、雪見の温泉',
  })
  const note = {
    ja: '新千歳から釧路へ。',
    en: 'From New Chitose to Kushiro.',
    zh: '從新千歲前往釧路。',
    ko: '신치토세에서 구시로로.',
  }
  const details = TripDetailsSchema.parse({
    tripId: TRIP_ID,
    titles: {
      ja: '流氷とタンチョウと、雪見の温泉',
      en: 'Drift ice, cranes and a snowy onsen',
      zh: '流冰、丹頂鶴與雪見溫泉',
      ko: '유빙과 두루미, 설경 온천',
    },
    dayNotes: plan.days.map((d) => ({ day: d.day, note })),
    skipped: [],
    createdAt: '2026-11-03T12:00:00+09:00',
  })
  return { plan, details }
}

export function personaDay(day: number, plan = personaTrip().plan): DayPlan {
  return buildDayPlan({ plan, day, roads: ROAD_CATALOG, zones })
}

/** 応答の本文（{ plan, details, day }） */
export function tripDayBody(day: number, lang: TripPlan['lang'] = 'ja') {
  const trip = personaTrip(lang)
  return { ...trip, day: personaDay(day, trip.plan) }
}

/** ペルソナの旅で、ゾーンを通る最初の日 */
export function personaZoneDay(): number {
  const { plan } = personaTrip()
  const found = plan.days.find((d) => personaDay(d.day, plan).zones.length > 0)
  if (!found) throw new Error('ペルソナの旅にゾーンを通る日が無い')
  return found.day
}
