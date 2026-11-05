import { STATS } from '@antler/trip'
import baseline from '../data/loss-baseline.json'
import type { LossBaseline } from '../types'
import { assessLoss } from './assess-loss'
import { FIVE_DAYS, type PlanPart } from './fixtures'

// UC-3（R3）: 喪失 4 指標。統計の値は STATS、単価は loss-baseline.json から読む（テストも数字を写さない）。

const unit: LossBaseline = {
  verified: false,
  note: 'test',
  lodgingPerPersonNightJPY: 12_345,
  experiencePerPersonJPY: 6_789,
}

describe('assessLoss', () => {
  const d2 = { day: 2, achievedStops: ['red-crowned-crane'] }

  it('UC-3a: 失った日数は N − day + 1、達成 n / N と重さの合計', () => {
    const r = assessLoss(FIVE_DAYS, d2, unit)
    expect(r.days).toEqual({ lost: 4, fromDay: 2, toDay: 5 })
    expect(r.pleasures).toEqual({ achieved: 1, total: 3, achievedWeight: 4, totalWeight: 11 })
  })

  it('UC-3a: しおりに入らなかった楽しみ（skipped）は N に入れない', () => {
    // pleasures には選んだが days には入らなかった楽しみ
    const plan: PlanPart = {
      ...FIVE_DAYS,
      pleasures: [...FIVE_DAYS.pleasures, { id: 'skipped-one', weight: 3 }],
    }
    expect(assessLoss(plan, d2, unit).pleasures).toEqual({
      achieved: 1,
      total: 3,
      achievedWeight: 4,
      totalWeight: 11,
    })
  })

  it('UC-3a: 前の日の楽しみは達成に数える', () => {
    const r = assessLoss(FIVE_DAYS, { day: 4, achievedStops: [] }, unit)
    expect(r.pleasures).toEqual({ achieved: 3, total: 3, achievedWeight: 11, totalWeight: 11 })
    expect(r.cancel.lostPleasures).toBe(0)
  })

  it('UC-3b: キャンセルは (泊数 × 宿単価 ＋ 楽しみ数 × 体験単価) × 人数 を千円単位で切り捨て', () => {
    const r = assessLoss(FIVE_DAYS, d2, unit)
    // 宿は D2〜D4 の 3 泊、失った楽しみは温泉と流氷の 2 件、4 人
    expect(r.cancel).toMatchObject({ nights: 3, lostPleasures: 2, people: 4, approximate: true })
    const exact = (3 * unit.lodgingPerPersonNightJPY + 2 * unit.experiencePerPersonJPY) * 4
    expect(r.cancel.jpy).toBe(Math.floor(exact / 1000) * 1000)
    expect(r.cancel.jpy % 1000).toBe(0)
    expect(r.cancel.jpy).toBeLessThan(exact)
  })

  it('UC-3b: 単価は loss-baseline.json（verified:false なので概算）', () => {
    const b: LossBaseline = baseline
    const r = assessLoss(FIVE_DAYS, d2, b)
    const exact = (3 * b.lodgingPerPersonNightJPY + 2 * b.experiencePerPersonJPY) * 4
    expect(r.cancel.jpy).toBe(Math.floor(exact / 1000) * 1000)
    expect(r.cancel.approximate).toBe(!b.verified)
  })

  it('UC-3c: 車両の損害は STATS の平均と最大、免責・NOC はプレースホルダ', () => {
    const r = assessLoss(FIVE_DAYS, d2, unit)
    expect(r.vehicle).toEqual({
      averageJPY: STATS.vehicleInsurance.averageJPY,
      maxJPY: STATS.vehicleInsurance.maxJPY,
      deductiblePlaceholder: STATS.deductible.placeholder,
    })
  })

  it('UC-3d: 最終日に衝突 → 失った日数 1、宿 0 泊', () => {
    const r = assessLoss(FIVE_DAYS, { day: 5, achievedStops: [] }, unit)
    expect(r.days).toEqual({ lost: 1, fromDay: 5, toDay: 5 })
    expect(r.cancel).toMatchObject({ nights: 0, lostPleasures: 0, jpy: 0 })
  })

  it('10 日・10 件の計算は 50 ms 以内（resilience.md の性能）', () => {
    const plan: PlanPart = {
      party: { size: 8, drivers: 2, experience: 'few' },
      pleasures: Array.from({ length: 10 }, (_, i) => ({ id: `p${String(i)}`, weight: 3 })),
      days: Array.from({ length: 10 }, (_, i) => ({
        day: i + 1,
        from: 'a',
        to: 'b',
        stops: [`p${String(i)}`],
        stay: i < 9 ? 'b' : null,
      })),
    }
    const start = performance.now()
    for (let i = 0; i < 100; i++) assessLoss(plan, { day: 3, achievedStops: ['p2'] }, unit)
    expect((performance.now() - start) / 100).toBeLessThan(50)
  })
})
