import { z } from 'zod'
import { IsoDateTime, Lang, Slug } from './common'

// TripPlan — A-1 で生成され、記録に残る「旅のしおり」（ch7、A1-1〜A1-5）。
// 「運転できる人は人数以下」「楽しみの重複なし」は JSON Schema では表せないので refine で確かめる
// （edge はこの型を使わない。api と sim が TS で検証する）。

export const DeparturePlace = z.enum(['CTS', 'KUH', 'SAPPORO', 'AKJ', 'HKD'])

const Endpoint = z.strictObject({ at: IsoDateTime, place: DeparturePlace })

export const TripPlanSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9]{4,16}$/),
    lang: Lang,
    /** 同じシードで同じ旅程・条件・出来事を再生する（A6-4） */
    seed: z.number().int().min(0),
    party: z.strictObject({
      size: z.number().int().min(1).max(8),
      drivers: z.number().int().min(1).max(8),
      experience: z.enum(['first', 'few', 'experienced']),
    }),
    depart: Endpoint,
    return: Endpoint,
    budgetPerPersonJPY: z.number().int().min(0),
    area: z.enum(['doto', 'doo']),
    pleasures: z
      .array(z.strictObject({ id: Slug, weight: z.number().int().min(1).max(5) }))
      .max(10),
    title: z.string().min(1).max(200),
    days: z
      .array(
        z.strictObject({
          day: z.number().int().min(1),
          from: Slug,
          to: Slug,
          stops: z.array(Slug),
          stay: Slug.nullable(),
        }),
      )
      .min(1),
    riskScore: z.number().min(0).max(1),
    alertEnabled: z.boolean(),
  })
  .refine((t) => t.party.drivers <= t.party.size, {
    message: '運転できる人は人数以下',
    path: ['party', 'drivers'],
  })
  .refine((t) => new Set(t.pleasures.map((p) => p.id)).size === t.pleasures.length, {
    message: '同じ楽しみを 2 回選べない',
    path: ['pleasures'],
  })
export type TripPlan = z.infer<typeof TripPlanSchema>
