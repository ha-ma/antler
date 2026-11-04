import type { Light } from './stop-deck.js'

// 束の組み立ての入力（docs/specs/stop-events/functional.md R2〜R6）。
// domain は @antler/* を import しないので、application が DayPlan と旅から値を写して渡す。

export type LatLon = { lat: number; lon: number }

export type MaterialLeg = {
  from: string
  to: string
  departMs: number
  arriveMs: number
  distanceKm: number
}

export type MaterialZone = {
  /** legs の添字 */
  leg: number
  entryKm: number
  exitKm: number
  entryMs: number
  /** 入口の地点（遅れをずらした時刻の光を測り直す） */
  entry: LatLon
  roadName: Record<'ja' | 'en' | 'zh' | 'ko', string>
}

export type DayMaterial = {
  tripId: string
  seed: number
  day: number
  /** 旅の日数 */
  dayCount: number
  /** JST の暦日 */
  date: string
  partySize: number
  experience: 'first' | 'few' | 'experienced'
  budgetPerPersonJPY: number
  legs: MaterialLeg[]
  zones: MaterialZone[]
  /** その日の楽しみ（しおりの順） */
  stops: { id: string; base: string; weight: number }[]
  /** その日に予約した宿の地点（最終日は null） */
  stay: string | null
  /** 最終日だけ: 返却地に着いていなければならない時刻（返却の 1 時間前）。ほかの日は null */
  returnDeadlineMs: number | null
  data: { routes: string; zones: string }
}

/** 時刻と地点の光（application が @antler/zones の lightPeriod を渡す） */
export type LightAt = (atMs: number, where: LatLon) => Light
