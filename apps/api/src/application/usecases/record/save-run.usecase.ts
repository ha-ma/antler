import { toJst } from '@antler/schema'
import { MAX_RUNS_PER_DAY, type DriveRunInput } from '@antler/trip'
import {
  NotOwnerError,
  OwnerTokenRequiredError,
  RunDayOutOfRangeError,
  RunLimitError,
} from '../../../domain/record/errors/record-errors.js'
import {
  isOwnerTokenHash,
  OWNER_TOKEN_PATTERN,
} from '../../../domain/record/policies/owner-policy.js'
import { TripNotFoundError } from '../../../domain/trips/errors/trip-errors.js'
import { TRIP_ID_PATTERN } from '../../../domain/trips/rules/trip-rules.js'
import type { StoredRun } from '../../ports/repositories/record.repository.js'
import type { Hasher } from '../../ports/security/hasher.js'
import type { Clock } from '../../ports/system/clock.js'
import type { EventLog } from '../../ports/system/event-log.js'
import type { UnitOfWork } from '../../ports/unit-of-work.js'

// POST /api/trips/:id/runs（docs/specs/record/functional.md R2、threat.md、resilience.md）。
// 所有者トークンの照合・日数・同じ runId・件数の上限・挿入を 1 つのトランザクションで行う
// （削除と同時でも、消えた旅に run が残らない。CONC-1）。

export type SaveRunDeps = { uow: UnitOfWork; hasher: Hasher; clock: Clock; log: EventLog }

export type SaveRunInput = {
  tripId: string
  /** Authorization の Bearer の中身。無ければ空文字 */
  ownerToken: string
  run: DriveRunInput
}

export type SavedRun = {
  runId: string
  day: number
  alertEnabled: boolean
  outcome: DriveRunInput['outcome']
  /** 保存した時刻（JST の ISO） */
  createdAt: string
}

export type SaveRunOutput = { run: SavedRun; replayed: boolean }

function toSaved(stored: StoredRun): SavedRun {
  const { run } = stored
  return {
    runId: run.runId,
    day: run.day,
    alertEnabled: run.alertEnabled,
    outcome: run.outcome,
    createdAt: toJst(new Date(stored.createdAtMs).toISOString()),
  }
}

export class SaveRunUseCase {
  constructor(private readonly deps: SaveRunDeps) {}

  async execute({ tripId, ownerToken, run }: SaveRunInput): Promise<SaveRunOutput> {
    if (!OWNER_TOKEN_PATTERN.test(ownerToken)) throw new OwnerTokenRequiredError()
    if (!TRIP_ID_PATTERN.test(tripId)) throw new TripNotFoundError()
    const presented = this.deps.hasher.sha256Hex(ownerToken)
    const nowMs = this.deps.clock.nowMs()

    const result = await this.deps.uow.transaction(async ({ trips, records }) => {
      const trip = await trips.findTrip(tripId)
      if (!trip) throw new TripNotFoundError()
      if (!isOwnerTokenHash(trip.ownerTokenHash, presented)) throw new NotOwnerError()
      if (run.day > trip.plan.days.length) throw new RunDayOutOfRangeError()

      const existing = await records.findRun(tripId, run.runId)
      if (existing) return { stored: existing, replayed: true }
      if ((await records.countRuns(tripId, run.day)) >= MAX_RUNS_PER_DAY) throw new RunLimitError()
      const inserted = await records.insertRun(tripId, run, nowMs)
      if (inserted) return { stored: inserted, replayed: false }
      // 同時の再送が先に入れた（主キーで片方だけが通る）
      const raced = await records.findRun(tripId, run.runId)
      if (!raced) throw new Error('run を保存できませんでした')
      return { stored: raced, replayed: true }
    })

    if (result.replayed) this.deps.log.info('record.run.replayed', { tripId })
    else this.deps.log.info('record.run.saved', { tripId, day: run.day, seq: result.stored.seq })
    return { run: toSaved(result.stored), replayed: result.replayed }
  }
}
