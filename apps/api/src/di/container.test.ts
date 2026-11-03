import { EnvError } from '../infrastructure/config/env.js'
import { buildContainer } from './container.js'

describe('buildContainer', () => {
  it('環境変数からアプリを組み立てる', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { app, env } = buildContainer({ CORS_ORIGINS: 'http://localhost:5173', NODE_ENV: 'test' })
    expect(env.NODE_ENV).toBe('test')
    expect((await app.request('/health')).status).toBe(200)
    vi.restoreAllMocks()
  })

  it('環境変数が不正なら起動しない', () => {
    expect(() => buildContainer({})).toThrow(EnvError)
  })
})
