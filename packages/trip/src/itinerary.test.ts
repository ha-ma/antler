import { TripPlanSchema } from '@antler/schema'
import { describe, expect, it } from 'vitest'
import { PERSONA_INPUT, TripInputSchema, tripDayCount } from './input'
import { buildItinerary } from './itinerary'
import { buildTripPlan } from './plan'
import { pleasuresInArea } from './pleasures'
import { assessRisk } from './risk'
import { draftTitles } from './title'
import type { TripInput } from './types'

const with_ = (over: Partial<TripInput>): TripInput => ({ ...PERSONA_INPUT, ...over })

describe('UC-1 入力の検証（TripInputSchema）', () => {
  it('UC-1a: 運転できる人が人数より多い・返却が出発以前・11 日 → エラー。10 日は通る', () => {
    expect(TripInputSchema.safeParse(PERSONA_INPUT).success).toBe(true)
    const party = { ...PERSONA_INPUT.party, drivers: 5 }
    expect(TripInputSchema.safeParse(with_({ party })).success).toBe(false)
    const back = { at: '2027-02-14T09:00:00+09:00', place: 'CTS' as const }
    expect(TripInputSchema.safeParse(with_({ return: back })).success).toBe(false)
    const same = { at: PERSONA_INPUT.depart.at, place: 'CTS' as const }
    expect(TripInputSchema.safeParse(with_({ return: same })).success).toBe(false)
    const ten = { at: '2027-02-23T17:00:00+09:00', place: 'CTS' as const }
    expect(tripDayCount(with_({ return: ten }))).toBe(10)
    expect(TripInputSchema.safeParse(with_({ return: ten })).success).toBe(true)
    const eleven = { at: '2027-02-24T17:00:00+09:00', place: 'CTS' as const }
    expect(TripInputSchema.safeParse(with_({ return: eleven })).success).toBe(false)
  })

  it('UC-1b: 予算 0 は通り、1,000,001 はエラー', () => {
    expect(TripInputSchema.safeParse(with_({ budgetPerPersonJPY: 0 })).success).toBe(true)
    expect(TripInputSchema.safeParse(with_({ budgetPerPersonJPY: 1_000_001 })).success).toBe(false)
  })

  it('UC-1c: +08:00 の出発は JST に直して暦日を数える（23:30+08:00 → 翌日の 0:30 JST）', () => {
    const input = with_({
      depart: { at: '2027-02-14T23:30:00+08:00', place: 'CTS' },
      return: { at: '2027-02-18T17:00:00+09:00', place: 'CTS' },
    })
    // JST では 2/15 0:30 出発 → 2/15〜2/18 の 4 日
    expect(tripDayCount(input)).toBe(4)
    expect(buildItinerary(input).days).toHaveLength(4)
  })

  it('UC-1d（共有の検証）: 知らない欄を含む body は通らない', () => {
    const body = { ...PERSONA_INPUT, id: 'abcd1234', riskScore: 0.1 }
    expect(TripInputSchema.safeParse(body).success).toBe(false)
  })

  it('UC-2d（共有の検証）: エリアのマスターに無い id（道央の id・存在しない id）は通らない', () => {
    const doo = pleasuresInArea('doo')[0]
    if (!doo) throw new Error('道央のマスターが空')
    expect(
      TripInputSchema.safeParse(with_({ pleasures: [{ id: doo.id, weight: 3 }] })).success,
    ).toBe(false)
    expect(
      TripInputSchema.safeParse(with_({ pleasures: [{ id: 'no-such-thing', weight: 3 }] })).success,
    ).toBe(false)
  })
})

describe('UC-3 しおりの組み立て（buildItinerary）', () => {
  it('UC-3a: ペルソナ → D1〜D5 の連番、流氷ウォーク（重さ 5）は 1 日を占め、TripPlan の形を通る', () => {
    const it3 = buildItinerary(PERSONA_INPUT)
    expect(it3.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5])
    expect(it3.skipped).toEqual([])
    const iceDay = it3.days.find((d) => d.stops.includes('drift-ice-walk'))
    expect(iceDay?.stops).toEqual(['drift-ice-walk'])
    expect(it3.days[0]?.from).toBe('cts')
    expect(it3.days[4]?.to).toBe('cts')
    expect(it3.days[4]?.stay).toBeNull()
    const risk = assessRisk(PERSONA_INPUT, it3)
    const plan = buildTripPlan(PERSONA_INPUT, it3, risk, {
      id: 'K7m2abcd',
      seed: 918273,
      title: 't',
    })
    expect(TripPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('UC-3b: 楽しみ 0 件 → 移動だけの days と決まった形のタイトル', () => {
    const input = with_({ pleasures: [] })
    const it3 = buildItinerary(input)
    expect(it3.days).toHaveLength(5)
    expect(it3.days.every((d) => d.stops.length === 0)).toBe(true)
    expect(draftTitles(input, it3).ja).toBe('道東 5 日間のドライブ')
  })

  it('UC-3c: 入りきらない → 重さの小さいものから外れ、skipped に入る', () => {
    const all = pleasuresInArea('doto').slice(0, 10)
    const weights = [5, 5, 5, 5, 5, 5, 5, 5, 5, 1]
    const input = with_({
      return: { at: '2027-02-16T17:00:00+09:00', place: 'CTS' },
      pleasures: all.map((p, i) => ({ id: p.id, weight: weights[i] ?? 1 })),
    })
    const it3 = buildItinerary(input)
    expect(it3.skipped.length).toBeGreaterThan(0)
    // 重さ 1 のものが最初に外れる
    expect(it3.skipped[0]).toBe(all[9]?.id)
    const placed = it3.days.flatMap((d) => d.stops)
    expect([...placed, ...it3.skipped].sort()).toEqual(all.map((p) => p.id).sort())
  })

  it('UC-3d: 函館空港発で道東 → D1 は移動だけ。出発地と返却地が違ってもよい', () => {
    const input = with_({
      depart: { at: '2027-02-14T10:00:00+09:00', place: 'HKD' },
      return: { at: '2027-02-18T17:00:00+09:00', place: 'KUH' },
    })
    const it3 = buildItinerary(input)
    expect(it3.days[0]?.from).toBe('hkd')
    expect(it3.days[0]?.stops).toEqual([])
    expect(it3.days[4]?.to).toBe('kuh')
  })

  it('UC-3e: 1 日の旅 → days は 1 件で、D1 が往路と復路を兼ねる', () => {
    const input = with_({
      depart: { at: '2027-02-14T08:00:00+09:00', place: 'KUH' },
      return: { at: '2027-02-14T20:00:00+09:00', place: 'KUH' },
      pleasures: [{ id: 'red-crowned-crane', weight: 2 }],
    })
    const it3 = buildItinerary(input)
    expect(it3.days).toHaveLength(1)
    expect(it3.days[0]).toMatchObject({ day: 1, from: 'kuh', to: 'kuh', stay: null })
  })

  it('UC-3f: 同じ入力 → 同じ days（決定的）', () => {
    expect(buildItinerary(PERSONA_INPUT)).toEqual(buildItinerary(structuredClone(PERSONA_INPUT)))
  })
})
