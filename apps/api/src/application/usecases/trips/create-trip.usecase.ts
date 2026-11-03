import type { TripDetails } from '@antler/schema'
import { assessRisk, buildItinerary, buildTripPlan, type TripInput } from '@antler/trip'
import {
  TripIdCollisionError,
  TripInProgressError,
  TripWriterBusyError,
  TripWriterError,
} from '../../../domain/trips/errors/trip-errors.js'
import type { TripWriting, TripWritingBrief } from '../../../domain/trips/models/trip-writing.js'
import {
  ensureWithinDailyLimit,
  jstDayStartMs,
} from '../../../domain/trips/policies/daily-limit-policy.js'
import { decideOnExistingRequest } from '../../../domain/trips/policies/idempotency-policy.js'
import {
  canonicalJson,
  createTripIdentity,
  idempotencyKeyMaterial,
  ownerTokenMaterial,
} from '../../../domain/trips/policies/trip-identity-policy.js'
import { validateTripWriting } from '../../../domain/trips/policies/trip-writing-policy.js'
import { MAX_ID_ATTEMPTS, MAX_WRITER_ATTEMPTS } from '../../../domain/trips/rules/trip-rules.js'
import type { TripWriterGateway } from '../../ports/gateways/trip-writer.gateway.js'
import type { TripRepository } from '../../ports/repositories/trip.repository.js'
import type { Hasher } from '../../ports/security/hasher.js'
import type { RandomSource } from '../../ports/security/random-source.js'
import type { TokenSigner } from '../../ports/security/token-signer.js'
import type { Clock } from '../../ports/system/clock.js'
import type { ConcurrencyLimiter } from '../../ports/system/concurrency-limiter.js'
import type { EventLog } from '../../ports/system/event-log.js'
import type { UnitOfWork } from '../../ports/unit-of-work.js'
import type { CreateTripInput, CreateTripOutput } from './dto.js'
import { toWritingBrief } from './writing-brief.js'

// POST /api/trips（docs/specs/plan-trip/functional.md R5・R7・R8・R9、resilience.md「トランザクション境界」）。
// 1. 冪等キーの行を pending で作る（主キーで 2 回目を止める）。既にあれば状態で分ける
// 2. しおり・リスク（@antler/trip の純粋関数。端末の値を信じない）
// 3. Claude（トランザクションの外。外れたら 1 回だけ作り直す）。同時呼び出しの枠を取り（無ければ 503）、
//    呼び出しのたびに当日の通し番号を DB で進めて、1 日の上限を超えたら呼ばない（429。失敗した呼び出しも数える）
// 4. TripPlan・TripDetails・ownerToken のハッシュの保存と、冪等キーの done を 1 つのトランザクションで
// 2〜4 が失敗したら冪等キーを failed にする（旅の行は残さない）

export type CreateTripDeps = {
  trips: TripRepository
  uow: UnitOfWork
  writer: TripWriterGateway
  /** Claude の同時呼び出しの枠 */
  writerSlots: ConcurrencyLimiter
  random: RandomSource
  hasher: Hasher
  /** 所有者トークンの署名（HMAC。鍵はサーバーの秘密 OWNER_TOKEN_SECRET） */
  ownerTokens: TokenSigner
  clock: Clock
  log: EventLog
  /** 1 日（日本時間の暦日）の Claude の呼び出しの上限（作り直し・失敗も数える） */
  dailyWriterCallLimit: number
}

export class CreateTripUseCase {
  constructor(private readonly deps: CreateTripDeps) {}

  async execute({ idempotencyKey, trip }: CreateTripInput): Promise<CreateTripOutput> {
    const { trips, hasher, ownerTokens, clock } = this.deps
    const keyHash = hasher.sha256Hex(idempotencyKeyMaterial(idempotencyKey))
    const bodyHash = hasher.sha256Hex(canonicalJson(trip))
    // 同じキーの再送でも同じトークンを返せるよう、キーをサーバーの秘密で署名して作る（R7・R8）
    const ownerToken = ownerTokens.sign(ownerTokenMaterial(idempotencyKey))
    const nowMs = clock.nowMs()

    const claimed = await trips.insertPendingRequest({ keyHash, bodyHash, nowMs })
    if (!claimed) {
      const existing = await trips.findRequest(keyHash)
      if (!existing) throw new TripInProgressError()
      const decision = decideOnExistingRequest(existing, bodyHash, nowMs)
      if (decision.kind === 'replay') {
        const stored = await trips.findTrip(decision.tripId)
        if (!stored) throw new Error('冪等キーの行が指す旅がありません')
        return { plan: stored.plan, details: stored.details, ownerToken, replayed: true }
      }
      const reclaimed = await trips.reclaimRequest(
        keyHash,
        { status: existing.status, updatedAtMs: existing.updatedAtMs },
        { bodyHash, nowMs },
      )
      if (!reclaimed) throw new TripInProgressError()
    }

    try {
      return await this.create(trip, keyHash, ownerToken, nowMs)
    } catch (error) {
      await this.markFailed(keyHash)
      throw error
    }
  }

  private async create(
    trip: TripInput,
    keyHash: string,
    ownerToken: string,
    nowMs: number,
  ): Promise<CreateTripOutput> {
    const { uow, random, hasher, clock, log } = this.deps
    const itinerary = buildItinerary(trip)
    const risk = assessRisk(trip, itinerary)
    const writing = await this.write(
      toWritingBrief(trip, itinerary, risk),
      itinerary.days.map((d) => d.day),
    )

    const ownerTokenHash = hasher.sha256Hex(ownerToken)
    for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
      const { id, seed } = createTripIdentity((n) => random.bytes(n))
      const plan = buildTripPlan(trip, itinerary, risk, {
        id,
        seed,
        title: writing.titles[trip.lang],
      })
      const details: TripDetails = {
        tripId: id,
        titles: writing.titles,
        dayNotes: writing.dayNotes,
        skipped: itinerary.skipped,
        createdAt: new Date(nowMs).toISOString(),
      }
      try {
        await uow.transaction(async ({ trips: tx }) => {
          await tx.insertTrip({ plan, details, ownerTokenHash, createdAtMs: nowMs })
          await tx.markRequestDone(keyHash, id, clock.nowMs())
        })
      } catch (error) {
        if (error instanceof TripIdCollisionError) {
          log.warn('trip.id.collision', { attempt })
          continue
        }
        log.error('trip.save.failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
        })
        throw error
      }
      log.info('trip.created', {
        tripId: id,
        days: plan.days.length,
        riskLevel: risk.level,
        durationMs: clock.nowMs() - nowMs,
      })
      return { plan, details, ownerToken, replayed: false }
    }
    throw new Error('旅の id が続けて衝突しました')
  }

  /**
   * Claude に書かせ、検証する。応答が使えなければ 1 回だけ作り直す（R5）。
   * 同時呼び出しの枠を作り直しのぶんまで持ち続け、呼び出しのたびに 1 日の上限を確かめる（R9）。
   */
  private async write(brief: TripWritingBrief, dayNumbers: number[]): Promise<TripWriting> {
    const release = this.deps.writerSlots.tryAcquire()
    if (!release) {
      this.deps.log.warn('trip.writer.busy')
      throw new TripWriterBusyError()
    }
    try {
      return await this.writeWithRetry(brief, dayNumbers)
    } finally {
      release()
    }
  }

  /** 呼び出しの前に当日の通し番号を進める。上限を超えていれば呼ばずに DailyLimitError */
  private async countWriterCall(): Promise<void> {
    const { trips, clock, log, dailyWriterCallLimit } = this.deps
    const callNumber = await trips.countWriterCall(jstDayStartMs(clock.nowMs()))
    try {
      ensureWithinDailyLimit(callNumber, dailyWriterCallLimit)
    } catch (error) {
      log.warn('trip.daily_limit', { callNumber, dailyWriterCallLimit })
      throw error
    }
  }

  private async writeWithRetry(
    brief: TripWritingBrief,
    dayNumbers: number[],
  ): Promise<TripWriting> {
    const { writer, log } = this.deps
    let previousProblems: string[] | undefined
    let lastReason: 'invalid' | 'truncated' | 'refused' | 'malformed' = 'invalid'
    for (let attempt = 1; attempt <= MAX_WRITER_ATTEMPTS; attempt++) {
      await this.countWriterCall()
      const outcome = await writer.write(previousProblems ? { brief, previousProblems } : { brief })
      if (outcome.kind === 'rejected') {
        lastReason = outcome.reason
        previousProblems = [outcome.reason]
        log.warn('trip.writer.invalid', { attempt, reasons: previousProblems })
        continue
      }
      const problems = validateTripWriting(outcome.writing, dayNumbers)
      if (problems.length === 0) return outcome.writing
      lastReason = 'invalid'
      previousProblems = [...new Set(problems.map((p) => `${p.code}@${p.path}`))]
      log.warn('trip.writer.invalid', { attempt, reasons: previousProblems })
    }
    throw new TripWriterError(lastReason)
  }

  private async markFailed(keyHash: string): Promise<void> {
    try {
      await this.deps.trips.markRequestFailed(keyHash, this.deps.clock.nowMs())
    } catch (error) {
      // 元の失敗を返すことを優先する。行は 2 分後に古い pending として作り直せる
      this.deps.log.error('trip.request.mark_failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
      })
    }
  }
}
