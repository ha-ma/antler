import type { Lang } from '@antler/schema'
import { fillText, STOP_TEXT } from '../text'
import type { Light } from '../types'

// A-4 の数字の表示（docs/specs/stop-events/functional.md R4・R11・UI-4b）。時刻は +09:00 の ISO（分まで）。

/** 画面の光の言い方の種類（night は束の日付の午前なら夜明け前、それ以外は日没後） */
export type LightWord = 'day' | 'dusk' | 'dawn' | 'afterSunset' | 'beforeDawn'

/** 'YYYY-MM-DDTHH:mm+09:00' の時刻（HH:mm） */
export function hhmm(iso: string): string {
  return iso.slice(11, 16)
}

/** 時刻の日付が束の日付より後か（「翌」を付ける） */
export function isAfterDate(iso: string, date: string): boolean {
  return iso.slice(0, 10) > date
}

export function lightWord(light: Light, iso: string, date: string): LightWord {
  if (light !== 'night') return light
  const morning = !isAfterDate(iso, date) && Number(iso.slice(11, 13)) < 12
  return morning ? 'beforeDawn' : 'afterSunset'
}

/** 画面に出す時刻（束の日付より後なら「翌」を付ける） */
export function timeOfDay(iso: string, date: string, lang: Lang): string {
  return isAfterDate(iso, date) ? fillText(STOP_TEXT.nextDay[lang], { time: hhmm(iso) }) : hhmm(iso)
}

/** HTML の lang 属性（zh は繁体字） */
export function htmlLang(lang: Lang): string {
  return lang === 'zh' ? 'zh-Hant' : lang
}

/** ¥ と 3 桁区切り（¥61,400） */
export function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString('en-US')}`
}
