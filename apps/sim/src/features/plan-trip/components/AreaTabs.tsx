import type { Area } from '@antler/trip'
import type { KeyboardEvent } from 'react'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText, type PlanTextKey } from '../text'

const AREAS: readonly { area: Area; key: PlanTextKey }[] = [
  { area: 'doto', key: 'areaDoto' },
  { area: 'doo', key: 'areaDoo' },
]

/** エリアタブ（道東 / 道央）。各タブにそのエリアの選択数を出す。左右の矢印キーで移る。 */
export function AreaTabs() {
  const lang = usePlanTripStore((s) => s.lang)
  const current = usePlanTripStore((s) => s.area)
  const selections = usePlanTripStore((s) => s.selections)
  const setArea = usePlanTripStore((s) => s.setArea)

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const index = AREAS.findIndex((a) => a.area === current)
    const step = e.key === 'ArrowRight' ? 1 : -1
    const next = AREAS[(index + step + AREAS.length) % AREAS.length]
    if (!next) return
    setArea(next.area)
    document.getElementById(`plan-tab-${next.area}`)?.focus()
  }

  return (
    <div role="tablist" aria-label={PLAN_TEXT.areas[lang]} className="plan-tabs">
      {AREAS.map(({ area, key }) => {
        const selected = area === current
        const count = selections[area].length
        return (
          <button
            key={area}
            id={`plan-tab-${area}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="plan-pleasure-panel"
            tabIndex={selected ? 0 : -1}
            className={selected ? 'plan-tab plan-tab--selected' : 'plan-tab'}
            onClick={() => setArea(area)}
            onKeyDown={onKeyDown}
          >
            {PLAN_TEXT[key][lang]}{' '}
            <span className="plan-num" aria-hidden="true">
              {count}
            </span>
            <span className="plan-visually-hidden">
              {fillText('areaCount', lang, { n: count })}
            </span>
          </button>
        )
      })}
    </div>
  )
}
