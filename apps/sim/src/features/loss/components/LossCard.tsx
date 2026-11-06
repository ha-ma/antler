import type { Lang } from '@antler/schema'
import type { ItineraryRow } from '../domain/strike'
import { fillText, LOSS_TEXT } from '../text'
import { dropClass, type DropStyle } from '../utils/drop'
import { clockOf, placeName, pleasureName } from '../utils/format'

type Props = {
  lang: Lang
  title: string
  dayCount: number
  rows: ItineraryRow[]
  /** 落ちて積み重なる並びの番号と傾き（result-screens R2。しおりは −1.5°） */
  drop?: DropStyle
}

function rowText(row: ItineraryRow, lang: Lang): string {
  const t = LOSS_TEXT
  switch (row.kind) {
    case 'route':
      return fillText(t.routeRow[lang], {
        from: placeName(row.from, lang),
        to: placeName(row.to, lang),
      })
    case 'stop':
      return pleasureName(row.id, lang)
    case 'stay':
      return fillText(t.stayRow[lang], { place: placeName(row.place, lang) })
    case 'collision':
      return fillText(t.collisionRow[lang], {
        time: clockOf(row.at),
        from: placeName(row.from, lang),
        to: placeName(row.to, lang),
      })
  }
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3 8.5 L6.5 12 L13 4.5" />
    </svg>
  )
}

function CrossMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M4 4 L12 12 M12 4 L4 12" />
    </svg>
  )
}

/**
 * LossCard（A6-1、functional.md R2）: しおりに取り消し線、衝突の位置に ✕（alert-danger）、−1.5° 回転、trip の紙の面。
 * 取り消し線は <s> で書き、読み上げ用に「取り消し」を添える。✓ / ✕ はインライン SVG（stroke）。
 */
export function LossCard({ lang, title, dayCount, rows, drop }: Props) {
  const t = LOSS_TEXT
  return (
    <section
      className={dropClass('loss-card', drop)}
      style={drop}
      data-theme="trip"
      aria-labelledby="loss-card-heading"
    >
      <div className="loss-card__head">
        <h2 id="loss-card-heading" className="loss-card__eyebrow">
          {t.cardHeading[lang]}
        </h2>
        <span className="loss-num loss-card__days">
          {fillText(t.cardDays[lang], { n: dayCount })}
        </span>
      </div>
      <p className="loss-card__title">
        <s>{title}</s>
        <span className="loss-visually-hidden">（{t.struck[lang]}）</span>
      </p>
      <ol className="loss-card__rows">
        {rows.map((row, i) => {
          const day = fillText(t.dayLabel[lang], { n: row.day })
          const text = rowText(row, lang)
          return (
            <li
              key={`${row.kind}-${String(row.day)}-${String(i)}`}
              className={`loss-row loss-row--${row.status}`}
            >
              <span className="loss-row__mark loss-num">
                {row.status === 'achieved' ? <CheckMark /> : null}
                {row.status === 'collision' ? <CrossMark /> : null}
                {row.status === 'lost' ? day : null}
              </span>
              {row.status === 'lost' ? (
                <span>
                  <s>{text}</s>
                  <span className="loss-visually-hidden">（{t.struck[lang]}）</span>
                </span>
              ) : (
                <span>
                  <span className="loss-num">{day}</span> {text}
                  {row.status === 'achieved' ? (
                    <span className="loss-visually-hidden">（{t.done[lang]}）</span>
                  ) : null}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
