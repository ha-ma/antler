import type { Clock } from '../../application/ports/system/clock.js'

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now()
  }
}
