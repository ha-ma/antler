import type { Lang } from '@antler/schema'
import type { DayPlan } from '@antler/trip'
import { BRIEF_TEXT, fillText } from '../text'
import { kmLabel, timeLabel } from '../utils/format'
import { lightText } from '../utils/light'

type Props = { day: DayPlan; lang: Lang }

/** ゾーン通過の一覧（R3）。地図と同じ内容を文字で出す（色だけに頼らない） */
export function ZonePassageList({ day, lang }: Props) {
  const t = BRIEF_TEXT
  return (
    <section className="brief-card brief-passages" aria-labelledby="brief-passages-title">
      <h2 id="brief-passages-title" className="brief-card__title">
        {t.passages[lang]}
      </h2>
      {day.zones.length === 0 ? (
        <p className="brief-muted">{t.noPassages[lang]}</p>
      ) : (
        <ol className="brief-passages__list">
          {day.zones.map((z, i) => (
            <li key={i} className={`brief-passage brief-passage--${z.light}`}>
              <svg
                className="brief-passage__mark"
                viewBox="0 0 16 14"
                width="16"
                height="14"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M8 1 L15 13 L1 13 Z" />
              </svg>
              <span className="brief-passage__road">{z.roadName[lang]}</span>
              <span className="brief-num">
                {fillText(t.passage[lang], {
                  from: timeLabel(z.entryAt, day.date, lang),
                  to: timeLabel(z.exitAt, day.date, lang),
                  km: kmLabel(z.exitKm - z.entryKm),
                  light: lightText(z.light, lang),
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
