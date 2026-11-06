import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { StartOverlay } from './StartOverlay'

// docs/specs/drive-season/functional.md R2・R5（UC-2c）

function renderAt(search: string, trip = false) {
  const demo = demoScenario(ZONES, search)
  const scenario = trip ? { ...demo, source: 'trip' as const } : demo
  render(
    <MemoryRouter initialEntries={[`/drive${search}`]}>
      <StartOverlay scenario={scenario} onStart={() => undefined} />
    </MemoryRouter>,
  )
}

describe('出発の案内の季節の切り替え（drive-season R2）', () => {
  it('UC-2c: 見本の場面に天候・路面と 5 つの切り替え。alert=off を保ち、選んでいるものに aria-current', () => {
    renderAt('?month=7&weather=rain&alert=off')
    expect(screen.getByTestId('start-conditions')).toHaveTextContent('雨・湿潤')
    const nav = screen.getByRole('navigation', { name: '季節' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/drive?alert=off',
      '/drive?alert=off&month=2&weather=snow',
      '/drive?alert=off&month=4&weather=rain',
      '/drive?alert=off&month=7&weather=clear',
      '/drive?alert=off&month=10&weather=rain',
    ])
    expect(links.map((a) => a.textContent)).toEqual([
      '既定（2 月・薄暮）',
      '冬・雪（2 月）',
      '雪どけ・雨（4 月）',
      '夏・晴れ（7 月）',
      '秋・雨（10 月）',
    ])
    const current = links.filter((a) => a.getAttribute('aria-current') === 'true')
    expect(current).toHaveLength(0)
  })

  it('UC-2c: 何も無い URL では既定が選ばれていて、圧雪・曇り', () => {
    renderAt('')
    expect(screen.getByTestId('start-conditions')).toHaveTextContent('曇り・圧雪')
    const current = screen.getByRole('link', { current: true })
    expect(current).toHaveTextContent('既定（2 月・薄暮）')
    expect(current).toHaveAttribute('href', '/drive')
  })

  it('UC-2c: 夏・晴れを選んでいるとき、それが aria-current', () => {
    renderAt('?month=7&weather=clear')
    expect(screen.getByRole('link', { current: true })).toHaveTextContent('夏・晴れ（7 月）')
  })

  it('UC-2c: 旅の場面には切り替えを出さない', () => {
    renderAt('?month=7', true)
    expect(screen.queryByRole('navigation', { name: '季節' })).toBeNull()
  })
})
