import { recordText, type RecordView } from '@antler/trip'
import { ResultMark } from './ResultMark'

// しおり（docs/specs/record/functional.md R5）。各日に結果の印と文字、OFF の印と OFF の挑戦の結果。

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
