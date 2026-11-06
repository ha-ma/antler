/// <reference types="vite/client" />
// ↑ import.meta.glob の型（packages の tsconfig は vite/client を読まないので、このテストだけで読む）
import { checkTables, formatProblems, type TableAllowance } from '@antler/i18n-check'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import placesJson from '../data/places.json'
import pleasuresJson from '../data/pleasures.json'
import { buildItinerary } from './itinerary'
import { PERSONA_INPUT } from './input'
import { formatBudget } from './locale'
import { assessRisk } from './risk'
import { draftTitles } from './title'
import type { TripInput } from './types'

// @antler/trip の 4 言語の文言を全部集めて検査する（docs/specs/i18n/functional.md R2・R3、INV-1）。
// 名前の規則（text.ts・*-text.ts・i18n.ts）の表は自動で集まる。関数で作る文（risk・title・locale）は見本を出し、
// JSON の表（楽しみ・地点、zones の道路名）は明示して読む（scripts/ci_arch_check.py は import の登録を見る）。

const BY_NAME = import.meta.glob(['./**/text.ts', './**/*-text.ts', './**/i18n.ts'], {
  eager: true,
})

/** 見本の旅（関数で作る文を全部の分岐で出すため、季節・地域・経験・夜の楽しみを振る） */
const INPUTS: TripInput[] = [
  PERSONA_INPUT,
  {
    ...PERSONA_INPUT,
    lang: 'ja',
    area: 'doo',
    party: { ...PERSONA_INPUT.party, experience: 'experienced' },
    depart: { ...PERSONA_INPUT.depart, at: '2027-07-10T10:00:00+09:00' },
    return: { ...PERSONA_INPUT.return, at: '2027-07-13T17:00:00+09:00' },
    pleasures: [],
  },
  {
    ...PERSONA_INPUT,
    party: { ...PERSONA_INPUT.party, experience: 'few' },
    depart: { ...PERSONA_INPUT.depart, at: '2027-10-10T10:00:00+09:00' },
    return: { ...PERSONA_INPUT.return, at: '2027-10-13T17:00:00+09:00' },
  },
  {
    ...PERSONA_INPUT,
    depart: { ...PERSONA_INPUT.depart, at: '2027-11-10T10:00:00+09:00' },
    return: { ...PERSONA_INPUT.return, at: '2027-11-13T17:00:00+09:00' },
  },
]

function samples() {
  return INPUTS.map((input) => {
    const itinerary = buildItinerary(input)
    return {
      titles: draftTitles(input, itinerary),
      reasons: assessRisk(input, itinerary).reasons,
    }
  })
}

const zones = JSON.parse(
  readFileSync(new URL('../../zones/data/zones.geojson', import.meta.url), 'utf8'),
) as { features: { properties: { id: string; roadName: unknown } }[] }

const EXTRA: Record<string, unknown> = {
  './risk.ts・./title.ts（見本）': samples(),
  './locale.ts（見本）': {
    budget: {
      ja: formatBudget(120_000, 'ja'),
      en: formatBudget(120_000, 'en'),
      zh: formatBudget(120_000, 'zh'),
      ko: formatBudget(120_000, 'ko'),
    },
  },
  '../data/places.json': placesJson,
  '../data/pleasures.json': pleasuresJson,
  // 画面に出すのは道路名だけ（section は ja・en だけで、どの画面にも出さない）
  '../../zones/data/zones.geojson（道路名）': zones.features.map((f) => f.properties.roadName),
}

const ALLOW: TableAllowance[] = []

describe('INV-1 trip の文言の表（4 言語）', () => {
  const result = checkTables({ ...BY_NAME, ...EXTRA }, { allow: ALLOW })

  it('表を読めている', () => {
    expect(Object.keys(BY_NAME).length).toBeGreaterThanOrEqual(1)
    expect(result.entries).toBeGreaterThan(150)
  })

  it('全部の組が 4 言語の規則を通る', () => {
    expect(result.problems, `\n${formatProblems(result.problems)}\n`).toEqual([])
  })

  it('使われない例外が無い', () => {
    expect(result.unusedAllowances).toEqual([])
  })
})
