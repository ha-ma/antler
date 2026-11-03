import { tripDayCount } from './input'
import { pleasureById } from './pleasures'
import type { Itinerary, Localized, TripInput } from './types'

// 入力中のしおりの 1 行タイトル（functional.md R3）。決まった形で 4 言語。決定後は Claude の文に置き換わる。

const AREA_NAME: Record<TripInput['area'], Localized> = {
  doto: { ja: '道東', en: 'Eastern Hokkaido', zh: '道東', ko: '도동' },
  doo: { ja: '道央', en: 'Central Hokkaido', zh: '道央', ko: '도오' },
}

export function draftTitles(input: TripInput, itinerary: Itinerary): Localized {
  const days = String(tripDayCount(input))
  const area = AREA_NAME[input.area]
  // 重さの大きい順に 2 つまで（入りきらなかったものは除く）
  const top = [...input.pleasures]
    .filter((p) => !itinerary.skipped.includes(p.id))
    .sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 2)
    .flatMap((p) => pleasureById(p.id)?.name ?? [])
  if (top.length === 0) {
    return {
      ja: `${area.ja} ${days} 日間のドライブ`,
      en: `${days}-day drive in ${area.en}`,
      zh: `${area.zh} ${days} 天自駕`,
      ko: `${area.ko} ${days}일 드라이브`,
    }
  }
  return {
    ja: `${area.ja} ${days} 日間・${top.map((n) => n.ja).join('と')}`,
    en: `${days} days in ${area.en}: ${top.map((n) => n.en).join(' & ')}`,
    zh: `${area.zh} ${days} 天・${top.map((n) => n.zh).join('與')}`,
    ko: `${area.ko} ${days}일・${top.map((n) => n.ko).join('와 ')}`,
  }
}
