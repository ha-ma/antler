import type { Lang } from '@antler/schema'
import { formatBudget, STATS } from '@antler/trip'
import { CountUpText } from '@/shared/components/CountUpText'
import { fillText, LOSS_TEXT } from '../text'
import { dropClass, dropLandedMs, type DropStyle } from '../utils/drop'
import { fillNodes } from '../utils/fill-nodes'
import { count, monthLabel } from '../utils/format'

type Source = { name: string; verified: boolean }

/**
 * 統計カード（A6-3、functional.md R4）: STATS の鹿事故と保険の実数。出典名を必ず書き、
 * verified:false には「出典の再照合中」を添える。stats.json に無い数字（停止距離など）は出さない。
 */
export function StatsCard({ lang, drop }: { lang: Lang; drop?: DropStyle }) {
  const t = LOSS_TEXT
  const deer = STATS.deerAccidents
  const ins = STATS.vehicleInsurance
  const sources: Source[] = [deer.source, ins.source]
  // 件数・金額はカードの着地のあとに 80 ms ずつずらして数え上げる。年・期間は動かさない（result-countup R1・R5）
  const landed = dropLandedMs(drop)
  const num = (text: string, order: number) => (
    <CountUpText text={text} notBeforeMs={landed + order * 80} />
  )
  return (
    <section
      className={dropClass('loss-stats', drop)}
      style={drop}
      aria-labelledby="loss-stats-heading"
    >
      <h2 id="loss-stats-heading" className="loss-stats__heading">
        {fillNodes(t.statsHeading[lang], { year: deer.year, total: num(count(deer.total), 0) })}
      </h2>
      <p>
        {fillNodes(t.statsAccidents[lang], {
          previous: num(count(deer.previousYearTotal), 1),
          kushiro: num(count(deer.kushiroArea), 2),
        })}
      </p>
      <p>
        {fillNodes(t.statsInsurance[lang], {
          from: monthLabel(ins.period.from, lang),
          to: monthLabel(ins.period.to, lang),
          claims: num(count(ins.claims), 3),
          paid: num(formatBudget(ins.paidJPY, lang), 4),
          average: num(formatBudget(ins.averageJPY, lang), 5),
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
