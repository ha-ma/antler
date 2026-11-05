import { TripDetailsSchema, TripPlanSchema } from '@antler/schema'
import { DayPlanSchema } from '@antler/trip'
import { useQuery } from '@tanstack/react-query'
import { logger } from '@/shared/utils/logger'
import type { TripDay } from '../types'
import { apiBase, errorCode } from './api'

// 衝突した日のしおり（GET /api/trips/:id/day/:n。brief-map の既存 API）。functional.md R5 の 3 つ目の小項目。
// brief-map は useTripDay を公開していないので、同じ扱いの小さな hook を loss に置く（queryKey は別）。
// 再試行は 5xx と通信の失敗だけ 1 回（404・409・429・形の違いは再試行しない）。

const TIMEOUT_MS = 10_000

/** 読み込みの失敗。status は HTTP のステータス（通信の失敗・形の違いは null）、code は api のエラーコード */
export class LossTripDayError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(`loss trip day failed: ${String(status)} ${String(code)}`)
    this.name = 'LossTripDayError'
  }
}

async function fetchTripDay(id: string, day: number, signal: AbortSignal): Promise<TripDay> {
  const url = `${apiBase()}/api/trips/${encodeURIComponent(id)}/day/${String(day)}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) })
  } catch {
    throw new LossTripDayError(null, null)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code = errorCode(body)
    logger.warn('loss.day.failed', { status: res.status, code })
    throw new LossTripDayError(res.status, code)
  }
  const b = (body ?? {}) as Record<string, unknown>
  const plan = TripPlanSchema.safeParse(b['plan'])
  const details = TripDetailsSchema.safeParse(b['details'])
  const dayPlan = DayPlanSchema.safeParse(b['day'])
  if (!plan.success || !details.success || !dayPlan.success) {
    const error = new LossTripDayError(null, 'INVALID_RESPONSE')
    logger.error('loss.day.invalid', error, { status: res.status })
    throw error
  }
  return { plan: plan.data, details: details.data, day: dayPlan.data }
}

/** enabled が false（URL が読めない）のあいだは fetch しない（UC-1b） */
export function useLossTripDay(id: string, day: number, enabled: boolean) {
  return useQuery({
    queryKey: ['loss-trip-day', id, day],
    queryFn: ({ signal }) => fetchTripDay(id, day, signal),
    enabled,
    staleTime: Infinity,
    retry: (count, error) =>
      count < 1 &&
      error instanceof LossTripDayError &&
      ((error.status === null && error.code === null) || (error.status ?? 0) >= 500),
    retryDelay: 500,
  })
}
