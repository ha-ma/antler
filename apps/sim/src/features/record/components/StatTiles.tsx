import { recordText, type RecordView } from '@antler/trip'

// StatTile 4 つ（docs/specs/record/functional.md R5）。ラベル caption → 値 num-l、単位は 40 %。

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
