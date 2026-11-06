import { describe, expect, it } from 'vitest'
import { monthOf, precipitationOf, sceneLookOf, sceneSeasonOf } from './season'

// docs/specs/drive-season/functional.md R3（UC-3a）

describe('景色の季節（drive-season R3）', () => {
  it('UC-3a: 月 → 冬（12〜3）・雪どけ（4）・緑（5〜9）・紅葉（10）・初冬（11）', () => {
    const seasons = Array.from({ length: 12 }, (_, i) => sceneSeasonOf(i + 1, 'dry'))
    expect(seasons).toEqual([
      'winter',
      'winter',
      'winter',
      'thaw',
      'green',
      'green',
      'green',
      'green',
      'green',
      'autumn',
      'late-autumn',
      'winter',
    ])
  })

  it('UC-3a: 路面が圧雪なら月に関係なく冬。凍結・濡れは月のまま', () => {
    expect(sceneSeasonOf(4, 'packed-snow')).toBe('winter')
    expect(sceneSeasonOf(11, 'packed-snow')).toBe('winter')
    expect(sceneSeasonOf(11, 'ice')).toBe('late-autumn')
    expect(sceneSeasonOf(4, 'wet')).toBe('thaw')
  })

  it('UC-3a: monthOf は JST の月（+09:00 の 3/31 23:30 は 3 月、UTC で書いた時刻も JST に直す）', () => {
    expect(monthOf('2027-03-31T23:30+09:00')).toBe(3)
    expect(monthOf('2027-03-31T15:30Z')).toBe(4)
    expect(monthOf('2027-07-15T16:40+09:00')).toBe(7)
    expect(monthOf('2027-12-31T23:59+09:00')).toBe(12)
  })

  it('UC-3e: 降るもの: 雪の日は雪、雨の日は雨、ほかは無い', () => {
    expect(precipitationOf('snow')).toBe('snow')
    expect(precipitationOf('rain')).toBe('rain')
    for (const w of ['clear', 'cloudy', 'fog'] as const) expect(precipitationOf(w)).toBe('none')
  })

  it('UC-3a: sceneLookOf は場面の月・路面・天候から景色をまとめる', () => {
    expect(
      sceneLookOf({ startAt: '2027-07-15T16:40+09:00', surface: 'wet', weather: 'rain' }),
    ).toEqual({ season: 'green', surface: 'wet', weather: 'rain', precipitation: 'rain' })
    expect(
      sceneLookOf({ startAt: '2027-02-15T16:40+09:00', surface: 'packed-snow', weather: 'cloudy' }),
    ).toEqual({
      season: 'winter',
      surface: 'packed-snow',
      weather: 'cloudy',
      precipitation: 'none',
    })
  })
})
