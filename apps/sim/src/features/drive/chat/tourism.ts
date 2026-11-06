import { PLEASURES, placeById, pleasureById, type Pleasure } from '@antler/trip'
import { metersBetween } from '@antler/zones'
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

/** 拠点がどの区切りからもこれより遠ければ、終点に置く（T12） */
export const STOP_MATCH_M = 15_000

/**
 * その日の楽しみの道のり（m。drive-tourism T12、drive-sound-tourism S14）。拠点の地点にいちばん近い移動の区切り
 * （始点・各移動の始まり・終点）。どの区切りからも 15 km より遠い拠点は終点（その日の最後まで「先」）。
 * おすすめのカードと会話の補いの行が同じ位置を使う（通り過ぎた楽しみを出さない）
 */
export function stopPositionsM(
  scenario: Pick<DriveScenario, 'stops' | 'route' | 'legStarts'>,
  totalM: number,
): { pleasure: Pleasure; atM: number }[] {
  const { route } = scenario
  const cuts = [0, ...scenario.legStarts.map((l) => l.sM), totalM]
  const pointAt = (m: number) => {
    const i = totalM > 0 ? Math.round((m / totalM) * (route.length - 1)) : 0
    return route[Math.min(route.length - 1, Math.max(0, i))]
  }
  return todayPleasures(scenario).map((pleasure) => {
    const place = placeById(pleasure.base)
    let best = { atM: totalM, d: Infinity }
    if (place) {
      for (const m of cuts) {
        const p = pointAt(m)
        if (!p) continue
        const d = metersBetween(p, [place.lon, place.lat])
        if (d < best.d) best = { atM: m, d }
      }
    }
    return { pleasure, atM: best.d <= STOP_MATCH_M ? best.atM : totalM }
  })
}

/**
 * 会話の補いの行の楽しみと、その位置（S14）。tourismPleasures と同じ選び方（その日の楽しみ、無ければ到着地の楽しみ）。
 * 到着地の楽しみは終点（その日の最後まで「先」）
 */
export function tourismStops(
  scenario: Pick<DriveScenario, 'stops' | 'route' | 'legStarts' | 'to' | 'startAt'>,
  totalM: number,
): { pleasure: Pleasure; atM: number }[] {
  const today = stopPositionsM(scenario, totalM)
  if (today.length > 0) return today
  return nearbyPleasures(scenario).map((pleasure) => ({ pleasure, atM: totalM }))
}

/** 鹿の語（鹿を見つけた・いると読める文は赤の警告の役割。偽警報に見える文を出さない。T13） */
const DEER_WORD = /鹿|シカ|deer|사슴/iu

export function hasDeerWord(text: string): boolean {
  return DEER_WORD.test(text.normalize('NFKC'))
}
