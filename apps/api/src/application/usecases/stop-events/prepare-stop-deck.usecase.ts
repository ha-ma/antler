import type { TripPlan } from '@antler/schema'
import {
  buildDayPlan,
  ItineraryChangedError as ItineraryRebuildError,
  type DayPlan,
} from '@antler/trip'
import { lightPeriod } from '@antler/zones'
import {
  OwnerRequiredError,
  SceneWriterError,
} from '../../../domain/stop-events/errors/stop-event-errors.js'
import type { StopDeck } from '../../../domain/stop-events/models/stop-deck.js'
import type {
  StopWriting,
  StopWritingBrief,
} from '../../../domain/stop-events/models/stop-writing.js'
import {
  isOwnerTokenShape,
  isTripOwner,
} from '../../../domain/stop-events/policies/owner-policy.js'
import { buildStopDeck } from '../../../domain/stop-events/policies/stop-deck-policy.js'
import { validateStopWriting } from '../../../domain/stop-events/policies/stop-writing-policy.js'
import {
  ItineraryChangedError,
  TripDayNotFoundError,
  TripInProgressError,
  TripInputError,
  TripNotFoundError,
  TripWriterBusyError,
  type TripWriterFailure,
} from '../../../domain/trips/errors/trip-errors.js'
import {
  ensureWithinDailyLimit,
  jstDayStartMs,
} from '../../../domain/trips/policies/daily-limit-policy.js'
import {
  MAX_WRITER_ATTEMPTS,
  PENDING_STALE_MS,
  TRIP_ID_PATTERN,
} from '../../../domain/trips/rules/trip-rules.js'
import type { RoadCatalogGateway } from '../../ports/gateways/road-catalog.gateway.js'
import type { SceneWriterGateway } from '../../ports/gateways/scene-writer.gateway.js'
import type { StopDeckRepository } from '../../ports/repositories/stop-deck.repository.js'
import type { StoredTrip, TripRepository } from '../../ports/repositories/trip.repository.js'
import type { Hasher } from '../../ports/security/hasher.js'
import type { Clock } from '../../ports/system/clock.js'
import type { ConcurrencyLimiter } from '../../ports/system/concurrency-limiter.js'
import type { EventLog } from '../../ports/system/event-log.js'
import { toDayMaterial, toWritingBrief } from './stop-material.js'

// POST /api/trips/:id/day/:n/stop-deck（docs/specs/stop-events/functional.md R2〜R9、resilience.md「トランザクション境界」）。
// 1. 旅・所有者・日の確認（Claude・書き込みの前）
// 2. （trip_id, day）の pending の行を作る。done なら保存済みを返す、作っている最中なら 409
// 3. DayPlan と束（純粋関数）→ Claude（同時の枠と 1 日の上限は plan-trip と共有。外れたら 1 回だけ作り直す）
// 4. 束と文を done で保存。2〜3 が失敗したら failed に戻す

export type PrepareStopDeckDeps = {
  trips: Pick<TripRepository, 'findTrip' | 'countWriterCall'>
  decks: StopDeckRepository
  data: RoadCatalogGateway
  writer: SceneWriterGateway
  /** Claude の同時呼び出しの枠（plan-trip と同じインスタンス） */
  writerSlots: ConcurrencyLimiter
  hasher: Hasher
  clock: Clock
  log: EventLog
  /** 1 日（日本時間の暦日）の Claude の呼び出しの上限（plan-trip と共有） */
  dailyWriterCallLimit: number
}

export type PrepareStopDeckInput = { tripId: string; day: number; ownerToken: string | undefined }
export type PrepareStopDeckOutput = { deck: StopDeck; writing: StopWriting; replayed: boolean }

export class PrepareStopDeckUseCase {
  constructor(private readonly deps: PrepareStopDeckDeps) {}

  async execute({ tripId, day, ownerToken }: PrepareStopDeckInput): Promise<PrepareStopDeckOutput> {
    const { decks, clock } = this.deps
    const stored = await this.ownedTrip(tripId, day, ownerToken)
    const nowMs = clock.nowMs()

    const claimed = await decks.insertPending({ tripId, day, nowMs })
    if (!claimed) {
      const existing = await decks.find(tripId, day)
      if (!existing) throw new TripInProgressError()
      if (existing.status === 'done' && existing.deck && existing.writing) {
        // データの版（routes・zones。DayPlan の data と同じ値）が変わっていなければ保存済みを返す。
        // 変わっていれば作り直す（IDEM-34）。DayPlan は作らずに版だけを比べる
        const { roads, zones } = this.deps.data.load()
        if (
          existing.deck.data.routes === roads.meta.fetchedAt &&
          existing.deck.data.zones === zones.hash
        ) {
          return { deck: existing.deck, writing: existing.writing, replayed: true }
        }
        this.deps.log.info('stop_deck.data_changed', { tripId, day })
      } else if (existing.status === 'pending' && nowMs - existing.updatedAtMs < PENDING_STALE_MS) {
        throw new TripInProgressError()
      }
      const reclaimed = await decks.reclaim(
        tripId,
        day,
        { status: existing.status, updatedAtMs: existing.updatedAtMs },
        nowMs,
      )
      if (!reclaimed) throw new TripInProgressError()
    }

    try {
      return await this.prepare(stored.plan, day, nowMs)
    } catch (error) {
      await this.markFailed(tripId, day, nowMs)
      throw error
    }
  }

  /** 旅があり、トークンがその旅の所有者のもので、その日があること（R9） */
  private async ownedTrip(
    tripId: string,
    day: number,
    ownerToken: string | undefined,
  ): Promise<StoredTrip> {
    if (!Number.isInteger(day) || day < 1) throw new TripInputError(['n: 1 以上の整数'])
    if (!TRIP_ID_PATTERN.test(tripId)) throw new TripNotFoundError()
    const stored = await this.deps.trips.findTrip(tripId)
    if (!stored) throw new TripNotFoundError()
    if (
      !isOwnerTokenShape(ownerToken) ||
      !isTripOwner(stored.ownerTokenHash, this.deps.hasher.sha256Hex(ownerToken))
    ) {
      this.deps.log.warn('stop_deck.owner_required', { tripId })
      throw new OwnerRequiredError()
    }
    if (day > stored.plan.days.length) throw new TripDayNotFoundError()
    return stored
  }

  /** claimedAtMs は自分が pending を立てた時刻（done・failed はその行のままのときだけ書く。CONC-33） */
  private async prepare(
    plan: TripPlan,
    day: number,
    claimedAtMs: number,
  ): Promise<PrepareStopDeckOutput> {
    const { decks, clock, log } = this.deps
    const dayPlan = this.dayPlanOf(plan, day)
    const deck = buildStopDeck(toDayMaterial(plan, dayPlan), (atMs, where) =>
      lightPeriod(atMs, where),
    )
    // 場面の無い日（移動が短く楽しみも無い）は Claude を呼ばない
    const writing: StopWriting =
      deck.scenes.length === 0
        ? { scenes: [] }
        : await this.write(toWritingBrief(plan, dayPlan, deck), deck)
    let saved: boolean
    try {
      saved = await decks.markDone({
        tripId: plan.id,
        day,
        deck,
        writing,
        claimedAtMs,
        nowMs: clock.nowMs(),
      })
    } catch (error) {
      log.error('stop_deck.save.failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
      })
      throw error
    }
    // 作り直しに取られていた（2 分を過ぎた）。作った束は返すが、行は新しい生成のものを残す
    if (!saved) log.warn('stop_deck.claim_lost', { tripId: plan.id, day })
    log.info('stop_deck.created', {
      tripId: plan.id,
      day,
      scenes: deck.scenes.length,
      durationMs: clock.nowMs() - claimedAtMs,
    })
    return { deck, writing, replayed: false }
  }

  private dayPlanOf(plan: TripPlan, day: number): DayPlan {
    try {
      return buildDayPlan({ plan, day, ...this.deps.data.load() })
    } catch (error) {
      if (error instanceof ItineraryRebuildError) {
        this.deps.log.warn('stop_deck.itinerary_changed', { tripId: plan.id })
        throw new ItineraryChangedError()
      }
      throw error
    }
  }

  /** Claude に書かせ、束と照らして検証する。外れたら 1 回だけ作り直す（R7）。同時の枠は作り直しのぶんまで持つ */
  private async write(brief: StopWritingBrief, deck: StopDeck): Promise<StopWriting> {
    const release = this.deps.writerSlots.tryAcquire()
    if (!release) {
      this.deps.log.warn('stop_deck.writer.busy')
      throw new TripWriterBusyError()
    }
    try {
      return await this.writeWithRetry(brief, deck)
    } finally {
      release()
    }
  }

  private async writeWithRetry(brief: StopWritingBrief, deck: StopDeck): Promise<StopWriting> {
    const { writer, log } = this.deps
    let previousProblems: string[] | undefined
    let lastReason: TripWriterFailure = 'invalid'
    for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
      await this.countWriterCall()
      const outcome = await writer.write(previousProblems ? { brief, previousProblems } : { brief })
      if (outcome.kind === 'rejected') {
        lastReason = outcome.reason
        previousProblems = [outcome.reason]
        log.warn('stop_deck.writer.invalid', { attempt, reasons: previousProblems })
        continue
      }
      const problems = validateStopWriting(outcome.writing, deck)
      if (problems.length === 0) return outcome.writing
      lastReason = 'invalid'
      previousProblems = [...new Set(problems.map((p) => `${p.code}@${p.path}`))]
      log.warn('stop_deck.writer.invalid', { attempt, reasons: previousProblems })
    }
    throw new SceneWriterError(lastReason)
  }

  /** 呼び出しの前に当日の通し番号を進める（plan-trip と同じ数え上げ）。上限を超えていれば呼ばない */
  private async countWriterCall(): Promise<void> {
    const { trips, clock, log, dailyWriterCallLimit } = this.deps
    const callNumber = await trips.countWriterCall(jstDayStartMs(clock.nowMs()))
    try {
      ensureWithinDailyLimit(callNumber, dailyWriterCallLimit)
    } catch (error) {
      log.warn('stop_deck.daily_limit', { callNumber, dailyWriterCallLimit })
      throw error
    }
  }

  private async markFailed(tripId: string, day: number, claimedAtMs: number): Promise<void> {
    try {
      await this.deps.decks.markFailed(tripId, day, claimedAtMs, this.deps.clock.nowMs())
    } catch (error) {
      // 元の失敗を返すことを優先する。行は 2 分後に古い pending として作り直せる
      this.deps.log.error('stop_deck.mark_failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
      })
    }
  }
}
