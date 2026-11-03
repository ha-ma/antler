import type { TripPlan } from '@antler/schema'
import {
  distanceToPolyline,
  lightPeriod,
  metersBetween,
  planRoute,
  type LonLat,
  type ZoneCollection,
  type ZoneFeature,
} from '@antler/zones'
import { DAY_MS, jstDayIndex } from '../dates'
import { buildItinerary } from '../itinerary'
import { placeById } from '../places'
import { pleasureById } from '../pleasures'
import type { TripInput } from '../types'
import { CONDITIONS_VERSION, dayConditions } from './conditions'
import { roadBetween, type RoadCatalog } from './roads'
import type { DayLeg, DayPlan, ZonePassage } from './schema'
import { jstMinute, sunTimes } from './sun-times'

// その日の行程（docs/specs/brief-map/functional.md R2・R3・R4）。保存した TripPlan と同梱のデータだけから決まる純粋関数。
// 移動の出発は buildItinerary の leg.startMs、所要は routes.json（OSRM × 係数）。ゾーンの通過時刻は道のりに比例して補間する。

/** 保存した days が、いまのマスターで作り直した days と違う（地点・楽しみのマスターが変わった） */
export class ItineraryChangedError extends Error {
  constructor() {
    super('保存したしおりを、いまのマスターで作り直せません')
    this.name = 'ItineraryChangedError'
  }
}

export type DayPlanInput = {
  plan: TripPlan
  /** 1 始まり */
  day: number
  roads: RoadCatalog
  zones: ZoneCollection
}

export function tripInputOf(plan: TripPlan): TripInput {
  return {
    lang: plan.lang,
    party: plan.party,
    depart: plan.depart,
    return: plan.return,
    budgetPerPersonJPY: plan.budgetPerPersonJPY,
    area: plan.area,
    pleasures: plan.pleasures,
  }
}

export function buildDayPlan({ plan, day, roads, zones }: DayPlanInput): DayPlan {
  const today = plan.days[day - 1]
  if (!Number.isInteger(day) || !today) throw new RangeError(`その日はありません: ${day}`)
  const itinerary = buildItinerary(tripInputOf(plan))
  if (JSON.stringify(itinerary.days) !== JSON.stringify(plan.days))
    throw new ItineraryChangedError()

  const legs: DayLeg[] = []
  const passages: ZonePassage[] = []
  let prevArriveMs = Number.NEGATIVE_INFINITY
  for (const leg of itinerary.legs.filter((l) => l.day === day)) {
    const road = roadBetween(roads, leg.from, leg.to)
    const durationMs = road.durationMin * 60_000
    // しおりの出発は直線の目安で決まっているので、前の移動の到着（OSRM）より早ければ待つ（移動を重ねない）
    const departMs = floorMinute(Math.max(leg.startMs, prevArriveMs))
    const arriveMs = floorMinute(departMs + durationMs)
    prevArriveMs = arriveMs
    const index = legs.length
    legs.push({
      from: leg.from,
      to: leg.to,
      departAt: jstMinute(departMs),
      arriveAt: jstMinute(arriveMs),
      distanceKm: round(road.distanceKm, 2),
      durationMin: round(road.durationMin, 1),
      source: road.source,
      route: road.line.map(([lon, lat]) => [lon, lat] as [number, number]),
    })
    // 直線（組が無い）は道を通っていないので、ゾーンを判定しない
    if (road.source === 'straight') continue
    const routePlan = planRoute(road.line, zones)
    const atKm = (km: number) =>
      floorMinute(departMs + (routePlan.totalKm > 0 ? km / routePlan.totalKm : 0) * durationMs)
    for (const interval of routePlan.intervals) {
      const entry = pointAtKm(road.line, interval.entryKm)
      const nearest = nearestZone(zones, interval.zoneIds, entry)
      if (!nearest) continue
      const entryMs = atKm(interval.entryKm)
      passages.push({
        leg: index,
        zoneIds: interval.zoneIds,
        roadName: nearest.properties.roadName,
        entryKm: round(interval.entryKm, 2),
        exitKm: round(interval.exitKm, 2),
        entryAt: jstMinute(entryMs),
        exitAt: jstMinute(atKm(interval.exitKm)),
        light: lightPeriod(entryMs, { lat: entry[1], lon: entry[0] }),
      })
    }
  }

  const date = jstDate(jstDayIndex(plan.depart.at) + day - 1)
  const stayAt = legs.length === 0 ? (today.stay ?? today.to) : null
  const sunPlace = legs[legs.length - 1]?.to ?? stayAt ?? today.to
  const where = placeOf(sunPlace)
  return {
    day,
    date,
    legs,
    stops: today.stops.map((id) => ({ id, base: pleasureById(id)?.base ?? today.to })),
    zones: passages,
    sun: { place: sunPlace, ...sunTimes(date, where) },
    stayAt,
    conditions: dayConditions({
      seed: plan.seed,
      day,
      month: Number(date.slice(5, 7)),
      departMonth: Number(jstDate(jstDayIndex(plan.depart.at)).slice(5, 7)),
      party: plan.party,
    }),
    data: { routes: roads.meta.fetchedAt, zones: zones.hash, conditions: CONDITIONS_VERSION },
  }
}

/** 区間のゾーンのうち、入口に最も近いもの（planRoute は id を辞書順に並べるので、通る順を距離で選び直す） */
function nearestZone(
  zones: ZoneCollection,
  ids: readonly string[],
  at: LonLat,
): ZoneFeature | undefined {
  let best: ZoneFeature | undefined
  let bestM = Number.POSITIVE_INFINITY
  for (const id of ids) {
    const zone = zones.features.find((z) => z.id === id)
    if (!zone) continue
    const d = distanceToPolyline(at, zone.properties.centerline).distanceM
    if (d < bestM) {
      best = zone
      bestM = d
    }
  }
  return best
}

const MINUTE_MS = 60_000

/** 分に切り捨てる（表示の時刻と光の判定の時刻をそろえる） */
function floorMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

function jstDate(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10)
}

/** 線の始点から km の道のりの点（線を越えたら終点） */
export function pointAtKm(line: readonly LonLat[], km: number): LonLat {
  let walked = 0
  const target = km * 1000
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as LonLat
    const b = line[i + 1] as LonLat
    const seg = metersBetween(a, b)
    if (walked + seg >= target) {
      const t = seg === 0 ? 0 : (target - walked) / seg
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    walked += seg
  }
  return line[line.length - 1] ?? [0, 0]
}

function placeOf(id: string): { lat: number; lon: number } {
  const place = placeById(id)
  if (!place) throw new RangeError(`地点が見つからない: ${id}`)
  return place
}

function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}
