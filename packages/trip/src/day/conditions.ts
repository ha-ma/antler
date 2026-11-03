import { createRng, deriveSeed, pickWeighted } from './rng'

// 当日の条件（docs/specs/brief-map/functional.md R4、A2-3）。(旅のシード, 日) から決まる純粋関数で、保存しない。
// 同じシード・同じ版なら同じ条件が出ることを「記録に残す」とする。表を変えたら CONDITIONS_VERSION を上げる。
// 天候・路面の文字列は drive-3d（apps/sim/src/features/drive/types.ts）と同じ。Capture の語彙（`_` 区切り）への変換は capture の feature。

export const CONDITIONS_VERSION = 1

/** 天候（drive の検知の確率に効く） */
export type Weather = 'clear' | 'cloudy' | 'snow' | 'fog'
/** 路面（drive の制動距離とグリップに効く） */
export type Surface = 'dry' | 'wet' | 'packed-snow' | 'ice'
export type VehicleClass = 'compact' | 'compact-suv' | 'minivan'
/** 窓の曇り（車内の人数で増える。drive の検知の確率に効く） */
export type WindowFog = 'none' | 'light' | 'medium' | 'heavy'

export type DayConditions = {
  version: typeof CONDITIONS_VERSION
  /** その日に運転する人（運転できる人の何人目か。1 始まり） */
  driver: number
  /** 運転できる人の数（2 以上なら交代できる） */
  drivers: number
  vehicle: VehicleClass
  fourWd: boolean
  weather: Weather
  surface: Surface
  /** 車内の人数（= party.size） */
  occupants: number
  windowFog: WindowFog
}

export type ConditionsInput = {
  seed: number
  day: number
  /** その日の月（JST、1〜12）。天候と路面に使う */
  month: number
  /** 旅の出発の月（JST）。車（4WD）は旅全体で 1 台なので、出発の月で決める */
  departMonth: number
  party: { size: number; drivers: number }
}

type Season = 'winter' | 'shoulder' | 'green' | 'summer'

function seasonOf(month: number): Season {
  if (month === 12 || month <= 3) return 'winter'
  if (month === 4 || month === 11) return 'shoulder'
  if (month === 7 || month === 8) return 'summer'
  return 'green'
}

/** 月ごとの天候の割合（道東の冬は雪、夏は海霧が多い。目安。推奨で決定） */
const WEATHER: Record<Season, Partial<Record<Weather, number>>> = {
  winter: { clear: 25, cloudy: 30, snow: 40, fog: 5 },
  shoulder: { clear: 40, cloudy: 35, snow: 15, fog: 10 },
  green: { clear: 45, cloudy: 35, fog: 20 },
  summer: { clear: 40, cloudy: 35, fog: 25 },
}

function surfaceWeights(season: Season, weather: Weather): Partial<Record<Surface, number>> {
  if (season === 'winter')
    return weather === 'snow'
      ? { 'packed-snow': 70, ice: 30 }
      : { 'packed-snow': 50, ice: 30, dry: 20 }
  if (season === 'shoulder')
    return weather === 'snow' ? { 'packed-snow': 60, wet: 40 } : { dry: 60, wet: 30, ice: 10 }
  return weather === 'clear' ? { dry: 100 } : { dry: 60, wet: 40 }
}

const FOG_LEVELS: readonly WindowFog[] = ['none', 'light', 'medium', 'heavy']

/** 人数の段（1〜2 人 none、3〜4 人 light、5〜6 人 medium、7〜8 人 heavy）。雪か霧の日は 1 段上げる */
function windowFogOf(occupants: number, weather: Weather): WindowFog {
  const base = occupants <= 2 ? 0 : occupants <= 4 ? 1 : occupants <= 6 ? 2 : 3
  const bump = weather === 'snow' || weather === 'fog' ? 1 : 0
  return FOG_LEVELS[Math.min(FOG_LEVELS.length - 1, base + bump)] as WindowFog
}

function vehicleOf(size: number): VehicleClass {
  if (size <= 2) return 'compact'
  return size <= 5 ? 'compact-suv' : 'minivan'
}

export function dayConditions({
  seed,
  day,
  month,
  departMonth,
  party,
}: ConditionsInput): DayConditions {
  const rng = createRng(deriveSeed(seed, `conditions:${day}`))
  const season = seasonOf(month)
  const weather = pickWeighted(rng, WEATHER[season] as Record<Weather, number>)
  const surface = pickWeighted(rng, surfaceWeights(season, weather) as Record<Surface, number>)
  const driver = 1 + Math.min(party.drivers - 1, Math.floor(rng() * party.drivers))
  return {
    version: CONDITIONS_VERSION,
    driver,
    drivers: party.drivers,
    vehicle: vehicleOf(party.size),
    fourWd: ['winter', 'shoulder'].includes(seasonOf(departMonth)),
    weather,
    surface,
    occupants: party.size,
    windowFog: windowFogOf(party.size, weather),
  }
}
