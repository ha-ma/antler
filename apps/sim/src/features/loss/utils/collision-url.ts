import { IsoDateTime, Slug, toJst, type TripPlan } from '@antler/schema'
import type { DayPlan } from '@antler/trip'
import { LIGHT_PERIODS } from '@antler/zones'
import { z } from 'zod'
import type { CollisionReport } from '../types'

// A-6 の入口（functional.md R1）: 衝突の情報は URL のクエリだけに持つ。
// `/loss/:tripId?day&leg&at&speed&light&side&stops=a,b&t(&alert=off)`。alert は OFF のときだけ書く。

const MAX_SPEED_KMH = 199
const MAX_SIM_MS = 86_400_000
const MAX_STOPS = 10

const TripId = z.string().regex(/^[A-Za-z0-9]{4,16}$/)
/** 先頭の 0 や符号・小数を許さない 10 進の整数 */
const IntText = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})$/)
  .transform(Number)

const QuerySchema = z.strictObject({
  day: IntText.pipe(z.number().int().min(1)),
  leg: IntText.pipe(z.number().int().min(0)),
  at: IsoDateTime,
  speed: IntText.pipe(z.number().int().min(0).max(MAX_SPEED_KMH)),
  light: z.enum(LIGHT_PERIODS),
  side: z.enum(['L', 'R']),
  stops: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : []))
    .pipe(
      z
        .array(Slug)
        .max(MAX_STOPS)
        .refine((a) => new Set(a).size === a.length),
    ),
  t: IntText.pipe(z.number().int().min(0).max(MAX_SIM_MS)),
  alert: z.literal('off').optional(),
})

/** drive が衝突のあとに移る A-6 の URL */
export function lossHref(report: CollisionReport): string {
  const q = new URLSearchParams({
    day: String(report.day),
    leg: String(report.leg),
    at: report.at,
    speed: String(report.speedKmh),
    light: report.light,
    side: report.side,
    stops: report.achievedStops.join(','),
    t: String(report.simMs),
  })
  if (!report.alertEnabled) q.set('alert', 'off')
  return `/loss/${encodeURIComponent(report.tripId)}?${q.toString()}`
}

/** URL を CollisionReport に読む。欠け・範囲外・形の違い・知らない欄は null（画面は api を呼ばない） */
export function parseCollision(id: string, search: URLSearchParams): CollisionReport | null {
  if (!TripId.safeParse(id).success) return null
  const raw: Record<string, string> = {}
  for (const [key, value] of search) {
    // 同じ名前が 2 回あるのは形の違い
    if (key in raw) return null
    raw[key] = value
  }
  const parsed = QuerySchema.safeParse(raw)
  if (!parsed.success) return null
  const q = parsed.data
  return {
    tripId: id,
    day: q.day,
    leg: q.leg,
    at: q.at,
    speedKmh: q.speed,
    light: q.light,
    side: q.side,
    alertEnabled: q.alert === undefined,
    achievedStops: q.stops,
    simMs: q.t,
  }
}

/**
 * しおりを読んだあとの検証（R1 の最後。api の R7 と同じ規則）: 日が旅の中・移動がその日の数未満・
 * at の JST の暦日がその日・achievedStops がその日の楽しみで、拠点が legs[0..leg] の出発地のどれか。
 */
export function checkAgainstDay(
  plan: Pick<TripPlan, 'days'>,
  day: Pick<DayPlan, 'day' | 'date' | 'legs' | 'stops'>,
  c: Pick<CollisionReport, 'day' | 'leg' | 'at' | 'achievedStops'>,
): boolean {
  if (c.day < 1 || c.day > plan.days.length || day.day !== c.day) return false
  if (c.leg >= day.legs.length) return false
  if (toJst(c.at).slice(0, 10) !== day.date) return false
  const reached = new Set(day.legs.slice(0, c.leg + 1).map((l) => l.from))
  return c.achievedStops.every((id) => {
    const stop = day.stops.find((s) => s.id === id)
    return stop !== undefined && reached.has(stop.base)
  })
}
