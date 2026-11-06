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
export { buildItinerary } from './itinerary'
export { assessRisk, RISK_WEIGHTS } from './risk'
export { draftTitles } from './title'
export { formatBudget, initialLang, USD_RATE } from './locale'
export { buildTripPlan, HOURS_PER_WEIGHT, weightForHours } from './plan'
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
// 走行の記録と旅の記録の集計（record、A-7・POST /api/trips/:id/runs・GET /api/trips/:id/record）
export {
  DeerPatternSchema,
  DriveEncounterSchema,
  DriveRunInputSchema,
  MAX_ENCOUNTERS_PER_RUN,
  MAX_RUNS_PER_DAY,
  MAX_SPOTTED_PER_RUN,
  MAX_ZONE_PASSES,
  SpottingSchema,
  type DeerPattern,
  type DriveEncounter,
  type DriveRunInput,
  type Spotting,
} from './record/run'
export {
  CLOSE_CALL_M,
  summarizeRecord,
  TripRecordSchema,
  type DayResult,
  type RecordPlan,
  type RecordRun,
  type TripRecord,
} from './record/summary'
export { RecordTripSchema, recordTripOf, type RecordTrip } from './record/trip-view'
export { RECORD_TEXT, recordText, type RecordTextKey } from './record/text'
export { buildRecordView, type LogTone, type RecordView, type StatKey } from './record/view'
export {
  formatClock,
  formatDateRange,
  formatSeconds,
  patternLabel,
  placeName,
  pleasureLabel,
} from './record/format'
export {
  DayConditionsSchema,
  DayPlanSchema,
  type DayLeg,
  type DayPlan,
  type ZonePassage,
} from './day/schema'
