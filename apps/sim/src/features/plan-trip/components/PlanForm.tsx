import { useFormContext } from 'react-hook-form'
import { useSubmitTrip } from '../hooks/useSubmitTrip'
import { useTripPreview } from '../hooks/useTripPreview'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT } from '../text'
import type { PlanFormValues } from '../types'
import { CreateTripStatus } from './CreateTripStatus'
import { ItineraryPanel } from './ItineraryPanel'
import { PleasurePicker } from './PleasurePicker'
import { TripInputFields } from './TripInputFields'

/** 2 カラムの本文: 左に入力と楽しみ、右にしおり・リスク・主ボタン。 */
export function PlanForm() {
  const lang = usePlanTripStore((s) => s.lang)
  const { handleSubmit } = useFormContext<PlanFormValues>()
  const preview = useTripPreview()
  const trip = useSubmitTrip(preview)

  return (
    <main className="plan-body">
      <form
        id="plan-trip-form"
        className="plan-main"
        noValidate
        onSubmit={(e) => void handleSubmit(trip.submit)(e)}
      >
        <h1 className="plan-title">{PLAN_TEXT.heading[lang]}</h1>
        <p className="plan-lead">{PLAN_TEXT.lead[lang]}</p>
        <TripInputFields problems={preview.problems} valid={preview.valid} />
        <PleasurePicker />
      </form>
      <aside className="plan-aside" aria-labelledby="plan-itinerary-heading">
        <ItineraryPanel preview={preview} />
        <button
          type="submit"
          form="plan-trip-form"
          className="plan-submit"
          aria-disabled={trip.pending || undefined}
          aria-busy={trip.pending || undefined}
        >
          {trip.pending ? PLAN_TEXT.submitting[lang] : PLAN_TEXT.submit[lang]}
        </button>
        <CreateTripStatus failure={trip.failure} pending={trip.pending} onRetry={trip.retry} />
        <p className="plan-footnote">{PLAN_TEXT.footnote[lang]}</p>
      </aside>
    </main>
  )
}
