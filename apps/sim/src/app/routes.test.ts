import { describe, expect, it, vi } from 'vitest'
import { routes } from './routes'

// performance R5: 画面ごとの遅延読込と、A-2 を開いたときの運転の先読み

const { schedulePreloadDrive } = vi.hoisted(() => ({ schedulePreloadDrive: vi.fn() }))
vi.mock('./preload-drive', () => ({ schedulePreloadDrive }))

type Lazy = () => Promise<{ Component?: unknown }>

function lazyOf(path: string): Lazy {
  const route = routes.find((r) => r.path === path)
  expect(typeof route?.lazy).toBe('function')
  return route?.lazy as Lazy
}

describe('ルートの遅延読込（performance R5）', () => {
  it('UC-5a: 入口の A-1 を除いて、画面のルートは遅延読込（element を持たず lazy で Component を返す）', async () => {
    expect(routes.find((r) => r.path === '/plan')?.element).toBeDefined()
    const pages = routes.filter((r) => !['/', '*', '/plan'].includes(r.path ?? ''))
    expect(pages.map((r) => r.path)).toEqual([
      '/trip/:id/brief',
      '/loss/:id',
      '/t/:id',
      '/drive',
      '/trip/:id/day/:n/stops',
    ])
    for (const page of pages) {
      expect(page.element).toBeUndefined()
      const { Component } = await lazyOf(page.path ?? '')()
      expect(typeof Component).toBe('function')
    }
  })

  it('UC-5b: A-2（/trip/:id/brief）を読んだら運転の先読みを予約する。ほかの画面では予約しない', async () => {
    schedulePreloadDrive.mockClear()
    await lazyOf('/loss/:id')()
    await lazyOf('/t/:id')()
    expect(schedulePreloadDrive).not.toHaveBeenCalled()
    await lazyOf('/trip/:id/brief')()
    expect(schedulePreloadDrive).toHaveBeenCalledTimes(1)
  })
})
