import { IsoDateTime, Slug, toJst, type TripPlan } from '@antler/schema'
import type { DayPlan } from '@antler/trip'
import { LIGHT_PERIODS } from '@antler/zones'
import { z } from 'zod'
import type { DriveResult } from '@/features/drive'
import type { CollisionReport, ResolvedCollision } from '../types'

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
  // speed・light・side・t・stops は任意（DriveResult に無いものは書かない。欄が無ければ null）
  speed: IntText.pipe(z.number().int().min(0).max(MAX_SPEED_KMH)).optional(),
  light: z.enum(LIGHT_PERIODS).optional(),
  side: z.enum(['L', 'R']).optional(),
  // 欄が無い → null（予定どおり）、`stops=`（空）→ []（何も済ませていない）
  stops: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? null : s === '' ? [] : s.split(',')))
    .pipe(
      z
        .array(Slug)
        .max(MAX_STOPS)
        .refine((a) => new Set(a).size === a.length)
        .nullable(),
    ),
  t: IntText.pipe(z.number().int().min(0).max(MAX_SIM_MS)).optional(),
  alert: z.literal('off').optional(),
})

/** 整数に丸めて範囲に収める（drive は実数の速さ・経過を渡してよい。R1） */
function clampInt(value: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(value)))
}

/** drive が衝突のあとに移る A-6 の URL。速さは 0〜199、経過は 0〜MAX_SIM_MS の整数に丸める。null の欄は書かない */
export function lossHref(report: CollisionReport): string {
  const q = new URLSearchParams({
    day: String(report.day),
    leg: String(report.leg),
    at: report.at,
  })
  if (report.speedKmh !== null) q.set('speed', String(clampInt(report.speedKmh, MAX_SPEED_KMH)))
  if (report.light !== null) q.set('light', report.light)
  if (report.side !== null) q.set('side', report.side)
  if (report.achievedStops !== null) q.set('stops', report.achievedStops.join(','))
  if (report.simMs !== null) q.set('t', String(clampInt(report.simMs, MAX_SIM_MS)))
  if (!report.alertEnabled) q.set('alert', 'off')
  return `/loss/${encodeURIComponent(report.tripId)}?${q.toString()}`
}

/**
 * drive-link の走行の結果（DriveResult）から A-6 の入口を作る。衝突で、旅から作った場面のときだけ（見本の場面・完走は null）。
 * DriveResult に無い速さ・光・側・経過は null、済ませた楽しみは null（予定どおり）。
 */
export function lossReportFromDrive(result: DriveResult): CollisionReport | null {
  if (result.outcome !== 'collided' || result.source !== 'trip') return null
  return {
    tripId: result.tripId,
    day: result.day,
    leg: result.legIndex,
    at: result.endedAt,
    speedKmh: null,
    light: null,
    side: null,
    alertEnabled: result.alertEnabled,
    achievedStops: null,
    simMs: null,
  }
}

/** 衝突した移動までに出発した町（legs[0..leg].from）の楽しみ。R7 で済ませられる楽しみの全部 */
function reachableStops(day: Pick<DayPlan, 'legs' | 'stops'>, leg: number): string[] {
  const departed = new Set(day.legs.slice(0, leg + 1).map((l) => l.from))
  return day.stops.filter((s) => departed.has(s.base)).map((s) => s.id)
}

/** achievedStops が null（予定どおり）なら、しおりから済んだ楽しみを決める */
export function resolveCollision(
  c: CollisionReport,
  day: Pick<DayPlan, 'legs' | 'stops'>,
): ResolvedCollision {
  return { ...c, achievedStops: c.achievedStops ?? reachableStops(day, c.leg) }
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
    speedKmh: q.speed ?? null,
    light: q.light ?? null,
    side: q.side ?? null,
    alertEnabled: q.alert === undefined,
    achievedStops: q.stops,
    simMs: q.t ?? null,
  }
}

/**
 * しおりを読んだあとの検証（R1 の最後。api の R7 と同じ規則）: 日が旅の中・移動がその日の数未満・
 * at の JST の暦日がその日・achievedStops がその日の楽しみで、拠点が legs[0..leg] の出発地のどれか。
 */
export function checkAgainstDay(
  plan: Pick<TripPlan, 'days'>,
  day: Pick<DayPlan, 'day' | 'date' | 'legs' | 'stops'>,
  c: Pick<ResolvedCollision, 'day' | 'leg' | 'at' | 'achievedStops'>,
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
