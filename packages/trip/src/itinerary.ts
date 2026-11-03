import { metersBetween, type LonLat } from '@antler/zones'
import { atHour, dayOf, HOUR_MS, jstDayIndex, tripDayCount } from './dates'
import { AREA_CIRCUIT, DEPARTURE_PLACE_ID, placeById } from './places'
import { pleasureById } from './pleasures'
import type { Itinerary, Leg, Pleasure, TripInput } from './types'

// しおりの組み立て（functional.md R3、A1-4）。決定的な純粋関数で、端末は入力のたびに、api は保存の前に呼ぶ。
// - 重さ w の楽しみは w × 1.6 時間（重さ 5 ＝ 8 時間 ＝ 丸 1 日）。活動は 8:00〜18:00 の枠に入れる
// - 移動は直線距離 × 1.3 ÷ 時速 50 km（目安）。移動は枠を越えてよい（暗い時間の運転はリスクで数える）
// - 拠点はエリアの周回順に回る（出発地に近い側から。向きは移動の合計が短い方）
// - 返却の 1 時間前までに返却地へ着けなければ、重さの小さい楽しみから外す（skipped）

export const HOURS_PER_WEIGHT = 1.6
const ROAD_FACTOR = 1.3
const SPEED_KMH = 50
const ACTIVITY_START_H = 8
const ACTIVITY_END_H = 18
/** 車を受け取る・返す手続きの時間 */
const HANDOVER_H = 1

type Chosen = { pleasure: Pleasure; weight: number; order: number }
type Activity = { id: string; day: number }
type Schedule = { legs: Leg[]; activities: Activity[]; feasible: boolean }

/** 2 地点の移動時間（時間）。 */
export function travelHours(from: string, to: string): number {
  if (from === to) return 0
  const a = placeById(from)
  const b = placeById(to)
  if (!a || !b) throw new RangeError(`地点が見つからない: ${from} → ${to}`)
  const km = metersBetween([a.lon, a.lat] as LonLat, [b.lon, b.lat] as LonLat) / 1000
  return (km * ROAD_FACTOR) / SPEED_KMH
}

/**
 * 楽しみを 1 つも入れなくても、出発地から返却地へ返却の 1 時間前までに着けるか（R1）。
 * 着けない旅（例: 新千歳 10:00 出発・釧路空港 11:30 返却）は入力エラーにする（2026-11-03、推奨で決定）。
 */
export function travelFits(input: TripInput): boolean {
  const start = DEPARTURE_PLACE_ID[input.depart.place]
  const end = DEPARTURE_PLACE_ID[input.return.place]
  return simulate(input, [], start, end, jstDayIndex(input.depart.at)).feasible
}

export function buildItinerary(input: TripInput): Itinerary {
  const start = DEPARTURE_PLACE_ID[input.depart.place]
  const end = DEPARTURE_PLACE_ID[input.return.place]
  const firstDay = jstDayIndex(input.depart.at)
  const dayCount = tripDayCount(input)

  let chosen = orderByCircuit(input, start)
  const skipped: string[] = []
  let schedule = simulate(input, chosen, start, end, firstDay)
  while (!schedule.feasible && chosen.length > 0) {
    const drop = chosen.reduce((worst, c) =>
      c.weight < worst.weight || (c.weight === worst.weight && c.order > worst.order) ? c : worst,
    )
    skipped.push(drop.pleasure.id)
    chosen = chosen.filter((c) => c !== drop)
    schedule = simulate(input, chosen, start, end, firstDay)
  }

  return {
    days: toDays(schedule, dayCount, start, end),
    skipped,
    legs: schedule.legs,
  }
}

/** 選んだ楽しみを周回順に並べる。向きは、出発地からの移動の合計が短い方（同じなら順方向）。 */
function orderByCircuit(input: TripInput, start: string): Chosen[] {
  const circuit = AREA_CIRCUIT[input.area]
  const picked = input.pleasures.flatMap((p) => {
    const pleasure = pleasureById(p.id)
    return pleasure ? [{ pleasure, weight: p.weight }] : []
  })
  const sortBy = (forward: boolean) =>
    picked
      .map((p) => {
        const index = circuit.indexOf(p.pleasure.base)
        return { ...p, order: forward ? index : circuit.length - 1 - index }
      })
      .sort(
        (a, b) =>
          a.order - b.order ||
          b.weight - a.weight ||
          (a.pleasure.id < b.pleasure.id ? -1 : a.pleasure.id > b.pleasure.id ? 1 : 0),
      )
  const cost = (list: Chosen[]) =>
    list.reduce(
      (acc, c) => ({
        at: c.pleasure.base,
        hours: acc.hours + travelHours(acc.at, c.pleasure.base),
      }),
      { at: start, hours: 0 },
    ).hours
  const forward = sortBy(true)
  const backward = sortBy(false)
  return cost(backward) < cost(forward) ? backward : forward
}

function simulate(
  input: TripInput,
  chosen: Chosen[],
  start: string,
  end: string,
  firstDay: number,
): Schedule {
  const legs: Leg[] = []
  const activities: Activity[] = []
  const lastDay = firstDay + tripDayCount(input) - 1
  let at = start
  let t = Date.parse(input.depart.at) + HANDOVER_H * HOUR_MS

  const drive = (to: string, from: number) => {
    const hours = travelHours(at, to)
    if (hours > 0) {
      legs.push({ day: dayOf(from) - firstDay + 1, from: at, to, startMs: from, hours })
    }
    at = to
    return from + hours * HOUR_MS
  }

  for (const c of chosen) {
    const travel = travelHours(at, c.pleasure.base)
    const act = c.weight * HOURS_PER_WEIGHT
    const today = dayOf(t)
    // 今日の枠に入らないが、翌朝からなら 1 日に収まる → 今夜は今いる場所に泊まり、翌朝に移動する
    const fitsToday = t + (travel + act) * HOUR_MS <= atHour(today, ACTIVITY_END_H)
    const fitsADay = travel + act <= ACTIVITY_END_H - ACTIVITY_START_H
    let departAt = t
    if (!fitsToday && fitsADay) departAt = Math.max(t, atHour(today + 1, ACTIVITY_START_H))
    else if (t < atHour(today, ACTIVITY_START_H) && travel === 0)
      departAt = atHour(today, ACTIVITY_START_H)
    const arrive = drive(c.pleasure.base, departAt)
    let begin = Math.max(arrive, atHour(dayOf(arrive), ACTIVITY_START_H))
    if (begin + act * HOUR_MS > atHour(dayOf(begin), ACTIVITY_END_H)) {
      begin = atHour(dayOf(begin) + 1, ACTIVITY_START_H)
    }
    activities.push({ id: c.pleasure.id, day: dayOf(begin) - firstDay + 1 })
    t = begin + act * HOUR_MS
  }

  // 返却地へ: 返却の 1 時間前に着くように、できるだけ遅く出る
  const deadline = Date.parse(input.return.at) - HANDOVER_H * HOUR_MS
  const back = travelHours(at, end)
  const leaveAt = Math.max(t, deadline - back * HOUR_MS)
  const arrival = drive(end, leaveAt)
  const lastActivityDay = activities.reduce((m, a) => Math.max(m, a.day), 1)
  const feasible =
    arrival <= deadline + 1 &&
    dayOf(leaveAt) <= lastDay &&
    firstDay + lastActivityDay - 1 <= lastDay
  return { legs, activities, feasible }
}

function toDays(
  schedule: Schedule,
  dayCount: number,
  start: string,
  end: string,
): Itinerary['days'] {
  // 日付の表示は使う側（sim）が input.depart.at から求める
  const placeAtEndOf = (day: number) =>
    schedule.legs.filter((l) => l.day <= day).reduce<string>((_, l) => l.to, start)
  return Array.from({ length: dayCount }, (_, i) => {
    const day = i + 1
    const last = day === dayCount
    return {
      day,
      from: day === 1 ? start : placeAtEndOf(day - 1),
      to: last ? end : placeAtEndOf(day),
      stops: schedule.activities.filter((a) => a.day === day).map((a) => a.id),
      stay: last ? null : placeAtEndOf(day),
    }
  })
}
