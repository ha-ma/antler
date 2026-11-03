import type { TripPlan } from '@antler/schema'
import type { Itinerary, RiskAssessment, TripInput } from './types'

// 入力・しおり・リスクから TripPlan（ch7）を組み立てる。id・seed・title は api が決める（functional.md R5・R7）。

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
    pleasures: input.pleasures.map((p) => ({ ...p })),
    title: ids.title,
    days: itinerary.days.map((d) => ({ ...d, stops: [...d.stops] })),
    riskScore: risk.score,
    // 作成時は ON。A-6・A-7 の ON / OFF は走行の記録の側に持つ（R10）
    alertEnabled: true,
  }
}
