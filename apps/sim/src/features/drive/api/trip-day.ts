import { TripDetailsSchema, TripPlanSchema, type TripPlan } from '@antler/schema'
import { DayPlanSchema, type DayPlan } from '@antler/trip'
import { logger } from '@/shared/utils/logger'
import { ZONES } from '../domain/zones-data'

// GET /api/trips/:id/day/:n（drive-link R2・R5。docs/specs/brief-map/functional.md R5）。
// brief-map の useTripDay と同じ決まり（形を確かめてから使う、10 秒で時間切れ）。feature をまたいで import しないので drive にも持つ。

const TIMEOUT_MS = 10_000

/** 旅の id の形（英数 4〜16 文字。brief-map の API と同じ。違えば読みに行かない） */
export const TRIP_ID = /^[A-Za-z0-9]{4,16}$/

export type TripDayResponse = { plan: TripPlan; day: DayPlan }

/** 読み込みの失敗。status は HTTP のステータス（通信の失敗・形の違いは null）、code は api のエラーコード */
export class TripDayError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(`trip day failed: ${String(status)} ${String(code)}`)
    this.name = 'TripDayError'
  }
}

function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined
  return (base ?? '').replace(/\/+$/, '')
}

export async function fetchTripDay(
  id: string,
  day: number,
  signal: AbortSignal,
): Promise<TripDayResponse> {
  const url = `${apiBase()}/api/trips/${encodeURIComponent(id)}/day/${String(day)}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) })
  } catch {
    throw new TripDayError(null, null)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    // 本文の形は信じない（{ error: null } や JSON でない本文でも TripDayError にする）
    const error =
      typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
    const raw =
      typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null
    const code = typeof raw === 'string' ? raw : null
    logger.warn('drive.day.failed', { status: res.status, code })
    throw new TripDayError(res.status, code)
  }
  const b = (body ?? {}) as Record<string, unknown>
  const plan = TripPlanSchema.safeParse(b['plan'])
  const details = TripDetailsSchema.safeParse(b['details'])
  const dayPlan = DayPlanSchema.safeParse(b['day'])
  if (!plan.success || !details.success || !dayPlan.success) {
    const error = new TripDayError(null, 'INVALID_RESPONSE')
    logger.error('drive.day.invalid', error, { status: res.status })
    throw error
  }
  // api と sim のゾーン DB が違う（デプロイがずれた）ときは、警告だけ残して同梱のもので走る（R5・UC-4e）
  if (dayPlan.data.data.zones !== ZONES.hash) {
    logger.warn('drive.zones.mismatch', { api: dayPlan.data.data.zones, bundled: ZONES.hash })
  }
  return { plan: plan.data, day: dayPlan.data }
}

/** 再試行は通信の失敗（status も code も無い）と 5xx だけ 1 回。形の違う応答・4xx は読み直しても変わらない */
export function shouldRetryTripDay(count: number, error: unknown): boolean {
  return (
    count < 1 &&
    error instanceof TripDayError &&
    ((error.status === null && error.code === null) || (error.status ?? 0) >= 500)
  )
}
