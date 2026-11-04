import type { Capture } from '@antler/schema'
import type { FetchLike, ResponseLike } from '../lib/upload'

// テスト用の偽物。edge（8767 の HTTP）と api（POST /api/captures）を 1 つの fetch に束ねる。
// 実ネットワークは使わない。レスポンスは Node の Response ではなく、使う分だけの形（ResponseLike）で返す。

export const EDGE_BASE = 'http://ezoroad.local:8767'
export const API_BASE = 'http://localhost:8804'

export function captureId(n: number): string {
  return `cap_${n.toString(16).padStart(12, '0')}`
}

export function makeCapture(n: number, over: Partial<Capture> = {}): Capture {
  const id = captureId(n)
  return {
    id,
    source: 'vehicle',
    image: `captures/${id}.jpg`,
    imageSize: [320, 240],
    boxes: [{ label: 'deer', xywh: [0.4, 0.4, 0.1, 0.2], by: 'model' }],
    conditions: {
      season: 'autumn',
      month: 10,
      weather: 'unknown',
      surface: 'unknown',
      light: 'dusk',
      fog: 'none',
      traffic: 'unknown',
      vehicle: 'unknown',
    },
    distanceM: 42,
    side: 'L',
    pose: 'unknown',
    reactionMs: null,
    outcome: 'avoided',
    roadSegment: 'unknown',
    consent: false,
    createdAt: '2026-11-03T17:12:30.000+09:00',
    ...over,
  }
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ResponseLike {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob([JSON.stringify(body)])),
  }
}

export function imageResponse(): ResponseLike {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'image/jpeg' },
    json: () => Promise.reject(new Error('not json')),
    blob: () =>
      Promise.resolve(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })),
  }
}

export type ApiCall = {
  url: string
  init: RequestInit
  capture: Capture
  capturePart: unknown
  image: Blob
  keys: string[]
}
/** api の応答。'network' は fetch が例外を投げる（回線切れ）。 */
export type ApiBehavior = (call: ApiCall, n: number) => ResponseLike | 'network'
export type Route = 'list' | 'image' | 'consent' | 'uploaded'
export type EdgeFault = (route: Route, n: number) => 'network' | number | undefined

export type FakeItem = { capture: Capture; uploaded: boolean }

export type BackendOptions = {
  items?: Capture[]
  idleSeconds?: number | null
  api?: ApiBehavior
  edgeFault?: EdgeFault
  /** 同意の POST を受けても consent が true にならない id（送れない状態の再現） */
  stuckConsent?: string[]
  /** 同意の POST が成功しても、この id は一覧から消える（保持期間切れの再現） */
  vanishOnConsent?: string[]
}

export function createBackend(options: BackendOptions = {}) {
  const items: FakeItem[] = (options.items ?? []).map((capture) => ({ capture, uploaded: false }))
  const counts: Record<Route, number> = { list: 0, image: 0, consent: 0, uploaded: 0 }
  const state = {
    items,
    idleSeconds: options.idleSeconds === undefined ? null : options.idleSeconds,
    api: options.api ?? ((): ResponseLike => jsonResponse(201, { id: 'x', image: 'y' })),
    edgeFault: options.edgeFault,
  }
  const edgeCalls: { route: Route; url: string; body: unknown; init: RequestInit | undefined }[] =
    []
  const apiCalls: ApiCall[] = []
  let apiCount = 0

  function fault(route: Route): ResponseLike | 'network' | undefined {
    counts[route] += 1
    const f = state.edgeFault?.(route, counts[route])
    if (f === 'network') return 'network'
    if (typeof f === 'number') return jsonResponse(f, { error: 'x' })
    return undefined
  }

  const fetchFake: FetchLike = (url, init) => {
    const method = init?.method ?? 'GET'
    if (url.startsWith(`${API_BASE}/api/captures`)) {
      apiCount += 1
      const form = init?.body as FormData
      const capturePart = form.get('capture')
      const call: ApiCall = {
        url,
        init: init ?? {},
        capture: JSON.parse(String(capturePart)) as Capture,
        capturePart,
        image: form.get('image') as Blob,
        keys: [...form.keys()],
      }
      apiCalls.push(call)
      const result = state.api(call, apiCount)
      return result === 'network'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(result)
    }
    if (!url.startsWith(EDGE_BASE)) return Promise.reject(new TypeError(`unexpected url ${url}`))
    const path = url.slice(EDGE_BASE.length)
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined

    if (method === 'GET' && path.startsWith('/captures?')) {
      edgeCalls.push({ route: 'list', url, body, init })
      const bad = fault('list')
      if (bad === 'network') return Promise.reject(new TypeError('Failed to fetch'))
      if (bad) return Promise.resolve(bad)
      const query = new URLSearchParams(path.split('?')[1])
      const limit = Number(query.get('limit') ?? 200)
      const pending = state.items.filter((i) => !i.uploaded)
      return Promise.resolve(
        jsonResponse(200, {
          items: pending.slice(0, limit).map((i) => ({ capture: i.capture, uploaded: i.uploaded })),
          total: pending.length,
          idleSeconds: state.idleSeconds,
        }),
      )
    }
    const image = /^\/captures\/(cap_[0-9a-f]{12})\/image$/.exec(path)
    if (method === 'GET' && image) {
      edgeCalls.push({ route: 'image', url, body, init })
      const bad = fault('image')
      if (bad === 'network') return Promise.reject(new TypeError('Failed to fetch'))
      if (bad) return Promise.resolve(bad)
      const found = state.items.find((i) => i.capture.id === image[1])
      return Promise.resolve(found ? imageResponse() : jsonResponse(404, { error: 'not found' }))
    }
    if (method === 'POST' && path === '/captures/consent') {
      edgeCalls.push({ route: 'consent', url, body, init })
      const bad = fault('consent')
      if (bad === 'network') return Promise.reject(new TypeError('Failed to fetch'))
      if (bad) return Promise.resolve(bad)
      const { consent, ids } = body as { consent: boolean; ids: string[] }
      let updated = 0
      for (const id of ids) {
        const index = state.items.findIndex((i) => i.capture.id === id && !i.uploaded)
        const item = state.items[index]
        if (!item) continue
        if (!consent) {
          state.items.splice(index, 1)
          updated += 1
        } else if (options.vanishOnConsent?.includes(id)) {
          state.items.splice(index, 1)
        } else if (!options.stuckConsent?.includes(id)) {
          item.capture = { ...item.capture, consent: true }
          updated += 1
        }
      }
      return Promise.resolve(jsonResponse(200, { updated }))
    }
    if (method === 'POST' && path === '/captures/uploaded') {
      edgeCalls.push({ route: 'uploaded', url, body, init })
      const bad = fault('uploaded')
      if (bad === 'network') return Promise.reject(new TypeError('Failed to fetch'))
      if (bad) return Promise.resolve(bad)
      const { ids } = body as { ids: string[] }
      let updated = 0
      for (const id of ids) {
        const item = state.items.find(
          (i) => i.capture.id === id && i.capture.consent && !i.uploaded,
        )
        if (item) {
          item.uploaded = true
          updated += 1
        }
      }
      return Promise.resolve(jsonResponse(200, { updated }))
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }))
  }

  return { fetch: fetchFake, state, edgeCalls, apiCalls }
}
