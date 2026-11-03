import { metersBetween, type LonLat } from '@antler/zones'
import { z } from 'zod'
import { travelHours } from '../itinerary'
import { placeById } from '../places'
import { decodePolyline } from './polyline'
import { roadKey } from './road-pairs'

// 2 地点の道（docs/specs/brief-map/functional.md R1）。routes.json（開発時に OSRM から取った線）を引くだけで、
// 実行時に外部へ通信しない。組が無ければ直線と plan-trip の目安の所要で返す（source: "straight"）。

export const RoadCatalogSchema = z.strictObject({
  meta: z.object({
    source: z.string().min(1),
    attribution: z.string().min(1),
    fetchedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    simplifyM: z.number().positive(),
    /** OSRM の所要に掛ける係数 */
    durationFactor: z.number().positive(),
    direction: z.string(),
  }),
  roads: z.record(
    z.string().regex(/^[a-z0-9-]+\|[a-z0-9-]+$/),
    z.strictObject({
      distanceM: z.number().positive(),
      durationS: z.number().positive(),
      polyline: z.string().min(2),
    }),
  ),
})
export type RoadCatalog = z.infer<typeof RoadCatalogSchema>

export type Road = {
  /** from から to への線 */
  line: LonLat[]
  distanceKm: number
  /** 所要（分）。OSRM の値 × 係数、直線なら plan-trip の目安 */
  durationMin: number
  source: 'osrm' | 'straight'
}

export function roadBetween(catalog: RoadCatalog, from: string, to: string): Road {
  const a = placeById(from)
  const b = placeById(to)
  if (!a || !b) throw new RangeError(`地点が見つからない: ${from} → ${to}`)
  const entry = catalog.roads[roadKey(from, to)]
  if (!entry) {
    const line: LonLat[] = [
      [a.lon, a.lat],
      [b.lon, b.lat],
    ]
    return {
      line,
      distanceKm: metersBetween(line[0] as LonLat, line[1] as LonLat) / 1000,
      durationMin: travelHours(from, to) * 60,
      source: 'straight',
    }
  }
  const line = decodePolyline(entry.polyline)
  return {
    line: from < to ? line : line.reverse(),
    distanceKm: entry.distanceM / 1000,
    durationMin: (entry.durationS * catalog.meta.durationFactor) / 60,
    source: 'osrm',
  }
}
