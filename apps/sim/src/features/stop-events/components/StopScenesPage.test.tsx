import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { STOP_OWNER_TOKEN, STOP_TRIP_ID, stopDeckBody } from '@/test/stop-deck'
import { StopScenesPage } from './StopScenesPage'

// 確認用の画面と受け入れ（docs/specs/stop-events/functional.md UI-4h・AC-32）。api は fetch のスタブ。

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

type Call = { url: string; init: RequestInit }

function setup(withOwner = true) {
  if (withOwner) localStorage.setItem(`antler.trip-owner.${STOP_TRIP_ID}`, STOP_OWNER_TOKEN)
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP'])
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init })
      const body = url.endsWith('/events') ? { accepted: 1, duplicates: 0 } : stopDeckBody()
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: url.endsWith('/events') ? 200 : 201 }),
      )
    }),
  )
  const router = createMemoryRouter(
    [{ path: '/trip/:id/day/:n/stops', element: <StopScenesPage /> }],
    {
      initialEntries: [`/trip/${STOP_TRIP_ID}/day/2/stops`],
    },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return calls
}

describe('StopScenesPage', () => {
  it('UI-4h・AC-32: 場面の一覧を出し、押すとモーダル。選ぶと choice を Bearer の ownerToken つきで送る', async () => {
    const user = userEvent.setup()
    const calls = setup()
    await user.click(await screen.findByRole('button', { name: /群れがまだ残っていた/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('阿寒湖 到着予定')
    await user.click(screen.getByRole('button', { name: /もう少し、鶴の飛び立ちを見る/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('選んだもの：もう少し、鶴の飛び立ちを見る')
    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith('/events'))).toBe(true)
    })
    const sent = calls.find((c) => c.url.endsWith('/events'))
    const body = JSON.parse(String(sent?.init.body)) as {
      runId: string
      alertEnabled: boolean
      events: Record<string, unknown>[]
    }
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.alertEnabled).toBe(true)
    expect(body.events[0]).toEqual({
      kind: 'choice',
      seq: 0,
      day: 2,
      at: '2027-02-15T10:56+09:00',
      sceneId: 'p-red-crowned-crane',
      choiceId: 'linger',
      leg: 1,
    })
    expect(new Headers(sent?.init.headers).get('Authorization')).toBe(`Bearer ${STOP_OWNER_TOKEN}`)
  })

  it('UI-4h: トークンが無い端末では束を取りに行かず、案内を出す', () => {
    const calls = setup(false)
    expect(screen.getByText(/この旅を作った端末で開くと/)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})
