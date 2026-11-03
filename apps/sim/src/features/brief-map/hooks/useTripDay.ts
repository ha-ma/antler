import { TripDetailsSchema, TripPlanSchema } from '@antler/schema'
import { DayPlanSchema } from '@antler/trip'
import { useQuery } from '@tanstack/react-query'
import { logger } from '@/shared/utils/logger'
import type { TripDay } from '../types'

// GET /api/trips/:id/day/:n（docs/specs/brief-map/functional.md R5・R6、resilience.md）。
// 応答は形を確かめてから使う。再試行は 5xx と通信の失敗だけ 1 回（404・409・429・形の違いは再試行しない）。

const TIMEOUT_MS = 10_000

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

async function fetchTripDay(id: string, day: number, signal: AbortSignal): Promise<TripDay> {
  const url = `${apiBase()}/api/trips/${encodeURIComponent(id)}/day/${String(day)}`
  let res: Response
  try {
    // 日を切り替えたら前の要求を止める（TanStack Query の signal）。10 秒で時間切れ
    res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) })
  } catch {
    throw new TripDayError(null, null)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: { code?: unknown } }).error.code ?? '')
        : null
    logger.warn('brief.day.failed', { status: res.status, code })
    throw new TripDayError(res.status, code)
  }
  const b = (body ?? {}) as Record<string, unknown>
  const plan = TripPlanSchema.safeParse(b['plan'])
  const details = TripDetailsSchema.safeParse(b['details'])
  const dayPlan = DayPlanSchema.safeParse(b['day'])
  if (!plan.success || !details.success || !dayPlan.success) {
    const error = new TripDayError(null, 'INVALID_RESPONSE')
    logger.error('brief.day.invalid', error, { status: res.status })
    throw error
  }
  return { plan: plan.data, details: details.data, day: dayPlan.data }
}

export function useTripDay(id: string, day: number) {
  return useQuery({
    queryKey: ['trip-day', id, day],
    queryFn: ({ signal }) => fetchTripDay(id, day, signal),
    // 同じ旅・同じ日は同じ結果（シードで再現できる）なので、読み直さない
    staleTime: Infinity,
    // 通信の失敗（status も code も無い）と 5xx だけ。形の違う応答は再試行しても変わらない
    retry: (count, error) =>
      count < 1 &&
      error instanceof TripDayError &&
      ((error.status === null && error.code === null) || (error.status ?? 0) >= 500),
    retryDelay: 500,
  })
}
