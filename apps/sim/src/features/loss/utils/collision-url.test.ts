import { personaDay, personaTrip, TRIP_ID } from '@/test/trip-day'
import type { CollisionReport } from '../types'
import { checkAgainstDay, lossHref, parseCollision } from './collision-url'

// UC-1（R1）: 入口の URL と、しおりを読んだあとの検証（R7 と同じ規則）。

const report: CollisionReport = {
  tripId: TRIP_ID,
  day: 2,
  leg: 0,
  at: '2027-02-15T16:31:00+09:00',
  speedKmh: 54,
  light: 'dusk',
  side: 'L',
  alertEnabled: false,
  achievedStops: ['red-crowned-crane'],
  simMs: 812345,
}

function roundTrip(href: string): CollisionReport | null {
  const url = new URL(href, 'http://localhost')
  const id = decodeURIComponent(url.pathname.replace(/^\/loss\//, ''))
  return parseCollision(id, url.searchParams)
}

describe('lossHref / parseCollision', () => {
  it('UC-1a: drive が実数の速さ・経過を渡しても、丸めて範囲に収めた URL は読める', () => {
    const href = lossHref({ ...report, speedKmh: 54.6, simMs: 812345.7 })
    expect(roundTrip(href)).toEqual({ ...report, speedKmh: 55, simMs: 812346 })
    const fast = roundTrip(lossHref({ ...report, speedKmh: 250.2, simMs: -3 }))
    expect(fast).toMatchObject({ speedKmh: 199, simMs: 0 })
  })

  it('UC-1a: lossHref の URL を parseCollision で読むと同じ CollisionReport に戻る', () => {
    const href = lossHref(report)
    expect(href).toBe(
      `/loss/${TRIP_ID}?day=2&leg=0&at=2027-02-15T16%3A31%3A00%2B09%3A00&speed=54&light=dusk&side=L&stops=red-crowned-crane&t=812345&alert=off`,
    )
    expect(roundTrip(href)).toEqual(report)
  })

  it('UC-1a: alert ON は alert のクエリ無し、stops は空でもよい', () => {
    const on = { ...report, alertEnabled: true, achievedStops: [] }
    const href = lossHref(on)
    expect(href).not.toContain('alert=')
    expect(roundTrip(href)).toEqual(on)
    // stops の欄が無くても空とみなす
    const q = new URL(href, 'http://localhost').searchParams
    q.delete('stops')
    expect(parseCollision(TRIP_ID, q)).toEqual(on)
  })

  it('UC-1a: 2 件の stops はカンマで並ぶ', () => {
    const two = { ...report, achievedStops: ['a-b', 'c'] }
    expect(lossHref(two)).toContain('stops=a-b%2Cc')
    expect(roundTrip(lossHref(two))).toEqual(two)
  })

  const base = () => new URL(lossHref(report), 'http://localhost').searchParams
  const broken: [string, (q: URLSearchParams) => void][] = [
    ['speed が 250', (q) => q.set('speed', '250')],
    ['speed が小数', (q) => q.set('speed', '54.5')],
    ['day が 0', (q) => q.set('day', '0')],
    ['day が欠け', (q) => q.delete('day')],
    ['leg が負', (q) => q.set('leg', '-1')],
    ['light が知らない値', (q) => q.set('light', 'noon')],
    ['side が知らない値', (q) => q.set('side', 'C')],
    ['at がタイムゾーン無し', (q) => q.set('at', '2027-02-15T16:31:00')],
    ['at が欠け', (q) => q.delete('at')],
    ['t が 86,400,001', (q) => q.set('t', '86400001')],
    ['t が欠け', (q) => q.delete('t')],
    ['alert が off 以外', (q) => q.set('alert', 'on')],
    [
      'stops が 11 件',
      (q) => q.set('stops', Array.from({ length: 11 }, (_, i) => `s${String(i)}`).join(',')),
    ],
    ['stops に重複', (q) => q.set('stops', 'a,a')],
    ['stops の形が違う', (q) => q.set('stops', 'Red Crane')],
    ['stops に空の要素', (q) => q.set('stops', 'a,,b')],
  ]
  it.each(broken)('UC-1b: %s → 読めない（null）', (_, edit) => {
    const q = base()
    edit(q)
    expect(parseCollision(TRIP_ID, q)).toBeNull()
  })

  it('UC-1b: id の形が違う → 読めない', () => {
    expect(parseCollision('ab', base())).toBeNull()
    expect(parseCollision('abc-defg', base())).toBeNull()
  })

  it('UC-1a: 速さ 0 と 199、t 0 と 86,400,000 は読める', () => {
    const q = base()
    q.set('speed', '0')
    q.set('t', '0')
    expect(parseCollision(TRIP_ID, q)?.speedKmh).toBe(0)
    q.set('speed', '199')
    q.set('t', '86400000')
    expect(parseCollision(TRIP_ID, q)?.simMs).toBe(86_400_000)
  })
})

describe('checkAgainstDay（R1 の最後・R7 と同じ規則）', () => {
  const { plan } = personaTrip()
  const day2 = personaDay(2, plan)

  it('UC-1a: ペルソナの D2・1 本目の移動・タンチョウ達成は通る', () => {
    expect(checkAgainstDay(plan, day2, report)).toBe(true)
  })

  it('UC-1b: day が旅の日数を超える・日が違う → 通らない', () => {
    expect(checkAgainstDay(plan, day2, { ...report, day: 6 })).toBe(false)
    expect(checkAgainstDay(plan, day2, { ...report, day: 3 })).toBe(false)
  })

  it('UC-1b: leg がその日の移動の数以上 → 通らない（移動の無い日は衝突できない）', () => {
    expect(checkAgainstDay(plan, day2, { ...report, leg: 1 })).toBe(false)
    const day3 = personaDay(3, plan)
    expect(checkAgainstDay(plan, day3, { ...report, day: 3, leg: 0, achievedStops: [] })).toBe(
      false,
    )
  })

  it('UC-1b: at の JST の暦日が別の日 → 通らない（UTC で同じ日でも JST で見る）', () => {
    expect(checkAgainstDay(plan, day2, { ...report, at: '2027-02-16T00:10:00+09:00' })).toBe(false)
    // UTC では 2/14 だが JST では 2/15
    expect(checkAgainstDay(plan, day2, { ...report, at: '2027-02-14T15:30:00Z' })).toBe(true)
  })

  it('UC-1b: その日に無い楽しみ・衝突した移動より先の町の楽しみ → 通らない', () => {
    expect(checkAgainstDay(plan, day2, { ...report, achievedStops: ['drift-ice-walk'] })).toBe(
      false,
    )
    const ahead = {
      ...day2,
      stops: [...day2.stops, { id: 'shiretoko-cruise', base: 'shiretoko' }],
    }
    expect(
      checkAgainstDay(plan, ahead, {
        ...report,
        achievedStops: ['red-crowned-crane', 'shiretoko-cruise'],
      }),
    ).toBe(false)
  })
})
