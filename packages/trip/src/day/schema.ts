import { IsoDateTime, LocalizedText, Slug } from '@antler/schema'
import { LIGHT_PERIODS } from '@antler/zones'
import { z } from 'zod'
import { CONDITIONS_VERSION } from './conditions'

// その日の行程（`GET /api/trips/:id/day/:n` の `day`。docs/specs/brief-map/functional.md R5）。
// api が組み立て、画面がこの形で確かめてから使う。凍結した @antler/schema には入れない（A と B の契約ではない）。

const LonLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
const Km = z.number().min(0)

export const DayLegSchema = z.strictObject({
  from: Slug,
  to: Slug,
  departAt: IsoDateTime,
  arriveAt: IsoDateTime,
  distanceKm: Km,
  durationMin: z.number().min(0),
  source: z.enum(['osrm', 'straight']),
  route: z.array(LonLatSchema).min(2),
})

export const ZonePassageSchema = z.strictObject({
  /** legs の添字 */
  leg: z.number().int().min(0),
  zoneIds: z.array(z.string().min(1)).min(1),
  roadName: LocalizedText,
  /** その移動のルートの始点からの道のり */
  entryKm: Km,
  exitKm: Km,
  entryAt: IsoDateTime,
  exitAt: IsoDateTime,
  /** 入口の地点・時刻の光 */
  light: z.enum(LIGHT_PERIODS),
})

export const DayConditionsSchema = z.strictObject({
  version: z.literal(CONDITIONS_VERSION),
  driver: z.number().int().min(1).max(8),
  drivers: z.number().int().min(1).max(8),
  vehicle: z.enum(['compact', 'compact-suv', 'minivan']),
  fourWd: z.boolean(),
  weather: z.enum(['clear', 'cloudy', 'rain', 'snow', 'fog']),
  surface: z.enum(['dry', 'wet', 'packed-snow', 'ice']),
  occupants: z.number().int().min(1).max(8),
  windowFog: z.enum(['none', 'light', 'medium', 'heavy']),
})

export const DayPlanSchema = z.strictObject({
  day: z.number().int().min(1),
  /** JST の暦日 */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  legs: z.array(DayLegSchema),
  /** その日の楽しみ（しおりで確定した出来事） */
  stops: z.array(z.strictObject({ id: Slug, base: Slug })),
  zones: z.array(ZonePassageSchema),
  sun: z.strictObject({
    /** 日没を測った地点（その日の到着地か滞在地） */
    place: Slug,
    duskStartAt: IsoDateTime.nullable(),
    sunsetAt: IsoDateTime.nullable(),
    duskEndAt: IsoDateTime.nullable(),
  }),
  /** 移動の無い日の滞在地。移動がある日は null */
  stayAt: Slug.nullable(),
  conditions: DayConditionsSchema,
  /** 結果を決めるデータの版。同じ旅・同じ日・同じ data なら同じ DayPlan */
  data: z.strictObject({
    /** routes.json の取得日 */
    routes: z.string().min(1),
    /** zones.geojson の hash */
    zones: z.string().min(1),
    conditions: z.literal(CONDITIONS_VERSION),
  }),
})
export type DayPlan = z.infer<typeof DayPlanSchema>
export type DayLeg = z.infer<typeof DayLegSchema>
export type ZonePassage = z.infer<typeof ZonePassageSchema>
