import { PLEASURES, pleasureById, type Pleasure } from '@antler/trip'
import type { DriveScenario } from '../types'

// 運転中の観光の話題（docs/specs/drive-tourism/functional.md T9・T12・T13）。純粋関数。
// 見本の会話とゾーンの前のおすすめのカードが同じ楽しみの選び方を使う。

type TourismScene = Pick<DriveScenario, 'stops' | 'to' | 'startAt'>

/** その日の楽しみ（しおりで確定した立ち寄り。利用者が選んだので季節では絞らない） */
export function todayPleasures(scenario: Pick<DriveScenario, 'stops'>): Pleasure[] {
  return scenario.stops.flatMap((id) => {
    const p = pleasureById(id)
    return p ? [p] : []
  })
}

/**
 * 到着地を拠点とする楽しみ（マスターの順）。旅の月が months に入るもの（空は通年）だけ（spec-adversary M3）。
 * その日の楽しみは除く
 */
export function nearbyPleasures(scenario: TourismScene): Pleasure[] {
  const month = Number(scenario.startAt.slice(5, 7))
  return PLEASURES.filter(
    (p) =>
      p.base === scenario.to &&
      !scenario.stops.includes(p.id) &&
      (p.months.length === 0 || p.months.includes(month)),
  )
}

/**
 * 見本の会話の楽しみ（T9）: その日の楽しみ、無ければ到着地の楽しみ。
 * 見本の場面（2 月の釧路 → 阿寒湖）は阿寒湖の楽しみになる
 */
export function tourismPleasures(scenario: TourismScene): Pleasure[] {
  const today = todayPleasures(scenario)
  return today.length > 0 ? today : nearbyPleasures(scenario)
}

/** 鹿の語（鹿を見つけた・いると読める文は赤の警告の役割。偽警報に見える文を出さない。T13） */
const DEER_WORD = /鹿|シカ|deer|사슴/iu

export function hasDeerWord(text: string): boolean {
  return DEER_WORD.test(text.normalize('NFKC'))
}
