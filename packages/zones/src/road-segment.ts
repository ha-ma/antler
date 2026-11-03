import { distanceToPolyline, type LonLat } from './geo'
import { ENTER_M } from './judge'
import type { ZoneCollection } from './zone-db'

// Capture の位置の丸め（functional.md R8、ch5「精密な位置は保存しない」）。
// ゾーンから 1 km 以内ならそのゾーンの id、それ以外は unknown。座標から ID を作らない。
// ゾーン外を「路線＋1 km 単位のキロポスト」にするのは保留（路線の線形とキロポストが手に入ってから）。

/** ゾーンの縁からこの距離までは、そのゾーンの id に丸める（m） */
export const SEGMENT_SNAP_M = 1000

export function toRoadSegment(p: LonLat, zones: ZoneCollection): string {
  let best: { id: string; d: number } | null = null
  for (const z of zones.features) {
    const d = distanceToPolyline(p, z.properties.centerline).distanceM
    if (!best || d < best.d) best = { id: z.id, d }
  }
  return best && best.d <= ENTER_M + SEGMENT_SNAP_M ? best.id : 'unknown'
}
