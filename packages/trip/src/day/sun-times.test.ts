import { lightPeriod } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { sunTimes } from './sun-times'

// docs/specs/brief-map/functional.md R3（UC-3c）

const kushiro = { lat: 42.9849, lon: 144.3814 }

describe('sunTimes（日没と薄暮）', () => {
  it('UC-3c: 2 月 15 日の釧路の日没は 16 時台、薄暮の始まり < 日没 < 薄暮の終わり', () => {
    const t = sunTimes('2027-02-15', kushiro)
    expect(t.sunsetAt).toMatch(/^2027-02-15T16:\d\d\+09:00$/)
    const ms = (iso: string | null) => Date.parse(iso ?? '')
    expect(ms(t.duskStartAt)).toBeLessThan(ms(t.sunsetAt))
    expect(ms(t.sunsetAt)).toBeLessThan(ms(t.duskEndAt))
  })

  it('UC-3c: 薄暮の始まりと終わりは lightPeriod の dusk の境目（1 分の刻みで）', () => {
    const t = sunTimes('2027-02-15', kushiro)
    const before = (iso: string | null) => Date.parse(iso ?? '') - 60_000
    expect(lightPeriod(t.duskStartAt ?? '', kushiro)).toBe('dusk')
    expect(lightPeriod(before(t.duskStartAt), kushiro)).toBe('day')
    expect(lightPeriod(t.duskEndAt ?? '', kushiro)).toBe('night')
    expect(lightPeriod(before(t.duskEndAt), kushiro)).toBe('dusk')
  })

  it('UC-3c: 夏至の日没は冬より遅い（19 時台）', () => {
    expect(sunTimes('2027-06-21', kushiro).sunsetAt).toMatch(/T(18|19):\d\d\+09:00$/)
  })
})
