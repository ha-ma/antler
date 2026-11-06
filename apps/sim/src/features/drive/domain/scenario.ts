import { Lang, TripPlanSchema, type TripPlan } from '@antler/schema'
import { initialLang } from '@antler/trip'
import { polylineLengthM, type LonLat, type ZoneCollection } from '@antler/zones'
import type { DriveScenario } from '../types'
import { demoSeason } from './demo-season'
import { deriveSeed } from './rng'
import { fromPlane, toPlane, type PlaneXZ } from './road'
import { ROUTE_STEP_M, smoothPlane } from './route-shape'

// 見本の場面（drive-3d R1）。`/drive` に trip が無いとき（開発用）に走る: 見本の旅程（ch7-example を 2 日にしたもの）と、
// 国道 240 号 釧路市 鶴丘 → 阿寒町 → 上徹別〜飽別（zones.geojson の R240-akan-1・R240-akan-2）。
// 旅のその日の場面は trip-scenario.ts の scenarioFromDay（drive-link）。

export { ROUTE_STEP_M }

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
    { day: 2, from: 'kushiro', to: 'akan', stops: [], stay: 'akan' },
  ],
  riskScore: 0.78,
  alertEnabled: true,
})

/** 固定の場面で通るゾーン（この順に通る） */
export const DEMO_ZONE_IDS = ['R240-akan-1', 'R240-akan-2'] as const
/** 最初のゾーンの手前と、最後のゾーンの後ろに足す長さ（m） */
export const LEAD_IN_M = 5000
export const LEAD_OUT_M = 1000

/** 鹿の候補と検知の乱数の種（drive-link R4）。同じ旅・同じ日なら同じ鹿、日が違えば違う鹿 */
export function driveSeed(tripSeed: number, day: number): number {
  return deriveSeed(tripSeed, `drive:${String(day)}`)
}

/**
 * 固定の場面（2 日目の 16:40）。季節・天候・路面は URL の month・weather から（drive-season R2、demo-season.ts）。
 * 無ければ 2 月・薄暮・圧雪・曇り、4 人なので窓は少し曇る
 */
/**
 * 見本の場面の言語（i18n R5）: `?lang=ja|en|zh|ko` があればそれ、無い・知らない値ならブラウザの言語（initialLang）。
 * 4 言語の画面を撮って確かめるため。旅の場面は旅の言語が正で、`?lang=` を読まない
 */
export function demoLang(search: string, languages: readonly string[]): Lang {
  const parsed = Lang.safeParse(new URLSearchParams(search).get('lang'))
  return parsed.success ? parsed.data : initialLang(languages)
}

export function demoScenario(
  zones: ZoneCollection,
  search = '',
  languages: readonly string[] = [],
): DriveScenario {
  const route = buildDemoRoute(zones)
  const season = demoSeason(search, DEMO_TRIP)
  return {
    source: 'demo',
    trip: { ...DEMO_TRIP, lang: demoLang(search, languages) },
    day: 2,
    route,
    startAt: season.startAt,
    surface: season.surface,
    weather: season.weather,
    windowFog: season.windowFog,
    from: 'kushiro',
    // 地点のマスタ（@antler/trip の places）の id。HUD の区間の案内は名前（阿寒湖）で出す
    to: 'akan',
    distanceKm: polylineLengthM(route) / 1000,
    stops: [],
    legStarts: [],
    // 見本は 1 本の移動を 50 km/h の目安で（drive-tune R1）
    legPace: [{ sM: 0, departAt: season.startAt, mps: 50 / 3.6 }],
    straightRangesM: [],
    data: null,
    seed: driveSeed(DEMO_TRIP.seed, 2),
    alertEnabled: resolveAlertEnabled(search),
  }
}

/**
 * アラートの ON/OFF（drive-link R3、UC-1c）。URL に ?alert=off があれば OFF、無ければ ON。
 * TripPlan の alertEnabled は作成時の初期値のままなので見ない（plan-trip R10。ON/OFF は走行の記録の側）
 */
export function resolveAlertEnabled(search: string): boolean {
  return new URLSearchParams(search).get('alert') !== 'off'
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
  return smoothPlane([first, ...pts, last]).map((p) => fromPlane(origin, p))
}

/** a → b の向きに b から length 先の点 */
function extend(a: PlaneXZ, b: PlaneXZ, length: number): PlaneXZ {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz) || 1
  return [b[0] + (dx / len) * length, b[1] + (dz / len) * length]
}
