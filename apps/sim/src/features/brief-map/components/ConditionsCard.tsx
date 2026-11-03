import type { Lang } from '@antler/schema'
import type { DayConditions } from '@antler/trip'
import { BRIEF_TEXT, fillText, type BriefTextKey } from '../text'

type Props = { conditions: DayConditions; lang: Lang }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** 今日の条件（R4、A2-3）と操作説明（R8、A2-4） */
export function ConditionsCard({ conditions: c, lang }: Props) {
  const t = BRIEF_TEXT
  const word = (key: string) => t[key as BriefTextKey][lang]
  const vehicle = `${word(`vehicle${cap(c.vehicle)}`)}${c.fourWd ? ` ${t.fourWd[lang]}` : ''}`
  return (
    <section className="brief-card brief-conditions" aria-labelledby="brief-conditions-title">
      <h2 id="brief-conditions-title" className="brief-eyebrow">
        {t.conditions[lang]}
      </h2>
      <dl className="brief-conditions__list">
        <div>
          <dt>{t.driver[lang]}</dt>
          <dd>
            {fillText(t.driverValue[lang], { n: c.driver })}
            {c.drivers > 1 ? fillText(t.driverSwap[lang], { m: c.drivers }) : null}
          </dd>
        </div>
        <div>
          <dt>{t.vehicle[lang]}</dt>
          <dd>{vehicle}</dd>
        </div>
        <div>
          <dt>{t.weather[lang]}</dt>
          <dd>
            {word(`weather${cap(c.weather)}`)} ・ {word(`surface${cap(c.surface)}`)}
          </dd>
        </div>
        <div>
          <dt>{t.cabin[lang]}</dt>
          <dd>
            {fillText(t.cabinValue[lang], { n: c.occupants, fog: word(`fog${cap(c.windowFog)}`) })}
          </dd>
        </div>
      </dl>
      <p className="brief-fine">{t.conditionsNote[lang]}</p>
      <h3 className="brief-eyebrow">{t.controls[lang]}</h3>
      <div className="brief-controls">
        <div>
          <p className="brief-controls__device">{t.pc[lang]}</p>
          <ul className="brief-chips">
            <li>{t.pcDrive[lang]}</li>
            <li>{t.pcBrake[lang]}</li>
            <li>{t.pcDeer[lang]}</li>
          </ul>
        </div>
        <div>
          <p className="brief-controls__device">{t.phone[lang]}</p>
          <ul className="brief-chips">
            <li>{t.phoneDrive[lang]}</li>
            <li>{t.phoneBrake[lang]}</li>
            <li>{t.phoneDeer[lang]}</li>
          </ul>
        </div>
      </div>
    </section>
  )
}
