import type { Lang } from '@antler/schema'
import { Link } from 'react-router'
import { briefHref, driveHref, useBriefParams } from '../hooks/useBriefParams'
import { TripDayError, useTripDay } from '../hooks/useTripDay'
import { BRIEF_TEXT, fillText } from '../text'
import type { TripDay } from '../types'
import { kmLabel, placeName, pleasureName, timeLabel } from '../utils/format'
import { AlertToggleCard } from './AlertToggleCard'
import { BriefHeader } from './BriefHeader'
import { ConditionsCard } from './ConditionsCard'
import { ZoneMap } from './ZoneMap'
import { ZonePassageList } from './ZonePassageList'
import './brief-map.css'

/** 遷移してきたら見出しにフォーカスを移す（ref のコールバック。useEffect を使わない）。 */
function focusOnMount(el: HTMLHeadingElement | null): void {
  el?.focus()
}

const htmlLang = (lang: Lang) => (lang === 'zh' ? 'zh-Hant' : lang)

/** `/trip/:id/brief?day=n&alert=off` — A-2 出発前ブリーフィング（docs/specs/brief-map/functional.md R6〜R9） */
export function BriefPage() {
  const { id, day, alertOn, setAlertOn } = useBriefParams()
  const query = useTripDay(id, day)

  if (query.isPending) {
    return (
      <main className="brief brief--status" aria-busy="true">
        <p>{BRIEF_TEXT.loading.ja}</p>
      </main>
    )
  }
  if (query.isError)
    return <BriefError error={query.error} onRetry={() => void query.refetch()} id={id} />
  // 日ごとに作り直す（前の日の地図と投影を持ち越さない。見出しへのフォーカスも日ごとに移す）
  return (
    <BriefContent
      key={`${id}-${String(day)}`}
      data={query.data}
      alertOn={alertOn}
      setAlertOn={setAlertOn}
    />
  )
}

function BriefError({ error, onRetry, id }: { error: Error; onRetry: () => void; id: string }) {
  // 旅が読めないので言語が分からない。A-1 の既定の ja で出す
  const lang: Lang = 'ja'
  const t = BRIEF_TEXT
  const status = error instanceof TripDayError ? error.status : null
  const code = error instanceof TripDayError ? error.code : null
  const message =
    code === 'DAY_NOT_FOUND'
      ? t.dayNotFound[lang]
      : status === 404
        ? t.notFound[lang]
        : status === 409
          ? t.outdated[lang]
          : status === 429
            ? t.limited[lang]
            : t.failed[lang]
  return (
    <main className="brief brief--status">
      <h1 className="brief-title" tabIndex={-1} ref={focusOnMount}>
        {message}
      </h1>
      {code === 'DAY_NOT_FOUND' ? (
        <Link className="brief-link" to={briefHref(id, 1, true)}>
          {t.toDay1[lang]}
        </Link>
      ) : status === 404 || status === 409 ? (
        <Link className="brief-link" to="/plan">
          {t.toPlan[lang]}
        </Link>
      ) : (
        <button type="button" className="brief-button brief-button--secondary" onClick={onRetry}>
          {t.retry[lang]}
        </button>
      )}
    </main>
  )
}

type ContentProps = { data: TripDay; alertOn: boolean; setAlertOn: (on: boolean) => void }

function BriefContent({ data, alertOn, setAlertOn }: ContentProps) {
  const { plan, details, day } = data
  const lang = plan.lang
  const t = BRIEF_TEXT
  const route = [
    ...(day.legs.length > 0 ? [day.legs[0]?.from ?? ''] : []),
    ...day.legs.map((l) => l.to),
  ].map((p) => placeName(p, lang))
  const totalKm = day.legs.reduce((sum, l) => sum + l.distanceKm, 0)
  const summary = [
    fillText(t.dayN[lang], { n: day.day }),
    route.length > 0 ? route.join(' → ') : placeName(day.stayAt ?? day.sun.place, lang),
    route.length > 0 ? fillText(t.km[lang], { km: kmLabel(totalKm) }) : null,
    day.sun.sunsetAt
      ? fillText(t.sunset[lang], { time: timeLabel(day.sun.sunsetAt, day.date, lang) })
      : null,
  ]
    .filter(Boolean)
    .join(' ・ ')
  const note = details.dayNotes.find((d) => d.day === day.day)?.note[lang]
  const nextDay = day.day < plan.days.length ? day.day + 1 : null

  return (
    <div className="brief" lang={htmlLang(lang)}>
      <title>{`${t.stepBrief[lang]} | ${t.brand[lang]}`}</title>
      <BriefHeader
        lang={lang}
        tripId={plan.id}
        day={day.day}
        dayCount={plan.days.length}
        alertOn={alertOn}
      />
      <main className="brief-body">
        <section className="brief-main" aria-labelledby="brief-heading">
          <p className="brief-eyebrow">{details.titles[lang]}</p>
          <h1 id="brief-heading" className="brief-title" tabIndex={-1} ref={focusOnMount}>
            {t.heading[lang]}
          </h1>
          <p className="brief-lead">
            <span className="brief-num">{summary}</span>
            {note ? <span className="brief-lead__note">{note}</span> : null}
            <span>{t.zoneLead[lang]}</span>
          </p>
          {day.stops.length > 0 ? (
            <p className="brief-stops">
              {day.stops.map((s) => pleasureName(s.id, lang)).join(' ・ ')}
            </p>
          ) : null}
          <ZoneMap day={day} lang={lang} />
          <ZonePassageList day={day} lang={lang} />
        </section>
        <aside className="brief-aside">
          <AlertToggleCard lang={lang} alertOn={alertOn} onChange={setAlertOn} />
          <ConditionsCard conditions={day.conditions} lang={lang} />
          {day.legs.length > 0 ? (
            // drive（/drive）は react-router の外の画面なので、ページを移るリンクにする
            <a className="brief-button brief-start" href={driveHref(plan.id, day.day, alertOn)}>
              {t.start[lang]}
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M3 8 H13 M9 4 L13 8 L9 12" />
              </svg>
            </a>
          ) : (
            <div className="brief-card">
              <p>
                {fillText(t.noDrive[lang], { place: placeName(day.stayAt ?? day.sun.place, lang) })}
              </p>
              {nextDay ? (
                <Link className="brief-link" to={briefHref(plan.id, nextDay, alertOn)}>
                  {fillText(t.toNextDay[lang], { n: nextDay })}
                </Link>
              ) : null}
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}
