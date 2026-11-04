import type { TripPlan } from '@antler/schema'
import type { DayPlan } from '@antler/trip'
import type { ResolvedCollision } from '../types'

// しおりの取り消し線（functional.md R2、A6-1）。端末の純粋関数。
// 行は 1 日ごとに「行程（from → to。移動の無い日は出さない）→ 楽しみ → 宿」の順。
// 衝突より前の日は予定どおり済んだとみなす（A-2 の ?day=n で途中の日から走れるので、走ったかどうかは見ない）。
// 衝突した日は、達成した楽しみ → ✕ の行（その移動の from → to）→ 残りの楽しみ → 宿。行程の行は ✕ の行が代わる。

export type RowStatus = 'achieved' | 'lost' | 'collision'

export type ItineraryRow =
  | { kind: 'route'; day: number; from: string; to: string; status: 'achieved' | 'lost' }
  | { kind: 'stop'; day: number; id: string; status: 'achieved' | 'lost' }
  | { kind: 'stay'; day: number; place: string; status: 'achieved' | 'lost' }
  | { kind: 'collision'; day: number; from: string; to: string; at: string; status: 'collision' }

type PlanDay = TripPlan['days'][number]

function dayRows(d: PlanDay, status: 'achieved' | 'lost'): ItineraryRow[] {
  return [
    ...(d.from !== d.to
      ? [{ kind: 'route' as const, day: d.day, from: d.from, to: d.to, status }]
      : []),
    ...d.stops.map((id) => ({ kind: 'stop' as const, day: d.day, id, status })),
    ...(d.stay ? [{ kind: 'stay' as const, day: d.day, place: d.stay, status }] : []),
  ]
}

export function strikeItinerary(
  plan: Pick<TripPlan, 'days'>,
  day: { legs: readonly Pick<DayPlan['legs'][number], 'from' | 'to'>[] },
  collision: Pick<ResolvedCollision, 'day' | 'leg' | 'at' | 'achievedStops'>,
): ItineraryRow[] {
  const achieved = new Set(collision.achievedStops)
  const leg = day.legs[collision.leg]
  return plan.days.flatMap((d): ItineraryRow[] => {
    if (d.day < collision.day) return dayRows(d, 'achieved')
    if (d.day > collision.day) return dayRows(d, 'lost')
    const done = d.stops.filter((id) => achieved.has(id))
    const rest = d.stops.filter((id) => !achieved.has(id))
    return [
      ...done.map((id) => ({ kind: 'stop' as const, day: d.day, id, status: 'achieved' as const })),
      {
        kind: 'collision',
        day: d.day,
        from: leg?.from ?? d.from,
        to: leg?.to ?? d.to,
        at: collision.at,
        status: 'collision',
      },
      ...rest.map((id) => ({ kind: 'stop' as const, day: d.day, id, status: 'lost' as const })),
      ...(d.stay
        ? [{ kind: 'stay' as const, day: d.day, place: d.stay, status: 'lost' as const }]
        : []),
    ]
  })
}
