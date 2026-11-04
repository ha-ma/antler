import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  API_BASE,
  captureId,
  createBackend,
  EDGE_BASE,
  jsonResponse,
  makeCapture,
} from '../__tests__/fake-edge'
import { createEdgeApi, EdgeError, imageUrl, parsePendingList } from './edge-api'
import { TimeoutError, withTimeout } from './http'
import type { FetchLike } from './upload'

function api(fetch: FetchLike, ms = { listMs: 3000, edgeMs: 5000 }) {
  return createEdgeApi({ baseUrl: EDGE_BASE, fetch, ...ms })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('edge の Capture サーバー（E5）', () => {
  it('GATE-1a: 一覧は pending=1&limit=N で取り、件数・idleSeconds・各 Capture を返す（壊れた形も落とさない）', async () => {
    const backend = createBackend({ items: [makeCapture(1), makeCapture(2)], idleSeconds: 75 })
    const list = await api(backend.fetch).listPending(200)
    expect(backend.edgeCalls[0]?.url).toBe(`${EDGE_BASE}/captures?pending=1&limit=200`)
    expect(backend.edgeCalls[0]?.init?.credentials).toBe('omit')
    expect(list.total).toBe(2)
    expect(list.idleSeconds).toBe(75)
    expect(list.items.map((i) => i.id)).toEqual([captureId(1), captureId(2)])
  })

  it('UP-1c: parsePendingList は id の形が正しければ中身が壊れていても残し、id が不正なものは落とす', () => {
    const list = parsePendingList({
      items: [
        { capture: { id: captureId(1), nonsense: true }, uploaded: false },
        { capture: { id: '../etc/passwd' }, uploaded: false },
        { capture: null, uploaded: false },
        'x',
      ],
      total: 4,
      idleSeconds: null,
    })
    expect(list.items.map((i) => i.id)).toEqual([captureId(1)])
    expect(list.total).toBe(4)
  })

  it.each([
    [null],
    [{ items: 'x', total: 1, idleSeconds: null }],
    [{ items: [], total: -1, idleSeconds: null }],
    [{ items: [], total: 'a', idleSeconds: null }],
    [{ items: [], total: 1, idleSeconds: 'x' }],
    [{ items: [], total: 1 }],
  ])('GATE-1a: 形の違う一覧は EdgeError（重ねない）', (raw) => {
    expect(() => parsePendingList(raw)).toThrow(EdgeError)
  })

  it('GATE-1a: 2xx でない一覧は EdgeError（status つき）', async () => {
    const fetch: FetchLike = () => Promise.resolve(jsonResponse(503, {}))
    await expect(api(fetch).listPending(200)).rejects.toMatchObject({
      name: 'EdgeError',
      status: 503,
    })
  })

  it('GATE-1a: 一覧は 3 秒で打ち切る（応答しない edge）', async () => {
    vi.useFakeTimers()
    const fetch: FetchLike = () => new Promise(() => undefined)
    const pending = api(fetch).listPending(200)
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(2999)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it('FAIL-9: 画像・同意・送信済みは 5 秒で打ち切る', async () => {
    vi.useFakeTimers()
    const fetch: FetchLike = () => new Promise(() => undefined)
    const edge = api(fetch)
    const results = [
      expect(edge.fetchImage(captureId(1))).rejects.toBeInstanceOf(TimeoutError),
      expect(edge.setConsent([captureId(1)], true)).rejects.toBeInstanceOf(TimeoutError),
      expect(edge.markUploaded([captureId(1)])).rejects.toBeInstanceOf(TimeoutError),
    ]
    await vi.advanceTimersByTimeAsync(5000)
    await Promise.all(results)
  })

  it('UP-1a: 同意・送信済みは JSON を POST し、更新した件数を返す', async () => {
    const backend = createBackend({ items: [makeCapture(1)] })
    const edge = api(backend.fetch)
    expect(await edge.setConsent([captureId(1)], true)).toBe(1)
    expect(await edge.markUploaded([captureId(1)])).toBe(1)
    // 2 回目は 0 件（冪等）
    expect(await edge.markUploaded([captureId(1)])).toBe(0)
    const [consent, uploaded] = backend.edgeCalls
    expect(consent?.init?.method).toBe('POST')
    expect(consent?.init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(consent?.body).toEqual({ consent: true, ids: [captureId(1)] })
    expect(uploaded?.body).toEqual({ ids: [captureId(1)] })
  })

  it('UP-1a: updated が数でない応答は EdgeError', async () => {
    const fetch: FetchLike = () => Promise.resolve(jsonResponse(200, { updated: 'many' }))
    await expect(api(fetch).setConsent([captureId(1)], true)).rejects.toBeInstanceOf(EdgeError)
    const failing: FetchLike = () => Promise.resolve(jsonResponse(415, {}))
    await expect(api(failing).setConsent([captureId(1)], true)).rejects.toMatchObject({
      status: 415,
    })
  })

  it('GATE-1b: 画像の URL は /captures/{id}/image。id の形が不正なら取らない（パスを通さない）', async () => {
    expect(imageUrl(EDGE_BASE, captureId(1))).toBe(`${EDGE_BASE}/captures/${captureId(1)}/image`)
    const fetch = vi.fn<FetchLike>()
    await expect(api(fetch).fetchImage('../secret')).rejects.toMatchObject({ status: 404 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('UP-1b: 画像は blob で取る。2xx でなければ EdgeError', async () => {
    const backend = createBackend({ items: [makeCapture(1)] })
    const blob = await api(backend.fetch).fetchImage(captureId(1))
    expect(blob.size).toBeGreaterThan(0)
    await expect(api(backend.fetch).fetchImage(captureId(9))).rejects.toMatchObject({ status: 404 })
  })
})

describe('withTimeout', () => {
  it('打ち切り前に届けば timer を片づけ、signal を渡す', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const fetch: FetchLike = (_url, init) => {
      signal = init?.signal
      return Promise.resolve(jsonResponse(200, {}))
    }
    const response = await withTimeout(fetch, 1000)(`${API_BASE}/x`, {})
    expect(response.status).toBe(200)
    expect(signal?.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('打ち切ると signal を abort して TimeoutError。fetch が失敗したときはその例外', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const hang: FetchLike = (_url, init) => {
      signal = init?.signal
      return new Promise(() => undefined)
    }
    const timedOut = expect(withTimeout(hang, 1000)('http://x')).rejects.toBeInstanceOf(
      TimeoutError,
    )
    await vi.advanceTimersByTimeAsync(1000)
    await timedOut
    expect(signal?.aborted).toBe(true)

    const broken: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'))
    await expect(withTimeout(broken, 1000)('http://x')).rejects.toBeInstanceOf(TypeError)
    const odd: FetchLike = () => Promise.reject(new Error('plain'))
    await expect(withTimeout(odd, 1000)('http://x')).rejects.toThrow('plain')
  })
})
