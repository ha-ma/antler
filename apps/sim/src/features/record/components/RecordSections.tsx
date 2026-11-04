import { recordText, type RecordView } from '@antler/trip'
import { ResultMark } from './ResultMark'

// A-7 の本文の各欄（docs/specs/record/functional.md R5・R8）。表示の形（RecordView）は @antler/trip が作り、
// api の SSR・OG 画像と同じものを描く。色は tokens.css の CSS 変数だけ（record.css）。

export function StatTiles({ view }: { view: RecordView }) {
  return (
    <dl className="record-stats" aria-label={recordText('statsLabel', view.lang)}>
      {view.stats.map((s) => (
        <div key={s.key} className={`record-stat record-stat--${s.key}`}>
          <dt>{s.label}</dt>
          <dd>
            {s.value}
            {s.unit ? <small>{s.unit}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function KeptList({ view }: { view: RecordView }) {
  return (
    <section className="record-card" aria-labelledby="record-kept">
      <h2 id="record-kept">{view.keptHeading}</h2>
      {view.kept.length === 0 ? (
        <p className="record-empty">{view.keptEmpty}</p>
      ) : (
        <ul className="record-kept">
          {view.kept.map((k) => (
            <li key={k.id}>
              <div className="record-photo">{recordText('photoPending', view.lang)}</div>
              <b>
                {k.dayLabel} {k.name}
              </b>
              <span>{k.note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ZoneLog({ view }: { view: RecordView }) {
  return (
    <section className="record-card" aria-labelledby="record-log">
      <h2 id="record-log">{view.logHeading}</h2>
      {view.log.length === 0 ? (
        <p className="record-empty">{view.logEmpty}</p>
      ) : (
        <ol className="record-log">
          {view.log.map((l, i) => (
            <li key={`${l.when}-${String(i)}`}>
              <span className="record-log__when">{l.when}</span>
              <span className="record-log__what">{l.what}</span>
              <span className="record-log__brake">{l.brake}</span>
              <span className={`record-log__outcome record-log__outcome--${l.tone}`}>
                {l.outcomeLabel}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function ShioriCard({ view }: { view: RecordView }) {
  const { shiori } = view
  return (
    <section className="record-card record-shiori" aria-labelledby="record-shiori">
      <div className="record-shiori__head">
        <h2 id="record-shiori">{shiori.heading}</h2>
        <span className="record-chip">{shiori.statusLabel}</span>
      </div>
      <p className="record-shiori__title">{view.title}</p>
      <ol>
        {shiori.rows.map((r) => (
          <li key={r.day} className="record-shiori__row">
            <ResultMark result={r.result} />
            <span>
              {r.title}
              {r.alertOff ? (
                <span className="record-off"> {recordText('alertOff', view.lang)}</span>
              ) : null}
              {r.offChallenge ? <span className="record-off"> {r.offChallenge}</span> : null}
              <small>
                {r.resultLabel}
                {r.detail ? ` ・ ${r.detail}` : ''}
              </small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function BIntro({ lang, href }: { lang: RecordView['lang']; href: string }) {
  const t = (key: Parameters<typeof recordText>[0]) => recordText(key, lang)
  return (
    <section className="record-b" data-theme="night" aria-labelledby="record-b">
      <div className="record-b__head">
        <div className="record-b__phone" aria-hidden="true">
          <span />
        </div>
        <div>
          <h2 id="record-b">{t('bHeading')}</h2>
          <p>{t('bBody')}</p>
        </div>
      </div>
      <ul>
        <li>{t('bPoint1')}</li>
        <li>{t('bPoint2')}</li>
        <li>{t('bPoint3')}</li>
      </ul>
      <a className="record-b__link" href={href}>
        {t('bLink')} <span aria-hidden="true">→</span>
      </a>
    </section>
  )
}
