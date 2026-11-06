import type { TripPlan } from '@antler/schema'
import {
  buildDayPlan,
  ItineraryChangedError as ItineraryRebuildError,
  type DayPlan,
} from '@antler/trip'
import { ChatLimitError, ChatWriterError } from '../../../domain/chats/errors/chat-errors.js'
import type {
  ChatDeck,
  ChatPlan,
  ChatWriting,
  ChatWritingBrief,
  StoredChat,
} from '../../../domain/chats/models/chat-deck.js'
import { buildChatPlan, chatKeyMaterial } from '../../../domain/chats/policies/chat-plan-policy.js'
import { validateChatWriting } from '../../../domain/chats/policies/chat-writing-policy.js'
import {
  CHAT_FAILURE_MEMORY_MS,
  MAX_CHAT_WRITER_ATTEMPTS,
  MAX_CHATS_PER_TRIP,
} from '../../../domain/chats/rules/chat-rules.js'
import { OwnerRequiredError } from '../../../domain/stop-events/errors/stop-event-errors.js'
import {
  isOwnerTokenShape,
  isTripOwner,
} from '../../../domain/stop-events/policies/owner-policy.js'
import {
  ItineraryChangedError,
  TripDayNotFoundError,
  TripInputError,
  TripNotFoundError,
  TripWriterBusyError,
  type TripWriterFailure,
} from '../../../domain/trips/errors/trip-errors.js'
import {
  ensureWithinDailyLimit,
  jstDayStartMs,
} from '../../../domain/trips/policies/daily-limit-policy.js'
import { TRIP_ID_PATTERN } from '../../../domain/trips/rules/trip-rules.js'
import type { ChatWriterGateway } from '../../ports/gateways/chat-writer.gateway.js'
import type { RoadCatalogGateway } from '../../ports/gateways/road-catalog.gateway.js'
import type { ChatRepository } from '../../ports/repositories/chat.repository.js'
import type { StoredTrip, TripRepository } from '../../ports/repositories/trip.repository.js'
import type { Hasher } from '../../ports/security/hasher.js'
import type { Clock } from '../../ports/system/clock.js'
import type { ConcurrencyLimiter } from '../../ports/system/concurrency-limiter.js'
import type { EventLog } from '../../ports/system/event-log.js'
import { lightOnRoad, toChatMaterial, toChatWritingBrief } from './chat-material.js'

// POST /api/trips/:id/day/:n/chat（docs/specs/drive-audio-chat/functional.md R10・R11・R15〜R17、resilience.md「トランザクション境界」）。
// 1. 旅を読む（404）→ ownerToken（403）→ 日の範囲（404）→ DayPlan を作り直す（409）
// 2. 束の計画（純粋関数）→ 鍵（SHA-256）。同じ鍵の同時の要求はプロセスの中で 1 つにまとめる（single-flight）
// 3. 保存済みの行があれば返す（200。Claude を呼ばない・数えない）。10 分以内に外れた鍵なら Claude を呼ばずに 502
// 4. 行が 0 の束は Claude を呼ばずに保存。そうでなければ旅ごとの上限（409）→ 同時の枠（503）
//    → 呼び出しごとに 1 日の上限（429。plan-trip と共有）→ Claude。外れたら 1 回だけ作り直す
// 5. 1 行の INSERT（ON CONFLICT DO NOTHING）。負けたら保存済みの束を返す。失敗しても何も残さない

export type PrepareChatDeps = {
  trips: Pick<TripRepository, 'findTrip' | 'countWriterCall'>
  chats: ChatRepository
  data: RoadCatalogGateway
  writer: ChatWriterGateway
  /** Claude の同時呼び出しの枠（plan-trip・stop-events・loss と同じインスタンス） */
  writerSlots: ConcurrencyLimiter
  hasher: Hasher
  clock: Clock
  log: EventLog
  /** 1 日（日本時間の暦日）の Claude の呼び出しの上限（plan-trip と共有） */
  dailyWriterCallLimit: number
}

export type PrepareChatInput = { tripId: string; day: number; ownerToken: string | undefined }
export type PrepareChatOutput = {
  chat: ChatDeck
  /** 保存済みの束を返した（200）。新しく作った（201）なら false */
  replayed: boolean
}

/**
 * 失敗を覚える理由。中身が外れた（作り直しても同じになりやすく、呼ぶたびに費用がかかる）ときだけ。
 * 時間切れ・上流の失敗・認証は一時的なので覚えない（もう一度送れば呼び直す。FAIL-41）
 */
const REMEMBERED_FAILURES: readonly TripWriterFailure[] = [
  'invalid',
  'truncated',
  'refused',
  'malformed',
]

type ChatKey = Pick<StoredChat, 'keyHash' | 'tripId' | 'day'>

export class PrepareChatUseCase {
  /** 鍵ごとの処理中の要求（single-flight。1 プロセス前提は同時の枠と同じ） */
  private readonly inFlight = new Map<string, Promise<PrepareChatOutput>>()
  /** 外れた鍵と、覚えておく期限（Clock の時刻。プロセスの中だけ） */
  private readonly failures = new Map<string, { untilMs: number; reason: TripWriterFailure }>()

  constructor(private readonly deps: PrepareChatDeps) {}

  async execute({ tripId, day, ownerToken }: PrepareChatInput): Promise<PrepareChatOutput> {
    const stored = await this.ownedTrip(tripId, day, ownerToken)
    const dayPlan = this.dayPlanOf(stored.plan, day)
    const chatPlan = buildChatPlan(toChatMaterial(stored.plan, dayPlan), lightOnRoad(dayPlan))
    const keyHash = this.deps.hasher.sha256Hex(chatKeyMaterial(tripId, day, chatPlan.data))

    const running = this.inFlight.get(keyHash)
    if (running) return running
    const key: ChatKey = { keyHash, tripId, day }
    const task = this.findOrCreate(key, chatPlan, () =>
      toChatWritingBrief(stored.plan, dayPlan, chatPlan),
    ).finally(() => this.inFlight.delete(keyHash))
    this.inFlight.set(keyHash, task)
    return task
  }

  /** 旅があり、トークンがその旅の所有者のもので、その日があること（R15。stop-deck と同じ順） */
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
      this.deps.log.warn('chat.owner_required', { tripId })
      throw new OwnerRequiredError()
    }
    if (day > stored.plan.days.length) throw new TripDayNotFoundError()
    return stored
  }

  private dayPlanOf(plan: TripPlan, day: number): DayPlan {
    try {
      return buildDayPlan({ plan, day, ...this.deps.data.load() })
    } catch (error) {
      if (error instanceof ItineraryRebuildError) {
        this.deps.log.warn('chat.itinerary_changed', { tripId: plan.id })
        throw new ItineraryChangedError()
      }
      throw error
    }
  }

  private async findOrCreate(
    key: ChatKey,
    plan: ChatPlan,
    briefOf: () => ChatWritingBrief,
  ): Promise<PrepareChatOutput> {
    const { chats, clock, log } = this.deps
    const started = clock.nowMs()
    const existing = await chats.findChat(key.keyHash)
    if (existing) {
      log.info('chat.replayed', {
        tripId: key.tripId,
        day: key.day,
        lines: existing.deck.lines.length,
        durationMs: clock.nowMs() - started,
      })
      return { chat: toDeck(existing.deck), replayed: true }
    }
    const failed = this.recentFailure(key.keyHash)
    if (failed) {
      log.warn('chat.writer.remembered_failure', { tripId: key.tripId, day: key.day })
      throw new ChatWriterError(failed)
    }

    // 行の無い束（移動の無い日など）は Claude を呼ばずに保存する（SAVE-2b）
    let writing: ChatWriting = { lines: [] }
    if (plan.lines.length > 0) {
      if ((await chats.countChats(key.tripId)) >= MAX_CHATS_PER_TRIP) {
        log.warn('chat.trip_limit', { tripId: key.tripId })
        throw new ChatLimitError()
      }
      writing = await this.write(key.keyHash, briefOf(), plan)
    }

    const deck = assemble(plan, writing)
    const chat: StoredChat = { ...key, deck, createdAtMs: clock.nowMs() }
    if (!(await chats.insertChat(chat))) {
      const winner = await chats.findChat(key.keyHash)
      if (!winner) throw new Error('保存の衝突のあとに会話の束が見つかりません')
      log.info('chat.replayed', { tripId: key.tripId, day: key.day, race: true })
      return { chat: toDeck(winner.deck), replayed: true }
    }
    log.info('chat.created', {
      tripId: key.tripId,
      day: key.day,
      lines: deck.lines.length,
      durationMs: clock.nowMs() - started,
    })
    return { chat: toDeck(deck), replayed: false }
  }

  /** 10 分以内に外れた鍵なら、その理由。期限の過ぎた記憶はここで捨てる */
  private recentFailure(keyHash: string): TripWriterFailure | null {
    const nowMs = this.deps.clock.nowMs()
    for (const [k, f] of this.failures) if (f.untilMs <= nowMs) this.failures.delete(k)
    return this.failures.get(keyHash)?.reason ?? null
  }

  /** 同時の枠を作り直しのぶんまで持ち、外れが続いたら鍵を覚える（R15・FAIL-45） */
  private async write(
    keyHash: string,
    brief: ChatWritingBrief,
    plan: ChatPlan,
  ): Promise<ChatWriting> {
    const release = this.deps.writerSlots.tryAcquire()
    if (!release) {
      this.deps.log.warn('chat.writer.busy')
      throw new TripWriterBusyError()
    }
    try {
      return await this.writeWithRetry(brief, plan)
    } catch (error) {
      if (error instanceof ChatWriterError && REMEMBERED_FAILURES.includes(error.reason)) {
        this.failures.set(keyHash, {
          untilMs: this.deps.clock.nowMs() + CHAT_FAILURE_MEMORY_MS,
          reason: error.reason,
        })
      }
      throw error
    } finally {
      release()
    }
  }

  private async writeWithRetry(brief: ChatWritingBrief, plan: ChatPlan): Promise<ChatWriting> {
    const { writer, log } = this.deps
    let previousProblems: string[] | undefined
    let lastReason: TripWriterFailure = 'invalid'
    for (let attempt = 1; attempt <= MAX_CHAT_WRITER_ATTEMPTS; attempt++) {
      await this.countWriterCall()
      const outcome = await writer.write(previousProblems ? { brief, previousProblems } : { brief })
      if (outcome.kind === 'rejected') {
        lastReason = outcome.reason
        previousProblems = [outcome.reason]
        log.warn('chat.writer.invalid', { attempt, reasons: previousProblems })
        continue
      }
      const problems = validateChatWriting(outcome.writing, plan)
      if (problems.length === 0) return outcome.writing
      lastReason = 'invalid'
      previousProblems = [...new Set(problems.map((p) => `${p.code}@${p.path}`))]
      log.warn('chat.writer.invalid', { attempt, reasons: previousProblems })
    }
    throw new ChatWriterError(lastReason)
  }

  /** 呼び出しの前に当日の通し番号を進める（plan-trip と同じ数え上げ）。上限を超えていれば呼ばない */
  private async countWriterCall(): Promise<void> {
    const { trips, clock, log, dailyWriterCallLimit } = this.deps
    const callNumber = await trips.countWriterCall(jstDayStartMs(clock.nowMs()))
    try {
      ensureWithinDailyLimit(callNumber, dailyWriterCallLimit)
    } catch (error) {
      log.warn('chat.daily_limit', { callNumber, dailyWriterCallLimit })
      throw error
    }
  }
}

/**
 * 計画（いつ・誰が・何の話題・どの楽しみ）と Claude の一言を合わせる。pleasure は残し（写真を出す。drive-tourism T6）、
 * 材料だけの欄（timing・angle・light）は落とす。pleasure は計画から取り、Claude の出力からは取らない（AUTH-T1）
 */
function assemble(plan: ChatPlan, writing: ChatWriting): ChatDeck {
  return {
    tripId: plan.tripId,
    day: plan.day,
    lines: plan.lines.map((line, i) => {
      const text = writing.lines[i]?.text
      if (!text) throw new Error('検証を通った一言が行と合いません')
      return {
        id: line.id,
        cue: line.cue,
        topic: line.topic,
        speaker: line.speaker,
        pleasure: line.pleasure,
        text,
      }
    }),
    data: { routes: plan.data.routes, zones: plan.data.zones },
  }
}

/** 応答は欄を明示して組み立てる（保存した行の鍵のハッシュ・作成時刻を返さない。SAVE-2c） */
function toDeck(deck: ChatDeck): ChatDeck {
  return {
    tripId: deck.tripId,
    day: deck.day,
    lines: deck.lines.map((l) => ({
      id: l.id,
      cue: { kind: 'road', leg: l.cue.leg, km: l.cue.km },
      topic: l.topic,
      speaker: l.speaker,
      // v1 の束（pleasure の欄が無い）は鍵の版（chat:v2）が違うので、ここには来ない（FAIL-T1）
      pleasure: l.pleasure,
      text: { ja: l.text.ja, en: l.text.en, zh: l.text.zh, ko: l.text.ko },
    })),
    data: { routes: deck.data.routes, zones: deck.data.zones },
  }
}
