import type { RecordView } from '@antler/trip'

// 鹿ゾーンでの各回のログ（docs/specs/record/functional.md R5）。結果は色と文字の両方で出す（回避・間一髪・衝突）。

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
