import { Hono } from 'hono'
import { rateLimit } from './rate-limit.js'

function appWith(now: { t: number }) {
  const app = new Hono()
  app.post(
    '/api/trips',
    rateLimit({
      limit: 10,
      windowMs: 60_000,
      key: (c) => c.req.header('x-test-ip') ?? 'unknown',
      now: () => now.t,
    }),
    (c) => c.json({ ok: true }, 201),
  )
  return app
}

const post = (app: Hono, ip: string) =>
  app.request('/api/trips', { method: 'POST', headers: { 'x-test-ip': ip } })

describe('rateLimit（記録作成 10/分/IP）', () => {
  it('同じ IP の 11 回目は 429 と Retry-After を返す', async () => {
    const now = { t: 0 }
    const app = appWith(now)
    for (let i = 0; i < 10; i++) {
      expect((await post(app, '1.1.1.1')).status).toBe(201)
    }
    const blocked = await post(app, '1.1.1.1')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('60')
    expect(blocked.headers.get('RateLimit-Remaining')).toBe('0')
  })

  it('IP ごとに数える', async () => {
    const app = appWith({ t: 0 })
    for (let i = 0; i < 10; i++) await post(app, '1.1.1.1')
    expect((await post(app, '2.2.2.2')).status).toBe(201)
  })

  it('窓が過ぎたら数え直す', async () => {
    const now = { t: 0 }
    const app = appWith(now)
    for (let i = 0; i < 11; i++) await post(app, '1.1.1.1')
    now.t = 60_000
    const res = await post(app, '1.1.1.1')
    expect(res.status).toBe(201)
    expect(res.headers.get('RateLimit-Remaining')).toBe('9')
  })
})
