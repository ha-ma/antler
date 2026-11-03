import {
  assessRisk,
  buildItinerary,
  draftTitles,
  PERSONA_INPUT,
  type Itinerary,
  type Localized,
  type RiskAssessment,
  type TripInput,
} from '@antler/trip'
import { useMemo, useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useAreaSelections, usePlanTripStore } from '../store'
import type { PlanFormValues } from '../types'
import { parseTripInput, type FieldProblems } from '../utils/trip-input'

export type TripPreview = {
  /** いまの入力が TripInputSchema を通るか */
  valid: boolean
  /** 欄ごとの問題（文言のキー） */
  problems: FieldProblems
  /** しおりの元の入力。フォームの値が通らないあいだは、最後に通ったフォームの値を使う（R1「しおりは前の値のまま」） */
  input: TripInput
  itinerary: Itinerary
  risk: RiskAssessment
  titles: Localized
}

function sameValues(a: Partial<PlanFormValues>, b: Partial<PlanFormValues>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 入力が変わるたびに、端末でしおり・リスク・タイトルを作り直す（R3・R4。API は呼ばない）。
 * FormProvider の内側で使う。楽しみ・エリア・言語（store）の変更は、フォームが不正なあいだも反映する。
 */
export function useTripPreview(): TripPreview {
  const { control } = useFormContext<PlanFormValues>()
  const values = useWatch({ control }) as Partial<PlanFormValues>
  const area = usePlanTripStore((s) => s.area)
  const lang = usePlanTripStore((s) => s.lang)
  const pleasures = useAreaSelections()

  const parsed = useMemo(
    () => parseTripInput(values, { area, pleasures, lang }),
    [values, area, pleasures, lang],
  )

  // 最後に通ったフォームの値。描画中に前の値と比べて更新する（useEffect を使わない React の推奨の形）。
  const [lastValidValues, setLastValidValues] = useState<Partial<PlanFormValues>>(values)
  if (parsed.success && !sameValues(values, lastValidValues)) {
    setLastValidValues(values)
  }

  const input = useMemo(() => {
    if (parsed.success) return parsed.input
    const fallback = parseTripInput(lastValidValues, { area, pleasures, lang })
    return fallback.success ? fallback.input : PERSONA_INPUT
  }, [parsed, lastValidValues, area, pleasures, lang])

  const computed = useMemo(() => {
    const itinerary = buildItinerary(input)
    return { itinerary, risk: assessRisk(input, itinerary), titles: draftTitles(input, itinerary) }
  }, [input])

  return { valid: parsed.success, problems: parsed.problems, input, ...computed }
}
