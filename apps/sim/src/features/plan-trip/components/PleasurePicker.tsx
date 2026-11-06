import { MAX_PLEASURES, pleasuresInArea } from '@antler/trip'
import { useAreaSelections, usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText } from '../text'
import { AreaTabs } from './AreaTabs'
import { LIMIT_MESSAGE_ID, PleasureCard } from './PleasureCard'

/** A1-2・A1-3: エリアタブ、カウンター「選択 n / 10」（表示中のエリアの数）、PleasureCard の格子。 */
export function PleasurePicker() {
  const lang = usePlanTripStore((s) => s.lang)
  const area = usePlanTripStore((s) => s.area)
  const selections = useAreaSelections()
  const full = selections.length >= MAX_PLEASURES

  return (
    <section className="plan-pleasures" aria-labelledby="plan-pleasures-heading">
      <div className="plan-pleasures__head">
        <div>
          <h2 id="plan-pleasures-heading" className="plan-heading">
            {PLAN_TEXT.pleasuresHeading[lang]}
          </h2>
          <p className="plan-caption">{PLAN_TEXT.pleasuresLead[lang]}</p>
        </div>
        <AreaTabs />
      </div>
      <p className="plan-counter" aria-live="polite" data-testid="plan-counter">
        {PLAN_TEXT.counter[lang]}{' '}
        <span className="plan-num plan-counter__num">
          {selections.length} / {MAX_PLEASURES}
        </span>
      </p>
      <p id={LIMIT_MESSAGE_ID} className="plan-caption" role="status">
        {full ? fillText('limitReached', lang, { max: MAX_PLEASURES }) : ''}
      </p>
      <div
        id="plan-pleasure-panel"
        role="tabpanel"
        aria-labelledby={`plan-tab-${area}`}
        className="plan-grid"
      >
        {pleasuresInArea(area).map((p) => {
          const selected = selections.some((s) => s.id === p.id)
          return (
            <PleasureCard key={p.id} pleasure={p} selected={selected} locked={full && !selected} />
          )
        })}
      </div>
      <p className="plan-caption plan-pleasures__photos">{PLAN_TEXT.photosNote[lang]}</p>
    </section>
  )
}
