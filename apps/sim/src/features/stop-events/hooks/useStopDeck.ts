import { useQuery } from '@tanstack/react-query'
import { ownerTokenOf } from '@/features/plan-trip'
import { logger } from '@/shared/utils/logger'
import type { StopDeckResponse } from '../types'
import { apiBase, errorCode, OWNER_TOKEN_HEADER } from '../utils/api'
import { parseStopDeckResponse } from '../utils/parse-deck'

// その日の束（POST /api/trips/:id/day/:n/stop-deck。docs/specs/stop-events/functional.md R2・R9・R12、resilience.md）。
// - 旅を作った端末だけが ownerToken を持つ。無ければ取りに行かない（A-4 を出さない。エラーにしない）
// - 旅と日で決まり、2 回目からは保存済みが返るので読み直さない（staleTime: Infinity）
// - 409 IN_PROGRESS（別のタブが作っている）は 5 秒あけて 12 回まで待ち直す。5xx・通信の失敗は 1 回だけ

/** 生成（Claude を含む）は最悪 45 秒 × 2 回 */
const TIMEOUT_MS = 100_000
const IN_PROGRESS_RETRIES = 12
const IN_PROGRESS_DELAY_MS = 5_000

export class StopDeckError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(`stop deck failed: ${String(status)} ${String(code)}`)
    this.name = 'StopDeckError'
  }
}

export async function fetchStopDeck(
  tripId: string,
  day: number,
  ownerToken: string,
  signal: AbortSignal,
): Promise<StopDeckResponse> {
  const url = `${apiBase()}/api/trips/${encodeURIComponent(tripId)}/day/${String(day)}/stop-deck`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { [OWNER_TOKEN_HEADER]: ownerToken },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
  } catch {
    throw new StopDeckError(null, null)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code = errorCode(body)
    logger.warn('stop-events.deck.failed', { status: res.status, code })
    throw new StopDeckError(res.status, code)
  }
  const parsed = parseStopDeckResponse(body)
  if (!parsed) {
    const error = new StopDeckError(null, 'INVALID_RESPONSE')
    logger.error('stop-events.deck.invalid', error, { status: res.status })
    throw error
  }
  return parsed
}

function shouldRetry(count: number, error: unknown): boolean {
  if (!(error instanceof StopDeckError)) return false
  if (error.status === 409 && error.code === 'IN_PROGRESS') return count < IN_PROGRESS_RETRIES
  const transient = (error.status === null && error.code === null) || (error.status ?? 0) >= 500
  return transient && count < 1
}

export function useStopDeck(tripId: string, day: number) {
  const ownerToken = ownerTokenOf(tripId)
  const query = useQuery({
    queryKey: ['stop-deck', tripId, day],
    queryFn: ({ signal }) => fetchStopDeck(tripId, day, ownerToken ?? '', signal),
    enabled: ownerToken !== null && Number.isInteger(day) && day >= 1,
    staleTime: Infinity,
    retry: shouldRetry,
    retryDelay: (_count, error) =>
      error instanceof StopDeckError && error.status === 409 ? IN_PROGRESS_DELAY_MS : 500,
  })
  return { ...query, hasOwner: ownerToken !== null }
}
