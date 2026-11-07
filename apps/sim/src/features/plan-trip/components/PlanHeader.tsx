import { BrandLogo } from '@/shared/components/BrandLogo'
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
        <BrandLogo theme="trip" />
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
