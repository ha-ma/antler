import { pleasureById } from '@antler/trip'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText } from '../text'
import type { PleasureSelection } from '../types'

type Props = { pleasures: readonly PleasureSelection[]; skipped: readonly string[] }

/** 重さの配分バー（重さに比例した横積み。spruce の濃淡で重い順）。下に名前と重さを並べる。 */
export function AllocationBar({ pleasures, skipped }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  const sorted = [...pleasures].sort((a, b) => b.weight - a.weight)
  const total = sorted.reduce((sum, p) => sum + p.weight, 0)

  if (sorted.length === 0) {
    return <p className="plan-caption">{PLAN_TEXT.noPleasures[lang]}</p>
  }
  return (
    <div className="plan-alloc">
      <p className="plan-label">{fillText('allocation', lang, { n: total })}</p>
      <div className="plan-alloc__bar" aria-hidden="true">
        {sorted.map((p, i) => (
          <span
            key={p.id}
            className="plan-alloc__seg"
            style={{ flexGrow: p.weight, opacity: Math.max(0.35, 1 - i * 0.12) }}
          />
        ))}
      </div>
      <ul className="plan-alloc__legend">
        {sorted.map((p) => (
          <li
            key={p.id}
            className={
              skipped.includes(p.id)
                ? 'plan-alloc__item plan-alloc__item--skipped'
                : 'plan-alloc__item'
            }
          >
            {pleasureById(p.id)?.name[lang] ?? p.id} <span className="plan-num">{p.weight}</span>
            {skipped.includes(p.id) ? (
              <span className="plan-visually-hidden">{PLAN_TEXT.skippedMark[lang]}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
