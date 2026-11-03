import { sunAltitude, type Where } from '@antler/zones'

// その日の日没と薄暮（docs/specs/brief-map/functional.md R3）。その日の 12:00〜24:00（JST）を 1 分刻みで調べる。
// 薄暮は太陽の高さ +6° 〜 −6°（@antler/zones の lightPeriod の dusk と同じ線）、日没は −0.833°（大気差と太陽の半径）。

export type SunTimes = {
  /** 薄暮の始まり（太陽が +6° を下回る） */
  duskStartAt: string | null
  /** 日没 */
  sunsetAt: string | null
  /** 薄暮の終わり（−6° を下回る。ここから夜） */
  duskEndAt: string | null
}

const MINUTE_MS = 60_000
const JST_MS = 9 * 60 * MINUTE_MS
const DUSK_START_DEG = 6
const SUNSET_DEG = -0.833
const DUSK_END_DEG = -6

/** epoch ms を `YYYY-MM-DDTHH:mm+09:00` にする */
export function jstMinute(ms: number): string {
  return `${new Date(ms + JST_MS).toISOString().slice(0, 16)}+09:00`
}

/** date は JST の暦日（YYYY-MM-DD）。where はその日の到着地点 */
export function sunTimes(date: string, where: Where): SunTimes {
  const noon = Date.parse(`${date}T12:00:00+09:00`)
  const found: SunTimes = { duskStartAt: null, sunsetAt: null, duskEndAt: null }
  let prev = sunAltitude(noon, where)
  for (let m = 1; m <= 12 * 60; m++) {
    const at = noon + m * MINUTE_MS
    const alt = sunAltitude(at, where)
    if (found.duskStartAt === null && prev > DUSK_START_DEG && alt <= DUSK_START_DEG)
      found.duskStartAt = jstMinute(at)
    if (found.sunsetAt === null && prev >= SUNSET_DEG && alt < SUNSET_DEG)
      found.sunsetAt = jstMinute(at)
    if (found.duskEndAt === null && prev >= DUSK_END_DEG && alt < DUSK_END_DEG)
      found.duskEndAt = jstMinute(at)
    prev = alt
  }
  return found
}
