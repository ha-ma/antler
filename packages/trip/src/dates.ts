import { IsoDateTime, toJst } from '@antler/schema'

// 時刻の共通部品。日付は JST の暦日で数える（functional.md R1）。

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
export const JST_MS = 9 * HOUR_MS

/** タイムゾーン付きの ISO 8601 として読めるか（読めない値で toJst が例外を投げないように先に確かめる）。 */
export function isIsoDateTime(value: string): boolean {
  return IsoDateTime.safeParse(value).success
}

/** JST の暦日の通し番号（1970-01-01 = 0）。 */
export function jstDayIndex(iso: string): number {
  return dayOf(Date.parse(toJst(iso)))
}

/** 瞬間（ms）の JST の暦日の通し番号。 */
export function dayOf(ms: number): number {
  return Math.floor((ms + JST_MS) / DAY_MS)
}

/** JST の暦日の、その時（0〜24）の瞬間（ms）。 */
export function atHour(dayIndex: number, hour: number): number {
  return dayIndex * DAY_MS - JST_MS + hour * HOUR_MS
}

/** 旅の日数（JST の暦日、両端を含む）。 */
export function tripDayCount(input: { depart: { at: string }; return: { at: string } }): number {
  return jstDayIndex(input.return.at) - jstDayIndex(input.depart.at) + 1
}
