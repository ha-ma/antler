import { jstMonth } from '@antler/zones'
import type { DriveScenario, Surface, Weather } from '../types'

// 景色の季節（docs/specs/drive-season/functional.md R3）。景色は旅の日の月で、車道の色と μ は路面で決める。
// 3D（scene/）はこれを読むだけにする（月の区切りをシーンに書かない）。

/** 景色の季節。冬 12〜3 月、雪どけ 4 月、緑 5〜9 月、紅葉 10 月、初冬 11 月 */
export type SceneSeason = 'winter' | 'thaw' | 'green' | 'autumn' | 'late-autumn'
/** 降るもの */
export type Precipitation = 'none' | 'snow' | 'rain'

export type SceneLook = {
  season: SceneSeason
  surface: Surface
  weather: Weather
  precipitation: Precipitation
}

/** ISO 8601 の時刻の JST の月（1〜12） */
export function monthOf(at: string): number {
  return jstMonth(at)
}

/** 月と路面から景色の季節。圧雪の道の周りに雪が無いことはないので、圧雪なら月に関係なく冬 */
export function sceneSeasonOf(month: number, surface: Surface): SceneSeason {
  if (surface === 'packed-snow') return 'winter'
  if (month === 12 || month <= 3) return 'winter'
  if (month === 4) return 'thaw'
  if (month === 10) return 'autumn'
  if (month === 11) return 'late-autumn'
  return 'green'
}

export function precipitationOf(weather: Weather): Precipitation {
  if (weather === 'snow') return 'snow'
  if (weather === 'rain') return 'rain'
  return 'none'
}

export function sceneLookOf(
  scenario: Pick<DriveScenario, 'startAt' | 'surface' | 'weather'>,
): SceneLook {
  return {
    season: sceneSeasonOf(monthOf(scenario.startAt), scenario.surface),
    surface: scenario.surface,
    weather: scenario.weather,
    precipitation: precipitationOf(scenario.weather),
  }
}
