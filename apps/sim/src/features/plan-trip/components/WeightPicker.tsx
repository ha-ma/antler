import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText } from '../text'

const MIN_WEIGHT = 1
const MAX_WEIGHT = 5
const LEVELS = [1, 2, 3, 4, 5] as const

type Props = { pleasureId: string; name: string; weight: number }

/**
 * 重さ 1〜5（選択済みのカードだけに出る）。押せるのは 44px の「−」「＋」の 2 つで、
 * 5 段のバーは見た目だけ（値は文字でも出す）。端では aria-disabled にして、フォーカスを失わせない。
 */
export function WeightPicker({ pleasureId, name, weight }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  const setWeight = usePlanTripStore((s) => s.setWeight)
  return (
    <div className="plan-weight" role="group" aria-label={fillText('weightOf', lang, { name })}>
      <button
        type="button"
        className="plan-weight__button"
        aria-label={PLAN_TEXT.weightDown[lang]}
        aria-disabled={weight <= MIN_WEIGHT}
        onClick={() => setWeight(pleasureId, Math.max(MIN_WEIGHT, weight - 1))}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M3 8 H13" />
        </svg>
      </button>
      <span className="plan-weight__steps" aria-hidden="true">
        {LEVELS.map((level) => (
          <span
            key={level}
            className={
              level <= weight ? 'plan-weight__step plan-weight__step--on' : 'plan-weight__step'
            }
          />
        ))}
      </span>
      <output className="plan-num plan-weight__value" aria-live="polite">
        {fillText('weightValue', lang, { n: weight })}
      </output>
      <button
        type="button"
        className="plan-weight__button"
        aria-label={PLAN_TEXT.weightUp[lang]}
        aria-disabled={weight >= MAX_WEIGHT}
        onClick={() => setWeight(pleasureId, Math.min(MAX_WEIGHT, weight + 1))}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M3 8 H13 M8 3 V13" />
        </svg>
      </button>
    </div>
  )
}
