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

  it('UC-2b 10 件選択済みで 11 件目は選べない。外して選び直せる', async () => {
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

    // 流氷ウォークを外す → 選び直す
    const ice = doto.find((p) => p.id === 'drift-ice-walk')
    if (!ice) throw new Error('流氷ウォークがマスターに無い')
    await user.click(card(ice.name.ja))
    expect(card(ice.name.ja)).toHaveAttribute('aria-pressed', 'false')
    await user.click(card(ice.name.ja))
    expect(card(ice.name.ja)).toHaveAttribute('aria-pressed', 'true')
  })

  it('DUR-7 カードに重さの操作が無く「約 n 時間」が出る。選択は id だけ', async () => {
    const user = userEvent.setup()
    render(<PleasurePicker />)
    expect(screen.queryByRole('group', { name: /重さ/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /重さ/ })).toBeNull()
    expect(screen.queryByText(/重さ/)).toBeNull()
    for (const p of pleasuresInArea('doto')) {
      const article = card(p.name.ja).closest('article')
      if (!article) throw new Error('カードが無い')
      const hours = Number.isInteger(p.hours) ? String(p.hours) : p.hours.toFixed(1)
      expect(within(article).getByText(`約 ${hours} 時間`)).toBeInTheDocument()
    }
    const marsh = pleasuresInArea('doto').find((p) => p.id === 'kushiro-marsh')
    if (!marsh) throw new Error('釧路湿原がマスターに無い')
    await user.click(card(marsh.name.ja))
    expect(usePlanTripStore.getState().selections.doto).toContainEqual({ id: 'kushiro-marsh' })
    for (const s of usePlanTripStore.getState().selections.doto) {
      expect(Object.keys(s)).toEqual(['id'])
    }
  })

  it('UC-2c 選択はエリアごとに保持し、カウンターは表示中のエリアの数', async () => {
    const user = userEvent.setup()
    render(<PleasurePicker />)
    const initial = usePlanTripStore.getState().selections.doto.length
    const third = pleasuresInArea('doto').find(
      (p) => !usePlanTripStore.getState().selections.doto.some((s) => s.id === p.id),
    )
    if (!third) throw new Error('道東のマスターが足りない')
    await user.click(card(third.name.ja))
    const picked = `${String(initial + 1)} / ${String(MAX_PLEASURES)}`
    expect(counter()).toContain(picked)

    await user.click(screen.getByRole('tab', { name: /道央/ }))
    expect(screen.getByRole('tab', { name: /道央/ })).toHaveAttribute('aria-selected', 'true')
    expect(counter()).toContain(`0 / ${String(MAX_PLEASURES)}`)
    const firstDoo = pleasuresInArea('doo')[0]
    if (!firstDoo) throw new Error('道央のマスターが空')
    expect(card(firstDoo.name.ja)).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('tab', { name: /道東/ }))
    expect(counter()).toContain(picked)
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
