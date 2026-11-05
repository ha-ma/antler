import {
  NotOwnerError,
  OwnerTokenRequiredError,
} from '../../../domain/record/errors/record-errors.js'
import {
  isOwnerTokenHash,
  OWNER_TOKEN_PATTERN,
} from '../../../domain/record/policies/owner-policy.js'
import { TripNotFoundError } from '../../../domain/trips/errors/trip-errors.js'
import { TRIP_ID_PATTERN } from '../../../domain/trips/rules/trip-rules.js'
import type { Hasher } from '../../ports/security/hasher.js'
import type { EventLog } from '../../ports/system/event-log.js'
import type { UnitOfWork } from '../../ports/unit-of-work.js'

// DELETE /api/trips/:id（docs/specs/record/functional.md R10、threat.md「認可の失効」、resilience.md）。
// 照合と削除を 1 つのトランザクションで行う。旅・run・その旅を指す冪等キーの行を消す
// （冪等キーの行が残ると、同じキーの再送が「指す旅が無い」500 になる。UC-5b）。

export type DeleteTripDeps = { uow: UnitOfWork; hasher: Hasher; log: EventLog }

export type DeleteTripInput = {
  tripId: string
  /** Authorization の Bearer の中身。無ければ空文字 */
  ownerToken: string
}

export class DeleteTripUseCase {
  constructor(private readonly deps: DeleteTripDeps) {}

  async execute({ tripId, ownerToken }: DeleteTripInput): Promise<void> {
    if (!OWNER_TOKEN_PATTERN.test(ownerToken)) throw new OwnerTokenRequiredError()
    if (!TRIP_ID_PATTERN.test(tripId)) throw new TripNotFoundError()
    const presented = this.deps.hasher.sha256Hex(ownerToken)

    await this.deps.uow.transaction(async ({ trips, records }) => {
      const trip = await trips.findTrip(tripId)
      if (!trip) throw new TripNotFoundError()
      if (!isOwnerTokenHash(trip.ownerTokenHash, presented)) throw new NotOwnerError()
      const deleted = await records.deleteTrip(tripId)
      if (deleted !== 1) throw new TripNotFoundError()
    })
    this.deps.log.info('record.trip.deleted', { tripId })
  }
}
