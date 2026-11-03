import type { Lang } from '@antler/schema'
import { placeById, pleasureById } from '@antler/trip'
import { BRIEF_TEXT, fillText } from '../text'

// 表示の整形（時刻は JST の分まで、切り捨て。functional.md R2・R3）。

const JST_MS = 9 * 60 * 60 * 1000

function jst(iso: string): string {
  return new Date(Date.parse(iso) + JST_MS).toISOString()
}

/** H:mm（0 時台は 0:30。時は先頭の 0 を落とす） */
export function clockOf(iso: string): string {
  const t = jst(iso)
  return `${String(Number(t.slice(11, 13)))}:${t.slice(14, 16)}`
}

/** その日（date、JST の YYYY-MM-DD）と違う日付なら「翌」を付ける */
export function timeLabel(iso: string, date: string, lang: Lang): string {
  const clock = clockOf(iso)
  return jst(iso).slice(0, 10) === date
    ? clock
    : fillText(BRIEF_TEXT.nextDayTime[lang], { time: clock })
}

export function placeName(id: string, lang: Lang): string {
  return placeById(id)?.name[lang] ?? id
}

export function pleasureName(id: string, lang: Lang): string {
  return pleasureById(id)?.name[lang] ?? id
}

/** 名札（13 px の文字）の幅の目安 px。全角は 13 px、半角は 7.5 px と見て左右に 12 px の余白 */
export function tagWidth(text: string): number {
  let width = 24
  for (const ch of text) width += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? 13 : 7.5
  return Math.ceil(width)
}

/** 小数 1 桁の km（10 km 以上は整数） */
export function kmLabel(km: number): string {
  return km >= 10 ? String(Math.round(km)) : km.toFixed(1)
}
