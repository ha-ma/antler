import { describe, expect, it } from 'vitest'
import { receiveRate } from './link-stats'

describe('UC-5 受信/秒', () => {
  it('UC-5b: 直近 5 秒の数を 5 で割る。受信が無いと undefined', () => {
    expect(receiveRate([], 10_000)).toBeUndefined()
    expect(receiveRate([1000], 10_000)).toBeUndefined()
    expect(receiveRate([6000, 7000, 8000, 9000, 10_000], 10_000)).toBe(1)
    expect(receiveRate([5000, 9000], 10_000)).toBe(0.4)
  })
})
