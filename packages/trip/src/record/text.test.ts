import { Lang } from '@antler/schema'
import { describe, expect, it } from 'vitest'
import { formatClock, formatDateRange, formatSeconds, patternLabel, placeName } from './format'
import { RECORD_TEXT, recordText } from './text'

// docs/specs/record/functional.md UC-8f（4 言語が欠けない）・UC-7e（Asia/Tokyo）

describe('RECORD_TEXT', () => {
  it('UC-8f: 4 言語とも空欄が無く、差し込みの名前が言語で同じ', () => {
    for (const [key, text] of Object.entries(RECORD_TEXT)) {
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      for (const lang of Lang.options) {
        expect(text[lang].trim(), `${key}.${lang}`).not.toBe('')
        expect(names(text[lang]), `${key}.${lang}`).toEqual(names(text.ja))
      }
    }
  })

  it('差し込みを埋める', () => {
    expect(recordText('headingPartial', 'ja', { n: 2 })).toBe('D2 まで走った。')
    expect(recordText('headingPartial', 'en', { n: 2 })).toBe('Drove through Day 2.')
  })
})

describe('format', () => {
  it('UC-7e: 日付と時刻はサーバーの TZ に依らず Asia/Tokyo', () => {
    expect(formatDateRange('2027-02-13T15:30:00Z', '2027-02-18T17:00:00+09:00')).toBe(
      '2027.02.14 – 02.18',
    )
    expect(formatDateRange('2026-12-30T10:00+09:00', '2027-01-02T10:00+09:00')).toBe(
      '2026.12.30 – 2027.01.02',
    )
    expect(formatClock('2027-02-15T07:31:00Z')).toBe('16:31')
    expect(formatSeconds(1450)).toBe('1.4')
  })

  it('地点・出方の名前を言語で引く', () => {
    expect(placeName('CTS', 'ja')).toContain('新千歳')
    expect(placeName('unknown-place', 'en')).toBe('unknown-place')
    expect(patternLabel('herd', 'ko')).toBe('무리')
  })
})
