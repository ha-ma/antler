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

  it('TEXT-1 送信ボタンは押すと起きること（しおり・鹿ゾーンの確認）を言う（result-screens R1）', () => {
    expect(PLAN_TEXT.submit).toEqual({
      ja: 'しおりを作って鹿ゾーンを確かめる →',
      en: 'Make my plan & check deer zones →',
      zh: '製作手冊並確認鹿區 →',
      ko: '일정표 만들고 사슴 구역 확인하기 →',
    })
    const all = Object.values(PLAN_TEXT).flatMap((entry) => Object.values(entry))
    expect(all.filter((s) => /守りに行く|protect this trip|去守護|지키러/.test(s))).toEqual([])
  })

  it('fillText は差し込みを埋める', () => {
    expect(fillText('hours', 'ja', { n: 3 })).toBe('約 3 時間')
    expect(fillText('nightsDays', 'en', { nights: 4, days: 5 })).toBe('4 nights, 5 days')
  })
})
