// @antler/trip — 旅のしおりとリスクの純粋関数、楽しみ・地点のマスター（A-1）。
// 端末（apps/sim）は入力のたびに、api（apps/api）は保存の前に、同じ関数で計算する。仕様: docs/specs/plan-trip/functional.md
export type {
  Area,
  Experience,
  Itinerary,
  Leg,
  Localized,
  Place,
  Pleasure,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
  TripInput,
} from './types'
export {
  MAX_BUDGET_JPY,
  MAX_PLEASURES,
  MAX_TRIP_DAYS,
  PERSONA_INPUT,
  TripInputSchema,
  tripDayCount,
} from './input'
export { PLEASURES, pleasureById, pleasuresInArea } from './pleasures'
export { AREA_CIRCUIT, DEPARTURE_PLACE_ID, PLACES, placeById } from './places'
export { buildItinerary, HOURS_PER_WEIGHT } from './itinerary'
export { assessRisk, RISK_WEIGHTS } from './risk'
export { draftTitles } from './title'
export { formatBudget, initialLang, USD_RATE } from './locale'
export { buildTripPlan } from './plan'
export { STATS } from './stats'
