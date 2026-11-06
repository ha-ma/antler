import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { DriveResult } from '@/features/drive'
import { renderWithProviders } from '@/test/render'
import { DriveRoute } from './DriveRoute'

// 運転の終わり → 走行の記録 → A-7（docs/specs/record/functional.md UC-9f、R11）と、
// 衝突 → A-6（docs/specs/loss/functional.md R1、UC-1c）。
// drive の画面（WebGL）は差し替え、終わりのボタンで DriveResult を渡す。

const TRIP_ID = 'K7m2abcd'
const TOKEN = 'ab'.repeat(32)
let next: Partial<DriveResult> = {}

function result(): DriveResult {
  return {
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
    spotting: { appeared: 3, found: 2, early: 1 },
    inputs: [],
    frames: null,
    ...next,
  } as DriveResult
}

// finish = 衝突・完走のフレーム（onFinish）、crash end = 衝突の演出の終わり（onCrashEnd。drive-crash-spot R3）
vi.mock('@/features/drive', () => ({
  DriveScreen: ({
    onFinish,
    onCrashEnd,
  }: {
    onFinish?: (r: DriveResult) => void
    onCrashEnd?: (r: DriveResult) => void
  }) => (
    <>
      <button type="button" onClick={() => onFinish?.(result())}>
        finish
      </button>
      <button type="button" onClick={() => onCrashEnd?.(result())}>
        crash end
      </button>
    </>
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
      { path: '/loss/:id', element: <p>loss page</p> },
    ],
    { initialEntries: [`/drive?trip=${TRIP_ID}&day=2`] },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return router
}

describe('DriveRoute（運転の終わり → 走行の記録・A-6・A-7）', () => {
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

  it('UC-9f / UC-1c / UC-3d（drive-crash-spot）: 衝突は当たったフレームで run を残し、演出が終わってから A-6（/loss/:id?…）へ移る。A-7 には移らない', async () => {
    localStorage.setItem(`antler.trip-owner.${TRIP_ID}`, TOKEN)
    const fetchMock = stubFetch()
    next = { outcome: 'collided', collidedDeerId: 'd1', alertEnabled: false }
    const router = renderDrive()
    await userEvent.click(await screen.findByRole('button', { name: 'finish' }))
    // 演出の間は移らないが、run はもう送っている（途中で離れても残る。spec-adversary C1）
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(router.state.location.pathname).toBe('/drive')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      spotting: { appeared: 3, found: 2, early: 1 },
    })
    await userEvent.click(screen.getByRole('button', { name: 'crash end' }))
    expect(await screen.findByText('loss page')).toBeInTheDocument()
    const { pathname, search } = router.state.location
    expect(pathname).toBe(`/loss/${TRIP_ID}`)
    const q = new URLSearchParams(search)
    expect(q.get('day')).toBe('2')
    expect(q.get('leg')).toBe('0')
    expect(q.get('alert')).toBe('off')
  })

  it('UC-1c: トークンの無い端末でも、衝突したら A-6 へ移る（喪失は ID を知る人が見られる）', async () => {
    const fetchMock = stubFetch()
    next = { outcome: 'collided', collidedDeerId: 'd1' }
    const router = renderDrive()
    await userEvent.click(await screen.findByRole('button', { name: 'finish' }))
    await userEvent.click(screen.getByRole('button', { name: 'crash end' }))
    expect(await screen.findByText('loss page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/loss/${TRIP_ID}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('UC-9f / UC-1c: トークンの無い端末の完走は送らず移らない。見本の場面は残さず、衝突でも A-6 に移らない', async () => {
    const fetchMock = stubFetch()
    const router = renderDrive()
    await userEvent.click(await screen.findByRole('button', { name: 'finish' }))
    next = { source: 'demo', outcome: 'collided', collidedDeerId: 'd1' }
    await userEvent.click(screen.getByRole('button', { name: 'finish' }))
    await userEvent.click(screen.getByRole('button', { name: 'crash end' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/drive')
  })
})
