import { OWNER_TOKEN, run, TRIP_ID } from '../test-fixtures'
import { RecordApiError } from '../types'
import { saveRun } from './useSaveRun'

// 走行の保存（docs/specs/record/functional.md UC-9e、R11）

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function stubFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('saveRun', () => {
  it('UC-9e: トークンがあれば Bearer 付きで POST、201 は saved・200 は replayed', async () => {
    localStorage.setItem(`antler.trip-owner.${TRIP_ID}`, OWNER_TOKEN)
    const fetchMock = stubFetch(201)
    const r = run({ day: 2 })
    expect(await saveRun({ tripId: TRIP_ID, run: r })).toEqual({ status: 'saved', tripId: TRIP_ID })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain(`/api/trips/${TRIP_ID}/runs`)
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${OWNER_TOKEN}`)
    expect(JSON.parse(String(init?.body))).toEqual(r)
    stubFetch(200)
    expect((await saveRun({ tripId: TRIP_ID, run: r })).status).toBe('replayed')
  })

  it('UC-9e: トークンが無ければ送らずに not-owner', async () => {
    const fetchMock = stubFetch(201)
    expect(await saveRun({ tripId: TRIP_ID, run: run() })).toEqual({
      status: 'not-owner',
      tripId: TRIP_ID,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('失敗は status と code を持つ RecordApiError', async () => {
    localStorage.setItem(`antler.trip-owner.${TRIP_ID}`, OWNER_TOKEN)
    stubFetch(409, { error: { code: 'RUN_LIMIT', message: 'x' } })
    await expect(saveRun({ tripId: TRIP_ID, run: run() })).rejects.toMatchObject({
      status: 409,
      code: 'RUN_LIMIT',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    await expect(saveRun({ tripId: TRIP_ID, run: run() })).rejects.toBeInstanceOf(RecordApiError)
  })
})
