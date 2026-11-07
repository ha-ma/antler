import { screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { TRIP_ID, tripDayBody } from '@/test/trip-day'
import type { ResolvedCollision } from '../types'
import { lossHref } from '../utils/collision-url'
import { LossPage } from './LossPage'

// A-6 の主ボタンの帯（docs/specs/sticky-cta/functional.md R5・UC-4）。api は fetch のスタブ。

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP'])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const DAY_BODY = tripDayBody(2, 'ja')

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = url.includes('/losses')
        ? {
            loss: {
              tripId: TRIP_ID,
              story: { ja: '文', en: 'text', zh: '文', ko: '글' },
              createdAt: '2026-11-04T10:00:00+09:00',
            },
          }
        : DAY_BODY
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: url.includes('/losses') ? 201 : 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
}

const collision: ResolvedCollision & { simMs: number } = {
  tripId: TRIP_ID,
  day: 2,
  leg: 0,
  at: '2027-02-15T16:31:00+09:00',
  speedKmh: 54,
  light: 'dusk',
  side: 'L',
  alertEnabled: false,
  achievedStops: ['red-crowned-crane'],
  simMs: 812345,
}

describe('A-6 の主ボタンの帯（sticky-cta）', () => {
  it('LOSS-1 主ボタンが帯の中に 1 つだけで .loss-drop の中に無く、副の導線は帯の外', async () => {
    stubApi()
    const router = createMemoryRouter([{ path: '/loss/:id', element: <LossPage /> }], {
      initialEntries: [lossHref(collision)],
    })
    renderWithProviders(<RouterProvider router={router} />)
    await screen.findByRole('heading', { level: 1 })
    const bar = screen.getByTestId('action-bar')
    const primary = within(bar).getByRole('link', {
      name: '鹿アラートを ON にして、同じ道をやり直す',
    })
    expect(
      screen.getAllByRole('link', { name: '鹿アラートを ON にして、同じ道をやり直す' }),
    ).toEqual([primary])
    expect(primary).toHaveAttribute('href', `/trip/${TRIP_ID}/brief?day=2`)
    // fixed を画面に付けるため、transform を持つ .loss-drop の中に置かない
    expect(bar.closest('.loss-drop')).toBeNull()
    // 副の導線は今までどおり nav の中（帯の外）
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByRole('link', { name: 'この日を最初から走り直す' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: '別の旅をつくる' })).toBeInTheDocument()
    expect(within(bar).queryByRole('link', { name: '別の旅をつくる' })).not.toBeInTheDocument()
  })
})
