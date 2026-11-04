import { RecordTripSchema, TripRecordSchema } from '@antler/trip'
import { useQuery } from '@tanstack/react-query'
import { logger } from '@/shared/utils/logger'
import { RecordApiError, type RecordData } from '../types'
import { apiBase, errorCode } from '../utils/links'

// GET /api/trips/:id/record（docs/specs/record/functional.md R4・R5、resilience.md）。
// 応答は形を確かめてから使う。再試行は 5xx と通信の失敗だけ 1 回（404・429・形の違いは再試行しない）。

const TIMEOUT_MS = 10_000

async function fetchRecord(id: string, signal: AbortSignal): Promise<RecordData> {
  let res: Response
  try {
    res = await fetch(`${apiBase()}/api/trips/${encodeURIComponent(id)}/record`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
  } catch {
    throw new RecordApiError(null, null)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code = errorCode(body)
    logger.warn('record.load.failed', { status: res.status, code })
    throw new RecordApiError(res.status, code)
  }
  const b = (body ?? {}) as Record<string, unknown>
  const trip = RecordTripSchema.safeParse(b['trip'])
  const record = TripRecordSchema.safeParse(b['record'])
  if (!trip.success || !record.success) {
    const error = new RecordApiError(null, 'INVALID_RESPONSE')
    logger.error('record.load.invalid', error, { status: res.status })
    throw error
  }
  return { trip: trip.data, record: record.data }
}

export function recordQueryKey(id: string) {
  return ['trip-record', id] as const
}

export function useTripRecord(id: string) {
  return useQuery({
    queryKey: recordQueryKey(id),
    queryFn: ({ signal }) => fetchRecord(id, signal),
    retry: (count, error) =>
      count < 1 &&
      error instanceof RecordApiError &&
      ((error.status === null && error.code === null) || (error.status ?? 0) >= 500),
    retryDelay: 500,
  })
}
