import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PERSONA_INPUT } from './input'
import { buildItinerary } from './itinerary'
import { formatBudget, initialLang } from './locale'
import { pleasuresInArea } from './pleasures'
import { assessRisk } from './risk'
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
    const withNight = risk({
      ...PERSONA_INPUT,
      pleasures: [...PERSONA_INPUT.pleasures, { id: night.id, weight: 1 }],
    })
    expect(withNight.score).toBeGreaterThan(risk(PERSONA_INPUT).score)
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
