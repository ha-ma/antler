import { HTTPException } from 'hono/http-exception'
import { createLogger } from '../logging/logger.js'
import { createApp, type AppDeps } from './app.js'
import type { ReadinessCheck } from './routes/health.routes.js'

function setup(overrides: Partial<AppDeps> = {}) {
  const lines: Record<string, unknown>[] = []
  const logger = createLogger('debug', {
    sink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
  })
  const app = createApp({
    logger,
    corsOrigins: ['http://localhost:5173'],
    readinessChecks: [],
    exposeErrorDetails: false,
    ...overrides,
  })
  return { app, lines }
}

describe('createApp', () => {
  it('GET /health は 200 {status:ok}', async () => {
    const { app } = setup()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('GET /health/ready は依存が全部届けば 200、1 つでも落ちれば 503 と落ちた名前', async () => {
    const ok: ReadinessCheck = { name: 'sqlite', check: () => Promise.resolve() }
    const down: ReadinessCheck = {
      name: 'storage',
      check: () => Promise.reject(new Error('EACCES')),
    }
    expect((await setup({ readinessChecks: [ok] }).app.request('/health/ready')).status).toBe(200)
    const res = await setup({ readinessChecks: [ok, down] }).app.request('/health/ready')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'error', details: { storage: 'unavailable' } })
  })

  it('許可したオリジンだけに CORS を返す', async () => {
    const { app } = setup()
    const allowed = await app.request('/health', { headers: { Origin: 'http://localhost:5173' } })
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    const other = await app.request('/health', { headers: { Origin: 'https://evil.example' } })
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('セキュリティヘッダーと X-Request-Id を付け、アクセスを JSON で記録する', async () => {
    const { app, lines } = setup()
    const res = await app.request('/health')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const id = res.headers.get('X-Request-Id')
    expect(id).toBeTruthy()
    expect(lines.find((l) => l['event'] === 'http.request')).toMatchObject({
      requestId: id,
      method: 'GET',
      path: '/health',
      status: 200,
    })
  })

  it('知らないパスは 404 の JSON', async () => {
    const res = await setup().app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('想定外の例外は 500。本番では内部メッセージを見せず、ログには残す', async () => {
    // 試験だけのルート。変数名を app にしない（sfad-drift が `app.get(` を実在のルートとして数えるため）
    const { app: server, lines } = setup()
    server.get('/boom', () => {
      throw new Error('db password=secret')
    })
    const res = await server.request('/boom')
    expect(res.status).toBe(500)
    const body = JSON.stringify(await res.json())
    expect(body).toContain('INTERNAL_ERROR')
    expect(body).not.toContain('secret')
    expect(lines.find((l) => l['event'] === 'http.error')).toMatchObject({ status: 500 })
  })

  it('開発では detail に例外のメッセージを出す', async () => {
    const { app: server } = setup({ exposeErrorDetails: true })
    server.get('/boom', () => {
      throw new Error('detail here')
    })
    expect(await (await server.request('/boom')).json()).toMatchObject({
      error: { detail: 'detail here' },
    })
  })

  it('HTTPException は その status を返す', async () => {
    const { app: server } = setup()
    server.get('/teapot', () => {
      throw new HTTPException(418, { message: 'teapot' })
    })
    const res = await server.request('/teapot')
    expect(res.status).toBe(418)
    expect(await res.json()).toMatchObject({ error: { code: 'HTTP_ERROR', message: 'teapot' } })
  })
})
