import type { LightPeriod } from './zone-db'

// 光の区分を太陽の高さで決める（functional.md R6）。時計の時刻では決めない（季節と場所でずれるため）。
// 太陽の位置は NOAA の Solar Calculator の式（大気差の補正なし）。精度は高さで 0.1° 程度。
// 入力は瞬間（ms か、タイムゾーン付きの ISO 8601）なので、端末のタイムゾーンに左右されない。

export type Where = { lat: number; lon: number }

const RAD = Math.PI / 180

/** タイムゾーン付きの ISO 8601 か ms を ms にする。タイムゾーンの無い文字列は拒否する（端末の TZ で解釈されるため）。 */
export function toInstant(at: string | number | Date): number {
  if (typeof at === 'number') return at
  if (at instanceof Date) return at.getTime()
  if (!/(?:Z|[+-][0-9]{2}:?[0-9]{2})$/.test(at)) {
    throw new RangeError(
      'タイムゾーン付きの ISO 8601 で渡してください（例 2027-02-15T16:30:00+09:00）',
    )
  }
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) throw new RangeError('日時を読めません')
  return ms
}

type SolarState = { altitudeDeg: number; hourAngleDeg: number }

function solar(ms: number, { lat, lon }: Where): SolarState {
  const jd = ms / 86_400_000 + 2_440_587.5
  const T = (jd - 2_451_545) / 36_525
  const L0 = (((280.46646 + T * (36_000.76983 + T * 0.0003032)) % 360) + 360) % 360
  const M = 357.52911 + T * (35_999.05029 - 0.0001537 * T)
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289
  const omega = 125.04 - 1934.136 * T
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD)
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD))
  const y = Math.tan((eps * RAD) / 2) ** 2
  const eqTimeMin =
    4 *
    (1 / RAD) *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD))
  const utcMinutes = (((ms % 86_400_000) + 86_400_000) % 86_400_000) / 60_000
  const trueSolarMin = (((utcMinutes + eqTimeMin + 4 * lon) % 1440) + 1440) % 1440
  const hourAngle = trueSolarMin / 4 < 0 ? trueSolarMin / 4 + 180 : trueSolarMin / 4 - 180
  const cosZenith =
    Math.sin(lat * RAD) * Math.sin(decl) +
    Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle * RAD)
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD
  return { altitudeDeg: 90 - zenith, hourAngleDeg: hourAngle }
}

/** 太陽の高さ（度、大気差なし）。 */
export function sunAltitude(at: string | number | Date, where: Where): number {
  return solar(toInstant(at), where).altitudeDeg
}

/** 太陽の高さ > +6° → day、-6°〜+6° → 午前は dawn・午後は dusk、< -6° → night。 */
export function lightPeriod(at: string | number | Date, where: Where): LightPeriod {
  const { altitudeDeg, hourAngleDeg } = solar(toInstant(at), where)
  if (altitudeDeg > 6) return 'day'
  if (altitudeDeg < -6) return 'night'
  return hourAngleDeg < 0 ? 'dawn' : 'dusk'
}
