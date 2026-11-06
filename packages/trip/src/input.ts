import { DeparturePlace, IsoDateTime, Lang, Slug } from '@antler/schema'
import { z } from 'zod'
import { isIsoDateTime, tripDayCount } from './dates'
import { travelFits } from './itinerary'
import { pleasureById } from './pleasures'
import type { TripInput } from './types'

// A-1 の入力（functional.md R1・R2）。画面の React Hook Form と api の HTTP の schema が同じものを使う。

export const MAX_PLEASURES = 10
export const MAX_TRIP_DAYS = 10
export const MAX_BUDGET_JPY = 1_000_000

export { jstDayIndex, tripDayCount } from './dates'

const Endpoint = z.strictObject({ at: IsoDateTime, place: DeparturePlace })

export const TripInputSchema = z
  .strictObject({
    lang: Lang,
    party: z.strictObject({
      size: z.number().int().min(1).max(8),
      drivers: z.number().int().min(1).max(8),
      experience: z.enum(['first', 'few', 'experienced']),
    }),
    depart: Endpoint,
    return: Endpoint,
    budgetPerPersonJPY: z.number().int().min(0).max(MAX_BUDGET_JPY),
    area: z.enum(['doto', 'doo']),
    // weight は古い画面との互換のためだけに受ける（使わない。plan-trip-photos）
    pleasures: z
      .array(z.strictObject({ id: Slug, weight: z.number().int().min(1).max(5).optional() }))
      .max(MAX_PLEASURES),
  })
  .superRefine((t, ctx) => {
    if (t.party.drivers > t.party.size) {
      ctx.addIssue({
        code: 'custom',
        path: ['party', 'drivers'],
        message: '運転できる人は人数以下',
      })
    }
    // 日時が読めないときは形の検証が 400 にする。ここで toJst に渡して例外にしない
    const datesReadable = isIsoDateTime(t.depart.at) && isIsoDateTime(t.return.at)
    if (!datesReadable) return
    if (Date.parse(t.return.at) <= Date.parse(t.depart.at)) {
      ctx.addIssue({ code: 'custom', path: ['return', 'at'], message: '返却は出発より後' })
    } else if (tripDayCount(t) > MAX_TRIP_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['return', 'at'],
        message: `旅は ${String(MAX_TRIP_DAYS)} 日まで`,
      })
    } else if (!travelFits(t)) {
      ctx.addIssue({
        code: 'custom',
        path: ['return', 'at'],
        message: '返却の 1 時間前までに返却地へ着けない',
      })
    }
    const ids = t.pleasures.map((p) => p.id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['pleasures'], message: '同じ楽しみを 2 回選べない' })
    }
    t.pleasures.forEach((p, i) => {
      if (pleasureById(p.id)?.area !== t.area) {
        ctx.addIssue({
          code: 'custom',
          path: ['pleasures', i, 'id'],
          message: 'このエリアの楽しみではない',
        })
      }
    })
  }) satisfies z.ZodType<TripInput>

/** ペルソナ（付録 A #4）: 台湾から初めての北海道、4 人、2 月、流氷、レンタカー。A-1 の初期値。 */
export const PERSONA_INPUT: TripInput = {
  lang: 'zh',
  party: { size: 4, drivers: 2, experience: 'first' },
  depart: { at: '2027-02-14T10:00:00+09:00', place: 'CTS' },
  return: { at: '2027-02-18T17:00:00+09:00', place: 'CTS' },
  budgetPerPersonJPY: 120_000,
  area: 'doto',
  // 夜のアイヌコタンは plan-trip-photos で足した（重さを外すと D1 の薄暮の移動が減り、リスクが 0.59「注意」に
  // 下がったため。流氷が目的のまま、デザインの「高い」を保つ。推奨で決定）
  pleasures: [{ id: 'drift-ice-walk' }, { id: 'red-crowned-crane' }, { id: 'akan-ainu-kotan' }],
}
