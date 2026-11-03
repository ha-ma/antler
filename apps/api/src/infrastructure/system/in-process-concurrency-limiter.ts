import type { ConcurrencyLimiter } from '../../application/ports/system/concurrency-limiter.js'

// プロセス内の数え上げ（1 プロセス前提。複数インスタンスにするときは共有の置き場に差し替える）。

export class InProcessConcurrencyLimiter implements ConcurrencyLimiter {
  private active = 0

  constructor(private readonly max: number) {}

  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null
    this.active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
    }
  }

  get inUse(): number {
    return this.active
  }
}
