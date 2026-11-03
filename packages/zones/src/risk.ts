import type { LonLat } from './geo'
import { lightPeriod, toInstant } from './sun'
import type { ZoneFeature } from './zone-db'

// ゾーンの危険度（functional.md R7。A5-2 の遭遇率の元）。重み表[JST の月][光の区分]、0〜1。

const JST_MS = 9 * 60 * 60 * 1000

/** その瞬間の JST の月（1〜12）。端末のタイムゾーンに左右されない。 */
export function jstMonth(at: string | number | Date): number {
  return new Date(toInstant(at) + JST_MS).getUTCMonth() + 1
}

export function zoneRisk(zone: ZoneFeature, at: string | number | Date): number {
  const line = zone.properties.centerline
  const mid = line[Math.floor(line.length / 2)] as LonLat
  const period = lightPeriod(at, { lon: mid[0], lat: mid[1] })
  const month = zone.properties.weights[jstMonth(at) - 1]
  if (!month) throw new RangeError('月を決められません')
  return month[period]
}
