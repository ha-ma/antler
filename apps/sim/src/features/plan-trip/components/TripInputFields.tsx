import { DeparturePlace } from '@antler/schema'
import { DEPARTURE_PLACE_ID, MAX_TRIP_DAYS, placeById } from '@antler/trip'
import type { ReactNode } from 'react'
import { useFormContext } from 'react-hook-form'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText, type PlanTextKey } from '../text'
import type { PlanFormValues } from '../types'
import { BUDGET_MAX_JPY, type FieldProblems } from '../utils/trip-input'

type Props = { problems: FieldProblems; valid: boolean }

const EXPERIENCES: readonly { value: PlanFormValues['experience']; key: PlanTextKey }[] = [
  { value: 'first', key: 'expFirst' },
  { value: 'few', key: 'expFew' },
  { value: 'experienced', key: 'expExperienced' },
]

const ERROR_VALUES: Partial<Record<PlanTextKey, Record<string, string | number>>> = {
  errReturn: { max: MAX_TRIP_DAYS },
  errBudget: { max: BUDGET_MAX_JPY.toLocaleString('en-US') },
}

/** A1-1 の入力（人数・運転できる人・経験・出発と返却の日時と場所・予算）。日時は日本時間。 */
export function TripInputFields({ problems, valid }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  const { register } = useFormContext<PlanFormValues>()

  const field = (name: keyof PlanFormValues, label: PlanTextKey, control: ReactNode) => {
    const problem = problems[name]
    return (
      <div className="plan-field">
        <label htmlFor={`plan-${name}`} className="plan-field__label">
          {PLAN_TEXT[label][lang]}
        </label>
        {control}
        {problem ? (
          <p id={`plan-${name}-error`} className="plan-field__error">
            {fillText(problem, lang, ERROR_VALUES[problem])}
          </p>
        ) : null}
      </div>
    )
  }

  const a11y = (name: keyof PlanFormValues) => ({
    id: `plan-${name}`,
    required: true,
    'aria-invalid': problems[name] ? true : undefined,
    'aria-describedby': problems[name] ? `plan-${name}-error` : undefined,
  })

  const placeOptions = DeparturePlace.options.map((p) => (
    <option key={p} value={p}>
      {placeById(DEPARTURE_PLACE_ID[p])?.name[lang] ?? p}
    </option>
  ))

  return (
    <fieldset className="plan-inputs">
      <legend className="plan-visually-hidden">{PLAN_TEXT.inputs[lang]}</legend>
      {field(
        'size',
        'size',
        <input
          {...a11y('size')}
          className="plan-input plan-input--num"
          type="number"
          min={1}
          max={8}
          inputMode="numeric"
          {...register('size', { valueAsNumber: true })}
        />,
      )}
      {field(
        'drivers',
        'drivers',
        <input
          {...a11y('drivers')}
          className="plan-input plan-input--num"
          type="number"
          min={1}
          max={8}
          inputMode="numeric"
          {...register('drivers', { valueAsNumber: true })}
        />,
      )}
      {field(
        'experience',
        'experience',
        <select {...a11y('experience')} className="plan-select" {...register('experience')}>
          {EXPERIENCES.map((e) => (
            <option key={e.value} value={e.value}>
              {PLAN_TEXT[e.key][lang]}
            </option>
          ))}
        </select>,
      )}
      {field(
        'departAt',
        'departAt',
        <input
          {...a11y('departAt')}
          className="plan-input plan-input--num"
          type="datetime-local"
          {...register('departAt')}
        />,
      )}
      {field(
        'departPlace',
        'departPlace',
        <select {...a11y('departPlace')} className="plan-select" {...register('departPlace')}>
          {placeOptions}
        </select>,
      )}
      {field(
        'returnAt',
        'returnAt',
        <input
          {...a11y('returnAt')}
          className="plan-input plan-input--num"
          type="datetime-local"
          {...register('returnAt')}
        />,
      )}
      {field(
        'returnPlace',
        'returnPlace',
        <select {...a11y('returnPlace')} className="plan-select" {...register('returnPlace')}>
          {placeOptions}
        </select>,
      )}
      {field(
        'budget',
        'budget',
        <input
          {...a11y('budget')}
          className="plan-input plan-input--num"
          type="number"
          min={0}
          max={BUDGET_MAX_JPY}
          step={1000}
          inputMode="numeric"
          {...register('budget', { valueAsNumber: true })}
        />,
      )}
      <p className="plan-inputs__status" role="status">
        {valid ? '' : PLAN_TEXT.invalidInput[lang]}
      </p>
    </fieldset>
  )
}
