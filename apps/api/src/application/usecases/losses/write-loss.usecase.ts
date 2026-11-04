import { LossLimitError, LossWriterError } from '../../../domain/losses/errors/loss-errors.js'
import type { LossBrief, StoredLoss } from '../../../domain/losses/models/loss.js'
import {
  buildLossBrief,
  checkCollision,
  lossKeyMaterial,
} from '../../../domain/losses/policies/collision-policy.js'
import { validateLossStory } from '../../../domain/losses/policies/loss-story-policy.js'
import {
  MAX_LOSS_WRITER_ATTEMPTS,
  MAX_LOSSES_PER_TRIP,
} from '../../../domain/losses/rules/loss-rules.js'
import {
  TripInputError,
  TripNotFoundError,
  TripWriterBusyError,
  type TripWriterFailure,
} from '../../../domain/trips/errors/trip-errors.js'
import type { LocalizedText } from '../../../domain/trips/models/trip-writing.js'
import {
  ensureWithinDailyLimit,
  jstDayStartMs,
} from '../../../domain/trips/policies/daily-limit-policy.js'
import { TRIP_ID_PATTERN } from '../../../domain/trips/rules/trip-rules.js'
import type { LossWriterGateway } from '../../ports/gateways/loss-writer.gateway.js'
import type { LossRepository } from '../../ports/repositories/loss.repository.js'
import type { TripRepository } from '../../ports/repositories/trip.repository.js'
import type { Hasher } from '../../ports/security/hasher.js'
import type { Clock } from '../../ports/system/clock.js'
import type { ConcurrencyLimiter } from '../../ports/system/concurrency-limiter.js'
import type { EventLog } from '../../ports/system/event-log.js'
import type { WriteLossInput, WriteLossOutput } from './dto.js'
import { jstDateOf, lossDaysOf } from './loss-context.js'

// POST /api/trips/:id/losses（docs/specs/loss/functional.md R5〜R8、resilience.md「トランザクション境界」）。
// 1. 旅を読む（無ければ 404）→ 保存したしおりと記述子を突き合わせる（400 / 409）
// 2. 文の材料だけで作った鍵で、保存済みの文を探す。あれば返す（Claude を呼ばない・数えない）
//    同じ鍵の要求が同時に来たら、プロセスの中で 1 つにまとめる（single-flight。UC-5f）
// 3. 旅ごとの上限（429）→ 同時の枠（503）→ 呼び出しごとに 1 日の上限（429。plan-trip と共有）→ Claude。外れたら 1 回だけ作り直す
// 4. 1 行の INSERT。負けたら（別のプロセスが先に保存）保存済みの文を返す。失敗しても何も残さない

export type WriteLossDeps = {
  trips: Pick<TripRepository, 'findTrip' | 'countWriterCall'>
  losses: LossRepository
  writer: LossWriterGateway
  /** Claude の同時呼び出しの枠（plan-trip と同じインスタンス） */
  writerSlots: ConcurrencyLimiter
  hasher: Hasher
  clock: Clock
  log: EventLog
  /** 1 日（日本時間の暦日）の Claude の呼び出しの上限（plan-trip と同じ数え上げ） */
  dailyWriterCallLimit: number
}

/** 保存する行の、文と時刻を除いた部分（鍵・旅・記述子） */
type LossKey = Pick<StoredLoss, 'keyHash' | 'tripId' | 'collision'>

export class WriteLossUseCase {
  /** 鍵ごとの処理中の要求（single-flight。1 プロセス前提は同時の枠と同じ） */
  private readonly inFlight = new Map<string, Promise<WriteLossOutput>>()

  constructor(private readonly deps: WriteLossDeps) {}

  async execute({ tripId, collision }: WriteLossInput): Promise<WriteLossOutput> {
    if (!TRIP_ID_PATTERN.test(tripId)) throw new TripNotFoundError()
    const stored = await this.deps.trips.findTrip(tripId)
    if (!stored) throw new TripNotFoundError()
    const days = lossDaysOf(stored.plan)
    const problems = checkCollision(days, collision, jstDateOf(collision.at))
    if (problems.length > 0) throw new TripInputError(problems)

    const keyHash = this.deps.hasher.sha256Hex(lossKeyMaterial(tripId, collision))
    const running = this.inFlight.get(keyHash)
    if (running) return running
    const brief = buildLossBrief({
      lang: stored.plan.lang,
      partySize: stored.plan.party.size,
      days,
      collision,
    })
    const task = this.findOrCreate({ keyHash, tripId, collision }, brief).finally(() =>
      this.inFlight.delete(keyHash),
    )
    this.inFlight.set(keyHash, task)
    return task
  }

  private async findOrCreate(draft: LossKey, brief: LossBrief): Promise<WriteLossOutput> {
    const { losses, clock, log } = this.deps
    const existing = await losses.findLoss(draft.keyHash)
    if (existing) {
      log.info('loss.replayed', { tripId: draft.tripId })
      return toOutput(existing, true)
    }
    if ((await losses.countLosses(draft.tripId)) >= MAX_LOSSES_PER_TRIP) {
      log.warn('loss.trip_limit', { tripId: draft.tripId })
      throw new LossLimitError()
    }

    const started = clock.nowMs()
    const story = await this.write(brief)
    const loss: StoredLoss = { ...draft, story, createdAtMs: clock.nowMs() }
    if (!(await losses.insertLoss(loss))) {
      const winner = await losses.findLoss(draft.keyHash)
      if (!winner) throw new Error('保存の衝突のあとに喪失文が見つかりません')
      log.info('loss.replayed', { tripId: draft.tripId, race: true })
      return toOutput(winner, true)
    }
    log.info('loss.created', {
      tripId: draft.tripId,
      day: draft.collision.day,
      alertEnabled: draft.collision.alertEnabled,
      durationMs: clock.nowMs() - started,
    })
    return toOutput(loss, false)
  }

  /** 同時の枠を作り直しのぶんまで持ち、呼び出しのたびに 1 日の上限を確かめる（R8） */
  private async write(brief: LossBrief): Promise<LocalizedText> {
    const release = this.deps.writerSlots.tryAcquire()
    if (!release) {
      this.deps.log.warn('loss.writer.busy')
      throw new TripWriterBusyError()
    }
    try {
      return await this.writeWithRetry(brief)
    } finally {
      release()
    }
  }

  private async countWriterCall(): Promise<void> {
    const { trips, clock, log, dailyWriterCallLimit } = this.deps
    const callNumber = await trips.countWriterCall(jstDayStartMs(clock.nowMs()))
    try {
      ensureWithinDailyLimit(callNumber, dailyWriterCallLimit)
    } catch (error) {
      log.warn('loss.daily_limit', { callNumber, dailyWriterCallLimit })
      throw error
    }
  }

  private async writeWithRetry(brief: LossBrief): Promise<LocalizedText> {
    const { writer, log } = this.deps
    let previousProblems: string[] | undefined
    let lastReason: TripWriterFailure = 'invalid'
    for (let attempt = 1; attempt <= MAX_LOSS_WRITER_ATTEMPTS; attempt++) {
      await this.countWriterCall()
      const outcome = await writer.write(previousProblems ? { brief, previousProblems } : { brief })
      if (outcome.kind === 'rejected') {
        lastReason = outcome.reason
        previousProblems = [outcome.reason]
        log.warn('loss.writer.invalid', { attempt, reasons: previousProblems })
        continue
      }
      const problems = validateLossStory(outcome.output)
      if (problems.length === 0) return outcome.output.story
      lastReason = 'invalid'
      previousProblems = [...new Set(problems.map((p) => `${p.code}@${p.path}`))]
      log.warn('loss.writer.invalid', { attempt, reasons: previousProblems })
    }
    throw new LossWriterError(lastReason)
  }
}

function toOutput(loss: StoredLoss, replayed: boolean): WriteLossOutput {
  // 保存した行（鍵のハッシュ・記述子）をそのまま返さず、欄を明示して組み立てる（threat.md AUTH-7）
  return {
    loss: {
      tripId: loss.tripId,
      story: loss.story,
      createdAt: new Date(loss.createdAtMs).toISOString(),
    },
    replayed,
  }
}
