import type { Lang, TripPlan } from '@antler/schema'

/** 出発・返却の場所（CTS・KUH・SAPPORO・AKJ・HKD） */
export type DeparturePlace = TripPlan['depart']['place']

// @antler/trip の型（docs/specs/plan-trip/functional.md）。sim と api が同じ型と関数を使う。

export type Area = TripPlan['area']
export type Experience = TripPlan['party']['experience']

/** 4 言語の文（zh は繁体字）。 */
export type Localized = Record<Lang, string>

/** 地点（空港・駅・町）。しおりの from / to / stay と、楽しみの拠点に使う。 */
export type Place = {
  /** slug（例 kushiro、cts） */
  id: string
  name: Localized
  lat: number
  lon: number
  /** 道東 / 道央の拠点か、出発・返却の玄関口（空港・駅） */
  kind: 'base' | 'gateway'
  /** 拠点の属するエリア。玄関口は null */
  area: Area | null
}

/** 楽しみ（A1-2 のカード）。 */
export type Pleasure = {
  /** slug（例 drift-ice-walk） */
  id: string
  area: Area
  name: Localized
  /** 補足（「地名 ・ 条件」の形。季節・所要・時間帯） */
  note: Localized
  /** 拠点の地点 id（Place.id） */
  base: string
  /** 行う時間帯。night / dawn は暗い時間の運転を伴う（リスクの材料） */
  timeOfDay: 'day' | 'night' | 'dawn'
  /** 楽しめる月（1〜12）。空なら通年 */
  months: number[]
  /** 事実（季節・所要・拠点）をユーザーが確かめたか（Deferred。暫定は false） */
  verified: boolean
}

/** A-1 の入力（`POST /api/trips` の body と同じ形）。 */
export type TripInput = {
  lang: Lang
  party: TripPlan['party']
  depart: { at: string; place: DeparturePlace }
  return: { at: string; place: DeparturePlace }
  budgetPerPersonJPY: number
  area: Area
  pleasures: { id: string; weight: number }[]
}

/** 1 回の移動（リスクの「暗い時間の移動」に使う）。 */
export type Leg = {
  day: number
  from: string
  to: string
  /** 出発の時刻（ms） */
  startMs: number
  hours: number
}

export type Itinerary = {
  days: TripPlan['days']
  /** 入りきらなかった楽しみの id（重さの小さい順に外したもの） */
  skipped: string[]
  legs: Leg[]
}

export type RiskLevel = 'low' | 'caution' | 'high'

export type RiskFactor =
  'area' | 'month' | 'sunset' | 'darkDriving' | 'experience' | 'nightPleasure'

export type RiskAssessment = {
  /** 0〜1。小数 2 桁に丸めた値 */
  score: number
  level: RiskLevel
  /** 各要素の寄与（重み × 値） */
  contributions: Record<RiskFactor, number>
  /** 寄与の大きい順に最大 3 行 */
  reasons: Localized[]
}
