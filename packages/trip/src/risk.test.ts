import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PERSONA_INPUT } from './input'
import { buildItinerary } from './itinerary'
import { formatBudget, initialLang } from './locale'
import { pleasuresInArea } from './pleasures'
import { assessRisk, darkShare, monthText, riskLevel, sunsetMs } from './risk'
import { jstDayIndex } from './dates'
import { MONTH_FACTORS, STATS } from './stats'
import type { TripInput } from './types'

const here = path.dirname(fileURLToPath(import.meta.url))
const risk = (input: TripInput) => assessRisk(input, buildItinerary(input))

const SUMMER_DOO: TripInput = {
  ...PERSONA_INPUT,
  area: 'doo',
  party: { ...PERSONA_INPUT.party, experience: 'experienced' },
  depart: { at: '2027-07-10T10:00:00+09:00', place: 'CTS' },
  return: { at: '2027-07-13T17:00:00+09:00', place: 'CTS' },
  pleasures: [],
}

describe('UC-4 リスクスコア（assessRisk）', () => {
  it('UC-4a: ペルソナ → 0.6 以上「高い」。7 月・道央・慣れている・夜の楽しみなし → 0.4 未満「低め」', () => {
    const persona = risk(PERSONA_INPUT)
    expect(persona.score).toBeGreaterThanOrEqual(0.6)
    expect(persona.level).toBe('high')
    const summer = risk(SUMMER_DOO)
    expect(summer.score).toBeLessThan(0.4)
    expect(summer.level).toBe('low')
  })

  it('UC-4b: 根拠文は 3 行以下、4 言語、統計の数字は stats.json の値と一致', () => {
    const { reasons } = risk(PERSONA_INPUT)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.length).toBeLessThanOrEqual(3)
    for (const r of reasons) {
      for (const text of [r.ja, r.en, r.zh, r.ko]) expect(text.length).toBeGreaterThan(0)
    }
    const all = reasons.map((r) => r.ja).join('')
    expect(all).toContain(STATS.deerAccidents.kushiroArea.toLocaleString('en-US'))
  })

  it('UC-4c: 夜・早朝の楽しみを足すとスコアが上がる。経験が上がると下がる', () => {
    const night = pleasuresInArea('doto').find((p) => p.timeOfDay !== 'day')
    if (!night) throw new Error('道東に夜・早朝の楽しみが無い')
    // ペルソナは夜のアイヌコタンを含む（plan-trip-photos）ので、昼の楽しみだけの旅と比べる
    const dayOnly = {
      ...PERSONA_INPUT,
      pleasures: PERSONA_INPUT.pleasures.filter(
        (p) => pleasuresInArea('doto').find((q) => q.id === p.id)?.timeOfDay === 'day',
      ),
    }
    const withNight = risk({ ...dayOnly, pleasures: [...dayOnly.pleasures, { id: night.id }] })
    expect(withNight.score).toBeGreaterThan(risk(dayOnly).score)
    const veteran = risk({
      ...PERSONA_INPUT,
      party: { ...PERSONA_INPUT.party, experience: 'experienced' },
    })
    expect(veteran.score).toBeLessThan(risk(PERSONA_INPUT).score)
  })

  it('月別係数の写しが zones.source.json の factors と一致する（正は zones）', () => {
    const source = JSON.parse(
      readFileSync(path.resolve(here, '../../zones/data/zones.source.json'), 'utf-8'),
    ) as { factors: { months: number[] } }
    expect(MONTH_FACTORS).toEqual(source.factors.months)
  })
})

describe('UC-4 の境目（[ADDED code-reviewer]）', () => {
  it('UC-4d: 「いちばん多い」は係数が最大の月（10 月）だけ。11 月は「多い時期」', () => {
    const peak = MONTH_FACTORS.indexOf(Math.max(...MONTH_FACTORS)) + 1
    expect(peak).toBe(10)
    expect(monthText(10, MONTH_FACTORS[9] ?? 0).ja).toContain('いちばん多い')
    const nov = monthText(11, MONTH_FACTORS[10] ?? 0)
    expect(nov.ja).not.toContain('いちばん')
    expect(nov.ja).toContain('多い時期')
  })

  it('UC-4e: 区分の境目は 0.6 で「高い」、0.4 で「注意」、それ未満は「低め」', () => {
    expect(riskLevel(0.6)).toBe('high')
    expect(riskLevel(0.59)).toBe('caution')
    expect(riskLevel(0.4)).toBe('caution')
    expect(riskLevel(0.39)).toBe('low')
  })

  it('UC-4f: 日没は太陽の高さが 0° を切る時刻（釧路 2/14 は 16:30〜17:00、札幌 7/10 は 19:00 以降）', () => {
    const hourJst = (ms: number) => (((ms / 3_600_000 + 9) % 24) + 24) % 24
    const feb = sunsetMs(jstDayIndex('2027-02-14T12:00:00+09:00'), 42.985, 144.381)
    expect(hourJst(feb)).toBeGreaterThan(16.5)
    expect(hourJst(feb)).toBeLessThan(17)
    const jul = sunsetMs(jstDayIndex('2027-07-10T12:00:00+09:00'), 43.062, 141.354)
    expect(hourJst(jul)).toBeGreaterThan(19)
  })

  it('UC-4g: 暗い時間の割合は時間で重み付け（暗い 1 時間 ＋ 明るい 3 時間 → 0.25）', () => {
    const at = (iso: string) => Date.parse(iso)
    const share = darkShare({
      days: [],
      skipped: [],
      legs: [
        { day: 1, from: 'cts', to: 'sapporo', startMs: at('2027-02-14T22:00:00+09:00'), hours: 1 },
        { day: 2, from: 'sapporo', to: 'cts', startMs: at('2027-02-15T10:00:00+09:00'), hours: 3 },
      ],
    })
    expect(share).toBeCloseTo(0.25, 2)
  })
})

describe('UC-6 言語と通貨', () => {
  it('UC-6a: ブラウザの言語から初期言語を決める（zh-TW → zh、fr → ja）', () => {
    expect(initialLang(['zh-TW', 'en'])).toBe('zh')
    expect(initialLang(['zh-Hant-HK'])).toBe('zh')
    expect(initialLang(['zh-CN'])).toBe('ja')
    expect(initialLang(['fr-FR', 'ko-KR'])).toBe('ko')
    expect(initialLang(['fr'])).toBe('ja')
    expect(initialLang(['en-US'])).toBe('en')
    expect(initialLang([])).toBe('ja')
  })

  it('UC-6b: 予算の USD 併記は設定のレートで 10 ドル単位', () => {
    expect(formatBudget(120_000, 'ja')).toBe('¥120,000（約 $800）')
    expect(formatBudget(0, 'en')).toBe('¥0（approx. $0）')
    expect(formatBudget(1_234, 'ko')).toBe('¥1,234（약 $10）')
  })
})
