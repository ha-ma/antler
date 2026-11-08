import { act } from '@testing-library/react'

// 数え上げ（docs/specs/result-countup/functional.md）のテスト用の環境。
// jsdom には IntersectionObserver が無い（数え上げない＝最初から最後の値）。数え上げを確かめるテストだけ、
// IntersectionObserver・requestAnimationFrame・matchMedia を手で進められる偽物に差し替える。
// 後片付けは vi.unstubAllGlobals()。

type Observer = { callback: IntersectionObserverCallback; targets: Element[]; live: boolean }

export function stubCountUpEnv({ reducedMotion = false } = {}) {
  let now = 0
  let nextId = 1
  let frames = new Map<number, FrameRequestCallback>()
  const observers: Observer[] = []

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId
    nextId += 1
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly o: Observer
      constructor(callback: IntersectionObserverCallback) {
        this.o = { callback, targets: [], live: true }
        observers.push(this.o)
      }
      observe(el: Element) {
        this.o.targets.push(el)
      }
      unobserve() {}
      disconnect() {
        this.o.live = false
      }
      takeRecords() {
        return []
      }
    },
  )
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))

  /** 1 コマ進める（時刻を ms だけ進めてから、待っている rAF を呼ぶ） */
  function step(ms: number) {
    now += ms
    const pending = frames
    frames = new Map()
    act(() => {
      for (const cb of pending.values()) cb(now)
    })
  }

  return {
    /** 合計 ms を 16 ms ずつ進める */
    advance(ms: number) {
      let left = ms
      while (left > 0) {
        const d = Math.min(16, left)
        step(d)
        left -= d
      }
    },
    /** 要素（無ければ見張っている全部）が画面に入ったことにする */
    intersect(el?: Element) {
      act(() => {
        for (const o of observers) {
          if (!o.live) continue
          const hit = o.targets.filter((t) => !el || t === el || t.contains(el) || el.contains(t))
          if (hit.length === 0) continue
          o.callback(
            hit.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
            o as unknown as IntersectionObserver,
          )
        }
      })
    },
    /** 見張っている要素の数（終わったら 0） */
    watching() {
      return observers.filter((o) => o.live).length
    },
  }
}
