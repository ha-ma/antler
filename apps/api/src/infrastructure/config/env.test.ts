import { EnvError, loadEnv } from './env.js'

const base = { CORS_ORIGINS: 'http://localhost:5173' }

describe('loadEnv', () => {
  it('既定値を補い、CORS_ORIGINS を配列にする', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'http://localhost:5173, https://ezoroad.example' })
    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 8787,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:5173', 'https://ezoroad.example'],
    })
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
