import { z } from 'zod'
import { IsoDateTime, Slug } from './common'

// TripDetails — TripPlan に添える Claude の文と、しおりの組み立ての結果（docs/specs/plan-trip/functional.md R5）。
// TripPlan（凍結済み）は変えずに、この型を追加した（2026-11-03、推奨で決定）。作成時に TripPlan と一緒に保存し、
// 読むときに Claude を呼び直さない（シード再生で文が変わらないように）。

/** 4 言語の文。どれも空でない（付録 A #9「4 言語が欠けない」）。 */
export const LocalizedText = z.strictObject({
  ja: z.string().min(1).max(400),
  en: z.string().min(1).max(400),
  zh: z.string().min(1).max(400),
  ko: z.string().min(1).max(400),
})
export type LocalizedText = z.infer<typeof LocalizedText>

const TripId = z.string().regex(/^[A-Za-z0-9]{4,16}$/)

export const TripDetailsSchema = z.strictObject({
  tripId: TripId,
  /** しおりのタイトル（4 言語）。TripPlan.title は titles[plan.lang] */
  titles: LocalizedText,
  /** 各日の 1 行説明。days と同じ数・同じ順 */
  dayNotes: z.array(z.strictObject({ day: z.number().int().min(1), note: LocalizedText })).min(1),
  /** 入りきらなかった楽しみの id */
  skipped: z.array(Slug),
  createdAt: IsoDateTime,
})
export type TripDetails = z.infer<typeof TripDetailsSchema>
