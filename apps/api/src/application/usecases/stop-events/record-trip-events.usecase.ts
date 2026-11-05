import {
  EventConflictError,
  EventLimitError,
  OwnerRequiredError,
} from '../../../domain/stop-events/errors/stop-event-errors.js'
import type {
  ResolvedChoice,
  TripEventInput,
  TripEventRecord,
} from '../../../domain/stop-events/models/trip-event.js'
import {
  isOwnerTokenShape,
  isTripOwner,
} from '../../../domain/stop-events/policies/owner-policy.js'
import {
  eventFingerprint,
  eventProblems,
  resolveChoice,
  toEventRecord,
} from '../../../domain/stop-events/policies/trip-event-policy.js'
import {
  MAX_EVENTS_PER_POST,
  MAX_EVENTS_PER_TRIP,
} from '../../../domain/stop-events/rules/stop-rules.js'
import { TripInputError, TripNotFoundError } from '../../../domain/trips/errors/trip-errors.js'
import { TRIP_ID_PATTERN } from '../../../domain/trips/rules/trip-rules.js'
import type { StopDeckRepository } from '../../ports/repositories/stop-deck.repository.js'
import type { TripEventRepository } from '../../ports/repositories/trip-event.repository.js'
import type { TripRepository } from '../../ports/repositories/trip.repository.js'
import type { Hasher } from '../../ports/security/hasher.js'
import type { Clock } from '../../ports/system/clock.js'
import type { EventLog } from '../../ports/system/event-log.js'

// POST /api/trips/:id/events（docs/specs/stop-events/functional.md R9・R10、resilience.md）。
// 1. 旅と所有者の確認
// 2. seq の重なり・日の範囲・choice の解決（保存した束から値を写す。端末の値を信じない）
// 3. 同じ (runId, seq) の既存の行と比べる（同じ → 重複、違う → 409 で全件を入れない）
// 4. 旅の上限を確かめ、新しい行を 1 つの文で入れる

export type RecordTripEventsDeps = {
  trips: Pick<TripRepository, 'findTrip'>
  decks: Pick<StopDeckRepository, 'find'>
  events: TripEventRepository
  hasher: Hasher
  clock: Clock
  log: EventLog
}

export type RecordTripEventsInput = {
  tripId: string
  ownerToken: string | undefined
  runId: string
  alertEnabled: boolean
  events: readonly TripEventInput[]
}

export type RecordTripEventsOutput = { accepted: number; duplicates: number }

export class RecordTripEventsUseCase {
  constructor(private readonly deps: RecordTripEventsDeps) {}

  async execute(input: RecordTripEventsInput): Promise<RecordTripEventsOutput> {
    const { trips, events, hasher, clock, log } = this.deps
    if (!TRIP_ID_PATTERN.test(input.tripId)) throw new TripNotFoundError()
    const stored = await trips.findTrip(input.tripId)
    if (!stored) throw new TripNotFoundError()
    if (
      !isOwnerTokenShape(input.ownerToken) ||
      !isTripOwner(stored.ownerTokenHash, hasher.sha256Hex(input.ownerToken))
    ) {
      log.warn('trip_events.owner_required', { tripId: input.tripId })
      throw new OwnerRequiredError()
    }

    this.checkShape(input.events, stored.plan.days.length)
    const ctx = { departAtMs: Date.parse(stored.plan.depart.at), alertEnabled: input.alertEnabled }
    const problems = input.events.flatMap((e) => eventProblems(e, ctx))
    if (problems.length > 0) throw new TripInputError(problems)
    const resolved = await this.resolveChoices(input.tripId, input.events)
    const run = {
      tripId: input.tripId,
      runId: input.runId,
      alertEnabled: input.alertEnabled,
      receivedAtMs: clock.nowMs(),
    }
    const records = input.events.map((e) => toEventRecord(e, run, resolved.get(e.seq) ?? null))

    const existing = new Map(
      (
        await events.findBySeqs(
          input.tripId,
          input.runId,
          records.map((r) => r.seq),
        )
      ).map((r) => [r.seq, eventFingerprint(r)]),
    )
    const fresh: TripEventRecord[] = []
    let duplicates = 0
    for (const record of records) {
      const before = existing.get(record.seq)
      if (before === undefined) fresh.push(record)
      else if (before === eventFingerprint(record)) duplicates++
      else {
        log.warn('trip_events.conflict', { tripId: input.tripId, seq: record.seq })
        throw new EventConflictError()
      }
    }

    if (fresh.length > 0) {
      const count = await events.countByTrip(input.tripId)
      if (count + fresh.length > MAX_EVENTS_PER_TRIP) {
        log.warn('trip_events.limit', { tripId: input.tripId, count })
        throw new EventLimitError()
      }
      try {
        await events.insertMany(fresh)
      } catch (error) {
        log.error('trip_events.save.failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
        })
        throw error
      }
    }
    log.info('trip_events.recorded', {
      tripId: input.tripId,
      accepted: fresh.length,
      duplicates,
      kinds: countKinds(fresh),
    })
    return { accepted: fresh.length, duplicates }
  }

  /** 件数・seq の重なり・日の範囲（schema の検証に加えて、旅の日数で確かめる） */
  private checkShape(list: readonly TripEventInput[], dayCount: number): void {
    if (list.length < 1 || list.length > MAX_EVENTS_PER_POST) {
      throw new TripInputError([`events: 1〜${String(MAX_EVENTS_PER_POST)} 件`])
    }
    const seqs = new Set(list.map((e) => e.seq))
    if (seqs.size !== list.length) throw new TripInputError(['events: seq が重なっている'])
    if (list.some((e) => e.day > dayCount))
      throw new TripInputError(['events: day が旅の日数を超える'])
  }

  /** choice を保存した束で解決する。束が無い・知らない場面や選択肢 → 入力エラー */
  private async resolveChoices(
    tripId: string,
    list: readonly TripEventInput[],
  ): Promise<Map<number, ResolvedChoice>> {
    const resolved = new Map<number, ResolvedChoice>()
    const decksByDay = new Map<number, Awaited<ReturnType<StopDeckRepository['find']>>>()
    for (const event of list) {
      if (event.kind !== 'choice') continue
      if (!decksByDay.has(event.day))
        decksByDay.set(event.day, await this.deps.decks.find(tripId, event.day))
      const row = decksByDay.get(event.day)
      const value =
        row?.status === 'done' && row.deck
          ? resolveChoice(row.deck, event.sceneId, event.choiceId)
          : null
      if (!value) throw new TripInputError(['events: その日の束に無い場面か選択肢'])
      resolved.set(event.seq, value)
    }
    return resolved
  }
}

function countKinds(records: readonly TripEventRecord[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of records) counts[r.kind] = (counts[r.kind] ?? 0) + 1
  return counts
}
