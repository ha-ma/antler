import { IsoDateTime, Lang, Slug, type TripPlan } from '@antler/schema'
import { z } from 'zod'

// 記録に見せる旅の欄（docs/specs/record/functional.md R4）。記録の URL は SNS で広く共有されるので、
// 画面（A-7・SSR・OG）に出す欄だけを返す。予算・seed・リスク・楽しみの重さ・TripDetails は含めない。

const Endpoint = z.strictObject({ at: IsoDateTime, place: z.string().min(1) })

export const RecordTripSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9]{4,16}$/),
  lang: Lang,
  title: z.string().min(1).max(200),
  depart: Endpoint,
  return: Endpoint,
  partySize: z.number().int().min(1),
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
})
export type RecordTrip = z.infer<typeof RecordTripSchema>

export function recordTripOf(plan: TripPlan): RecordTrip {
  return {
    id: plan.id,
    lang: plan.lang,
    title: plan.title,
    depart: { at: plan.depart.at, place: plan.depart.place },
    return: { at: plan.return.at, place: plan.return.place },
    partySize: plan.party.size,
    days: plan.days.map((d) => ({
      day: d.day,
      from: d.from,
      to: d.to,
      stops: [...d.stops],
      stay: d.stay,
    })),
  }
}
