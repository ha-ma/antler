import { EnvError, loadEnv } from '../../src/infrastructure/config/env.js'
import {
  loadVercelEnv,
  vercelOrigin,
  withVercelDefaults,
} from '../../src/infrastructure/config/vercel-env.js'
import { vercelClientIp } from '../../src/infrastructure/http/middleware/vercel-client-ip.js'
import { VERCEL_SOURCE } from './harness.js'

// deploy-a R4・R8（docs/specs/deploy-a/functional.md の UC-2・UC-5）

const headers = (h: Record<string, string>) => ({
  header: (name: string) => h[name.toLowerCase()],
})

describe('vercelClientIp（deploy-a R8）', () => {
  it('IP-5a: x-vercel-forwarded-for の右端 → x-real-ip → x-forwarded-for の右端', () => {
    expect(
      vercelClientIp(
        headers({
          'x-vercel-forwarded-for': '198.51.100.1, 203.0.113.9',
          'x-real-ip': '192.0.2.1',
          'x-forwarded-for': '192.0.2.2',
        }),
      ),
    ).toBe('203.0.113.9')
    expect(
      vercelClientIp(headers({ 'x-real-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.2' })),
    ).toBe('192.0.2.1')
    expect(vercelClientIp(headers({ 'x-forwarded-for': '10.0.0.1, 192.0.2.2 ' }))).toBe('192.0.2.2')
  })

  it('IP-5a: 空白・空の値は飛ばす。どれも無ければ undefined', () => {
    expect(
      vercelClientIp(headers({ 'x-vercel-forwarded-for': ' , ', 'x-real-ip': '192.0.2.3' })),
    ).toBe('192.0.2.3')
    expect(vercelClientIp(headers({}))).toBeUndefined()
  })
})

describe('Vercel の env（deploy-a R4）', () => {
  it('ENV-2a: preview は VERCEL_BRANCH_URL、無ければ VERCEL_URL。production は VERCEL_PROJECT_PRODUCTION_URL', () => {
    expect(vercelOrigin(VERCEL_SOURCE)).toBe('https://antler-git-feat-deploy-a.vercel.app')
    expect(vercelOrigin({ VERCEL_ENV: 'preview', VERCEL_URL: 'antler-abc.vercel.app' })).toBe(
      'https://antler-abc.vercel.app',
    )
    expect(
      vercelOrigin({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'ezoroad.example',
        VERCEL_BRANCH_URL: 'antler-git-main.vercel.app',
      }),
    ).toBe('https://ezoroad.example')
    expect(vercelOrigin({})).toBeUndefined()
  })

  it('ENV-2a: 公開の URL と CORS_ORIGINS の既定を足す。明示が勝つ。元の source は変えない', () => {
    const source = { ...VERCEL_SOURCE, SIM_PUBLIC_URL: 'https://sim.example' }
    const filled = withVercelDefaults(source)
    expect(filled['PUBLIC_API_URL']).toBe('https://antler-git-feat-deploy-a.vercel.app')
    expect(filled['CORS_ORIGINS']).toBe('https://antler-git-feat-deploy-a.vercel.app')
    expect(filled['SIM_PUBLIC_URL']).toBe('https://sim.example')
    expect(source).not.toHaveProperty('PUBLIC_API_URL')
    // Vercel の値も明示も無ければ何も足さない
    expect(withVercelDefaults({ A: '1' })).toEqual({ A: '1' })
  })

  it('ENV-2b: file: の URL・トークンなし・Blob の資格なし → EnvError（名前つき・値なし）', () => {
    const base = withVercelDefaults(VERCEL_SOURCE)
    const cases: [Record<string, string | undefined>, RegExp][] = [
      [{ TRIPS_DB_URL: 'file:./data/trips.db' }, /TRIPS_DB_URL/],
      [{ TRIPS_DB_URL: 'wss://antler.turso.io' }, /TRIPS_DB_URL/],
      [{ TURSO_AUTH_TOKEN: undefined }, /TURSO_AUTH_TOKEN/],
      [{ BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: undefined }, /BLOB_STORE_ID/],
    ]
    for (const [patch, name] of cases) {
      let error: unknown
      try {
        loadVercelEnv({ ...base, ...patch })
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(EnvError)
      expect(String(error)).toMatch(name)
      expect(String(error)).not.toContain('test-owner-token-secret')
      expect(String(error)).not.toContain('test-anthropic-key')
    }
  })

  it('ENV-2b: Turso の URL・トークン・（BLOB_STORE_ID か BLOB_READ_WRITE_TOKEN）があれば通る', () => {
    const base = withVercelDefaults(VERCEL_SOURCE)
    expect(loadVercelEnv(base).TRIPS_DB_URL).toBe('libsql://antler-preview-test.turso.io')
    const oidc = { ...base, BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: 'store_abc' }
    expect(loadVercelEnv(oidc).PUBLIC_API_URL).toBe('https://antler-git-feat-deploy-a.vercel.app')
    expect(
      loadVercelEnv({ ...base, TRIPS_DB_URL: 'https://antler.turso.io' }).TURSO_AUTH_TOKEN,
    ).toBe('test-turso-token')
  })

  it('ENV-2c: ローカルの loadEnv は TURSO_AUTH_TOKEN が任意。Turso の URL でトークンなし → EnvError', () => {
    const local = {
      CORS_ORIGINS: 'http://localhost:5173',
      ANTHROPIC_API_KEY: 'k',
      OWNER_TOKEN_SECRET: 'test-owner-token-secret-0123456789abcdef',
    }
    expect(loadEnv(local).TURSO_AUTH_TOKEN).toBeUndefined()
    expect(loadEnv(local).TRIPS_DB_URL).toBe('file:./data/trips.db')
    expect(() => loadEnv({ ...local, TRIPS_DB_URL: 'libsql://antler.turso.io' })).toThrow(
      /TURSO_AUTH_TOKEN/,
    )
    expect(
      loadEnv({ ...local, TRIPS_DB_URL: 'libsql://antler.turso.io', TURSO_AUTH_TOKEN: 't' })
        .TURSO_AUTH_TOKEN,
    ).toBe('t')
  })
})
