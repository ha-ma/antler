import { EnvError, loadEnv } from './env.js'

const SECRET = 'test-owner-token-secret-0123456789abcdef'
const base = {
  CORS_ORIGINS: 'http://localhost:5173',
  ANTHROPIC_API_KEY: 'test-key',
  OWNER_TOKEN_SECRET: SECRET,
}

describe('loadEnv', () => {
  it('既定値を補い、CORS_ORIGINS を配列にする（NODE_ENV の既定は production）', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://ezoroad.example' })
    expect(env).toEqual({
      NODE_ENV: 'production',
      PORT: 8787,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:5173', 'https://ezoroad.example'],
      ANTHROPIC_API_KEY: 'test-key',
      OWNER_TOKEN_SECRET: SECRET,
      CLAUDE_DAILY_CALL_LIMIT: 400,
      CLAUDE_MAX_CONCURRENT_CALLS: 4,
      TRIPS_DB_URL: 'file:./data/trips.db',
      PUBLIC_API_URL: 'http://localhost:8787',
      SIM_PUBLIC_URL: 'http://localhost:5173',
      PWA_PUBLIC_URL: 'http://localhost:5174',
      OG_FONT_FILES: [],
      TRUST_PROXY: false,
    })
  })

  it('record の公開 URL はオリジンだけ、OG のフォントはカンマ区切り', () => {
    const env = loadEnv({
      ...base,
      PUBLIC_API_URL: 'https://api.ezoroad.example',
      OG_FONT_FILES: '/fonts/a.ttf, /fonts/b.ttc',
    })
    expect(env.PUBLIC_API_URL).toBe('https://api.ezoroad.example')
    expect(env.OG_FONT_FILES).toEqual(['/fonts/a.ttf', '/fonts/b.ttc'])
    expect(() => loadEnv({ ...base, SIM_PUBLIC_URL: 'https://ezoroad.example/app' })).toThrow(
      EnvError,
    )
    expect(() => loadEnv({ ...base, PWA_PUBLIC_URL: 'ezoroad.example' })).toThrow(EnvError)
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

  it('CLAUDE_DAILY_CALL_LIMIT・CLAUDE_MAX_CONCURRENT_CALLS・TRIPS_DB_URL・TRUST_PROXY を読む', () => {
    expect(
      loadEnv({
        ...base,
        CLAUDE_DAILY_CALL_LIMIT: '50',
        CLAUDE_MAX_CONCURRENT_CALLS: '2',
        TRIPS_DB_URL: 'file:/var/lib/antler/trips.db',
        TRUST_PROXY: 'true',
      }),
    ).toMatchObject({
      CLAUDE_DAILY_CALL_LIMIT: 50,
      CLAUDE_MAX_CONCURRENT_CALLS: 2,
      TRIPS_DB_URL: 'file:/var/lib/antler/trips.db',
      TRUST_PROXY: true,
    })
    expect(() => loadEnv({ ...base, CLAUDE_DAILY_CALL_LIMIT: '0' })).toThrow(
      /CLAUDE_DAILY_CALL_LIMIT/,
    )
    expect(() => loadEnv({ ...base, CLAUDE_MAX_CONCURRENT_CALLS: '0' })).toThrow(
      /CLAUDE_MAX_CONCURRENT_CALLS/,
    )
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
