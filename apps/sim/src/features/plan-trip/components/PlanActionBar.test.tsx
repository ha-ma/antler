import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText } from '../text'
import { PlanPage } from './PlanPage'

// A-1 の主ボタンの帯（docs/specs/sticky-cta/functional.md R3・UC-1・UC-2）。

const SUBMIT = 'しおりを作って鹿ゾーンを確かめる →'

beforeEach(() => {
  usePlanTripStore.getState().resetPlanTrip(['ja-JP'])
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderPlan() {
  const router = createMemoryRouter(
    [
      { path: '/plan', element: <PlanPage /> },
      { path: '/trip/:id/brief', element: <p>brief</p> },
    ],
    { initialEntries: ['/plan'] },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return router
}

const bar = () => screen.getByTestId('action-bar')

describe('A-1 の主ボタンの帯（sticky-cta）', () => {
  it('PLAN-1 主ボタンが帯の中に 1 つだけあり、直すところの文が無い', () => {
    renderPlan()
    const button = within(bar()).getByRole('button', { name: SUBMIT })
    expect(screen.getAllByRole('button', { name: SUBMIT })).toEqual([button])
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(within(bar()).queryByText(/直すところ/)).not.toBeInTheDocument()
  })

  it('PLAN-2 入力が通らないと帯に「直すところ: 運転できる人」が出て主ボタンが指す。直すと消える', async () => {
    const user = userEvent.setup()
    renderPlan()
    const drivers = screen.getByLabelText('運転できる人')
    await user.clear(drivers)
    await user.type(drivers, '9')
    const hint = within(bar()).getByText('直すところ: 運転できる人')
    const button = within(bar()).getByRole('button', { name: SUBMIT })
    expect(button).toHaveAttribute('aria-describedby', hint.id)
    expect(button).toHaveAccessibleDescription('直すところ: 運転できる人')
    // 帯の文はライブリージョンにしない（入力欄の下の role="status" が読む）
    expect(hint.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull()

    // 2 つ以上は画面の順に区切りでつなぐ
    const size = screen.getByLabelText('人数')
    await user.clear(size)
    await user.type(size, '0')
    expect(within(bar()).getByText('直すところ: 人数・運転できる人')).toBeInTheDocument()

    await user.clear(size)
    await user.type(size, '4')
    await user.clear(drivers)
    await user.type(drivers, '2')
    expect(within(bar()).queryByText(/直すところ/)).not.toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: SUBMIT })).not.toHaveAttribute(
      'aria-describedby',
    )
  })

  it('PLAN-3 直すところの文言が 4 言語にあり、en は「Fix: Drivers」', async () => {
    for (const lang of ['ja', 'en', 'zh', 'ko'] as const) {
      expect(PLAN_TEXT.fixFields[lang]).toContain('{fields}')
      expect(PLAN_TEXT.fixFieldsSeparator[lang].length).toBeGreaterThan(0)
    }
    expect(fillText('fixFields', 'en', { fields: PLAN_TEXT.drivers.en })).toBe('Fix: Drivers')

    usePlanTripStore.getState().resetPlanTrip(['en-US'])
    const user = userEvent.setup()
    renderPlan()
    const drivers = screen.getByLabelText('Drivers')
    await user.clear(drivers)
    await user.type(drivers, '9')
    expect(within(bar()).getByText('Fix: Drivers')).toBeInTheDocument()
  })

  it('PLAN-4 作成の失敗（role="alert" と「もう一度」）が帯の中に出る', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'X', message: 'x' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
    const user = userEvent.setup()
    renderPlan()
    await user.click(within(bar()).getByRole('button', { name: SUBMIT }))
    const alert = await within(bar()).findByRole('alert')
    expect(await within(alert).findByRole('button', { name: 'もう一度' })).toBeInTheDocument()
    // 失敗の知らせは帯の中に 1 つだけ
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})
