import type { TripDetails, TripPlan } from '@antler/schema'
import {
  buildDayPlan,
  ItineraryChangedError as ItineraryRebuildError,
  type DayPlan,
} from '@antler/trip'
import {
  ItineraryChangedError,
  TripDayNotFoundError,
  TripInputError,
  TripNotFoundError,
} from '../../../domain/trips/errors/trip-errors.js'
import { TRIP_ID_PATTERN } from '../../../domain/trips/rules/trip-rules.js'
import type { RoadCatalogGateway } from '../../ports/gateways/road-catalog.gateway.js'
import type { TripRepository } from '../../ports/repositories/trip.repository.js'
import type { EventLog } from '../../ports/system/event-log.js'

// GET /api/trips/:id/day/:n（docs/specs/brief-map/functional.md R2〜R5、threat.md、resilience.md）。
// 読み出しだけ。旅を 1 回読み、同梱のデータと @antler/trip の純粋関数でその日の行程を作る（書き込み・外部通信なし）。
// 認可: ID を知る人が読める（A7-1 と同じ）。無い id と形の違う id は区別しない。所有者の印は返さない。

export type GetTripDayDeps = {
  trips: Pick<TripRepository, 'findTrip'>
  data: RoadCatalogGateway
  log: EventLog
}

export type GetTripDayInput = { id: string; day: number }
export type GetTripDayOutput = { plan: TripPlan; details: TripDetails; day: DayPlan }

/** 計算がこれより遅ければ warn（resilience.md） */
const SLOW_MS = 200

export class GetTripDayUseCase {
  constructor(private readonly deps: GetTripDayDeps) {}

  async execute({ id, day }: GetTripDayInput): Promise<GetTripDayOutput> {
    if (!Number.isInteger(day) || day < 1) throw new TripInputError(['n: 1 以上の整数'])
    if (!TRIP_ID_PATTERN.test(id)) throw new TripNotFoundError()
    const stored = await this.deps.trips.findTrip(id)
    if (!stored) throw new TripNotFoundError()
    if (day > stored.plan.days.length) throw new TripDayNotFoundError()

    const started = performance.now()
    let dayPlan: DayPlan
    try {
      dayPlan = buildDayPlan({ plan: stored.plan, day, ...this.deps.data.load() })
    } catch (error) {
      if (error instanceof ItineraryRebuildError) {
        this.deps.log.warn('trip_day.itinerary_changed', { tripId: id })
        throw new ItineraryChangedError()
      }
      throw error
    }
    const elapsedMs = Math.round(performance.now() - started)
    if (elapsedMs > SLOW_MS) this.deps.log.warn('trip_day.slow', { tripId: id, day, ms: elapsedMs })
    for (const leg of dayPlan.legs.filter((l) => l.source === 'straight'))
      this.deps.log.warn('trip_day.road_missing', { from: leg.from, to: leg.to })

    // 保存した行（ownerTokenHash を含む）をそのまま返さず、欄を明示して組み立てる（threat.md AUTH-2）
    return { plan: stored.plan, details: stored.details, day: dayPlan }
  }
}
