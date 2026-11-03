import { MAX_PLEASURES, pleasuresInArea } from '@antler/trip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePlanTripStore } from '../store'
import { PleasurePicker } from './PleasurePicker'

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function card(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${escape(name)}`) })
}

function counter(): string {
  return screen.getByTestId('plan-counter').textContent ?? ''
}

describe('PleasurePicker（A1-2・A1-3）', () => {
  beforeEach(() => usePlanTripStore.getState().resetPlanTrip(['ja-JP']))

  it('UC-2b 10 件選択済みで 11 件目は選べない。外すと重さも消える', async () => {
    const user = userEvent.setup()
    render(<PleasurePicker />)
    const doto = pleasuresInArea('doto')
    expect(doto.length).toBeGreaterThan(MAX_PLEASURES)

    for (const p of doto) {
      const button = card(p.name.ja)
      if (
        button.getAttribute('aria-pressed') === 'false' &&
        button.getAttribute('aria-disabled') !== 'true'
      ) {
        await user.click(button)
      }
    }
    expect(counter()).toContain(`${String(MAX_PLEASURES)} / ${String(MAX_PLEASURES)}`)
    const unselected = doto.filter((p) => card(p.name.ja).getAttribute('aria-pressed') === 'false')
    expect(unselected.length).toBe(doto.length - MAX_PLEASURES)
    for (const p of unselected) {
      expect(card(p.name.ja)).toHaveAttribute('aria-disabled', 'true')
      await user.click(card(p.name.ja))
      expect(card(p.name.ja)).toHaveAttribute('aria-pressed', 'false')
    }
    expect(counter()).toContain(`${String(MAX_PLEASURES)} / ${String(MAX_PLEASURES)}`)
    expect(screen.getByText(/10 件まで選べます/)).toBeInTheDocument()

    // 流氷ウォークの重さを 5 → 外す → 重さの欄が消える → 選び直すと 3 から
    const ice = doto.find((p) => p.id === 'drift-ice-walk')
    if (!ice) throw new Error('流氷ウォークがマスターに無い')
    const weightGroup = () => screen.queryByRole('group', { name: `${ice.name.ja} の重さ` })
    expect(weightGroup()).not.toBeNull()
    await user.click(card(ice.name.ja))
    expect(weightGroup()).toBeNull()
    expect(card(ice.name.ja)).toHaveAttribute('aria-pressed', 'false')
    await user.click(card(ice.name.ja))
    const group = weightGroup()
    if (!group) throw new Error('重さの欄が出ない')
    expect(within(group).getByRole('status')).toHaveTextContent('重さ 3')
  })

  it('UC-2b 重さは「−」「＋」で 1〜5 のあいだを変わる', async () => {
    const user = userEvent.setup()
    render(<PleasurePicker />)
    const group = screen.getByRole('group', { name: 'タンチョウ の重さ' })
    const weight = () =>
      usePlanTripStore.getState().selections.doto.find((p) => p.id === 'red-crowned-crane')?.weight
    const down = within(group).getByRole('button', { name: '重さを下げる' })
    const up = within(group).getByRole('button', { name: '重さを上げる' })

    await user.click(down)
    await user.click(down)
    expect(weight()).toBe(2)
    expect(within(group).getByRole('status')).toHaveTextContent('重さ 2')
    await user.click(down)
    await user.click(down)
    expect(weight()).toBe(1)
    expect(down).toHaveAttribute('aria-disabled', 'true')
    for (let i = 0; i < 6; i += 1) await user.click(up)
    expect(weight()).toBe(5)
    expect(up).toHaveAttribute('aria-disabled', 'true')
  })

  it('UC-2c 選択はエリアごとに保持し、カウンターは表示中のエリアの数', async () => {
    const user = userEvent.setup()
    render(<PleasurePicker />)
    const third = pleasuresInArea('doto').find(
      (p) => p.id !== 'drift-ice-walk' && p.id !== 'red-crowned-crane',
    )
    if (!third) throw new Error('道東のマスターが足りない')
    await user.click(card(third.name.ja))
    expect(counter()).toContain(`3 / ${String(MAX_PLEASURES)}`)

    await user.click(screen.getByRole('tab', { name: /道央/ }))
    expect(screen.getByRole('tab', { name: /道央/ })).toHaveAttribute('aria-selected', 'true')
    expect(counter()).toContain(`0 / ${String(MAX_PLEASURES)}`)
    const firstDoo = pleasuresInArea('doo')[0]
    if (!firstDoo) throw new Error('道央のマスターが空')
    expect(card(firstDoo.name.ja)).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('tab', { name: /道東/ }))
    expect(counter()).toContain(`3 / ${String(MAX_PLEASURES)}`)
    expect(card(third.name.ja)).toHaveAttribute('aria-pressed', 'true')
  })

  it('左右の矢印キーでエリアタブを移る', async () => {
    const user = userEvent.setup()
    render(<PleasurePicker />)
    screen.getByRole('tab', { name: /道東/ }).focus()
    await user.keyboard('{ArrowRight}')
    expect(usePlanTripStore.getState().area).toBe('doo')
    expect(screen.getByRole('tab', { name: /道央/ })).toHaveFocus()
  })
})
