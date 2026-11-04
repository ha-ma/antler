import type { TripPlan } from '@antler/schema'
import { STATS } from '@antler/trip'
import type { CollisionReport, LossBaseline } from '../types'

// 喪失 4 指標（functional.md R3、A6-2）。端末の純粋関数で決定的に計算する。
// 統計の値は STATS（stats.json）、単価は data/loss-baseline.json から読む。コードに数字を埋めない。

export type LossAssessment = {
  /** 車両の損害: 保険金支払 1 件の平均と最大。免責・NOC は出典が無いあいだプレースホルダ */
  vehicle: { averageJPY: number; maxJPY: number; deductiblePlaceholder: boolean }
  /** キャンセル・払い戻しなし（概算）。千円単位で切り捨て */
  cancel: {
    jpy: number
    nights: number
    lostPleasures: number
    people: number
    approximate: boolean
  }
  /** 失った日数（衝突した日から最終日まで） */
  days: { lost: number; fromDay: number; toDay: number }
  /** 楽しみの達成（しおりに入った楽しみだけ。skipped は数えない） */
  pleasures: { achieved: number; total: number; achievedWeight: number; totalWeight: number }
}

export function assessLoss(
  plan: Pick<TripPlan, 'days' | 'pleasures' | 'party'>,
  collision: Pick<CollisionReport, 'day' | 'achievedStops'>,
  baseline: LossBaseline,
): LossAssessment {
  const weightOf = new Map(plan.pleasures.map((p) => [p.id, p.weight]))
  const achievedOnDay = new Set(collision.achievedStops)
  let achieved = 0
  let total = 0
  let achievedWeight = 0
  let totalWeight = 0
  for (const d of plan.days) {
    for (const id of d.stops) {
      const w = weightOf.get(id) ?? 0
      total += 1
      totalWeight += w
      if (d.day < collision.day || (d.day === collision.day && achievedOnDay.has(id))) {
        achieved += 1
        achievedWeight += w
      }
    }
  }
  const lastDay = plan.days.length
  const nights = plan.days.filter((d) => d.day >= collision.day && d.stay !== null).length
  const lostPleasures = total - achieved
  const people = plan.party.size
  const exact =
    (nights * baseline.lodgingPerPersonNightJPY + lostPleasures * baseline.experiencePerPersonJPY) *
    people
  return {
    vehicle: {
      averageJPY: STATS.vehicleInsurance.averageJPY,
      maxJPY: STATS.vehicleInsurance.maxJPY,
      deductiblePlaceholder: STATS.deductible.placeholder,
    },
    cancel: {
      jpy: Math.floor(exact / 1000) * 1000,
      nights,
      lostPleasures,
      people,
      approximate: !baseline.verified,
    },
    days: { lost: lastDay - collision.day + 1, fromDay: collision.day, toDay: lastDay },
    pleasures: { achieved, total, achievedWeight, totalWeight },
  }
}
