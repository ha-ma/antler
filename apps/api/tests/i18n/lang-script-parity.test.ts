import { SIMPLIFIED_CHARS as SHARED_SIMPLIFIED, scriptProblems } from '@antler/i18n-check'
import {
  SIMPLIFIED_CHARS,
  langScriptProblems,
} from '../../src/domain/shared/policies/lang-script-policy.js'
import { TRIP_LANGS } from '../../src/domain/trips/models/trip-writing.js'

// GEN-1（docs/specs/i18n/functional.md R8）: api の Domain は外部のパッケージに依存しないので、
// 文字種の規則を domain に写して持つ。@antler/i18n-check の出力の規則（mode: 'output'）とずれたら落とす。

const SAMPLES = [
  '雪原を走る日',
  'Snowy roads',
  '雪原之路',
  '눈길 드라이브',
  '开车去看雪',
  '雪のみち',
  '눈길 ドライブ',
  'Snowy みち',
  'Lake Mashu (摩周湖)',
  '出発',
  '園內',
  '123',
  'D{n} 雪',
  'ON',
  '',
]

describe('GEN-1: domain の文字種の規則が @antler/i18n-check と同じ', () => {
  it('簡体字の一覧が同じ', () => {
    expect([...SIMPLIFIED_CHARS].sort()).toEqual([...SHARED_SIMPLIFIED].sort())
  })

  it.each(TRIP_LANGS)('%s: 見本の文の判定が同じ', (lang) => {
    for (const text of SAMPLES) {
      expect(langScriptProblems(lang, text), text).toEqual(
        scriptProblems(lang, text, { mode: 'output' }),
      )
    }
  })
})
