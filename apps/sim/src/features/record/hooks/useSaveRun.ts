import { DriveRunInputSchema, type DriveRunInput } from '@antler/trip'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ownerTokenOf } from '@/features/plan-trip'
import { logger } from '@/shared/utils/logger'
import { RecordApiError, type SaveRunOutcome } from '../types'
import { apiBase, errorCode } from '../utils/links'
import { recordQueryKey } from './useTripRecord'

// 走行の記録を残す（docs/specs/record/functional.md R2・R11、resilience.md）。drive・loss が運転の終わりに呼ぶ。
// この端末に所有者トークンがあれば Bearer 付きで POST、無ければ送らずに not-owner を返す
// （呼び出し側は /t/:id へ移らず、その運転の結果をその場で見せる）。
// 再試行しない（呼び出し側の「もう一度」。同じ runId で送り直せば api は 1 件として扱う）。

const TIMEOUT_MS = 10_000

export type SaveRunVariables = { tripId: string; run: DriveRunInput }

export async function saveRun({ tripId, run }: SaveRunVariables): Promise<SaveRunOutcome> {
  const token = ownerTokenOf(tripId)
  if (!token) return { status: 'not-owner', tripId }
  const body = DriveRunInputSchema.parse(run)
  let res: Response
  try {
    res = await fetch(`${apiBase()}/api/trips/${encodeURIComponent(tripId)}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new RecordApiError(null, null)
  }
  if (!res.ok) {
    const code = errorCode(await res.json().catch(() => null))
    throw new RecordApiError(res.status, code)
  }
  return { status: res.status === 200 ? 'replayed' : 'saved', tripId }
}

export function useSaveRun() {
  const queryClient = useQueryClient()
  return useMutation<SaveRunOutcome, Error, SaveRunVariables>({
    mutationFn: saveRun,
    onSuccess: ({ tripId }) => {
      void queryClient.invalidateQueries({ queryKey: recordQueryKey(tripId) })
    },
    onError: (error) => {
      // トークン・run の中身は記録しない
      logger.warn('record.save.failed', {
        status: error instanceof RecordApiError ? error.status : null,
      })
    },
  })
}
