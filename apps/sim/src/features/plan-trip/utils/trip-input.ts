import { toJst, type Lang } from '@antler/schema'
import { MAX_BUDGET_JPY, TripInputSchema, type Area, type TripInput } from '@antler/trip'
import type { FieldErrors, ResolverResult } from 'react-hook-form'
import type { PlanTextKey } from '../text'
import type { PleasureSelection, PlanFormValues } from '../types'

// フォームの値（日本時間の datetime-local）＋ store の選択 → TripInput（R1）。
// 検証は @antler/trip の TripInputSchema だけで行う（api と同じ規則）。

/** 予算の上限（@antler/trip の MAX_BUDGET_JPY。入力欄の max に使う）。 */
export const BUDGET_MAX_JPY = MAX_BUDGET_JPY

/** フォームの外から入る値（store のエリア・選択・言語）。 */
export type PlanFormContext = {
  area: Area
  pleasures: readonly PleasureSelection[]
  lang: Lang
}

const MINUTES = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

/** datetime-local の値（日本時間）に +09:00 を付けた ISO 8601 にする。形が違えばそのまま返し、検証で落とす。 */
export function jstLocalToIso(local: string): string {
  if (MINUTES.test(local)) return `${local}:00+09:00`
  if (SECONDS.test(local)) return `${local}+09:00`
  return local
}

/** タイムゾーン付きの ISO 8601 → datetime-local の値（日本時間、分まで）。 */
export function isoToJstLocal(iso: string): string {
  return toJst(iso).slice(0, 16)
}

/** TripInput（ペルソナなど）からフォームの初期値を作る。 */
export function toFormValues(input: TripInput): PlanFormValues {
  return {
    size: input.party.size,
    drivers: input.party.drivers,
    experience: input.party.experience,
    departAt: isoToJstLocal(input.depart.at),
    departPlace: input.depart.place,
    returnAt: isoToJstLocal(input.return.at),
    returnPlace: input.return.place,
    budget: input.budgetPerPersonJPY,
  }
}

/** フォームの値と store の値を TripInput の形にまとめる（検証はしない）。 */
export function toTripInput(values: Partial<PlanFormValues>, context: PlanFormContext): unknown {
  return {
    lang: context.lang,
    party: { size: values.size, drivers: values.drivers, experience: values.experience },
    depart: { at: jstLocalToIso(values.departAt ?? ''), place: values.departPlace },
    return: { at: jstLocalToIso(values.returnAt ?? ''), place: values.returnPlace },
    budgetPerPersonJPY: values.budget,
    area: context.area,
    pleasures: context.pleasures.map((p) => ({ id: p.id, weight: p.weight })),
  }
}

export type FieldProblems = Partial<Record<keyof PlanFormValues, PlanTextKey>>

type Issue = { path: readonly PropertyKey[] }

/** TripInputSchema の問題を、フォームの欄と画面の文言に対応づける（楽しみ・エリア・言語は画面が守る）。 */
export function fieldProblems(
  issues: readonly Issue[],
  values: Partial<PlanFormValues>,
): FieldProblems {
  const out: FieldProblems = {}
  for (const issue of issues) {
    const [head, sub] = issue.path
    if (head === 'party' && sub === 'size') out.size ??= 'errSize'
    else if (head === 'party' && sub === 'drivers') out.drivers ??= 'errDrivers'
    else if (head === 'depart') out.departAt ??= 'errDateTime'
    else if (head === 'return') out.returnAt ??= values.returnAt ? 'errReturn' : 'errDateTime'
    else if (head === 'budgetPerPersonJPY') out.budget ??= 'errBudget'
  }
  return out
}

export type ParsedTripInput =
  | { success: true; input: TripInput; problems: FieldProblems }
  | { success: false; problems: FieldProblems }

/** フォームの値と store の値を TripInputSchema で検証する。 */
export function parseTripInput(
  values: Partial<PlanFormValues>,
  context: PlanFormContext,
): ParsedTripInput {
  const result = TripInputSchema.safeParse(toTripInput(values, context))
  if (result.success) return { success: true, input: result.data, problems: {} }
  return { success: false, problems: fieldProblems(result.error.issues, values) }
}

/** React Hook Form の resolver の中身。送信の可否を TripInputSchema で決める。 */
export function resolvePlanForm(
  values: PlanFormValues,
  context: PlanFormContext,
): ResolverResult<PlanFormValues> {
  const parsed = parseTripInput(values, context)
  if (parsed.success) return { values, errors: {} }
  const errors: FieldErrors<PlanFormValues> = {
    root: { tripInput: { type: 'trip-input', message: 'invalidInput' } },
  }
  for (const [name, key] of Object.entries(parsed.problems)) {
    errors[name as keyof PlanFormValues] = { type: 'trip-input', message: key }
  }
  return { values: {}, errors }
}
