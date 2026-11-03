import { PERSONA_INPUT } from '@antler/trip'
import { useForm } from 'react-hook-form'
import { usePlanTripStore } from '../store'
import type { PlanFormValues } from '../types'
import { resolvePlanForm, toFormValues, type PlanFormContext } from '../utils/trip-input'

/** 送信の瞬間の store の値（購読しない。選択のたびにフォーム全体を描き直さないため）。 */
function currentContext(): PlanFormContext {
  const { area, selections, lang } = usePlanTripStore.getState()
  return { area, pleasures: selections[area], lang }
}

/** A-1 の入力フォーム。初期値はペルソナ（付録 A #4）。検証は TripInputSchema（R1）。 */
export function usePlanForm() {
  return useForm<PlanFormValues>({
    defaultValues: toFormValues(PERSONA_INPUT),
    resolver: (values) => resolvePlanForm(values, currentContext()),
    mode: 'onSubmit',
  })
}
