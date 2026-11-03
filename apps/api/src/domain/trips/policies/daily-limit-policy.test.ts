import { DailyLimitError } from '../errors/trip-errors.js'
import { ensureWithinDailyLimit, jstDayStartMs } from './daily-limit-policy.js'

describe('DailyLimitPolicy（R9）', () => {
  it('日の始まりは日本時間の 0 時', () => {
    // 2027-02-14T23:30+09:00 → 2027-02-14T00:00+09:00
    expect(jstDayStartMs(Date.parse('2027-02-14T23:30:00+09:00'))).toBe(
      Date.parse('2027-02-14T00:00:00+09:00'),
    )
    // UTC では前日でも、日本時間では 2/15
    expect(jstDayStartMs(Date.parse('2027-02-14T15:30:00Z'))).toBe(
      Date.parse('2027-02-15T00:00:00+09:00'),
    )
  })

  it('AUTH-2: 当日の件数が上限に達していれば DailyLimitError', () => {
    expect(() => {
      ensureWithinDailyLimit(199, 200)
    }).not.toThrow()
    expect(() => {
      ensureWithinDailyLimit(200, 200)
    }).toThrow(DailyLimitError)
  })
})
