import { LANGS } from '@antler/alert-ui'
import { describe, expect, it } from 'vitest'
import { CAPTURE_TEXT, fill } from './i18n'

const PLACEHOLDER = /\{(\w+)\}/g
const names = (value: string) => [...value.matchAll(PLACEHOLDER)].map((m) => m[1]).sort()

describe('走行後の同意画面の文言', () => {
  it('GATE-1d: 固定文言の辞書は ja / en / zh / ko の全キーが空でない（#9）', () => {
    const keys = Object.keys(CAPTURE_TEXT.ja)
    for (const lang of LANGS) {
      expect(Object.keys(CAPTURE_TEXT[lang]).sort()).toEqual([...keys].sort())
      for (const key of keys) {
        const value = (CAPTURE_TEXT[lang] as Record<string, string>)[key]
        expect(value, `${lang}.${key}`).toBeTruthy()
      }
    }
  })

  it('GATE-1d: 置き換え欄（{n} など）は 4 言語で同じ', () => {
    for (const key of Object.keys(CAPTURE_TEXT.ja)) {
      const expected = names((CAPTURE_TEXT.ja as Record<string, string>)[key] ?? '')
      for (const lang of LANGS) {
        expect(
          names((CAPTURE_TEXT[lang] as Record<string, string>)[key] ?? ''),
          `${lang}.${key}`,
        ).toEqual(expected)
      }
    }
  })

  it('GATE-1e: 見えているボタンの文言を aria-label が含む（WCAG 2.5.3）', () => {
    for (const lang of LANGS) {
      const t = CAPTURE_TEXT[lang]
      expect(t.sendAria.toLowerCase()).toContain(t.send.toLowerCase())
      expect(t.declineAria.toLowerCase()).toContain(t.decline.toLowerCase())
      expect(t.laterAria.toLowerCase()).toContain(t.later.toLowerCase())
    }
  })

  it('GATE-1e: 文言に絵文字を使わない', () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(CAPTURE_TEXT[lang])) {
        expect(value, `${lang}.${key}`).not.toMatch(/\p{Extended_Pictographic}/u)
      }
    }
  })

  it('GATE-1d: fill は名前を値で置き換え、足りない名前は残す', () => {
    expect(fill('{n} 件（失敗 {m} 件）', { n: 3, m: 1 })).toBe('3 件（失敗 1 件）')
    expect(fill('{n} / {total}', { n: 1 })).toBe('1 / {total}')
  })
})
