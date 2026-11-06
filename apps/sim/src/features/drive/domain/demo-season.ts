import { dayConditions } from '@antler/trip'
import type { TripPlan } from '@antler/schema'
import type { Surface, Weather, WindowFog } from '../types'

// 見本の場面の季節（docs/specs/drive-season/functional.md R2）。`/drive?month=N&weather=W` で、見本の旅の種・2 日目・
// その月の当日の条件（旅の場面と同じ dayConditions）を使う。何も無い・読めないときは drive-3d からの固定の場面。

export type DemoSeason = {
  /** 出発時刻（ISO 8601、+09:00） */
  startAt: string
  surface: Surface
  weather: Weather
  windowFog: WindowFog
}

/** 既定（2 月 15 日 16:40、薄暮。圧雪・曇り、4 人なので窓は少し曇る）。drive-tune と鹿の受け入れテストの前提 */
export const DEMO_DEFAULT: DemoSeason = {
  startAt: '2027-02-15T16:40+09:00',
  surface: 'packed-snow',
  weather: 'cloudy',
  windowFog: 'light',
}

const WEATHERS: readonly Weather[] = ['clear', 'cloudy', 'rain', 'snow', 'fog']
const MONTH = /^(?:[1-9]|1[0-2])$/
/** month が無く weather だけのときの月 */
const DEFAULT_MONTH = 2

/** 出発の案内の季節の切り替え（R2）。query は URL の month・weather（既定は無し） */
export const DEMO_SEASONS: readonly {
  id: 'default' | 'winter' | 'thaw' | 'summer' | 'autumn'
  month: number | null
  weather: Weather | null
}[] = [
  { id: 'default', month: null, weather: null },
  { id: 'winter', month: 2, weather: 'snow' },
  { id: 'thaw', month: 4, weather: 'rain' },
  { id: 'summer', month: 7, weather: 'clear' },
  { id: 'autumn', month: 10, weather: 'rain' },
]

function readMonth(q: URLSearchParams): number | null {
  const v = q.get('month')
  return v !== null && MONTH.test(v) ? Number(v) : null
}

function readWeather(q: URLSearchParams): Weather | null {
  const v = q.get('weather')
  return WEATHERS.find((w) => w === v) ?? null
}

/** URL の month・weather から見本の場面の季節を決める */
export function demoSeason(search: string, trip: Pick<TripPlan, 'seed' | 'party'>): DemoSeason {
  const q = new URLSearchParams(search)
  const month = readMonth(q)
  const weather = readWeather(q)
  if (month === null && weather === null) return DEMO_DEFAULT
  const m = month ?? DEFAULT_MONTH
  const c = dayConditions({
    seed: trip.seed,
    day: 2,
    month: m,
    departMonth: m,
    party: trip.party,
    weather: weather ?? undefined,
  })
  return {
    startAt: `2027-${String(m).padStart(2, '0')}-15T16:40+09:00`,
    surface: c.surface,
    weather: c.weather,
    windowFog: c.windowFog,
  }
}

/** いまの URL が季節の切り替えのどれか（どれでもなければ null） */
export function currentDemoSeason(search: string): (typeof DEMO_SEASONS)[number]['id'] | null {
  const q = new URLSearchParams(search)
  const month = readMonth(q)
  const weather = readWeather(q)
  return DEMO_SEASONS.find((s) => s.month === month && s.weather === weather)?.id ?? null
}

/** 季節の切り替えのリンク（いまの URL の他の値を保ち、month・weather だけ差し替える） */
export function demoSeasonHref(search: string, id: (typeof DEMO_SEASONS)[number]['id']): string {
  const season = DEMO_SEASONS.find((s) => s.id === id)
  const q = new URLSearchParams(search)
  q.delete('month')
  q.delete('weather')
  if (season?.month != null) q.set('month', String(season.month))
  if (season?.weather != null) q.set('weather', season.weather)
  const text = q.toString()
  return text === '' ? '/drive' : `/drive?${text}`
}
