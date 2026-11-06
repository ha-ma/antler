import { pleasureById } from '@antler/trip'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText } from '../text'
import type { PleasureSelection } from '../types'
import { hoursLabel } from '../utils/hours'

type Props = { pleasures: readonly PleasureSelection[]; skipped: readonly string[] }

/**
 * 時間の配分バー（各楽しみの標準の所要に比例した横積み。spruce の濃淡で長い順）。下に名前と時間を並べる。
 * 重さの配分は plan-trip-photos で時間に読み替えた。
 */
export function AllocationBar({ pleasures, skipped }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  const sorted = pleasures
    .flatMap((p) => pleasureById(p.id) ?? [])
    .sort((a, b) => b.hours - a.hours || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const total = sorted.reduce((sum, p) => sum + p.hours, 0)

  if (sorted.length === 0) {
    return <p className="plan-caption">{PLAN_TEXT.noPleasures[lang]}</p>
  }
  return (
    <div className="plan-alloc">
      <p className="plan-label">{fillText('allocation', lang, { n: hoursLabel(total) })}</p>
      <div className="plan-alloc__bar" aria-hidden="true">
        {sorted.map((p, i) => (
          <span
            key={p.id}
            className="plan-alloc__seg"
            style={{ flexGrow: p.hours, opacity: Math.max(0.35, 1 - i * 0.12) }}
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
            {p.name[lang]}{' '}
            <span className="plan-num">{fillText('hours', lang, { n: hoursLabel(p.hours) })}</span>
            {skipped.includes(p.id) ? (
              <span className="plan-visually-hidden">{PLAN_TEXT.skippedMark[lang]}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
