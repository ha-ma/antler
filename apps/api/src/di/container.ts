import Anthropic from '@anthropic-ai/sdk'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Hono } from 'hono'
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
import { DrizzleTripRepository } from '../infrastructure/repositories/drizzle-trip.repository.js'
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
    log: logger,
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
  })
  return { env, logger, app, connection }
}
