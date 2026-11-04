import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/render'
import { STOP_OWNER_TOKEN, STOP_TRIP_ID, stopDeckBody } from '@/test/stop-deck'
import { TripEventSender } from '../utils/event-sender'
import { useStopDeck } from './useStopDeck'
import { useTripEventLog } from './useTripEventLog'

// 束の取得とイベントの送信（docs/specs/stop-events/functional.md R9・R10・R12、UI-4e・UI-4f）。api は fetch のスタブ。

const OWNER_KEY = `antler.trip-owner.${STOP_TRIP_ID}`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

type Call = { url: string; init: RequestInit }

function stubFetch(reply: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const call = { url, init }
      calls.push(call)
      const r = reply(call)
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }))
    }),
  )
  return calls
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
}

describe('useStopDeck', () => {
  it('UI-4e: トークンがあれば X-Owner-Token つきで POST し、形を確かめて返す', async () => {
    localStorage.setItem(OWNER_KEY, STOP_OWNER_TOKEN)
    const calls = stubFetch(() => ({ status: 201, body: stopDeckBody() }))
    const { result } = renderHook(() => useStopDeck(STOP_TRIP_ID, 2), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.hasOwner).toBe(true)
    expect(result.current.data?.deck.scenes).toHaveLength(2)
    expect(calls[0]?.url).toBe(`/api/trips/${STOP_TRIP_ID}/day/2/stop-deck`)
    expect(calls[0]?.init.method).toBe('POST')
    expect(new Headers(calls[0]?.init.headers).get('X-Owner-Token')).toBe(STOP_OWNER_TOKEN)
  })

  it('UI-4e: トークンが無ければ取りに行かない', () => {
    const calls = stubFetch(() => ({ status: 201, body: stopDeckBody() }))
    const { result } = renderHook(() => useStopDeck(STOP_TRIP_ID, 2), { wrapper })
    expect(result.current.hasOwner).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
    expect(calls).toHaveLength(0)
  })

  it('UI-4e: 形の違う応答・403 はエラー（再試行しない）', async () => {
    localStorage.setItem(OWNER_KEY, STOP_OWNER_TOKEN)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const bad = stubFetch(() => ({ status: 201, body: { deck: { scenes: 'x' } } }))
    const first = renderHook(() => useStopDeck(STOP_TRIP_ID, 2), { wrapper })
    await waitFor(() => {
      expect(first.result.current.isError).toBe(true)
    })
    expect(bad).toHaveLength(1)
    vi.unstubAllGlobals()
    const denied = stubFetch(() => ({ status: 403, body: { error: { code: 'OWNER_REQUIRED' } } }))
    const second = renderHook(() => useStopDeck(STOP_TRIP_ID, 3), { wrapper })
    await waitFor(() => {
      expect(second.result.current.isError).toBe(true)
    })
    expect(second.result.current.error).toMatchObject({ status: 403, code: 'OWNER_REQUIRED' })
    expect(denied).toHaveLength(1)
  })
})

describe('useTripEventLog', () => {
  const RUN = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f'
  const choice = {
    kind: 'choice' as const,
    day: 2,
    at: '2027-02-15T10:56+09:00',
    sceneId: 'p-x',
    choiceId: 'leave',
  }

  it('UI-4f: seq を 0 から振り、runId・alertEnabled・X-Owner-Token をつけて送る', async () => {
    localStorage.setItem(OWNER_KEY, STOP_OWNER_TOKEN)
    const calls = stubFetch(() => ({ status: 200, body: { accepted: 1, duplicates: 0 } }))
    const { result } = renderHook(() =>
      useTripEventLog(STOP_TRIP_ID, { runId: RUN, alertEnabled: false }),
    )
    expect(result.current.enabled).toBe(true)
    result.current.log(choice)
    result.current.log({ ...choice, choiceId: 'linger' })
    await waitFor(() => {
      expect(calls).toHaveLength(2)
    })
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)) as Record<string, unknown>)
    expect(bodies[0]).toEqual({ runId: RUN, alertEnabled: false, events: [{ ...choice, seq: 0 }] })
    expect((bodies[1]?.['events'] as { seq: number }[])[0]?.seq).toBe(1)
    expect(calls[0]?.url).toBe(`/api/trips/${STOP_TRIP_ID}/events`)
    expect(new Headers(calls[0]?.init.headers).get('X-Owner-Token')).toBe(STOP_OWNER_TOKEN)
  })

  it('UI-4f: トークンが無ければ何もしない', () => {
    const calls = stubFetch(() => ({ status: 200, body: {} }))
    const { result } = renderHook(() =>
      useTripEventLog(STOP_TRIP_ID, { runId: RUN, alertEnabled: true }),
    )
    expect(result.current.enabled).toBe(false)
    result.current.log(choice)
    expect(calls).toHaveLength(0)
  })

  it('UI-4f: 5xx・通信の失敗は同じ seq で送り直し、4xx は捨てる', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let n = 0
    const calls = stubFetch(() =>
      n++ === 0 ? { status: 503, body: {} } : { status: 200, body: {} },
    )
    const sender = new TripEventSender({
      tripId: STOP_TRIP_ID,
      runId: RUN,
      ownerToken: STOP_OWNER_TOKEN,
      retryDelaysMs: [0, 0],
    })
    expect(await sender.log(choice, true)).toBe(true)
    expect(calls).toHaveLength(2)
    expect(
      calls.map(
        (c) => (JSON.parse(String(c.init.body)) as { events: { seq: number }[] }).events[0]?.seq,
      ),
    ).toEqual([0, 0])

    vi.unstubAllGlobals()
    const rejected = stubFetch(() => ({ status: 400, body: { error: { code: 'INVALID_INPUT' } } }))
    expect(await sender.log(choice, true)).toBe(false)
    expect(rejected).toHaveLength(1)
  })

  it('UI-4f: 走行の途中でアラートを切り替えても seq は続く（run の中で 0 に戻らない）', async () => {
    localStorage.setItem(OWNER_KEY, STOP_OWNER_TOKEN)
    const calls = stubFetch(() => ({ status: 200, body: { accepted: 1, duplicates: 0 } }))
    const { result, rerender } = renderHook(
      ({ alertEnabled }) => useTripEventLog(STOP_TRIP_ID, { runId: RUN, alertEnabled }),
      { initialProps: { alertEnabled: true } },
    )
    result.current.log(choice)
    rerender({ alertEnabled: false })
    result.current.log(choice)
    await waitFor(() => {
      expect(calls).toHaveLength(2)
    })
    const sent = calls.map(
      (c) =>
        JSON.parse(String(c.init.body)) as { alertEnabled: boolean; events: { seq: number }[] },
    )
    expect(sent.map((b) => [b.alertEnabled, b.events[0]?.seq])).toEqual([
      [true, 0],
      [false, 1],
    ])
  })
})
