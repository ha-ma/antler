import type { Lang } from '@antler/schema'
import { sunAltitude } from '@antler/zones'
import { jstDayIndex, tripDayCount } from './input'
import { AREA_CIRCUIT, placeById } from './places'
import { pleasureById } from './pleasures'
import { MONTH_FACTORS, STATS } from './stats'
import type {
  Itinerary,
  Localized,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
  TripInput,
} from './types'

// 「この旅が失われるリスク」（functional.md R4、A1-5）。決定的に計算し、端末と api で同じ値を出す。
// 重みは目安で、統計モデルではない（画面に注記する）。統計の数字は stats.json から読む。

export const RISK_WEIGHTS: Record<RiskFactor, number> = {
  area: 0.2,
  month: 0.1,
  sunset: 0.2,
  darkDriving: 0.2,
  experience: 0.2,
  nightPleasure: 0.1,
}

const AREA_VALUE = { doto: 1, doo: 0.5 } as const
const EXPERIENCE_VALUE = { first: 1, few: 0.6, experienced: 0.3 } as const
/** 日没がこれより早ければ 1、遅ければ 0（JST の時） */
const EARLY_SUNSET_H = 16.5
const LATE_SUNSET_H = 19
/** 太陽の高さがこれ未満なら「暗い時間」（zones の光の区分の dusk / night と同じ境） */
const DARK_ALTITUDE_DEG = 6
const SAMPLE_MIN = 15

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const JST_MS = 9 * HOUR_MS
const ORDER: RiskFactor[] = [
  'area',
  'month',
  'sunset',
  'darkDriving',
  'experience',
  'nightPleasure',
]

const round2 = (v: number) => Math.round(v * 100) / 100
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function riskLevel(score: number): RiskLevel {
  if (score >= 0.6) return 'high'
  if (score >= 0.4) return 'caution'
  return 'low'
}

export function assessRisk(input: TripInput, itinerary: Itinerary): RiskAssessment {
  const firstDay = jstDayIndex(input.depart.at)
  const days = Array.from({ length: tripDayCount(input) }, (_, i) => firstDay + i)
  const base = placeById(AREA_CIRCUIT[input.area][0] ?? '')
  if (!base) throw new RangeError('エリアの拠点が無い')

  const months = days.map((d) => new Date(d * DAY_MS).getUTCMonth() + 1)
  const peakMonth = months.reduce((best, m) =>
    (MONTH_FACTORS[m - 1] ?? 0) > (MONTH_FACTORS[best - 1] ?? 0) ? m : best,
  )
  const sunsets = days.map((d) => ({ day: d, ms: sunsetMs(d, base.lat, base.lon) }))
  const earliest = sunsets.reduce((a, b) => (b.ms - b.day * DAY_MS < a.ms - a.day * DAY_MS ? b : a))
  const sunsetHour = (earliest.ms - earliest.day * DAY_MS + JST_MS) / HOUR_MS
  const dark = darkShare(itinerary)
  const included = input.pleasures
    .filter((p) => !itinerary.skipped.includes(p.id))
    .flatMap((p) => pleasureById(p.id) ?? [])
  const nightOnes = included.filter((p) => p.timeOfDay !== 'day')

  const values: Record<RiskFactor, number> = {
    area: AREA_VALUE[input.area],
    month: MONTH_FACTORS[peakMonth - 1] ?? 0,
    sunset: clamp01((LATE_SUNSET_H - sunsetHour) / (LATE_SUNSET_H - EARLY_SUNSET_H)),
    darkDriving: dark,
    experience: EXPERIENCE_VALUE[input.party.experience],
    nightPleasure: nightOnes.length > 0 ? 1 : 0,
  }
  const contributions = Object.fromEntries(
    ORDER.map((f) => [f, round2(RISK_WEIGHTS[f] * values[f])]),
  ) as Record<RiskFactor, number>
  const score = round2(ORDER.reduce((sum, f) => sum + RISK_WEIGHTS[f] * values[f], 0))

  const text: Record<RiskFactor, Localized> = {
    area: areaText(input.area),
    month: monthText(peakMonth, values.month),
    sunset: sunsetText(earliest.ms, base.name),
    darkDriving: darkText(Math.round(dark * 100)),
    experience: experienceText(input.party.experience),
    nightPleasure: nightText(nightOnes.map((p) => p.name)),
  }
  const reasons = [...ORDER]
    .filter((f) => contributions[f] > 0)
    .sort((a, b) => contributions[b] - contributions[a] || ORDER.indexOf(a) - ORDER.indexOf(b))
    .slice(0, 3)
    .map((f) => text[f])

  return { score, level: riskLevel(score), contributions, reasons }
}

/** その日（JST の通し日）の日没の時刻（ms）。正午から 22 時のあいだで太陽の高さが 0° を切る時刻を二分探索で求める。 */
export function sunsetMs(dayIndex: number, lat: number, lon: number): number {
  let lo = dayIndex * DAY_MS - JST_MS + 12 * HOUR_MS
  let hi = lo + 10 * HOUR_MS
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (sunAltitude(mid, { lat, lon }) > 0) lo = mid
    else hi = mid
  }
  return Math.round(lo)
}

/** 移動を 15 分ごとに見て、太陽の高さが +6° 未満の時間の割合。移動が無ければ 0。 */
function darkShare(itinerary: Itinerary): number {
  let total = 0
  let dark = 0
  for (const leg of itinerary.legs) {
    const from = placeById(leg.from)
    const to = placeById(leg.to)
    if (!from || !to) continue
    const steps = Math.max(1, Math.round((leg.hours * 60) / SAMPLE_MIN))
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps
      const lat = from.lat + (to.lat - from.lat) * t
      const lon = from.lon + (to.lon - from.lon) * t
      const at = leg.startMs + leg.hours * HOUR_MS * t
      total += 1
      if (sunAltitude(at, { lat, lon }) < DARK_ALTITUDE_DEG) dark += 1
    }
  }
  return total === 0 ? 0 : dark / total
}

const LANGS: Lang[] = ['ja', 'en', 'zh', 'ko']
const each = (f: (lang: Lang) => string) =>
  Object.fromEntries(LANGS.map((l) => [l, f(l)])) as Localized
const num = (n: number) => n.toLocaleString('en-US')

function areaText(area: TripInput['area']): Localized {
  const { year, total, kushiroArea } = STATS.deerAccidents
  if (area === 'doto') {
    return {
      ja: `道東は鹿との事故が多い地域です。${String(year)} 年は釧路方面だけで ${num(kushiroArea)} 件（全道 ${num(total)} 件）。`,
      en: `Eastern Hokkaido sees many deer collisions: ${num(kushiroArea)} in the Kushiro area alone in ${String(year)} (${num(total)} across Hokkaido).`,
      zh: `道東是鹿隻車禍頻繁的地區。${String(year)} 年光是釧路方面就有 ${num(kushiroArea)} 起（全北海道 ${num(total)} 起）。`,
      ko: `도동은 사슴 충돌 사고가 많은 지역입니다. ${String(year)}년 구시로 방면에서만 ${num(kushiroArea)}건(홋카이도 전체 ${num(total)}건).`,
    }
  }
  return {
    ja: `北海道全体で ${String(year)} 年に ${num(total)} 件の鹿との事故がありました。道央の郊外でも起きています。`,
    en: `Hokkaido had ${num(total)} deer collisions in ${String(year)}, including on the outskirts of central Hokkaido.`,
    zh: `${String(year)} 年全北海道共發生 ${num(total)} 起鹿隻車禍，道央的郊外也會發生。`,
    ko: `${String(year)}년 홋카이도 전체에서 사슴 충돌 사고가 ${num(total)}건 있었습니다. 도오 교외에서도 일어납니다.`,
  }
}

function monthText(month: number, factor: number): Localized {
  const m = String(month)
  if (factor >= 0.75) {
    return {
      ja: `${m} 月は鹿との事故が 1 年でいちばん多い時期です。`,
      en: `Month ${m} is the peak season for deer collisions.`,
      zh: `${m} 月是一年中鹿隻車禍最多的時期。`,
      ko: `${m}월은 사슴 충돌 사고가 1년 중 가장 많은 시기입니다.`,
    }
  }
  return {
    ja: `${m} 月も鹿との事故は起きています。`,
    en: `Deer collisions still happen in month ${m}.`,
    zh: `${m} 月也會發生鹿隻車禍。`,
    ko: `${m}월에도 사슴 충돌 사고는 일어납니다.`,
  }
}

function sunsetText(ms: number, place: Localized): Localized {
  const d = new Date(ms + JST_MS)
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  const md = `${String(d.getUTCMonth() + 1)}/${String(d.getUTCDate())}`
  return each((l) =>
    l === 'ja'
      ? `日没が早い時期です。${md} の${place.ja}の日没は ${hhmm}。薄暮は鹿が道路に出やすい時間です。`
      : l === 'en'
        ? `Sunset comes early: ${hhmm} at ${place.en} on ${md}. Dusk is when deer come onto the road.`
        : l === 'zh'
          ? `日落時間很早：${md} ${place.zh}的日落是 ${hhmm}。黃昏是鹿最常出現在路上的時段。`
          : `해가 일찍 집니다. ${md} ${place.ko}의 일몰은 ${hhmm}. 해질녘은 사슴이 도로에 나오기 쉬운 시간입니다.`,
  )
}

function darkText(pct: number): Localized {
  const p = String(pct)
  return {
    ja: `移動のおよそ ${p}% が薄暮・夜の時間帯です。`,
    en: `About ${p}% of your driving falls at dusk or after dark.`,
    zh: `大約 ${p}% 的行車時間在黃昏或夜間。`,
    ko: `이동의 약 ${p}%가 해질녘이나 밤 시간대입니다.`,
  }
}

function experienceText(exp: TripInput['party']['experience']): Localized {
  if (exp === 'first') {
    return {
      ja: '北海道の運転がはじめての人が運転します。',
      en: 'The drivers are new to driving in Hokkaido.',
      zh: '駕駛人是第一次在北海道開車。',
      ko: '홋카이도 운전이 처음인 사람이 운전합니다.',
    }
  }
  if (exp === 'few') {
    return {
      ja: '北海道の運転の経験が少ない人が運転します。',
      en: 'The drivers have little experience driving in Hokkaido.',
      zh: '駕駛人在北海道開車的經驗不多。',
      ko: '홋카이도 운전 경험이 적은 사람이 운전합니다.',
    }
  }
  return {
    ja: '北海道の運転に慣れた人が運転します。',
    en: 'The drivers are used to driving in Hokkaido.',
    zh: '駕駛人習慣在北海道開車。',
    ko: '홋카이도 운전에 익숙한 사람이 운전합니다.',
  }
}

function nightText(names: Localized[]): Localized {
  return each((l) => {
    const list = names.map((n) => n[l]).join(l === 'ja' || l === 'zh' ? '、' : ', ')
    return l === 'ja'
      ? `暗い時間に運転する楽しみ（${list}）が入っています。`
      : l === 'en'
        ? `Your plan includes driving in the dark for: ${list}.`
        : l === 'zh'
          ? `行程包含需要在天黑時開車的活動（${list}）。`
          : `어두운 시간에 운전하는 일정(${list})이 포함되어 있습니다.`
  })
}
