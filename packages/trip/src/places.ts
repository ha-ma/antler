import { DeparturePlace as DeparturePlaceSchema, Lang } from '@antler/schema'
import { z } from 'zod'
import placesJson from '../data/places.json'
import type { Area, Place } from './types'

// 地点のマスター（玄関口と楽しみの拠点）。data/places.json を読み込み時に検証する。

const LocalizedSchema = z.strictObject(
  Object.fromEntries(Lang.options.map((l) => [l, z.string().min(1)])) as Record<
    z.infer<typeof Lang>,
    z.ZodString
  >,
)

const PlaceSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: LocalizedSchema,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  kind: z.enum(['base', 'gateway']),
  area: z.enum(['doto', 'doo']).nullable(),
})

export const PLACES: readonly Place[] = z.array(PlaceSchema).parse(placesJson)

const BY_ID = new Map(PLACES.map((p) => [p.id, p]))

export function placeById(id: string): Place | undefined {
  return BY_ID.get(id)
}

type DeparturePlace = z.infer<typeof DeparturePlaceSchema>

export const DEPARTURE_PLACE_ID: Record<DeparturePlace, string> = {
  CTS: 'cts',
  KUH: 'kuh',
  SAPPORO: 'sapporo',
  AKJ: 'akj',
  HKD: 'hkd',
}

/** エリアの拠点（Place.id）を地理的に一筆書きで回る固定の順。 */
export const AREA_CIRCUIT: Record<Area, readonly string[]> = {
  doto: [
    'kushiro',
    'tsurui',
    'akan',
    'teshikaga',
    'shiretoko',
    'abashiri',
    'betsukai',
    'nemuro',
    'obihiro',
  ],
  doo: [
    'sapporo-city',
    'jozankei',
    'otaru',
    'shakotan',
    'niseko',
    'toya',
    'noboribetsu',
    'shikotsu',
    'furano',
    'biei',
    'asahikawa',
  ],
}
