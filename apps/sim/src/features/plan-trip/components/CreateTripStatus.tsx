import { usePlanTripStore } from '../store'
import { PLAN_TEXT } from '../text'
import type { CreateTripFailure } from '../types'

type Props = {
  failure: CreateTripFailure | null
  pending: boolean
  onRetry: () => void
}

/**
 * 作成の失敗の表示。入力は残したまま。429 は「本日の生成上限」。
 * つながらない・それ以外の失敗は、文言を分けたうえで「もう一度」で同じキーで送り直す。
 */
export function CreateTripStatus({ failure, pending, onRetry }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  return (
    <div className="plan-status" role="alert">
      {failure === 'limit' ? <p>{PLAN_TEXT.errorLimit[lang]}</p> : null}
      {failure === 'failed' || failure === 'unreachable' ? (
        <p>
          {(failure === 'unreachable' ? PLAN_TEXT.errorUnreachable : PLAN_TEXT.errorFailed)[lang]}{' '}
          <button type="button" className="plan-retry" disabled={pending} onClick={onRetry}>
            {PLAN_TEXT.retry[lang]}
          </button>
        </p>
      ) : null}
    </div>
  )
}
