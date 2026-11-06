import { PLAN_TEXT, fillText, type PlanTextKey } from './text'

const LANGS = ['ja', 'en', 'zh', 'ko'] as const
const PLACEHOLDER = /\{(\w+)\}/g

function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '').sort()
}

describe('PLAN_TEXT（R6・付録 A #9: 4 言語が欠けない）', () => {
  const keys = Object.keys(PLAN_TEXT) as PlanTextKey[]

  it.each(keys)('UC-6 %s は 4 言語とも空でない', (key) => {
    const entry: Record<string, string> = PLAN_TEXT[key]
    expect(Object.keys(entry).sort()).toEqual([...LANGS].sort())
    for (const lang of LANGS) {
      expect(entry[lang]?.trim()).not.toBe('')
    }
  })

  it.each(keys)('UC-6 %s は 4 言語で差し込みの名前がそろう', (key) => {
    const ja = placeholders(PLAN_TEXT[key].ja)
    for (const lang of LANGS) {
      expect(placeholders(PLAN_TEXT[key][lang])).toEqual(ja)
    }
  })

  it('fillText は差し込みを埋める', () => {
    expect(fillText('hours', 'ja', { n: 3 })).toBe('約 3 時間')
    expect(fillText('nightsDays', 'en', { nights: 4, days: 5 })).toBe('4 nights, 5 days')
  })
})
