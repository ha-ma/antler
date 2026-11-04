import type { TripPlan } from '@antler/schema'
import type { DayPlan } from '@antler/trip'
import { metersBetween, type LonLat } from '@antler/zones'
import type { DriveScenario } from '../types'
import { createRoadFrame } from './road'
import { smoothRoute } from './route-shape'
import { driveSeed, resolveAlertEnabled } from './scenario'

// 旅のその日の場面（drive-link R3・R4・R5）。GET /api/trips/:id/day/:n の DayPlan から、運転の場面を作る純粋関数。
// 同じ応答・同じ URL なら同じ場面（同じ道・同じ条件・同じ鹿の種）。移動の無い日は null。

export type TripDayInput = { plan: TripPlan; day: DayPlan }

/** つなぎ目でこれより離れていたら直線で埋める（m） */
const JOINT_GAP_M = 1

export function scenarioFromDay({ plan, day }: TripDayInput, search: string): DriveScenario | null {
  const first = day.legs[0]
  const last = day.legs[day.legs.length - 1]
  if (!first || !last) return null

  // 移動ごとになめらかにしてからつなぐ。つなぎ目はなめらかにしない（宿で折り返しても輪やトゲを作らない）
  const route: LonLat[] = []
  const legStartIndex: number[] = []
  const legEndIndex: number[] = []
  /** 直線で埋めたつなぎ目の頂点の範囲（前の移動の終点〜次の移動の始点） */
  const fillerIndex: [number, number][] = []
  for (const leg of day.legs) {
    const part = smoothRoute(leg.route)
    const prev = route[route.length - 1]
    const head = part[0]
    let body = part
    if (prev && head) {
      if (metersBetween(prev, head) <= JOINT_GAP_M) {
        // 同じ点: 前の移動の終点をこの移動の始点として使う
        body = part.slice(1)
      } else {
        // 離れた端点は直線で埋める（端点を除いた中の点だけ足す）。ここはしおりの道ではないので区間を作らない
        const from = route.length - 1
        route.push(...smoothRoute([prev, head]).slice(1, -1))
        fillerIndex.push([from, route.length])
      }
    }
    legStartIndex.push(body === part ? route.length : route.length - 1)
    route.push(...body)
    legEndIndex.push(route.length - 1)
  }

  const frame = createRoadFrame(route)
  const sAt = (index: number) => frame.cumulativeM[index] ?? 0
  const legStarts = day.legs.slice(1).map((leg, i) => ({
    sM: sAt(legStartIndex[i + 1] ?? 0),
    departAt: leg.departAt,
  }))
  // 直線で引いた概算の移動と、直線で埋めたつなぎ目には区間を作らない（brief-map R1。A-2 に出ないゾーンを出さない）
  const straightRangesM: [number, number][] = [
    ...day.legs.flatMap((leg, i): [number, number][] =>
      leg.source === 'straight' ? [[sAt(legStartIndex[i] ?? 0), sAt(legEndIndex[i] ?? 0)]] : [],
    ),
    ...fillerIndex.map(([a, b]): [number, number] => [sAt(a), sAt(b)]),
  ].sort((x, y) => x[0] - y[0])

  return {
    source: 'trip',
    trip: plan,
    day: day.day,
    route,
    startAt: first.departAt,
    surface: day.conditions.surface,
    weather: day.conditions.weather,
    windowFog: day.conditions.windowFog,
    from: first.from,
    to: last.to,
    distanceKm: day.legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    legStarts,
    straightRangesM,
    data: day.data,
    seed: driveSeed(plan.seed, day.day),
    alertEnabled: resolveAlertEnabled(search),
  }
}
