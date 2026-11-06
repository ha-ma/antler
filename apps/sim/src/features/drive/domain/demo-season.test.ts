import { dayConditions } from '@antler/trip'
import { describe, expect, it } from 'vitest'
import { ZONES } from './zones-data'
import { DEMO_TRIP, demoScenario } from './scenario'
import { DEMO_DEFAULT, DEMO_SEASONS, demoSeason } from './demo-season'

// docs/specs/drive-season/functional.md R2（UC-2a・UC-2b）

const conditionsOf = (month: number, weather?: Parameters<typeof dayConditions>[0]['weather']) =>
  dayConditions({
    seed: DEMO_TRIP.seed,
    day: 2,
    month,
    departMonth: month,
    party: DEMO_TRIP.party,
    weather,
  })

describe('見本の場面の季節（drive-season R2）', () => {
  it('UC-2a: 何も無い・読めない値は既定（2 月 15 日 16:40・圧雪・曇り・light）', () => {
    const fixed = {
      startAt: '2027-02-15T16:40+09:00',
      surface: 'packed-snow',
      weather: 'cloudy',
      windowFog: 'light',
    }
    expect(DEMO_DEFAULT).toEqual(fixed)
    for (const search of [
      '',
      '?month=13',
      '?month=0',
      '?month=7.5',
      '?month=abc',
      '?month=07x',
      '?weather=hail',
      '?alert=off',
    ])
      expect(demoSeason(search, DEMO_TRIP), search).toEqual(fixed)
    const s = demoScenario(ZONES, '?month=13')
    expect({ startAt: s.startAt, surface: s.surface, weather: s.weather }).toEqual({
      startAt: fixed.startAt,
      surface: fixed.surface,
      weather: fixed.weather,
    })
  })

  it('UC-2b: ?month=7 は 7 月 15 日 16:40 で、条件は dayConditions（見本の種・2 日目・7 月）。legPace も同じ時刻', () => {
    const c = conditionsOf(7)
    const s = demoScenario(ZONES, '?month=7')
    expect(s.startAt).toBe('2027-07-15T16:40+09:00')
    expect({ surface: s.surface, weather: s.weather, windowFog: s.windowFog }).toEqual({
      surface: c.surface,
      weather: c.weather,
      windowFog: c.windowFog,
    })
    expect(s.legPace[0]?.departAt).toBe('2027-07-15T16:40+09:00')
    expect(demoSeason('?month=12', DEMO_TRIP).startAt).toBe('2027-12-15T16:40+09:00')
  })

  it('UC-2b: ?month=7&weather=rain は雨・濡れ。?weather=rain だけなら 2 月の表（雨は無いので無視）', () => {
    expect(demoSeason('?month=7&weather=rain&alert=off', DEMO_TRIP)).toMatchObject({
      weather: 'rain',
      surface: 'wet',
    })
    const feb = conditionsOf(2)
    expect(demoSeason('?weather=rain', DEMO_TRIP)).toEqual({
      startAt: '2027-02-15T16:40+09:00',
      surface: feb.surface,
      weather: feb.weather,
      windowFog: feb.windowFog,
    })
    expect(demoSeason('?weather=snow', DEMO_TRIP).weather).toBe('snow')
  })

  it.each([
    ['default', '', 'cloudy', 'packed-snow', '2027-02-15T16:40+09:00'],
    ['winter', '?month=2&weather=snow', 'snow', 'packed-snow', '2027-02-15T16:40+09:00'],
    ['frozen', '?month=2&weather=clear', 'clear', 'ice', '2027-02-15T16:40+09:00'],
    ['thaw', '?month=4&weather=rain', 'rain', 'wet', '2027-04-15T16:40+09:00'],
    ['summer', '?month=7&weather=clear', 'clear', 'dry', '2027-07-15T16:40+09:00'],
    ['autumn', '?month=10&weather=rain', 'rain', 'wet', '2027-10-15T16:40+09:00'],
  ] as const)(
    'UC-2d: 切り替え %s（%s）は %s・%s、%s に出発',
    (id, search, weather, surface, startAt) => {
      const season = DEMO_SEASONS.find((s) => s.id === id)
      const q = new URLSearchParams(search)
      expect(season?.month ?? null).toBe(q.has('month') ? Number(q.get('month')) : null)
      expect(season?.weather ?? null).toBe(q.get('weather'))
      expect(demoSeason(search, DEMO_TRIP)).toMatchObject({ weather, surface, startAt })
    },
  )

  it('UC-2d: 切り替えは 6 つ。?month=2 だけ（天候の指定なし）は晴れ・凍結（既定とは違う）', () => {
    expect(DEMO_SEASONS.map((s) => s.id)).toEqual([
      'default',
      'winter',
      'frozen',
      'thaw',
      'summer',
      'autumn',
    ])
    expect(demoSeason('?month=2', DEMO_TRIP)).toMatchObject({ weather: 'clear', surface: 'ice' })
  })
})
