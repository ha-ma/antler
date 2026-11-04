import { useMemo } from 'react'
import { ownerTokenOf } from '@/features/plan-trip'
import type { TripEventDraft } from '../types'
import { TripEventSender } from '../utils/event-sender'

// 走行のイベントを残す入口（docs/specs/stop-events/functional.md R10・R12）。drive-link・loss・確認用の画面が使う。
// 旅を作った端末だけが ownerToken を持つ。無ければ何もしない（エラーにしない）。
// 送り手（seq の数え上げ）は旅・run・アラートが同じあいだ 1 つ（useMemo。描画のたびに作り直さない）。

export type TripEventLog = {
  /** seq を振って送る（待たなくてよい） */
  log: (event: TripEventDraft) => void
  /** ownerToken があり、送れる */
  enabled: boolean
}

export function useTripEventLog(
  tripId: string,
  { runId, alertEnabled }: { runId: string; alertEnabled: boolean },
): TripEventLog {
  const ownerToken = ownerTokenOf(tripId)
  const sender = useMemo(
    () =>
      ownerToken === null ? null : new TripEventSender({ tripId, runId, alertEnabled, ownerToken }),
    [tripId, runId, alertEnabled, ownerToken],
  )
  return useMemo(
    () => ({
      log: (event) => {
        void sender?.log(event)
      },
      enabled: sender !== null,
    }),
    [sender],
  )
}
