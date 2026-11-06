import Anthropic from '@anthropic-ai/sdk'
import type { Hono } from 'hono'
import { SubmitCaptureUseCase } from '../application/usecases/captures/submit-capture.usecase.js'
import { PrepareChatUseCase } from '../application/usecases/chats/prepare-chat.usecase.js'
import { DeleteTripUseCase } from '../application/usecases/record/delete-trip.usecase.js'
import { GetTripRecordUseCase } from '../application/usecases/record/get-trip-record.usecase.js'
import { SaveRunUseCase } from '../application/usecases/record/save-run.usecase.js'
import { GetTripDayUseCase } from '../application/usecases/trip-day/get-trip-day.usecase.js'
import { WriteLossUseCase } from '../application/usecases/losses/write-loss.usecase.js'
import { PrepareStopDeckUseCase } from '../application/usecases/stop-events/prepare-stop-deck.usecase.js'
import { RecordTripEventsUseCase } from '../application/usecases/stop-events/record-trip-events.usecase.js'
import { CreateTripUseCase } from '../application/usecases/trips/create-trip.usecase.js'
import { loadEnv, type Env } from '../infrastructure/config/env.js'
import type { Connection } from '../infrastructure/db/connection.js'
import { DrizzleUnitOfWork } from '../infrastructure/db/drizzle-unit-of-work.js'
import { ClaudeChatWriterGateway } from '../infrastructure/gateways/claude-chat-writer.gateway.js'
import { ClaudeLossWriterGateway } from '../infrastructure/gateways/claude-loss-writer.gateway.js'
import { ClaudeSceneWriterGateway } from '../infrastructure/gateways/claude-scene-writer.gateway.js'
import { ClaudeTripWriterGateway } from '../infrastructure/gateways/claude-trip-writer.gateway.js'
import { FileRoadCatalogGateway } from '../infrastructure/gateways/file-road-catalog.gateway.js'
import { createApp } from '../infrastructure/http/app.js'
import { clientIpKey } from '../infrastructure/http/middleware/client-ip.js'
import { createLogger, type Logger } from '../infrastructure/logging/logger.js'
import { DrizzleChatRepository } from '../infrastructure/repositories/drizzle-chat.repository.js'
import { DrizzleStopDeckRepository } from '../infrastructure/repositories/drizzle-stop-deck.repository.js'
import { DrizzleTripEventRepository } from '../infrastructure/repositories/drizzle-trip-event.repository.js'
import { OgImageRenderer } from '../infrastructure/http/views/og-image-renderer.js'
import { DrizzleLossRepository } from '../infrastructure/repositories/drizzle-loss.repository.js'
import { DrizzleRecordRepository } from '../infrastructure/repositories/drizzle-record.repository.js'
import { DrizzleTripRepository } from '../infrastructure/repositories/drizzle-trip.repository.js'
import { NodeSha256BytesHasher } from '../infrastructure/security/node-bytes-hasher.js'
import {
  HmacSha256TokenSigner,
  NodeRandomSource,
  NodeSha256Hasher,
} from '../infrastructure/security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../infrastructure/system/in-process-concurrency-limiter.js'
import { SystemClock } from '../infrastructure/system/system-clock.js'
import type { PlatformFactory } from './platform.js'

// Composition Root。全層を組み立てる唯一の場所。
// 動く場所ごとに違う部品（DB の接続・Capture の保存先・IP の取り方・レート制限の数え先）は Platform で受ける
// （docs/specs/deploy-a/functional.md R3）。既定はローカル（起動時に SQLite の表を作る。MIGR-1）。
// ローカルの部品はネイティブの libsql を読むので、動的 import の先に置く（Vercel の関数の bundle が実行時に読まない）。
// Claude のフェイクはテストの差し込みだけで、ここでは使わない（threat.md）。

export type Container = { env: Env; logger: Logger; app: Hono; connection: Connection }

export type BuildContainerOptions = {
  /** env の読み方（Vercel は loadVercelEnv）。既定は loadEnv */
  loadEnv?: (source: Record<string, string | undefined>) => Env
  /** 動く場所ごとの部品。既定はローカル */
  platform?: PlatformFactory
}

async function defaultPlatform(): Promise<PlatformFactory> {
  const { createLocalPlatform } = await import('./local-platform.js')
  return createLocalPlatform
}

export async function buildContainer(
  source: Record<string, string | undefined>,
  options: BuildContainerOptions = {},
): Promise<Container> {
  const env = (options.loadEnv ?? loadEnv)(source)
  const logger = createLogger(env.LOG_LEVEL, { base: { service: 'api' } })

  const platform = await (options.platform ?? (await defaultPlatform()))(env, logger)
  const { connection } = platform
  const trips = new DrizzleTripRepository(connection.db)
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 })
  // Claude の同時呼び出しの枠は plan-trip・stop-events・loss・drive-audio-chat で 1 つを共有する（別にすると上限が増える。loss R8）。
  // 1 日の上限も trip_writer_calls で共有
  const writerSlots = new InProcessConcurrencyLimiter(env.CLAUDE_MAX_CONCURRENT_CALLS)

  const createTrip = new CreateTripUseCase({
    trips,
    uow: new DrizzleUnitOfWork(connection.db),
    writer: new ClaudeTripWriterGateway(anthropic.messages, logger),
    writerSlots,
    random: new NodeRandomSource(),
    hasher: new NodeSha256Hasher(),
    ownerTokens: new HmacSha256TokenSigner(env.OWNER_TOKEN_SECRET),
    clock: new SystemClock(),
    log: logger,
    dailyWriterCallLimit: env.CLAUDE_DAILY_CALL_LIMIT,
  })

  // 読み出し（brief-map）は同梱データだけで計算し、外部へ通信しない
  const roadCatalog = new FileRoadCatalogGateway()
  const getTripDay = new GetTripDayUseCase({
    trips,
    data: roadCatalog,
    clock: new SystemClock(),
    log: logger,
  })

  // stop-events（A-4 の束とイベントログ）。書き込みは ownerToken を求める（threat.md）
  const decks = new DrizzleStopDeckRepository(connection.db)
  const prepareStopDeck = new PrepareStopDeckUseCase({
    trips,
    decks,
    data: roadCatalog,
    writer: new ClaudeSceneWriterGateway(anthropic.messages, logger),
    writerSlots,
    hasher: new NodeSha256Hasher(),
    clock: new SystemClock(),
    log: logger,
    dailyWriterCallLimit: env.CLAUDE_DAILY_CALL_LIMIT,
  })
  const recordTripEvents = new RecordTripEventsUseCase({
    trips,
    decks,
    events: new DrizzleTripEventRepository(connection.db),
    hasher: new NodeSha256Hasher(),
    clock: new SystemClock(),
    log: logger,
  })

  // 喪失文（loss）。1 日の上限は TripRepository.countWriterCall で plan-trip と同じ数え上げ
  const writeLoss = new WriteLossUseCase({
    trips,
    losses: new DrizzleLossRepository(connection.db),
    writer: new ClaudeLossWriterGateway(anthropic.messages, logger),
    writerSlots,
    hasher: new NodeSha256Hasher(),
    clock: new SystemClock(),
    log: logger,
    dailyWriterCallLimit: env.CLAUDE_DAILY_CALL_LIMIT,
  })

  // 車内の会話の束（drive-audio-chat）。ownerToken を求める。同時の枠と 1 日の上限は plan-trip と共有
  const prepareChat = new PrepareChatUseCase({
    trips,
    chats: new DrizzleChatRepository(connection.db),
    data: roadCatalog,
    writer: new ClaudeChatWriterGateway(anthropic.messages, logger),
    writerSlots,
    hasher: new NodeSha256Hasher(),
    clock: new SystemClock(),
    log: logger,
    dailyWriterCallLimit: env.CLAUDE_DAILY_CALL_LIMIT,
  })

  // 旅の記録（record）。書き込みと削除は所有者トークンを照合する。OG 画像はプロセスの中で描く
  const publicUrls = [env.PUBLIC_API_URL, env.SIM_PUBLIC_URL, env.PWA_PUBLIC_URL]
  if (
    env.NODE_ENV === 'production' &&
    publicUrls.some((u) => /\/\/(localhost|127\.0\.0\.1)/.test(u))
  ) {
    // 共有する記録の URL・OG 画像が localhost を指す（SNS のカードが出ない）。起動は止めない
    logger.warn('record.public_url_is_localhost', { urls: publicUrls })
  }
  const uow = new DrizzleUnitOfWork(connection.db)
  const hasher = new NodeSha256Hasher()
  const records = {
    saveRun: new SaveRunUseCase({ uow, hasher, clock: new SystemClock(), log: logger }),
    deleteTrip: new DeleteTripUseCase({ uow, hasher, log: logger }),
    getRecord: new GetTripRecordUseCase({
      trips,
      records: new DrizzleRecordRepository(connection.db),
      log: logger,
    }),
    ogImages: new OgImageRenderer({ fontFiles: env.OG_FONT_FILES }),
    urls: { api: env.PUBLIC_API_URL, sim: env.SIM_PUBLIC_URL, pwa: env.PWA_PUBLIC_URL },
  }

  // POST /api/captures（edge-capture）。保存先は Platform（ローカルはファイル、Vercel は Turso と Blob）
  const submitCapture = new SubmitCaptureUseCase({
    captures: platform.captures,
    hasher: new NodeSha256Hasher(),
    bytesHasher: new NodeSha256BytesHasher(),
    clock: new SystemClock(),
    maxItems: env.CAPTURES_MAX_ITEMS,
    maxBytes: env.CAPTURES_MAX_BYTES,
  })

  const rateLimitKey = clientIpKey({
    trustProxy: platform.trustProxy ?? env.TRUST_PROXY,
    remoteAddress: platform.remoteAddress,
  })

  const app = createApp({
    logger,
    corsOrigins: env.CORS_ORIGINS,
    readinessChecks: platform.readinessChecks,
    ...(platform.rateLimitCounter ? { rateLimitCounter: platform.rateLimitCounter } : {}),
    // 例外のメッセージ（detail）を応答に出すのは development だけ（test・production・未設定では出さない）
    exposeErrorDetails: env.NODE_ENV === 'development',
    trips: { createTrip, rateLimitKey },
    tripDays: { getTripDay, rateLimitKey },
    losses: { writeLoss, rateLimitKey },
    stopDecks: { prepareStopDeck, rateLimitKey },
    tripEvents: { recordTripEvents, rateLimitKey },
    chats: { prepareChat, rateLimitKey },
    records: { ...records, rateLimitKey },
    captures: { submitCapture, rateLimitKey, log: logger },
  })
  return { env, logger, app, connection }
}
