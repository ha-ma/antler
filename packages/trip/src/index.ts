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
// その日の行程（brief-map、A-2・GET /api/trips/:id/day/:n）。ルートのデータ（routes.json）は `@antler/trip/roads`
export {
  buildDayPlan,
  ItineraryChangedError,
  pointAtKm,
  tripInputOf,
  type DayPlanInput,
} from './day/day-plan'
export { sliceByKm } from './day/slice'
export {
  CONDITIONS_VERSION,
  dayConditions,
  type DayConditions,
  type Surface,
  type VehicleClass,
  type Weather,
  type WindowFog,
} from './day/conditions'
export { roadBetween, RoadCatalogSchema, type Road, type RoadCatalog } from './day/roads'
export {
  DayConditionsSchema,
  DayPlanSchema,
  type DayLeg,
  type DayPlan,
  type ZonePassage,
} from './day/schema'
