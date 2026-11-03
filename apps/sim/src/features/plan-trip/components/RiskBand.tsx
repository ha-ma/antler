import { STATS, type RiskAssessment, type RiskLevel } from '@antler/trip'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText, type PlanTextKey } from '../text'

const LEVEL_TEXT: Record<RiskLevel, PlanTextKey> = {
  high: 'riskHigh',
  caution: 'riskCaution',
  low: 'riskLow',
}

type Props = { risk: RiskAssessment }

/**
 * 「この旅が失われるリスク」（A1-5）。数値は出さず、語と帯で見せる（clay。alert-danger は使わない）。
 * 根拠文の統計は stats.json 由来なので、出典を添える（CLAUDE.md の MUST）。
 */
export function RiskBand({ risk }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  return (
    <section className="plan-risk" aria-labelledby="plan-risk-heading">
      <div className="plan-risk__head">
        <h3 id="plan-risk-heading" className="plan-label">
          {PLAN_TEXT.risk[lang]}
        </h3>
        <span className="plan-risk__level" data-testid="plan-risk-level">
          {PLAN_TEXT[LEVEL_TEXT[risk.level]][lang]}
        </span>
      </div>
      <div className="plan-risk__track" aria-hidden="true">
        <span
          className="plan-risk__fill"
          style={{ width: `${String(Math.round(Math.min(1, Math.max(0, risk.score)) * 100))}%` }}
        />
      </div>
      <ul className="plan-risk__reasons">
        {risk.reasons.map((r) => (
          <li key={r.ja}>{r[lang]}</li>
        ))}
      </ul>
      <p className="plan-fine">
        {PLAN_TEXT.riskNote[lang]}{' '}
        {fillText('source', lang, { name: STATS.deerAccidents.source.name })}
      </p>
    </section>
  )
}
