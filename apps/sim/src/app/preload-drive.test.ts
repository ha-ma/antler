import { afterEach, describe, expect, it, vi } from 'vitest'

// performance R5: A-2 の間に運転のチャンクを先読みする

const preloadDriveScene = vi.fn(() => Promise.resolve())
vi.mock('@/features/drive', () => ({ preloadDriveScene }))
vi.mock('./DriveRoute', () => ({ DriveRoute: () => null }))

afterEach(() => {
  vi.resetModules()
  preloadDriveScene.mockClear()
})

describe('運転のチャンクの先読み（performance R5）', () => {
  it('UC-5c: preloadDrive は 3D のチャンクを読み、2 回目は同じ Promise（読み直さない）', async () => {
    const { preloadDrive } = await import('./preload-drive')
    const first = preloadDrive()
    expect(preloadDrive()).toBe(first)
    await first
    expect(preloadDriveScene).toHaveBeenCalledTimes(1)
  })

  it('UC-5d: requestIdleCallback があれば空いたとき（最長 2 秒）、無ければ 1 秒後に始める', async () => {
    const { schedulePreloadDrive, PRELOAD_IDLE_TIMEOUT_MS } = await import('./preload-drive')
    const requestIdleCallback = vi.fn()
    const setTimeout = vi.fn()
    schedulePreloadDrive({ requestIdleCallback, setTimeout } as never)
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: PRELOAD_IDLE_TIMEOUT_MS,
    })
    expect(PRELOAD_IDLE_TIMEOUT_MS).toBe(2000)
    expect(setTimeout).not.toHaveBeenCalled()

    const fallback = vi.fn()
    schedulePreloadDrive({ setTimeout: fallback } as never)
    expect(fallback).toHaveBeenCalledWith(expect.any(Function), 1000)
    expect(preloadDriveScene).not.toHaveBeenCalled()
    // 呼ばれた関数が先読みを始める
    const run = fallback.mock.calls[0]?.[0] as () => void
    run()
    await vi.waitFor(() => expect(preloadDriveScene).toHaveBeenCalledTimes(1))
  })

  it('UC-5e: データ節約（Save-Data）の端末では予約しない', async () => {
    const { schedulePreloadDrive } = await import('./preload-drive')
    const requestIdleCallback = vi.fn()
    const setTimeout = vi.fn()
    const navigator = { connection: { saveData: true } }
    schedulePreloadDrive({ requestIdleCallback, setTimeout, navigator } as never)
    expect(requestIdleCallback).not.toHaveBeenCalled()
    expect(setTimeout).not.toHaveBeenCalled()
  })
})
