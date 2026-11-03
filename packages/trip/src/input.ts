import { DeparturePlace, IsoDateTime, Lang, Slug, toJst } from '@antler/schema'
import { z } from 'zod'
import { pleasureById } from './pleasures'
import type { TripInput } from './types'

// A-1 の入力（functional.md R1・R2）。画面の React Hook Form と api の HTTP の schema が同じものを使う。

export const MAX_PLEASURES = 10
export const MAX_TRIP_DAYS = 10
export const MAX_BUDGET_JPY = 1_000_000

const DAY_MS = 86_400_000

/** JST の暦日の通し番号（1970-01-01 = 0）。 */
export function jstDayIndex(iso: string): number {
  return Math.floor(Date.parse(toJst(iso)) / DAY_MS + 9 / 24)
}

/** 旅の日数（JST の暦日、両端を含む）。 */
export function tripDayCount(input: Pick<TripInput, 'depart' | 'return'>): number {
  return jstDayIndex(input.return.at) - jstDayIndex(input.depart.at) + 1
}

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
    pleasures: z
      .array(z.strictObject({ id: Slug, weight: z.number().int().min(1).max(5) }))
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
    if (Date.parse(t.return.at) <= Date.parse(t.depart.at)) {
      ctx.addIssue({ code: 'custom', path: ['return', 'at'], message: '返却は出発より後' })
    } else if (tripDayCount(t) > MAX_TRIP_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['return', 'at'],
        message: `旅は ${String(MAX_TRIP_DAYS)} 日まで`,
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
  pleasures: [
    { id: 'drift-ice-walk', weight: 5 },
    { id: 'red-crowned-crane', weight: 4 },
  ],
}
