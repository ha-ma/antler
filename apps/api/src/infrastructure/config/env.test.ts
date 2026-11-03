import { EnvError, loadEnv } from './env.js'

const SECRET = 'test-owner-token-secret-0123456789abcdef'
const base = {
  CORS_ORIGINS: 'http://localhost:5173',
  ANTHROPIC_API_KEY: 'test-key',
  OWNER_TOKEN_SECRET: SECRET,
}

describe('loadEnv', () => {
  it('既定値を補い、CORS_ORIGINS を配列にする', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://ezoroad.example' })
    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 8787,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:5173', 'https://ezoroad.example'],
      ANTHROPIC_API_KEY: 'test-key',
      OWNER_TOKEN_SECRET: SECRET,
      TRIPS_DAILY_LIMIT: 200,
      TRIPS_DB_URL: 'file:./data/trips.db',
      TRUST_PROXY: false,
    })
  })

  it('FAIL-6: ANTHROPIC_API_KEY が無い・空なら起動しない（既定値を持たない）', () => {
    expect(() => loadEnv({ CORS_ORIGINS: base.CORS_ORIGINS })).toThrow(/ANTHROPIC_API_KEY/)
    expect(() => loadEnv({ ...base, ANTHROPIC_API_KEY: '' })).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('OWNER_TOKEN_SECRET は必須で 32 文字以上（既定値を持たない）', () => {
    const noSecret: Record<string, string | undefined> = { ...base }
    delete noSecret['OWNER_TOKEN_SECRET']
    expect(() => loadEnv(noSecret)).toThrow(/OWNER_TOKEN_SECRET/)
    expect(() => loadEnv({ ...base, OWNER_TOKEN_SECRET: 'x'.repeat(31) })).toThrow(
      /OWNER_TOKEN_SECRET/,
    )
    expect(
      loadEnv({ ...base, OWNER_TOKEN_SECRET: 'x'.repeat(32) }).OWNER_TOKEN_SECRET,
    ).toHaveLength(32)
  })

  it('TRIPS_DAILY_LIMIT・TRIPS_DB_URL・TRUST_PROXY を読む', () => {
    expect(
      loadEnv({
        ...base,
        TRIPS_DAILY_LIMIT: '50',
        TRIPS_DB_URL: 'file:/var/lib/antler/trips.db',
        TRUST_PROXY: 'true',
      }),
    ).toMatchObject({
      TRIPS_DAILY_LIMIT: 50,
      TRIPS_DB_URL: 'file:/var/lib/antler/trips.db',
      TRUST_PROXY: true,
    })
    expect(() => loadEnv({ ...base, TRIPS_DAILY_LIMIT: '0' })).toThrow(/TRIPS_DAILY_LIMIT/)
    expect(() => loadEnv({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/)
  })

  it('CORS_ORIGINS が無ければ起動を止める（フォールバックしない）', () => {
    expect(() => loadEnv({})).toThrow(EnvError)
  })

  it('CORS_ORIGINS に * は使えない', () => {
    expect(() => loadEnv({ CORS_ORIGINS: '*' })).toThrow(/\*/)
  })

  it('オリジン以外（パス付き・スキームなし）は拒否する', () => {
    expect(() => loadEnv({ CORS_ORIGINS: 'localhost:5173' })).toThrow(EnvError)
    expect(() => loadEnv({ CORS_ORIGINS: 'http://localhost:5173/app' })).toThrow(EnvError)
  })

  it('PORT・LOG_LEVEL・NODE_ENV の形を確かめる', () => {
    expect(() => loadEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadEnv({ ...base, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/)
    expect(() => loadEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
    expect(loadEnv({ ...base, PORT: '9000', NODE_ENV: 'production' })).toMatchObject({
      PORT: 9000,
      NODE_ENV: 'production',
    })
  })
})
