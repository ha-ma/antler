import { Hono } from 'hono'
import { rateLimit, type RateLimitStore } from './rate-limit.js'

// 変数名を app にしない（sfad-drift が `app.post(` を実在のルートとして数えるため。試験だけのルート）
function serverWith(now: { t: number }, opts: { maxKeys?: number; store?: RateLimitStore } = {}) {
  const server = new Hono()
  server.post(
    '/api/trips',
    rateLimit({
      name: 'test.trips',
      limit: 10,
      windowMs: 60_000,
      key: (c) => c.req.header('x-test-ip') ?? 'unknown',
      now: () => now.t,
      ...opts,
    }),
    (c) => c.json({ ok: true }, 201),
  )
  return server
}

const post = (server: Hono, ip: string) =>
  server.request('/api/trips', { method: 'POST', headers: { 'x-test-ip': ip } })

describe('rateLimit（記録作成 10/分/IP）', () => {
  it('同じ IP の 11 回目は 429 と Retry-After を返す', async () => {
    const now = { t: 0 }
    const server = serverWith(now)
    for (let i = 0; i < 10; i++) {
      expect((await post(server, '1.1.1.1')).status).toBe(201)
    }
    const blocked = await post(server, '1.1.1.1')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('60')
    expect(blocked.headers.get('RateLimit-Remaining')).toBe('0')
  })

  it('IP ごとに数える', async () => {
    const server = serverWith({ t: 0 })
    for (let i = 0; i < 10; i++) await post(server, '1.1.1.1')
    expect((await post(server, '2.2.2.2')).status).toBe(201)
  })

  it('窓が過ぎたら数え直す', async () => {
    const now = { t: 0 }
    const server = serverWith(now)
    for (let i = 0; i < 11; i++) await post(server, '1.1.1.1')
    now.t = 60_000
    const res = await post(server, '1.1.1.1')
    expect(res.status).toBe(201)
    expect(res.headers.get('RateLimit-Remaining')).toBe('9')
  })

  it('W2: 窓が過ぎた項目は掃除され、鍵を増やされても残り続けない', async () => {
    const now = { t: 0 }
    const store: RateLimitStore = new Map()
    const server = serverWith(now, { store })
    for (let i = 0; i < 50; i++) await post(server, `10.0.0.${String(i)}`)
    expect(store.size).toBe(50)
    now.t = 60_000
    await post(server, '10.0.1.1')
    expect([...store.keys()]).toEqual(['10.0.1.1'])
  })

  it('W2: 覚える鍵の数に上限があり、超えたら古いものから忘れる', async () => {
    const store: RateLimitStore = new Map()
    const server = serverWith({ t: 0 }, { store, maxKeys: 3 })
    for (const ip of ['a', 'b', 'c', 'd']) await post(server, ip)
    expect([...store.keys()]).toEqual(['b', 'c', 'd'])
  })
})
