import type { Lang } from '@antler/schema'
import { formatBudget, STATS } from '@antler/trip'
import { fillText, LOSS_TEXT } from '../text'
import { count, monthLabel } from '../utils/format'

type Source = { name: string; verified: boolean }

/**
 * 統計カード（A6-3、functional.md R4）: STATS の鹿事故と保険の実数。出典名を必ず書き、
 * verified:false には「出典の再照合中」を添える。stats.json に無い数字（停止距離など）は出さない。
 */
export function StatsCard({ lang }: { lang: Lang }) {
  const t = LOSS_TEXT
  const deer = STATS.deerAccidents
  const ins = STATS.vehicleInsurance
  const sources: Source[] = [deer.source, ins.source]
  return (
    <section className="loss-stats" aria-labelledby="loss-stats-heading">
      <h2 id="loss-stats-heading" className="loss-stats__heading">
        {fillText(t.statsHeading[lang], { year: deer.year, total: count(deer.total) })}
      </h2>
      <p>
        {fillText(t.statsAccidents[lang], {
          previous: count(deer.previousYearTotal),
          kushiro: count(deer.kushiroArea),
        })}
      </p>
      <p>
        {fillText(t.statsInsurance[lang], {
          from: monthLabel(ins.period.from, lang),
          to: monthLabel(ins.period.to, lang),
          claims: count(ins.claims),
          paid: formatBudget(ins.paidJPY, lang),
          average: formatBudget(ins.averageJPY, lang),
        })}
      </p>
      <ul className="loss-stats__sources">
        {sources.map((s) => (
          <li key={s.name}>
            {fillText(t.source[lang], { name: s.name })}
            {s.verified ? null : t.recheck[lang]}
          </li>
        ))}
      </ul>
    </section>
  )
}
