import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { DriveResult } from '@/features/drive'
import { renderWithProviders } from '@/test/render'
import { DriveRoute } from './DriveRoute'

// 運転の終わり → 走行の記録 → A-7（docs/specs/record/functional.md UC-9f、R11）。
// drive の画面（WebGL）は差し替え、終わりのボタンで DriveResult を渡す。

const TRIP_ID = 'K7m2abcd'
const TOKEN = 'ab'.repeat(32)
let next: Partial<DriveResult> = {}

vi.mock('@/features/drive', () => ({
  DriveScreen: ({ onFinish }: { onFinish?: (r: DriveResult) => void }) => (
    <button
      type="button"
      onClick={() => {
        onFinish?.({
          tripId: TRIP_ID,
          day: 2,
          seed: 1,
          source: 'trip',
          data: null,
          alertEnabled: true,
          startAt: '2027-02-15T09:00:00+09:00',
          zonePasses: 2,
          outcome: 'completed',
          endS: 1000,
          legIndex: 0,
          endedAt: '2027-02-15T12:00:00+09:00',
          collidedDeerId: null,
          encounters: [],
          inputs: [],
          frames: null,
          ...next,
        } as DriveResult)
      }}
    >
      finish
    </button>
  ),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  next = {}
})

function stubFetch() {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ run: {} }), { status: 201 })),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderDrive() {
  const router = createMemoryRouter(
    [
      { path: '/drive', element: <DriveRoute /> },
      { path: '/t/:id', element: <p>record</p> },
    ],
    { initialEntries: [`/drive?trip=${TRIP_ID}&day=2`] },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return router
}

describe('DriveRoute（運転の終わり → 走行の記録）', () => {
  it('UC-9f: 旅の場面を完走 → run を残して /t/:id へ', async () => {
    localStorage.setItem(`antler.trip-owner.${TRIP_ID}`, TOKEN)
    const fetchMock = stubFetch()
    const router = renderDrive()
    await userEvent.click(await screen.findByRole('button', { name: 'finish' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/t/${TRIP_ID}`)
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain(`/api/trips/${TRIP_ID}/runs`)
    expect(JSON.parse(String(init?.body))).toMatchObject({
      day: 2,
      zonePasses: 2,
      outcome: 'completed',
    })
  })

  it('UC-9f: 衝突は残すが移らない。トークンの無い端末は送らず移らない。見本の場面は残さない', async () => {
    localStorage.setItem(`antler.trip-owner.${TRIP_ID}`, TOKEN)
    const fetchMock = stubFetch()
    next = { outcome: 'collided' }
    const router = renderDrive()
    await userEvent.click(await screen.findByRole('button', { name: 'finish' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(router.state.location.pathname).toBe('/drive')

    localStorage.clear()
    next = { outcome: 'completed' }
    await userEvent.click(screen.getByRole('button', { name: 'finish' }))
    next = { source: 'demo' }
    await userEvent.click(screen.getByRole('button', { name: 'finish' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/drive')
  })
})
