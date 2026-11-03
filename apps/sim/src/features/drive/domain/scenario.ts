import { TripPlanSchema, type TripPlan } from '@antler/schema'
import type { LonLat, ZoneCollection } from '@antler/zones'
import type { DriveScenario } from '../types'
import { fromPlane, toPlane, type PlaneXZ } from './road'

// 運転の場面（R1）。plan-trip ができるまでの固定の場面: 見本の旅程（ch7-example を 2 日にしたもの）と、
// 国道 240 号 釧路市 鶴丘 → 阿寒町 → 上徹別〜飽別（zones.geojson の R240-akan-1・R240-akan-2）。
// plan-trip のあとは、その TripPlan とルートで DriveScenario を作れば同じように走る。

/** 見本の旅程（packages/schema/fixtures/trip-plan/valid/ch7-example.json に 2 日目を足したもの） */
export const DEMO_TRIP: TripPlan = TripPlanSchema.parse({
  id: 'K7m2',
  lang: 'ja',
  seed: 918273,
  party: { size: 4, drivers: 2, experience: 'first' },
  depart: { at: '2027-02-14T10:00+09:00', place: 'CTS' },
  return: { at: '2027-02-18T17:00+09:00', place: 'CTS' },
  budgetPerPersonJPY: 120000,
  area: 'doto',
  pleasures: [
    { id: 'drift-ice-walk', weight: 5 },
    { id: 'red-crowned-crane', weight: 4 },
  ],
  title: '流氷とタンチョウと、雪見の温泉。道東をめぐる5日間。',
  days: [
    { day: 1, from: 'cts', to: 'kushiro', stops: ['washo-market'], stay: 'kushiro' },
    { day: 2, from: 'kushiro', to: 'akanko', stops: [], stay: 'akanko' },
  ],
  riskScore: 0.78,
  alertEnabled: true,
})

/** 固定の場面で通るゾーン（この順に通る） */
export const DEMO_ZONE_IDS = ['R240-akan-1', 'R240-akan-2'] as const
/** 最初のゾーンの手前と、最後のゾーンの後ろに足す長さ（m） */
export const LEAD_IN_M = 1500
export const LEAD_OUT_M = 1000
/** ルートの頂点の間隔（m） */
export const ROUTE_STEP_M = 20

/** 固定の場面（2 日目の 16:40、薄暮。圧雪・曇り） */
export function demoScenario(zones: ZoneCollection, search = ''): DriveScenario {
  return {
    trip: DEMO_TRIP,
    day: 2,
    route: buildDemoRoute(zones),
    startAt: '2027-02-15T16:40+09:00',
    surface: 'packed-snow',
    weather: 'cloudy',
    alertEnabled: resolveAlertEnabled(DEMO_TRIP, search),
  }
}

/** アラートの ON/OFF。URL に ?alert=off があれば OFF、無ければ旅程の値（UC-1c） */
export function resolveAlertEnabled(trip: TripPlan, search: string): boolean {
  return new URLSearchParams(search).get('alert') === 'off' ? false : trip.alertEnabled
}

/** 2 つのゾーンの中心線をつなぎ、前後に直線を足して、なめらかにして等間隔に打ち直す */
export function buildDemoRoute(zones: ZoneCollection): LonLat[] {
  const lines = DEMO_ZONE_IDS.map((id) => {
    const zone = zones.features.find((z) => z.id === id)
    if (!zone) throw new Error(`ゾーン DB に ${id} がありません`)
    return zone.properties.centerline
  })
  const raw = lines.flat()
  const origin = raw[0]
  if (!origin) throw new Error('中心線が空です')
  const pts = raw.map((p) => toPlane(origin, p))
  const first = extend(pts[1] ?? origin, pts[0] ?? origin, LEAD_IN_M)
  const last = extend(pts[pts.length - 2] ?? origin, pts[pts.length - 1] ?? origin, LEAD_OUT_M)
  const smooth = resample(catmullRom(dedupe([first, ...pts, last])), ROUTE_STEP_M)
  return smooth.map((p) => fromPlane(origin, p))
}

/** a → b の向きに b から length 先の点 */
function extend(a: PlaneXZ, b: PlaneXZ, length: number): PlaneXZ {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz) || 1
  return [b[0] + (dx / len) * length, b[1] + (dz / len) * length]
}

/** 1 m 未満で続く点を落とす（区間のつなぎ目の重複） */
function dedupe(points: PlaneXZ[]): PlaneXZ[] {
  return points.filter((p, i) => {
    const prev = points[i - 1]
    return !prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= 1
  })
}

/** centripetal Catmull-Rom で頂点を通るなめらかな線にする（線分を細かく刻む） */
function catmullRom(points: PlaneXZ[]): PlaneXZ[] {
  const out: PlaneXZ[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const p1 = points[i] as PlaneXZ
    const p2 = points[i + 1] as PlaneXZ
    const p0 = points[i - 1] ?? mirror(p2, p1)
    const p3 = points[i + 2] ?? mirror(p1, p2)
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const steps = Math.max(1, Math.ceil(segLen / 5))
    for (let k = 0; k < steps; k++) out.push(centripetal(p0, p1, p2, p3, k / steps))
  }
  const end = points[points.length - 1]
  if (end) out.push(end)
  return out
}

function mirror(a: PlaneXZ, center: PlaneXZ): PlaneXZ {
  return [2 * center[0] - a[0], 2 * center[1] - a[1]]
}

/** Barry–Goldman の式（alpha = 0.5） */
function centripetal(p0: PlaneXZ, p1: PlaneXZ, p2: PlaneXZ, p3: PlaneXZ, u: number): PlaneXZ {
  const knot = (a: PlaneXZ, b: PlaneXZ) =>
    Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])))
  const t0 = 0
  const t1 = t0 + knot(p0, p1)
  const t2 = t1 + knot(p1, p2)
  const t3 = t2 + knot(p2, p3)
  const t = t1 + (t2 - t1) * u
  const lerp = (a: PlaneXZ, b: PlaneXZ, ta: number, tb: number): PlaneXZ => {
    const w = (t - ta) / (tb - ta)
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]
  }
  const a1 = lerp(p0, p1, t0, t1)
  const a2 = lerp(p1, p2, t1, t2)
  const a3 = lerp(p2, p3, t2, t3)
  const b1 = lerp(a1, a2, t0, t2)
  const b2 = lerp(a2, a3, t1, t3)
  return lerp(b1, b2, t1, t2)
}

/** 折れ線を step m ごとの点に打ち直す（始点と終点は残す） */
function resample(points: PlaneXZ[], step: number): PlaneXZ[] {
  const first = points[0]
  if (!first) return []
  const out: PlaneXZ[] = [first]
  let carry = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as PlaneXZ
    const b = points[i + 1] as PlaneXZ
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    let at = step - carry
    while (at <= len) {
      const w = at / len
      out.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w])
      at += step
    }
    carry = len - (at - step)
  }
  const last = points[points.length - 1] as PlaneXZ
  const tail = out[out.length - 1] as PlaneXZ
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 1) out.push(last)
  return out
}
