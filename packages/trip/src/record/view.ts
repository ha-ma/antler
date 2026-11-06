import type { Lang } from '@antler/schema'
import {
  formatClock,
  formatDateRange,
  formatSeconds,
  patternLabel,
  placeName,
  pleasureLabel,
} from './format'
import type { DayResult, TripRecord } from './summary'
import { recordText } from './text'
import type { RecordTrip } from './trip-view'

// A-7 の表示の形（docs/specs/record/functional.md R5・R6・R7）。sim の画面・api の SSR・OG 画像が同じものを描く。
// 記号（✓ ✕）は持たない。描く側が形（SVG）と文字の代わり（resultLabel）で出す。

export type StatKey = 'pleasures' | 'zones' | 'deer' | 'brake'
export type LogTone = 'avoided' | 'closeCall' | 'collided'

export type RecordView = {
  lang: Lang
  title: string
  eyebrow: string
  heading: string
  summary: string
  stats: { key: StatKey; label: string; value: string; unit: string }[]
  kept: { id: string; dayLabel: string; name: string; note: string }[]
  keptHeading: string
  keptEmpty: string
  logHeading: string
  logEmpty: string
  /** 鹿の発見の 1 行（drive-crash-spot R4）。合計が無い・見えた鹿が 0 なら null */
  spotting: string | null
  log: { when: string; what: string; brake: string; tone: LogTone; outcomeLabel: string }[]
  shiori: {
    heading: string
    completed: boolean
    statusLabel: string
    rows: {
      day: number
      title: string
      detail: string
      result: DayResult
      resultLabel: string
      /** その日の結果が OFF の run */
      alertOff: boolean
      /** OFF の挑戦の結果（「OFF 完走」など）。無ければ null */
      offChallenge: string | null
    }[]
  }
}

const RESULT_KEY = {
  completed: 'resultCompleted',
  collided: 'resultCollided',
  'not-driven': 'resultNotDriven',
} as const

export function buildRecordView(trip: RecordTrip, record: TripRecord): RecordView {
  const { lang } = trip
  const t = (key: Parameters<typeof recordText>[0], values?: Record<string, string | number>) =>
    recordText(key, lang, values)
  const dayLabel = (n: number) => t('dayLabel', { n })
  const { totals } = record

  const heading =
    record.status === 'completed'
      ? t('headingCompleted')
      : record.status === 'not-started'
        ? t('headingNotStarted')
        : t('headingPartial', { n: record.furthestDay })

  return {
    lang,
    title: trip.title,
    eyebrow: t('eyebrow', { dates: formatDateRange(trip.depart.at, trip.return.at) }),
    heading,
    summary: t('summary', {
      party: trip.partySize,
      days: trip.days.length,
      zones: totals.zonePasses,
      met: totals.encounters,
      avoided: totals.avoided,
    }),
    stats: [
      {
        key: 'pleasures',
        label: t('statPleasures'),
        value: `${String(totals.pleasuresProtected)} / ${String(totals.pleasuresTotal)}`,
        unit: '',
      },
      {
        key: 'zones',
        label: t('statZones'),
        value: String(totals.zonePasses),
        unit: t('unitTimes'),
      },
      {
        key: 'deer',
        label: t('statDeer'),
        value: `${String(totals.encounters)} / ${String(totals.avoided)}`,
        unit: '',
      },
      {
        key: 'brake',
        label: t('statBrake'),
        value:
          totals.alertToBrakeAvgMs === null
            ? t('noValue')
            : formatSeconds(totals.alertToBrakeAvgMs),
        unit: totals.alertToBrakeAvgMs === null ? '' : t('unitSeconds'),
      },
    ],
    kept: record.pleasures
      .filter((p) => p.protected)
      .map((p) => ({ id: p.id, dayLabel: dayLabel(p.day), ...pleasureLabel(p.id, lang) })),
    keptHeading: t('keptHeading'),
    keptEmpty: t('keptEmpty'),
    logHeading: t('logHeading', { n: record.log.length }),
    logEmpty: t('logEmpty'),
    spotting:
      totals.spotting && totals.spotting.appeared > 0
        ? t('spotting', { ...totals.spotting })
        : null,
    log: record.log.map((l) => {
      const tone: LogTone =
        l.outcome === 'collided' ? 'collided' : l.closeCall ? 'closeCall' : 'avoided'
      return {
        when: l.at ? `${dayLabel(l.day)} ${formatClock(l.at)}` : dayLabel(l.day),
        what: `${patternLabel(l.pattern, lang)} ・ ${t('closest', { m: Math.round(l.closestM) })}`,
        brake: !l.alertEnabled
          ? t('alertOff')
          : l.alertToBrakeMs === null
            ? t('noValue')
            : t('alertToBrake', { s: formatSeconds(l.alertToBrakeMs) }),
        tone,
        outcomeLabel: t(
          tone === 'collided'
            ? 'outcomeCollided'
            : tone === 'closeCall'
              ? 'outcomeCloseCall'
              : 'outcomeAvoided',
        ),
      }
    }),
    shiori: {
      heading: t('shioriHeading'),
      completed: record.status === 'completed',
      statusLabel: record.status === 'completed' ? t('shioriCompleted') : t('shioriPartial'),
      rows: trip.days.map((d) => {
        const day = record.days.find((r) => r.day === d.day)
        const result = day?.result ?? 'not-driven'
        const stops = d.stops.map((id) => pleasureLabel(id, lang).name)
        const stay = d.stay ? t('stayAt', { place: placeName(d.stay, lang) }) : ''
        return {
          day: d.day,
          title: `${dayLabel(d.day)} ${placeName(d.from, lang)} → ${placeName(d.to, lang)}`,
          detail: [...stops, stay].filter(Boolean).join(' ・ '),
          result,
          resultLabel: t(RESULT_KEY[result]),
          alertOff: day?.alertEnabled === false,
          offChallenge:
            day?.offResult && day.alertEnabled !== false
              ? t('offChallenge', { mark: t(RESULT_KEY[day.offResult]) })
              : null,
        }
      }),
    },
  }
}
