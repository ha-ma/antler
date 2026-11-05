import type { Context } from 'hono'
import { EnvError } from '../infrastructure/config/env.js'
import type { Connection } from '../infrastructure/db/connection.js'
import { checkSchema } from '../infrastructure/db/migrate.js'
import { openRemoteDatabase } from '../infrastructure/db/remote-connection.js'
import { vercelClientIp } from '../infrastructure/http/middleware/vercel-client-ip.js'
import type { Logger } from '../infrastructure/logging/logger.js'
import { BlobCaptureRepository } from '../infrastructure/repositories/blob-capture.repository.js'
import {
  VercelBlobImageStore,
  type CaptureImageStore,
} from '../infrastructure/repositories/vercel-blob-image-store.js'
import {
  deriveRateLimitSecret,
  LibsqlRateLimitCounter,
} from '../infrastructure/system/rate-limit-counter.js'
import type { PlatformFactory } from './platform.js'

// Vercel の関数の部品（docs/specs/deploy-a/functional.md R3・R5・R7〜R9）。
// - DB: Turso に HTTP でつなぐ（ネイティブの libsql を読まない）。表は作らず、版だけを確かめる（古ければ組み立ての失敗）
// - レート制限: Turso の rate_limit_hits（鍵は HMAC）
// - Capture: 本文と数えは Turso、画像は Vercel Blob（非公開）
// - IP: Vercel のヘッダから（TRUST_PROXY は読まない）。取れなければ全員が 1 つの枠になるので warn（1 分に 1 回まで）
// DB と画像の置き場所はテストで差し替えられる（env の file: の抜け道は作らない）。

export type VercelPlatformOverrides = {
  connection?: Connection
  images?: CaptureImageStore
  nowMs?: () => number
}

const MISSING_IP_WARN_EVERY_MS = 60_000

function headerClientIp(logger: Logger, nowMs: () => number): (c: Context) => string | undefined {
  let nextWarnAt = 0
  return (c) => {
    const ip = vercelClientIp(c.req)
    if (ip === undefined && nowMs() >= nextWarnAt) {
      nextWarnAt = nowMs() + MISSING_IP_WARN_EVERY_MS
      logger.warn('client_ip.missing', { path: c.req.path })
    }
    return ip
  }
}

export function vercelPlatform(overrides: VercelPlatformOverrides = {}): PlatformFactory {
  return async (env, logger) => {
    let connection = overrides.connection
    if (!connection) {
      if (!env.TURSO_AUTH_TOKEN) throw new EnvError('環境変数が不正です: TURSO_AUTH_TOKEN が要る')
      connection = openRemoteDatabase({ url: env.TRIPS_DB_URL, authToken: env.TURSO_AUTH_TOKEN })
    }
    const { client } = connection
    try {
      // 古い版の DB に新しいコードが出たら、すべての要求を止める（spec-adversary W2）
      await checkSchema(client)
    } catch (error) {
      if (!overrides.connection) client.close()
      throw error
    }
    const nowMs = overrides.nowMs ?? Date.now
    return {
      connection,
      captures: new BlobCaptureRepository({
        db: connection.db,
        images: overrides.images ?? new VercelBlobImageStore(),
        nowMs,
      }),
      remoteAddress: headerClientIp(logger, nowMs),
      trustProxy: false,
      rateLimitCounter: new LibsqlRateLimitCounter({
        client,
        secret: deriveRateLimitSecret(env.OWNER_TOKEN_SECRET),
        log: logger,
      }),
      readinessChecks: [{ name: 'database', check: () => checkSchema(client) }],
    }
  }
}
