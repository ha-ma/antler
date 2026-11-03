// Claude に書かせる旅の文（タイトルと各日の 1 行説明、4 言語）と、Claude に渡す材料。
// docs/specs/plan-trip/functional.md R5。純粋な型だけ（@antler/trip・@antler/schema の型と構造で互換）。

export const TRIP_LANGS = ['ja', 'en', 'zh', 'ko'] as const
export type TripLang = (typeof TRIP_LANGS)[number]

/** 4 言語の文（zh は繁体字）。 */
export type LocalizedText = Record<TripLang, string>

/** Claude の出力（検証前）。 */
export type TripWriting = {
  titles: LocalizedText
  dayNotes: { day: number; note: LocalizedText }[]
}

/** 月日（年は渡さない。3 桁以上の数を書かせないため）。 */
export type MonthDay = { month: number; dayOfMonth: number }

/**
 * Claude に渡す材料。すべて選択肢由来の値で、自由入力の文字列を含まない（UC-5d）。
 * 統計の数字（リスクの根拠文）は渡さない。リスクは区分だけ。
 */
export type TripWritingBrief = {
  lang: TripLang
  area: 'doto' | 'doo'
  party: { size: number; drivers: number; experience: 'first' | 'few' | 'experienced' }
  depart: { place: LocalizedText; date: MonthDay; time: string }
  return: { place: LocalizedText; date: MonthDay; time: string }
  /** 予算は参考（しおりの組み立てには使わない。R1） */
  budgetPerPersonJPY: number
  days: {
    day: number
    date: MonthDay
    from: LocalizedText
    to: LocalizedText
    stay: LocalizedText | null
    stops: { name: LocalizedText; timeOfDay: 'day' | 'night' | 'dawn' }[]
  }[]
  /** 入りきらなかった楽しみ */
  skipped: LocalizedText[]
  riskLevel: 'low' | 'caution' | 'high'
}
