import { TripPlanSchema } from '@antler/schema'
import { describe, expect, it } from 'vitest'
import { PERSONA_INPUT, TripInputSchema } from './input'
import { AREA_CIRCUIT } from './places'
import { buildItinerary } from './itinerary'
import { buildTripPlan, weightForHours } from './plan'
import { PLEASURES, pleasureById, pleasuresInArea } from './pleasures'
import { assessRisk } from './risk'
import { draftTitles } from './title'
import type { TripInput } from './types'

// plan-trip-photos（docs/specs/plan-trip-photos/functional.md）: 重さを外し、標準の所要時間で組み立てる。

const with_ = (over: Partial<TripInput>): TripInput => ({ ...PERSONA_INPUT, ...over })
const hoursOf = (id: string) => pleasureById(id)?.hours ?? Number.NaN

describe('plan-trip-photos: 標準の所要時間（R1〜R3）', () => {
  it('DUR-1: マスターの 24 件すべてに hours（0.5〜8、0.5 刻み）がある', () => {
    expect(PLEASURES).toHaveLength(24)
    for (const p of PLEASURES) {
      expect(p.hours, p.id).toBeGreaterThanOrEqual(0.5)
      expect(p.hours, p.id).toBeLessThanOrEqual(8)
      expect(Number.isInteger(p.hours * 2), p.id).toBe(true)
    }
  })

  it('DUR-2: ペルソナ → D1〜D5 に流氷ウォーク・タンチョウ・アイヌコタンが入り、入力の weight は days に影響しない', () => {
    const base = buildItinerary(PERSONA_INPUT)
    expect(base.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5])
    expect(base.skipped).toEqual([])
    const placed = base.days.flatMap((d) => d.stops)
    expect(placed.sort()).toEqual(['akan-ainu-kotan', 'drift-ice-walk', 'red-crowned-crane'])
    // D1 は空港に留まらず、最初の拠点へ移動する（移動だけなら 18:00 までに着けるため）
    expect(base.days[0]?.to).not.toBe('cts')
    // ペルソナのリスクは「高い」のまま（デザインの A1_Plan、plan-trip UC-4a）
    expect(assessRisk(PERSONA_INPUT, base).level).toBe('high')
    const heavy = with_({ pleasures: PERSONA_INPUT.pleasures.map((p) => ({ ...p, weight: 5 })) })
    const light = with_({ pleasures: PERSONA_INPUT.pleasures.map((p) => ({ ...p, weight: 1 })) })
    expect(buildItinerary(heavy).days).toEqual(base.days)
    expect(buildItinerary(light).days).toEqual(base.days)
  })

  it('DUR-3: 入りきらない → 所要の短いものから外れ（同じなら周回順で後ろ）、skipped に入る', () => {
    const all = pleasuresInArea('doto').slice(0, 10)
    const input = with_({
      return: { at: '2027-02-16T17:00:00+09:00', place: 'CTS' },
      pleasures: all.map((p) => ({ id: p.id })),
    })
    const it3 = buildItinerary(input)
    expect(it3.skipped.length).toBeGreaterThan(0)
    const placed = it3.days.flatMap((d) => d.stops)
    expect([...placed, ...it3.skipped].sort()).toEqual(all.map((p) => p.id).sort())
    // 最初に外れるのは所要が最も短いもの（同じ所要なら周回順で後ろ）
    const circuit = AREA_CIRCUIT.doto
    const shortest = Math.min(...all.map((p) => p.hours))
    const firstOut = all
      .filter((p) => p.hours === shortest)
      .sort((a, b) => circuit.indexOf(b.base) - circuit.indexOf(a.base))
    const firstSkipped = it3.skipped[0] ?? ''
    expect(hoursOf(firstSkipped)).toBe(shortest)
    expect(firstOut.map((p) => p.id)).toContain(firstSkipped)
    // 短いものから外すので、外れたものの所要は、残ったものの最短以下
    expect(placed.length).toBeGreaterThan(0)
    for (const id of it3.skipped) {
      expect(hoursOf(id)).toBeLessThanOrEqual(Math.min(...placed.map(hoursOf)))
    }
  })

  it('DUR-4: 保存の weight は weightForHours で換算し、入力の weight を使わない', () => {
    // 1.6 時間の枠に切り上げ（所要より短く割り当てない）
    expect(weightForHours(0.5)).toBe(1)
    expect(weightForHours(1)).toBe(1)
    expect(weightForHours(1.6)).toBe(1)
    expect(weightForHours(2)).toBe(2)
    expect(weightForHours(3)).toBe(2)
    expect(weightForHours(4)).toBe(3)
    expect(weightForHours(8)).toBe(5)
    const input = with_({
      pleasures: [
        { id: 'drift-ice-walk', weight: 5 },
        { id: 'washo-market-donburi', weight: 5 },
        { id: 'kushiro-marsh' },
      ],
    })
    const itinerary = buildItinerary(input)
    const plan = buildTripPlan(input, itinerary, assessRisk(input, itinerary), {
      id: 'K7m2abcd',
      seed: 1,
      title: 't',
    })
    expect(plan.pleasures).toEqual([
      { id: 'drift-ice-walk', weight: weightForHours(hoursOf('drift-ice-walk')) },
      { id: 'washo-market-donburi', weight: weightForHours(hoursOf('washo-market-donburi')) },
      { id: 'kushiro-marsh', weight: weightForHours(hoursOf('kushiro-marsh')) },
    ])
    expect(TripPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('DUR-5（共有の検証）: weight の無い pleasures を受け、weight 付き（1〜5）も受ける。0・6 は通らない', () => {
    expect(
      TripInputSchema.safeParse(with_({ pleasures: [{ id: 'drift-ice-walk' }] })).success,
    ).toBe(true)
    for (const weight of [1, 5]) {
      const input = with_({ pleasures: [{ id: 'drift-ice-walk', weight }] })
      expect(TripInputSchema.safeParse(input).success).toBe(true)
    }
    for (const weight of [0, 6]) {
      const input = with_({ pleasures: [{ id: 'drift-ice-walk', weight }] })
      expect(TripInputSchema.safeParse(input).success).toBe(false)
    }
  })

  it('DUR-6: 入力中のタイトルの上位 2 件は所要の長い順', () => {
    const input = with_({
      pleasures: [{ id: 'washo-market-donburi' }, { id: 'kushiro-marsh' }, { id: 'mashu-iozan' }],
    })
    const titles = draftTitles(input, buildItinerary(input))
    const byHours = [...input.pleasures]
      .sort((a, b) => hoursOf(b.id) - hoursOf(a.id) || (a.id < b.id ? -1 : 1))
      .slice(0, 2)
      .map((p) => pleasureById(p.id)?.name.ja ?? '')
    expect(titles.ja).toBe(`道東 5 日間・${byHours.join('と')}`)
  })
})
