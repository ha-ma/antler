import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCapture, buildForm } from '../../tests/factories/captures.js'
import { loadEnv } from '../infrastructure/config/env.js'
import { buildContainer } from './container.js'

// POST /api/captures の組み立てと環境変数（docs/specs/edge-capture/functional.md A5・A6）。

const BASE = {
  CORS_ORIGINS: 'http://localhost:5173',
  NODE_ENV: 'test',
  ANTHROPIC_API_KEY: 'test-key',
  OWNER_TOKEN_SECRET: 'test-owner-token-secret-0123456789abcdef',
}

describe('CAPTURES_* の環境変数', () => {
  it('API-1i・API-1o: 既定は ./data/captures-received・50,000 件・5 GiB', () => {
    const env = loadEnv(BASE)
    expect(env.CAPTURES_DIR).toBe('./data/captures-received')
    expect(env.CAPTURES_MAX_ITEMS).toBe(50_000)
    expect(env.CAPTURES_MAX_BYTES).toBe(5 * 1024 ** 3)
  })

  it('API-1i・API-1o: 数は文字列から読み、0・小数・数でない値は起動を止める', () => {
    const env = loadEnv({
      ...BASE,
      CAPTURES_DIR: '/var/antler/captures',
      CAPTURES_MAX_ITEMS: '10',
      CAPTURES_MAX_BYTES: '1048576',
    })
    expect(env.CAPTURES_DIR).toBe('/var/antler/captures')
    expect(env.CAPTURES_MAX_ITEMS).toBe(10)
    expect(env.CAPTURES_MAX_BYTES).toBe(1_048_576)
    for (const bad of [
      { CAPTURES_MAX_ITEMS: '0' },
      { CAPTURES_MAX_ITEMS: '1.5' },
      { CAPTURES_MAX_BYTES: 'many' },
      { CAPTURES_DIR: '' },
    ]) {
      expect(() => loadEnv({ ...BASE, ...bad })).toThrow()
    }
  })
})

describe('buildContainer の captures', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'antler-container-captures-'))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('API-1a・API-1b: CAPTURES_DIR を 0700 で作り、POST /api/captures が 201 → 再送 200 で動く', async () => {
    const capturesDir = join(dir, 'received')
    const { app, connection } = await buildContainer({
      ...BASE,
      TRIPS_DB_URL: `file:${join(dir, 'data', 'trips.db')}`,
      CAPTURES_DIR: capturesDir,
    })
    expect(existsSync(capturesDir)).toBe(true)
    expect(statSync(capturesDir).mode & 0o777).toBe(0o700)
    const post = () => app.request('/api/captures', { method: 'POST', body: buildForm() })
    expect((await post()).status).toBe(201)
    expect((await post()).status).toBe(200)
    expect(readdirSync(capturesDir)).toHaveLength(2)
    connection.client.close()
  })

  it('API-1i: CAPTURES_MAX_ITEMS を超える分は 503 STORE_FULL', async () => {
    const { app, connection } = await buildContainer({
      ...BASE,
      TRIPS_DB_URL: `file:${join(dir, 'data', 'trips.db')}`,
      CAPTURES_DIR: join(dir, 'received'),
      CAPTURES_MAX_ITEMS: '1',
    })
    const post = (id: string) =>
      app.request('/api/captures', {
        method: 'POST',
        body: buildForm({ capture: buildCapture({ id }) }),
      })
    expect((await post('cap_aaaaaa000001')).status).toBe(201)
    expect((await post('cap_aaaaaa000002')).status).toBe(503)
    connection.client.close()
  })
})
