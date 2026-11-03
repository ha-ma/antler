import { usePlanTripStore } from '../store'
import { PLAN_TEXT, type PlanTextKey } from '../text'
import { LangSelect } from './LangSelect'

const STEPS: readonly PlanTextKey[] = ['stepPlan', 'stepBrief', 'stepDrive', 'stepRecord']

/** ヘッダー: ロゴ、4 つのステップ（いまは 1。リンクではなく現在地の表示）、言語切替。 */
export function PlanHeader() {
  const lang = usePlanTripStore((s) => s.lang)
  return (
    <header className="plan-header">
      <div className="plan-brand">
        <svg
          className="plan-brand__logo"
          viewBox="0 0 32 20"
          width="32"
          height="20"
          aria-hidden="true"
          focusable="false"
        >
          <path className="plan-brand__ridge" d="M1 18 L11 4 L17 12 L22 6 L31 18" />
          <path className="plan-brand__road" d="M6 18 L16 14 L26 18" />
        </svg>
        <span>{PLAN_TEXT.brand[lang]}</span>
      </div>
      <ol className="plan-steps" aria-label={PLAN_TEXT.steps[lang]}>
        {STEPS.map((key, i) => (
          <li
            key={key}
            className={i === 0 ? 'plan-step plan-step--current' : 'plan-step'}
            aria-current={i === 0 ? 'step' : undefined}
          >
            <span className="plan-num">{i + 1}</span> {PLAN_TEXT[key][lang]}
          </li>
        ))}
      </ol>
      <LangSelect />
    </header>
  )
}
