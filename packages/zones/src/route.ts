import { distanceToPolyline, metersBetween, toLocal, type LonLat } from './geo'
import { ENTER_M } from './judge'
import type { ZoneCollection } from './zone-db'

// A のルート（その日の LineString）に沿った距離（functional.md R3 の A・R5）。
// 重い処理（ルート上のゾーン区間の洗い出し）は planRoute でルートごとに 1 回、毎フレームは measureAlongRoute だけ。

/** ルートをこの間隔で調べる（m） */
const SAMPLE_M = 25
/** これ以内の隙間で続く区間は 1 つの走行区間にする */
export const ROUTE_MERGE_GAP_M = 200

export type RouteInterval = {
  zoneIds: string[]
  /** ルートの始点からの道のり（km） */
  entryKm: number
  exitKm: number
}

export type RoutePlan = {
  route: readonly LonLat[]
  /** 各頂点までの道のり（m） */
  cumulativeM: number[]
  totalKm: number
  intervals: RouteInterval[]
}

export function planRoute(route: readonly LonLat[], zones: ZoneCollection): RoutePlan {
  const cumulativeM = [0]
  for (let i = 0; i + 1 < route.length; i++) {
    cumulativeM.push(
      (cumulativeM[i] ?? 0) + metersBetween(route[i] as LonLat, route[i + 1] as LonLat),
    )
  }
  const totalM = cumulativeM[cumulativeM.length - 1] ?? 0

  // サンプル点ごとに、どのゾーンの中か
  type Hit = { atM: number; zoneIds: string[] }
  const hits: Hit[] = []
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i] as LonLat
    const b = route[i + 1] as LonLat
    const segM = (cumulativeM[i + 1] ?? 0) - (cumulativeM[i] ?? 0)
    const n = Math.max(1, Math.ceil(segM / SAMPLE_M))
    for (let k = 0; k < n; k++) {
      const t = k / n
      const p: LonLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      hits.push({ atM: (cumulativeM[i] ?? 0) + segM * t, zoneIds: zonesAt(p, zones) })
    }
  }
  const last = route[route.length - 1]
  if (last) hits.push({ atM: totalM, zoneIds: zonesAt(last, zones) })

  // 続く inside を区間にし、200 m 以内の隙間はつなぐ
  const intervals: RouteInterval[] = []
  let open: { ids: Set<string>; entryM: number; exitM: number } | null = null
  for (const h of hits) {
    if (h.zoneIds.length > 0) {
      if (open && h.atM - open.exitM <= ROUTE_MERGE_GAP_M) {
        h.zoneIds.forEach((id) => open?.ids.add(id))
        open.exitM = h.atM
      } else {
        if (open) intervals.push(close(open))
        open = { ids: new Set(h.zoneIds), entryM: h.atM, exitM: h.atM }
      }
    }
  }
  if (open) intervals.push(close(open))
  return { route, cumulativeM, totalKm: totalM / 1000, intervals }
}

function close(o: { ids: Set<string>; entryM: number; exitM: number }): RouteInterval {
  return { zoneIds: [...o.ids].sort(), entryKm: o.entryM / 1000, exitKm: o.exitM / 1000 }
}

function zonesAt(p: LonLat, zones: ZoneCollection): string[] {
  return zones.features
    .filter((z) => distanceToPolyline(p, z.properties.centerline).distanceM <= ENTER_M)
    .map((z) => z.id)
}

export type RouteMeasure = {
  /** 現在地をルートに落とした位置の道のり（km） */
  positionKm: number
  /** ゾーン内なら、その走行区間と出口までの残り km */
  current?: { zoneIds: string[]; remainingKm: number }
  /** 次の走行区間と、入口までの道のり km */
  next?: { zoneIds: string[]; distanceKm: number; entryKm: number }
}

/** これだけ最短より遠くても、手がかり（前回の位置）に近い区間を選ぶ（往復で行き道と帰り道が重なるとき） */
const HINT_TOLERANCE_M = 30

/**
 * 現在地をルートに落とした道のり（km）。道のりは planRoute の cumulativeM と同じ物差しで数える。
 * hintKm（前回の positionKm）を渡すと、同じくらい近い区間が複数あるとき（往復）に hintKm に近い方を選ぶ。
 */
export function projectOnRoute(plan: RoutePlan, position: LonLat, hintKm?: number): number {
  type Candidate = { distanceM: number; alongM: number }
  const candidates: Candidate[] = []
  for (let i = 0; i + 1 < plan.route.length; i++) {
    const a = toLocal(position, plan.route[i] as LonLat)
    const b = toLocal(position, plan.route[i + 1] as LonLat)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2))
    const startM = plan.cumulativeM[i] ?? 0
    const endM = plan.cumulativeM[i + 1] ?? startM
    candidates.push({
      distanceM: Math.hypot(a[0] + t * dx, a[1] + t * dy),
      alongM: startM + t * (endM - startM),
    })
  }
  if (candidates.length === 0) return 0
  const best = Math.min(...candidates.map((c) => c.distanceM))
  const near = candidates.filter((c) => c.distanceM <= best + HINT_TOLERANCE_M)
  const pick =
    hintKm === undefined
      ? near.reduce((x, y) => (y.distanceM < x.distanceM ? y : x))
      : near.reduce((x, y) =>
          Math.abs(y.alongM - hintKm * 1000) < Math.abs(x.alongM - hintKm * 1000) ? y : x,
        )
  return pick.alongM / 1000
}

/** 現在地をルートに落とし、いまの区間・次の区間までの道のりを返す。hintKm は前回の positionKm（往復の取り違え防止）。 */
export function measureAlongRoute(
  plan: RoutePlan,
  position: LonLat,
  hintKm?: number,
): RouteMeasure {
  const positionKm = projectOnRoute(plan, position, hintKm)
  const out: RouteMeasure = { positionKm }
  const current = plan.intervals.find((i) => i.entryKm <= positionKm && positionKm <= i.exitKm)
  if (current) out.current = { zoneIds: current.zoneIds, remainingKm: current.exitKm - positionKm }
  const next = plan.intervals.find((i) => i.entryKm > positionKm)
  if (next) {
    out.next = {
      zoneIds: next.zoneIds,
      distanceKm: next.entryKm - positionKm,
      entryKm: next.entryKm,
    }
  }
  return out
}
