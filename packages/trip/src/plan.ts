import type { TripPlan } from '@antler/schema'
import { pleasureById } from './pleasures'
import type { Itinerary, RiskAssessment, TripInput } from './types'

// 入力・しおり・リスクから TripPlan（ch7）を組み立てる。id・seed・title は api が決める（functional.md R5・R7）。

/**
 * しおりの活動の枠 1 つの時間（駐車・歩きを含む）。凍結済みの TripPlan は `pleasures[].weight`（1〜5）を
 * 必須で持つので、画面で重さを決めなくなった後は「標準の所要を枠に切り上げた数」を書く（plan-trip-photos R3）。
 * しおりの活動も同じ枠で割り当てるので、stop-events の滞在（weight × 96 分 = 枠 × 1.6 時間）と厳密に一致する。
 */
export const HOURS_PER_WEIGHT = 1.6

/** 標準の所要（時間）→ 枠の数（保存の weight、1〜5）。所要より短く割り当てない（切り上げ）。 */
export function weightForHours(hours: number): number {
  return Math.min(5, Math.max(1, Math.ceil(hours / HOURS_PER_WEIGHT - 1e-9)))
}

/** しおりで楽しみに割り当てる時間（枠 × 1.6 時間）。 */
export function activityHours(hours: number): number {
  return weightForHours(hours) * HOURS_PER_WEIGHT
}

export function buildTripPlan(
  input: TripInput,
  itinerary: Itinerary,
  risk: RiskAssessment,
  ids: { id: string; seed: number; title: string },
): TripPlan {
  return {
    id: ids.id,
    lang: input.lang,
    seed: ids.seed,
    party: { ...input.party },
    depart: { ...input.depart },
    return: { ...input.return },
    budgetPerPersonJPY: input.budgetPerPersonJPY,
    area: input.area,
    // 入力の weight は使わない（古い画面との互換で受けるだけ）
    pleasures: input.pleasures.map((p) => {
      const pleasure = pleasureById(p.id)
      if (!pleasure) throw new RangeError(`楽しみが見つからない: ${p.id}`)
      return { id: p.id, weight: weightForHours(pleasure.hours) }
    }),
    title: ids.title,
    days: itinerary.days.map((d) => ({ ...d, stops: [...d.stops] })),
    riskScore: risk.score,
    // 作成時は ON。A-6・A-7 の ON / OFF は走行の記録の側に持つ（R10）
    alertEnabled: true,
  }
}
