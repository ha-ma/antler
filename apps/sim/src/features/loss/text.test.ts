import { fillText, LOSS_TEXT } from './text'

// UC-7a（R10）: 文言の表は 4 言語とも全項目が空でない（付録 A #9）。差し込みの名前は 4 言語でそろう。

describe('LOSS_TEXT', () => {
  it('UC-7a: どの文言も ja / en / zh / ko がそろい、空でない', () => {
    for (const [key, text] of Object.entries(LOSS_TEXT)) {
      expect(Object.keys(text).sort(), key).toEqual(['en', 'ja', 'ko', 'zh'])
      for (const value of Object.values(text)) expect(value.trim(), key).not.toBe('')
    }
  })

  it('UC-7a: 差し込みの {name} は 4 言語で同じ組', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const [key, text] of Object.entries(LOSS_TEXT)) {
      expect(names(text.en), key).toEqual(names(text.ja))
      expect(names(text.zh), key).toEqual(names(text.ja))
      expect(names(text.ko), key).toEqual(names(text.ja))
    }
  })

  it('UI に絵文字を使わない・3 桁以上の数を文言に埋めない（統計は STATS から差し込む）', () => {
    const emoji = /\p{Emoji_Presentation}/u
    for (const [key, text] of Object.entries(LOSS_TEXT))
      for (const value of Object.values(text)) {
        expect(value, key).not.toMatch(emoji)
        expect(value, key).not.toMatch(/\d{3,}/)
      }
  })

  it('fillText は知らない名前を残す', () => {
    expect(fillText('{a}-{b}', { a: 1 })).toBe('1-{b}')
  })
})
