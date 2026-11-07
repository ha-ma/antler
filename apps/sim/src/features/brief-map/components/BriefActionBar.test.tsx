import { screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { personaZoneDay, TRIP_ID, tripDayBody } from '@/test/trip-day'
import { BriefPage } from './BriefPage'

// A-2 の主ボタンの帯（docs/specs/sticky-cta/functional.md R4・UC-3）。api は fetch のスタブ。

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubDay(edit: (body: ReturnType<typeof tripDayBody>) => unknown = (b) => b) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const day = Number(/\/day\/(\d+)/.exec(url)?.[1] ?? 0)
      return Promise.resolve(
        new Response(JSON.stringify(edit(tripDayBody(day))), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
}

const idle = (b: ReturnType<typeof tripDayBody>) => ({
  ...b,
  day: { ...b.day, legs: [], zones: [], stayAt: 'kushiro' },
})

function renderBrief(path: string) {
  const router = createMemoryRouter([{ path: '/trip/:id/brief', element: <BriefPage /> }], {
    initialEntries: [path],
  })
  renderWithProviders(<RouterProvider router={router} />)
}

const heading = () =>
  screen.findByRole('heading', { level: 1, name: '今日のルートと、鹿の多い区間' })

describe('A-2 の主ボタンの帯（sticky-cta）', () => {
  it('BRIEF-1 運転のある日は「エンジンをかける」が帯の中に 1 つだけ', async () => {
    const day = personaZoneDay()
    stubDay()
    renderBrief(`/trip/${TRIP_ID}/brief?day=${String(day)}&alert=off`)
    await heading()
    const bars = screen.getAllByTestId('action-bar')
    expect(bars).toHaveLength(1)
    const start = within(bars[0] as HTMLElement).getByRole('link', { name: 'エンジンをかける' })
    expect(screen.getAllByRole('link', { name: 'エンジンをかける' })).toEqual([start])
    expect(start).toHaveAttribute('href', `/drive?trip=${TRIP_ID}&day=${String(day)}&alert=off`)
  })

  it('BRIEF-2 運転の無い日は「次の日（DAY n）へ」が帯の中。最後の日は帯が無い', async () => {
    stubDay(idle)
    renderBrief(`/trip/${TRIP_ID}/brief?day=2`)
    await heading()
    const next = within(screen.getByTestId('action-bar')).getByRole('link', {
      name: '次の日（DAY 3）へ',
    })
    expect(screen.getAllByRole('link', { name: /次の日/ })).toEqual([next])
    // 「この日は運転しません」の文はカードに残る（帯の外）
    expect(
      within(screen.getByTestId('action-bar')).queryByText(/この日は運転しません/),
    ).not.toBeInTheDocument()
    expect(screen.getByText('この日は運転しません（釧路で過ごします）。')).toBeInTheDocument()
  })

  it('BRIEF-2 運転の無い最後の日は帯を出さない', async () => {
    stubDay(idle)
    renderBrief(`/trip/${TRIP_ID}/brief?day=5`)
    await heading()
    expect(screen.queryByTestId('action-bar')).not.toBeInTheDocument()
  })
})
