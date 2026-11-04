import { IsoDateTime, LocalizedText } from '@antler/schema'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { logger } from '@/shared/utils/logger'
import type { CollisionReport, Loss } from '../types'
import { apiBase, errorCode } from './api'

// 喪失文（POST /api/trips/:id/losses。functional.md R5・R6）。
// 内容で冪等な POST（同じ記述子の 2 回目は保存した文の 200）なので、useQuery で持つ（useEffect で fetch しない）。
// 再試行しない（retry: false。1 回の 502 が裏で何度も Claude を呼ばないように）。「もう一度」は人が押す。

/** api の時間切れ（30 秒）より少し長く待つ */
/** api の最悪（Claude 30 秒 × 作り直し 1 回）より長く待つ（resilience.md） */
const TIMEOUT_MS = 65_000

const ResponseSchema = z.object({
  loss: z.object({ tripId: z.string().min(1), story: LocalizedText, createdAt: IsoDateTime }),
})

/** 文の取得の失敗。status は HTTP のステータス（通信の失敗・形の違いは null）、code は api のエラーコード */
export class LossStoryError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(`loss story failed: ${String(status)} ${String(code)}`)
    this.name = 'LossStoryError'
  }
}

type StoryInput = Pick<
  CollisionReport,
  'tripId' | 'day' | 'leg' | 'at' | 'alertEnabled' | 'achievedStops'
>

async function postLoss(c: StoryInput, signal: AbortSignal): Promise<Loss> {
  const url = `${apiBase()}/api/trips/${encodeURIComponent(c.tripId)}/losses`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // URL の速さ・光・側は送らない（事実の 1 文にだけ使う。R1）
      body: JSON.stringify({
        day: c.day,
        leg: c.leg,
        at: c.at,
        alertEnabled: c.alertEnabled,
        achievedStops: c.achievedStops,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
  } catch {
    throw new LossStoryError(null, null)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code = errorCode(body)
    logger.warn('loss.story.failed', { status: res.status, code })
    throw new LossStoryError(res.status, code)
  }
  const parsed = ResponseSchema.safeParse(body)
  if (!parsed.success || parsed.data.loss.tripId !== c.tripId) {
    const error = new LossStoryError(null, 'INVALID_RESPONSE')
    logger.error('loss.story.invalid', error, { status: res.status })
    throw error
  }
  return parsed.data.loss
}

/** enabled が false（しおりの検証が済んでいない・外れた）のあいだは api を呼ばない */
export function useLossStory(c: StoryInput, enabled: boolean) {
  return useQuery({
    queryKey: [
      'loss-story',
      c.tripId,
      c.day,
      c.leg,
      c.at,
      c.alertEnabled,
      [...c.achievedStops].sort(),
    ],
    queryFn: ({ signal }) => postLoss(c, signal),
    enabled,
    staleTime: Infinity,
    retry: false,
    // 画面に戻ったとき・再接続のときに Claude を呼び直さない
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
