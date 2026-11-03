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

  it('AUTH-2: 当日の呼び出しの通し番号が上限を超えたら DailyLimitError（上限ちょうどは呼べる）', () => {
    expect(() => {
      ensureWithinDailyLimit(400, 400)
    }).not.toThrow()
    expect(() => {
      ensureWithinDailyLimit(401, 400)
    }).toThrow(DailyLimitError)
  })
})
