import { formatBudget, pleasureById, placeById } from '@antler/trip'
import type { TripPreview } from '../hooks/useTripPreview'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText } from '../text'
import { AllocationBar } from './AllocationBar'
import { RiskBand } from './RiskBand'

type Props = { preview: TripPreview }

/** 右パネル「旅のしおり」（A1-4・A1-5）: タイトル、重さの配分、D1〜Dn、入りきらない楽しみ、リスク、予算。 */
export function ItineraryPanel({ preview }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  const { input, itinerary, risk, titles } = preview
  const days = itinerary.days.length
  const placeName = (id: string) => placeById(id)?.name[lang] ?? id
  const pleasureName = (id: string) => pleasureById(id)?.name[lang] ?? id

  return (
    <div className="plan-panel">
      <div className="plan-panel__head">
        <h2 id="plan-itinerary-heading" className="plan-eyebrow">
          {PLAN_TEXT.itinerary[lang]}
        </h2>
        <span className="plan-num plan-panel__span">
          {days === 1
            ? PLAN_TEXT.dayTrip[lang]
            : fillText('nightsDays', lang, { nights: days - 1, days })}
        </span>
      </div>
      <p className="plan-panel__title" data-testid="plan-draft-title">
        {titles[lang]}
      </p>
      <AllocationBar pleasures={input.pleasures} skipped={itinerary.skipped} />
      <ol className="plan-days" aria-label={PLAN_TEXT.itinerary[lang]}>
        {itinerary.days.map((d) => (
          <li key={d.day} className="plan-day" data-testid="plan-day">
            <span className="plan-num plan-day__num" aria-hidden="true">
              D{d.day}
            </span>
            <span className="plan-visually-hidden">{fillText('dayLabel', lang, { n: d.day })}</span>
            <span className="plan-day__body">
              <span className="plan-day__route">
                {d.from === d.to ? placeName(d.to) : `${placeName(d.from)} → ${placeName(d.to)}`}
              </span>
              <span className="plan-day__stops">
                {d.stops.length > 0
                  ? d.stops.map(pleasureName).join('・')
                  : PLAN_TEXT.moveOnly[lang]}
                {d.stay ? ` ／ ${fillText('stayAt', lang, { place: placeName(d.stay) })}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {itinerary.skipped.length > 0 ? (
        <div className="plan-skipped">
          <h3 className="plan-label">{PLAN_TEXT.skipped[lang]}</h3>
          <ul className="plan-skipped__list" data-testid="plan-skipped">
            {itinerary.skipped.map((id) => (
              <li key={id}>{pleasureName(id)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <RiskBand risk={risk} />
      <dl className="plan-budget">
        <dt className="plan-label">{PLAN_TEXT.budgetSummary[lang]}</dt>
        <dd className="plan-num">{formatBudget(input.budgetPerPersonJPY, lang)}</dd>
      </dl>
    </div>
  )
}
