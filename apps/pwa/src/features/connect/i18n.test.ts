import { LANGS, resolveLang } from '@antler/alert-ui'
import { describe, expect, it } from 'vitest'
import { CONNECT_TEXT } from './i18n'

describe('UC-5 文言', () => {
  it('UC-5d / UC-6d: 固定文言の辞書は ja / en / zh / ko の全キーが空でない（#9）', () => {
    const keys = Object.keys(CONNECT_TEXT.ja)
    for (const lang of LANGS) {
      expect(Object.keys(CONNECT_TEXT[lang]).sort()).toEqual([...keys].sort())
      for (const key of keys) {
        const value = (CONNECT_TEXT[lang] as Record<string, string>)[key]
        expect(value, `${lang}.${key}`).toBeTruthy()
      }
    }
  })

  it('UC-5e: zh-TW は zh、未知の言語は ja', () => {
    expect(resolveLang(['zh-TW'])).toBe('zh')
    expect(resolveLang(['ko-KR'])).toBe('ko')
    expect(resolveLang(['fr-FR'])).toBe('en')
  })
})
