import { useMutation } from '@tanstack/react-query'
import { forgetOwnerToken, ownerTokenOf } from '@/features/plan-trip'
import { logger } from '@/shared/utils/logger'
import { RecordApiError } from '../types'
import { apiBase, errorCode, recordImageUrl } from '../utils/links'

// A-7 の操作（docs/specs/record/functional.md R6・R10、resilience.md）。どれも押したときだけ動く。

const DELETE_TIMEOUT_MS = 10_000
const IMAGE_TIMEOUT_MS = 15_000

async function deleteTrip(tripId: string): Promise<void> {
  const token = ownerTokenOf(tripId)
  if (!token) throw new RecordApiError(401, 'OWNER_TOKEN_REQUIRED')
  let res: Response
  try {
    res = await fetch(`${apiBase()}/api/trips/${encodeURIComponent(tripId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    })
  } catch {
    throw new RecordApiError(null, null)
  }
  if (!res.ok) throw new RecordApiError(res.status, errorCode(await res.json().catch(() => null)))
}

/** 旅の削除（R10）。成功したら端末の所有者トークンを消す（失敗したら残す。FAIL-4） */
export function useDeleteTrip(tripId: string) {
  return useMutation<void, Error>({
    mutationFn: () => deleteTrip(tripId),
    onSuccess: () => {
      forgetOwnerToken(tripId)
    },
    onError: (error) => {
      logger.warn('record.delete.failed', {
        status: error instanceof RecordApiError ? error.status : null,
      })
    },
  })
}

async function saveImage(tripId: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(recordImageUrl(tripId), { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
  } catch {
    throw new RecordApiError(null, null)
  }
  if (!res.ok) throw new RecordApiError(res.status, null)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = `ezo-road-${tripId}.png`
  a.click()
  // すぐに消すと保存が始まらないブラウザがあるので、少し待ってから消す
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}

/** しおりを画像で保存（A7-4）。api の og.png（OG 画像と同じ）を取って保存する */
export function useSaveImage(tripId: string) {
  return useMutation<void, Error>({
    mutationFn: () => saveImage(tripId),
    onError: (error) => {
      logger.warn('record.png.failed', {
        status: error instanceof RecordApiError ? error.status : null,
      })
    },
  })
}
