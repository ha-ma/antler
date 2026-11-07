import { screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { personaRecord, run, TRIP_ID } from '../test-fixtures'
import { RecordPage } from './RecordPage'

// A-7 の主ボタンの帯（docs/specs/sticky-cta/functional.md R5・UC-4）。api は fetch のスタブ。

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('A-7 の主ボタンの帯（sticky-cta）', () => {
  it('REC-1 「別の旅をつくる」が帯の中に 1 つだけ、「アラート OFF で挑戦」は帯の外', async () => {
    const data = personaRecord([run({ day: 1 }), run({ day: 2 })])
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
    const router = createMemoryRouter([{ path: '/t/:id', element: <RecordPage /> }], {
      initialEntries: [`/t/${TRIP_ID}`],
    })
    renderWithProviders(<RouterProvider router={router} />)
    await screen.findByRole('heading', { level: 1 })
    const bar = screen.getByTestId('action-bar')
    const primary = within(bar).getByRole('link', { name: '別の旅をつくる' })
    expect(screen.getAllByRole('link', { name: '別の旅をつくる' })).toEqual([primary])
    expect(primary).toHaveAttribute('href', '/plan')
    const challenge = screen.getByRole('link', { name: 'アラート OFF で挑戦' })
    expect(bar).not.toContainElement(challenge)
  })
})
