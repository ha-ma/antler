import { useMemo } from 'react'
import { ownerTokenOf } from '@/features/plan-trip'
import type { TripEventDraft } from '../types'
import { TripEventSender } from '../utils/event-sender'

// 走行のイベントを残す入口（docs/specs/stop-events/functional.md R10・R12）。drive-link・loss・確認用の画面が使う。
// 旅を作った端末だけが ownerToken を持つ。無ければ何もしない（エラーにしない）。
// 送り手（seq の数え上げ）は旅・run が同じあいだ 1 つ（useMemo）。アラートの ON / OFF を切り替えても作り直さない
// （作り直すと seq が 0 に戻り、同じ runId の既存の行と衝突する。component-guard W1）。

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
    () => (ownerToken === null ? null : new TripEventSender({ tripId, runId, ownerToken })),
    [tripId, runId, ownerToken],
  )
  return useMemo(
    () => ({
      log: (event) => {
        void sender?.log(event, alertEnabled)
      },
      enabled: sender !== null,
    }),
    [sender, alertEnabled],
  )
}
