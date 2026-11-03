import { useNavigate } from 'react-router'
import type { BriefLocationState, CreateTripFailure } from '../types'
import {
  pendingAttempt,
  startAttempt,
  useCreateTrip,
  type CreateTripAttempt,
} from './useCreateTrip'
import type { TripPreview } from './useTripPreview'

export type SubmitTrip = {
  /** 主ボタン。押すごとに新しい冪等キー */
  submit: () => void
  /** 失敗後の「もう一度」。同じキーと入力で送り直す */
  retry: () => void
  pending: boolean
  failure: CreateTripFailure | null
}

/** 「この旅を守りに行く」の送信・再試行と、成功したら `/trip/:id/brief` に移る（R5・R8）。 */
export function useSubmitTrip(preview: TripPreview): SubmitTrip {
  const createTrip = useCreateTrip()
  const navigate = useNavigate()

  const send = (attempt: CreateTripAttempt) => {
    createTrip.mutate(attempt, {
      onSuccess: ({ plan, details }) => {
        const state: BriefLocationState = { titles: details.titles }
        void navigate(`/trip/${encodeURIComponent(plan.id)}/brief`, { state })
      },
    })
  }

  return {
    submit: () => {
      if (!preview.valid || createTrip.isPending) return
      send(startAttempt(preview.input))
    },
    retry: () => {
      if (createTrip.isPending) return
      const attempt = pendingAttempt() ?? createTrip.variables
      // 入力が同じなら同じキーで送り直す（api は作り終えた旅を返す）。失敗のあとに入力を直していたら、新しい試みにする
      if (attempt && JSON.stringify(attempt.input) === JSON.stringify(preview.input)) {
        send(attempt)
      } else if (preview.valid) {
        send(startAttempt(preview.input))
      }
    },
    pending: createTrip.isPending,
    failure: createTrip.isError ? createTrip.error.failure : null,
  }
}
