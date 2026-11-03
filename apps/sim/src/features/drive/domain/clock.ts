import { ETA_MIN_KMH, sunAltitude, type LonLat } from '@antler/zones'

// HUD の時刻（R11）。時刻は JST で出す（端末のタイムゾーンに左右されない）。

const JST_OFFSET_MS = 9 * 3600_000
/** 日没は太陽の上端が地平線に沈むとき（高さ -0.833°） */
const SUNSET_ALTITUDE_DEG = -0.833

/** epoch ms → JST の「hh:mm」 */
export function formatJstTime(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** epoch ms → JST の「M/D」 */
export function formatJstDate(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** 経過 ms → 「h:mm」 */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`
}

/** その日（JST）の日没の時刻（epoch ms）。12 時から 1 分刻みで探す。沈まなければ null */
export function sunsetOf(ms: number, where: LonLat): number | null {
  const d = new Date(ms + JST_OFFSET_MS)
  const noonJst = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12) - JST_OFFSET_MS
  const at = { lon: where[0], lat: where[1] }
  for (let m = 0; m <= 12 * 60; m++) {
    const t = noonJst + m * 60_000
    if (sunAltitude(t, at) < SUNSET_ALTITUDE_DEG) return t
  }
  return null
}

/** 次のゾーンの到達予定（epoch ms）。時速 5 km 未満なら出さない（zones の ETA_MIN_KMH） */
export function etaMs(nowMs: number, distanceKm: number, speedMps: number): number | null {
  const kmh = speedMps * 3.6
  if (kmh < ETA_MIN_KMH) return null
  return nowMs + (distanceKm / kmh) * 3600_000
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
