import { describe, expect, it } from 'vitest'
import { BRIEF_TEXT, fillText } from './text'

// UC-6c: 文言の表は 4 言語とも空欄が無い（付録 A #9）。差し込みの名前は 4 言語でそろう。

describe('BRIEF_TEXT', () => {
  it('UC-6c: どの文言も ja / en / zh / ko がそろい、空でない', () => {
    for (const [key, text] of Object.entries(BRIEF_TEXT)) {
      expect(Object.keys(text).sort(), key).toEqual(['en', 'ja', 'ko', 'zh'])
      for (const value of Object.values(text)) expect(value.trim(), key).not.toBe('')
    }
  })

  it('UC-6c: 差し込みの {name} は 4 言語で同じ組', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const [key, text] of Object.entries(BRIEF_TEXT)) {
      expect(names(text.en), key).toEqual(names(text.ja))
      expect(names(text.zh), key).toEqual(names(text.ja))
      expect(names(text.ko), key).toEqual(names(text.ja))
    }
  })

  it('UI に絵文字を使わない', () => {
    // © は帰属表示に要るので Extended_Pictographic ではなく絵文字の表示のものだけを見る
    const emoji = /\p{Emoji_Presentation}/u
    for (const text of Object.values(BRIEF_TEXT))
      for (const value of Object.values(text)) expect(value).not.toMatch(emoji)
  })

  it('fillText は知らない名前を残す', () => {
    expect(fillText('{a}-{b}', { a: 1 })).toBe('1-{b}')
  })
})
