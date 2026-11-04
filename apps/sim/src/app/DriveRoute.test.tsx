import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { DriveResult } from '@/features/drive'
import { DriveRoute } from './DriveRoute'

// docs/specs/loss/functional.md R1（UC-1a）: 運転で衝突したら A-6 へ移る。完走では移らない。
// three を読まないよう、運転の画面はボタン 1 つのフェイクにする。

const result: DriveResult = {
  tripId: 'K7m2abcd',
  day: 2,
  seed: 1,
  source: 'trip',
  data: null,
  alertEnabled: false,
  startAt: '2027-02-15T09:00:00+09:00',
  zonePasses: 1,
  outcome: 'collided',
  endS: 1234,
  legIndex: 0,
  endedAt: '2027-02-15T16:31:00+09:00',
  collidedDeerId: 'd1',
  encounters: [],
  inputs: [],
  frames: null,
}

let next: DriveResult = result

vi.mock('@/features/drive', () => ({
  DriveScreen: ({ onFinish }: { onFinish?: (r: DriveResult) => void }) => (
    <button type="button" onClick={() => onFinish?.(next)}>
      finish
    </button>
  ),
}))

function renderAt() {
  const router = createMemoryRouter(
    [
      { path: '/drive', element: <DriveRoute /> },
      { path: '/loss/:id', element: <p>loss page</p> },
    ],
    { initialEntries: ['/drive?trip=K7m2abcd&day=2&alert=off'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('DriveRoute', () => {
  it('UC-1c: 旅の場面で衝突したら /loss/:id?… に移る（DriveResult から lossHref）', async () => {
    next = result
    const router = renderAt()
    ;(await screen.findByRole('button', { name: 'finish' })).click()
    expect(await screen.findByText('loss page')).toBeInTheDocument()
    const { pathname, search } = router.state.location
    expect(pathname).toBe('/loss/K7m2abcd')
    expect(new URLSearchParams(search).get('day')).toBe('2')
    expect(new URLSearchParams(search).get('alert')).toBe('off')
  })

  it('UC-1c: 完走では A-6 に移らない', async () => {
    next = { ...result, outcome: 'completed', collidedDeerId: null }
    const router = renderAt()
    ;(await screen.findByRole('button', { name: 'finish' })).click()
    expect(router.state.location.pathname).toBe('/drive')
  })
})
