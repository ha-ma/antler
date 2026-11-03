import type { Lang } from '@antler/schema'
import { placeById, type DayPlan } from '@antler/trip'
import type { LonLat } from '@antler/zones'
import { useMemo } from 'react'
import { useBaseMap } from '../hooks/useBaseMap'
import { buildOverlay } from '../map/overlay'
import { boundsOf } from '../map/projection'
import { BRIEF_TEXT, fillText } from '../text'
import { kmLabel, placeName, tagWidth, timeLabel } from '../utils/format'
import { lightText } from '../utils/light'

type Props = { day: DayPlan; lang: Lang }

/** 地図（R9）: MapLibre の背景の上に、ルート・ゾーンの帯・地点・名札の SVG を重ねる。背景が無くても同じ SVG を出す */
export function ZoneMap({ day, lang }: Props) {
  const t = BRIEF_TEXT
  const lines = useMemo(() => {
    if (day.legs.length > 0) return day.legs.map((l) => l.route as LonLat[])
    const stay = placeById(day.stayAt ?? day.sun.place)
    return stay ? [[[stay.lon, stay.lat] as LonLat]] : []
  }, [day])
  const bounds = useMemo(() => (lines.length > 0 ? boundsOf(lines) : null), [lines])
  const { ref, state } = useBaseMap(bounds)
  const project = state.project
  const overlay = useMemo(() => (project ? buildOverlay(day, project) : null), [day, project])
  const stayPoint = useMemo(() => {
    const first = lines[0]?.[0]
    return day.legs.length === 0 && first && project ? project(first) : null
  }, [day.legs.length, lines, project])

  const from = day.legs[0]?.from ?? day.stayAt ?? day.sun.place
  const to = day.legs[day.legs.length - 1]?.to ?? from
  const zonesText =
    day.zones.length === 0
      ? t.mapNoZone[lang]
      : day.zones
          .map((z) =>
            fillText(t.mapZone[lang], {
              road: z.roadName[lang],
              from: timeLabel(z.entryAt, day.date, lang),
              to: timeLabel(z.exitAt, day.date, lang),
            }),
          )
          .join(' ')
  const label = fillText(t.mapLabel[lang], {
    from: placeName(from, lang),
    to: placeName(to, lang),
    zones: zonesText,
  })

  return (
    <figure className="brief-map">
      {/* 枠の高さは CSS で決める（SVG の viewBox から高さを決めると、大きさの監視と互いに伸び続ける） */}
      <div className="brief-map__frame">
        <div className="brief-map__base" ref={ref} />
        {state.project ? (
          <svg
            className="brief-map__overlay"
            viewBox={`0 0 ${String(state.size.width)} ${String(state.size.height)}`}
            role="img"
            aria-label={label}
            data-mode={state.mode}
          >
            {overlay ? (
              <>
                <g className="brief-map__casing">
                  {[...overlay.routeOutside, ...overlay.routeInside].map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                </g>
                <g className="brief-map__bands" data-testid="zone-bands">
                  {overlay.bands.map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                </g>
                <g className="brief-map__route">
                  {overlay.routeOutside.map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                </g>
                <g className="brief-map__route brief-map__route--zone">
                  {overlay.routeInside.map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                </g>
                {/* 名札を先に描き、地点の名前を上に重ねる（名札で地点が隠れない） */}
                {overlay.labels.map((l) => {
                  const z = day.zones[l.passage]
                  if (!z) return null
                  const text = fillText(t.zoneTag[lang], {
                    km: kmLabel(z.exitKm - z.entryKm),
                    light: lightText(z.light, lang),
                  })
                  // 文の長さで幅を変え（4 言語の最長でも切れない）、枠からはみ出さないよう中心を寄せる
                  const width = tagWidth(text)
                  const x = Math.min(Math.max(l.x, width / 2 + 8), state.size.width - width / 2 - 8)
                  const y = Math.min(l.y + 30, state.size.height - 22)
                  return (
                    <g
                      key={l.passage}
                      className="brief-map__tag"
                      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
                    >
                      <rect x={-width / 2} y={-14} width={width} height={28} rx={14} />
                      <text textAnchor="middle" y={5}>
                        {text}
                      </text>
                    </g>
                  )
                })}
                {overlay.points.map((p, i) => (
                  <g
                    key={i}
                    className={`brief-map__point brief-map__point--${p.kind}`}
                    transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                  >
                    <circle r={p.kind === 'stop' ? 7 : 9} />
                    {/* 右端に近い地点は名前を左に出す（枠で切れない） */}
                    <text
                      x={p.x > state.size.width * 0.6 ? -14 : 14}
                      y={5}
                      textAnchor={p.x > state.size.width * 0.6 ? 'end' : 'start'}
                    >
                      {placeName(p.place, lang)}{' '}
                      {p.kind === 'depart'
                        ? fillText(t.departAt[lang], { time: timeLabel(p.at, day.date, lang) })
                        : fillText(t.arriveAt[lang], { time: timeLabel(p.at, day.date, lang) })}
                    </text>
                  </g>
                ))}
              </>
            ) : null}
            {stayPoint ? (
              <g
                className="brief-map__point brief-map__point--arrive"
                transform={`translate(${stayPoint[0].toFixed(1)} ${stayPoint[1].toFixed(1)})`}
              >
                <circle r={9} />
                <text x={14} y={5}>
                  {placeName(from, lang)}
                </text>
              </g>
            ) : null}
          </svg>
        ) : (
          <p className="brief-map__loading">{t.loading[lang]}</p>
        )}
      </div>
      <figcaption className="brief-map__caption">
        <ul className="brief-map__legend">
          <li>
            <span className="brief-swatch brief-swatch--route" aria-hidden="true" />
            {t.legendRoute[lang]}
          </li>
          <li>
            <span className="brief-swatch brief-swatch--zone" aria-hidden="true" />
            {t.legendZone[lang]}
          </li>
          <SunChip day={day} lang={lang} />
        </ul>
        {state.mode === 'fallback' ? <p className="brief-map__note">{t.fallback[lang]}</p> : null}
        {day.legs.some((l) => l.source === 'straight') ? (
          <p className="brief-map__note">{t.straight[lang]}</p>
        ) : null}
        <p className="brief-map__attr">
          {state.mode === 'map' ? <span>{t.attrTiles[lang]} ・ </span> : null}
          <span>{t.attrRoute[lang]}</span>{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            {t.attrLink[lang]}
          </a>
        </p>
      </figcaption>
    </figure>
  )
}

function SunChip({ day, lang }: Props) {
  const t = BRIEF_TEXT
  const { sunsetAt, duskStartAt, duskEndAt, place } = day.sun
  if (!sunsetAt) return null
  return (
    <li className="brief-map__sun">
      {fillText(t.sunset[lang], { time: timeLabel(sunsetAt, day.date, lang) })}
      {duskStartAt && duskEndAt
        ? ` ・ ${fillText(t.dusk[lang], {
            from: timeLabel(duskStartAt, day.date, lang),
            to: timeLabel(duskEndAt, day.date, lang),
          })}`
        : null}
      {fillText(t.sunAt[lang], { place: placeName(place, lang) })}
    </li>
  )
}
