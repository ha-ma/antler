import type { Lang } from '@antler/schema'
import { useFormContext } from 'react-hook-form'
import { ActionBar, ACTION_BAR_PRIMARY } from '@/shared/components/ActionBar'
import { useSubmitTrip } from '../hooks/useSubmitTrip'
import { useTripPreview } from '../hooks/useTripPreview'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText } from '../text'
import type { PlanFormValues } from '../types'
import type { FieldProblems } from '../utils/trip-input'
import { CreateTripStatus } from './CreateTripStatus'
import { ItineraryPanel } from './ItineraryPanel'
import { PleasurePicker } from './PleasurePicker'
import { TripInputFields } from './TripInputFields'

/** 入力欄の並び（画面の順）。欄の名前はラベルの文言と同じキー */
const FIELD_ORDER = [
  'size',
  'drivers',
  'experience',
  'departAt',
  'departPlace',
  'returnAt',
  'returnPlace',
  'budget',
] as const satisfies readonly (keyof PlanFormValues)[]

const HINT_ID = 'plan-submit-hint'

/** 下の帯の「直すところ: 人数・返却」（sticky-cta R3）。問題が無ければ null */
function fixHint(problems: FieldProblems, lang: Lang): string | null {
  const names = FIELD_ORDER.filter((f) => problems[f]).map((f) => PLAN_TEXT[f][lang])
  if (names.length === 0) return null
  return fillText('fixFields', lang, { fields: names.join(PLAN_TEXT.fixFieldsSeparator[lang]) })
}

/** 2 カラムの本文: 左に入力と楽しみ、右にしおり・リスク・主ボタン（主ボタンは画面の下に固定した帯。sticky-cta）。 */
export function PlanForm() {
  const lang = usePlanTripStore((s) => s.lang)
  const { handleSubmit } = useFormContext<PlanFormValues>()
  const preview = useTripPreview()
  const trip = useSubmitTrip(preview)
  // 入力が通らないあいだは帯に直すところを出す。いま作れる入力なら出さない
  const hint = preview.valid ? null : fixHint(preview.problems, lang)

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
        <ActionBar
          note={
            <>
              {/* 作成の失敗は押した場所の近く（帯の中）に出す。role="alert" の箱はいつも描く */}
              <CreateTripStatus
                failure={trip.failure}
                pending={trip.pending}
                onRetry={trip.retry}
              />
              {hint ? (
                <p id={HINT_ID} className="action-bar__hint">
                  {hint}
                </p>
              ) : null}
            </>
          }
        >
          <button
            type="submit"
            form="plan-trip-form"
            className={`plan-submit ${ACTION_BAR_PRIMARY}`}
            aria-disabled={trip.pending || undefined}
            aria-busy={trip.pending || undefined}
            aria-describedby={hint ? HINT_ID : undefined}
          >
            {trip.pending ? PLAN_TEXT.submitting[lang] : PLAN_TEXT.submit[lang]}
          </button>
        </ActionBar>
        <p className="plan-footnote">{PLAN_TEXT.footnote[lang]}</p>
      </aside>
    </main>
  )
}
