import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnvError } from '../infrastructure/config/env.js'
import { buildContainer } from './container.js'

describe('buildContainer', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'antler-container-'))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  const source = (dbFile: string) => ({
    CORS_ORIGINS: 'http://localhost:5173',
    NODE_ENV: 'test',
    ANTHROPIC_API_KEY: 'test-key',
    OWNER_TOKEN_SECRET: 'test-owner-token-secret-0123456789abcdef',
    TRIPS_DB_URL: `file:${join(dir, 'data', dbFile)}`,
  })

  it('環境変数からアプリを組み立て、SQLite の表を作る（readiness も通る）', async () => {
    const { app, env, connection } = await buildContainer(source('trips.db'))
    expect(env.NODE_ENV).toBe('test')
    expect((await app.request('/health')).status).toBe(200)
    expect((await app.request('/health/ready')).status).toBe(200)
    const tables = await connection.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    expect(tables.rows.map((r) => r['name'])).toEqual(['trip_requests', 'trips'])
    connection.client.close()
  })

  it('MIGR-1: 同じデータファイルで 2 回起動しても壊れない', async () => {
    const first = await buildContainer(source('again.db'))
    first.connection.client.close()
    const second = await buildContainer(source('again.db'))
    expect((await second.app.request('/health/ready')).status).toBe(200)
    second.connection.client.close()
  })

  it('POST /api/trips を載せる（Idempotency-Key が無ければ 400）', async () => {
    const { app, connection } = await buildContainer(source('route.db'))
    const res = await app.request('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(400)
    connection.client.close()
  })

  it('環境変数が不正なら起動しない', async () => {
    await expect(buildContainer({})).rejects.toThrow(EnvError)
  })

  it('FAIL-6: ANTHROPIC_API_KEY が無いと起動しない', async () => {
    const noKey: Record<string, string | undefined> = { ...source('nokey.db') }
    delete noKey['ANTHROPIC_API_KEY']
    await expect(buildContainer(noKey)).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })
})
