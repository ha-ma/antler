import { describe, expect, it } from 'vitest'
import { clockOf, timeLabel } from './format'

// 時刻の表示（R2「翌」、R3 分に切り捨て。UC-6e）

describe('時刻の表示', () => {
  it('ISO の時刻を HH:mm（JST）にする', () => {
    expect(clockOf('2027-02-15T16:38+09:00')).toBe('16:38')
    expect(clockOf('2027-02-15T07:38:59.000Z')).toBe('16:38')
  })

  it('UC-6e: その日の日付と違えば「翌」を付ける', () => {
    expect(timeLabel('2027-02-15T16:38+09:00', '2027-02-15', 'ja')).toBe('16:38')
    expect(timeLabel('2027-02-16T00:30+09:00', '2027-02-15', 'ja')).toBe('翌 0:30')
    expect(timeLabel('2027-02-16T00:30+09:00', '2027-02-15', 'en')).toBe('0:30 (+1 day)')
  })
})
