import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserServices, DEFAULT_TIMEOUTS } from './services'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ブラウザの実物（services）', () => {
  it('URL-1a: VITE_API_BASE_URL が無ければ apiBaseUrl は undefined。edge は 8767', () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const svc = createBrowserServices()
    expect(svc.apiBaseUrl).toBeUndefined()
    expect(svc.edgeBaseUrl).toBe('http://ezoroad.local:8767')
  })

  it('URL-1a: VITE_API_BASE_URL を読む', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8804')
    expect(createBrowserServices().apiBaseUrl).toBe('http://localhost:8804')
  })

  it('FAIL-9: 打ち切りは一覧 3 秒・edge 5 秒・api 20 秒', () => {
    expect(DEFAULT_TIMEOUTS).toEqual({ listMs: 3000, edgeMs: 5000, apiMs: 20000 })
    expect(createBrowserServices().timeouts).toEqual(DEFAULT_TIMEOUTS)
  })

  it('UP-1f: fetch は呼ぶたびに globalThis.fetch を引く。sleep は指定の時間だけ待つ', async () => {
    const fake = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fake)
    const svc = createBrowserServices()
    await svc.fetch('http://x', { method: 'POST' })
    expect(fake).toHaveBeenCalledWith('http://x', { method: 'POST' })

    vi.useFakeTimers()
    let done = false
    const waiting = svc.sleep(1000).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(done).toBe(true)
  })
})
