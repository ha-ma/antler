import type { Lang } from '@antler/schema'
import { placeById, DEPARTURE_PLACE_ID } from '../places'
import { pleasureById } from '../pleasures'
import type { DeerPattern } from './run'
import { recordText, type RecordTextKey } from './text'

// A-7 の書式（docs/specs/record/functional.md R5〜R7）。日付・時刻は端末・サーバーの TZ に依らず Asia/Tokyo で書く。

const TOKYO = 'Asia/Tokyo'

function tokyoParts(iso: string): { y: string; m: string; d: string; hh: string; mm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') }
}

/** 出発 – 返却（例 `2027.02.14 – 02.18`。年をまたげば両方に年） */
export function formatDateRange(departAt: string, returnAt: string): string {
  const a = tokyoParts(departAt)
  const b = tokyoParts(returnAt)
  const end = a.y === b.y ? `${b.m}.${b.d}` : `${b.y}.${b.m}.${b.d}`
  return `${a.y}.${a.m}.${a.d} – ${end}`
}

/** ゲーム内の時刻（HH:MM、日本時間） */
export function formatClock(iso: string): string {
  const p = tokyoParts(iso)
  return `${p.hh}:${p.mm}`
}

/** ms → 秒（小数 1 桁） */
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/** 地点の名前（出発・返却の玄関口の記号も読む）。知らない id はそのまま */
export function placeName(idOrGateway: string, lang: Lang): string {
  const id = DEPARTURE_PLACE_ID[idOrGateway as keyof typeof DEPARTURE_PLACE_ID] ?? idOrGateway
  return placeById(id)?.name[lang] ?? idOrGateway
}

/** 楽しみの名前と補足。知らない id は id をそのまま */
export function pleasureLabel(id: string, lang: Lang): { name: string; note: string } {
  const p = pleasureById(id)
  return p ? { name: p.name[lang], note: p.note[lang] } : { name: id, note: '' }
}

const PATTERN_KEY: Record<DeerPattern, RecordTextKey> = {
  roadside: 'patternRoadside',
  eyeshine: 'patternEyeshine',
  crossing: 'patternCrossing',
  herd: 'patternHerd',
  frozen: 'patternFrozen',
}

export function patternLabel(pattern: DeerPattern, lang: Lang): string {
  return recordText(PATTERN_KEY[pattern], lang)
}
