import { FormProvider } from 'react-hook-form'
import { usePlanForm } from '../hooks/usePlanForm'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT } from '../text'
import { htmlLang } from '../utils/lang'
import { PlanForm } from './PlanForm'
import { PlanHeader } from './PlanHeader'
import './plan-trip.css'

/** A-1 旅をつくる（`/plan`）。初期値はペルソナ（付録 A #4）。 */
export function PlanPage() {
  const lang = usePlanTripStore((s) => s.lang)
  const form = usePlanForm()

  return (
    <div className="plan" lang={htmlLang(lang)}>
      <title>{`${PLAN_TEXT.stepPlan[lang]} | ${PLAN_TEXT.brand[lang]}`}</title>
      <PlanHeader />
      <FormProvider {...form}>
        <PlanForm />
      </FormProvider>
    </div>
  )
}
