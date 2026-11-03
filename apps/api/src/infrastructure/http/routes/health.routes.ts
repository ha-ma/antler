import { Hono } from 'hono'

// /health は起動しているか（liveness）、/health/ready は外部依存に届くか（readiness）。
// 依存（SQLite・保存先）は ReadinessCheck として di で足す。

export type ReadinessCheck = { name: string; check: () => Promise<void> }

export function healthRoutes(checks: readonly ReadinessCheck[]): Hono {
  const routes = new Hono()
  routes.get('/health', (c) => c.json({ status: 'ok' }))
  routes.get('/health/ready', async (c) => {
    const results = await Promise.allSettled(checks.map((d) => d.check()))
    const failed: Record<string, string> = {}
    results.forEach((r, i) => {
      const name = checks[i]?.name ?? `check-${String(i)}`
      if (r.status === 'rejected') failed[name] = 'unavailable'
    })
    if (Object.keys(failed).length > 0) {
      return c.json({ status: 'error', details: failed }, 503)
    }
    return c.json({ status: 'ok' })
  })
  return routes
}
