import { recordText, type RecordView } from '@antler/trip'

// 守れたもの（docs/specs/record/functional.md R5）。写真の実物は Day 6（いまは photo-placeholder に案内）。

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
