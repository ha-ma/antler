import { render } from '@testing-library/react'
import { fillText, LOSS_TEXT } from '../text'
import { fillNodes } from './fill-nodes'

// 文の型に要素を差し込む（result-countup R2、LOSS-3）

const LANGS = ['ja', 'en', 'zh', 'ko'] as const

describe('fillNodes', () => {
  it('LOSS-3: 文字だけを渡せば 4 言語とも fillText と同じ文字列になる', () => {
    const values = { year: 2024, total: '6,705' }
    for (const lang of LANGS) {
      const template = LOSS_TEXT.statsHeading[lang]
      const { container, unmount } = render(<p>{fillNodes(template, values)}</p>)
      expect(container.textContent).toBe(fillText(template, values))
      unmount()
    }
  })

  it('LOSS-3: 置き場所の名前で差し込む（言語ごとに順番が違っても、同じ名前の場所に入る）', () => {
    const { container } = render(
      <p>{fillNodes(LOSS_TEXT.statsHeading.en, { year: 2024, total: <b>6,705</b> })}</p>,
    )
    expect(container.querySelector('b')?.textContent).toBe('6,705')
    expect(container.textContent).toBe('This happened 6,705 times in Hokkaido in 2024')
  })

  it('知らない key は {key} のまま残す', () => {
    const { container } = render(<p>{fillNodes('a {x} b {y}', { x: 1 })}</p>)
    expect(container.textContent).toBe(fillText('a {x} b {y}', { x: 1 }))
  })
})
