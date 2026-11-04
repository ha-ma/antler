import { resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Hono } from 'hono'
import { SubmitCaptureUseCase } from '../application/usecases/captures/submit-capture.usecase.js'
import { DeleteTripUseCase } from '../application/usecases/record/delete-trip.usecase.js'
import { GetTripRecordUseCase } from '../application/usecases/record/get-trip-record.usecase.js'
import { SaveRunUseCase } from '../application/usecases/record/save-run.usecase.js'
import { GetTripDayUseCase } from '../application/usecases/trip-day/get-trip-day.usecase.js'
import { CreateTripUseCase } from '../application/usecases/trips/create-trip.usecase.js'
import { loadEnv, type Env } from '../infrastructure/config/env.js'
import { openDatabase, type Connection } from '../infrastructure/db/connection.js'
import { DrizzleUnitOfWork } from '../infrastructure/db/drizzle-unit-of-work.js'
import { ensureSchema } from '../infrastructure/db/migrate.js'
import { ClaudeTripWriterGateway } from '../infrastructure/gateways/claude-trip-writer.gateway.js'
import { FileRoadCatalogGateway } from '../infrastructure/gateways/file-road-catalog.gateway.js'
import { createApp } from '../infrastructure/http/app.js'
import { clientIpKey } from '../infrastructure/http/middleware/client-ip.js'
import { createLogger, type Logger } from '../infrastructure/logging/logger.js'
import { OgImageRenderer } from '../infrastructure/http/views/og-image-renderer.js'
import { DrizzleRecordRepository } from '../infrastructure/repositories/drizzle-record.repository.js'
import { DrizzleTripRepository } from '../infrastructure/repositories/drizzle-trip.repository.js'
import { FileCaptureRepository } from '../infrastructure/repositories/file-capture.repository.js'
import { NodeSha256BytesHasher } from '../infrastructure/security/node-bytes-hasher.js'
import {
  HmacSha256TokenSigner,
  NodeRandomSource,
  NodeSha256Hasher,
} from '../infrastructure/security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../infrastructure/system/in-process-concurrency-limiter.js'
import { SystemClock } from '../infrastructure/system/system-clock.js'

// Composition Root。全層を組み立てる唯一の場所。
// 起動時に SQLite の表を作る（MIGR-1）。Claude のフェイクはテストの差し込みだけで、ここでは使わない（threat.md）。

export type Container = { env: Env; logger: Logger; app: Hono; connection: Connection }

export async function buildContainer(
  source: Record<string, string | undefined>,
): Promise<Container> {
  const env = loadEnv(source)
  const logger = createLogger(env.LOG_LEVEL, { base: { service: 'api' } })

  const connection = openDatabase(env.TRIPS_DB_URL)
  await ensureSchema(connection.client)
  const trips = new DrizzleTripRepository(connection.db)
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 })

  const createTrip = new CreateTripUseCase({
    trips,
    uow: new DrizzleUnitOfWork(connection.db),
    writer: new ClaudeTripWriterGateway(anthropic.messages, logger),
    writerSlots: new InProcessConcurrencyLimiter(env.CLAUDE_MAX_CONCURRENT_CALLS),
    random: new NodeRandomSource(),
    hasher: new NodeSha256Hasher(),
    ownerTokens: new HmacSha256TokenSigner(env.OWNER_TOKEN_SECRET),
    clock: new SystemClock(),
    log: logger,
    dailyWriterCallLimit: env.CLAUDE_DAILY_CALL_LIMIT,
  })

  // 読み出し（brief-map）は同梱データだけで計算し、外部へ通信しない
  const getTripDay = new GetTripDayUseCase({
    trips,
    data: new FileRoadCatalogGateway(),
    clock: new SystemClock(),
    log: logger,
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

  // POST /api/captures（edge-capture）。ファイル保存（CAPTURES_DIR を 0700 で作り、件数と画像の合計を数える）
  const submitCapture = new SubmitCaptureUseCase({
    captures: new FileCaptureRepository(resolve(env.CAPTURES_DIR)),
    hasher: new NodeSha256Hasher(),
    bytesHasher: new NodeSha256BytesHasher(),
    clock: new SystemClock(),
    maxItems: env.CAPTURES_MAX_ITEMS,
    maxBytes: env.CAPTURES_MAX_BYTES,
  })

  const rateLimitKey = clientIpKey({
    trustProxy: env.TRUST_PROXY,
    remoteAddress: (c) => {
      try {
        return getConnInfo(c).remote.address
      } catch {
        // Node のソケットが無い（app.request のテストなど）
        return undefined
      }
    },
  })

  const app = createApp({
    logger,
    corsOrigins: env.CORS_ORIGINS,
    readinessChecks: [
      {
        name: 'sqlite',
        check: async () => {
          await connection.client.execute('SELECT 1')
        },
      },
    ],
    // 例外のメッセージ（detail）を応答に出すのは development だけ（test・production・未設定では出さない）
    exposeErrorDetails: env.NODE_ENV === 'development',
    trips: { createTrip, rateLimitKey },
    tripDays: { getTripDay, rateLimitKey },
    records: { ...records, rateLimitKey },
    captures: { submitCapture, rateLimitKey, log: logger },
  })
  return { env, logger, app, connection }
}
