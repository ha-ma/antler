import type { CaptureImageGateway } from '../application/ports/gateways/capture-image.gateway.js'
import { EnvError } from '../infrastructure/config/env.js'
import type { Connection } from '../infrastructure/db/connection.js'
import { checkSchema } from '../infrastructure/db/migrate.js'
import { openRemoteDatabase } from '../infrastructure/db/remote-connection.js'
import { VercelBlobImageGateway } from '../infrastructure/gateways/vercel-blob-image.gateway.js'
import { vercelClientIp } from '../infrastructure/http/middleware/vercel-client-ip.js'
import { BlobCaptureRepository } from '../infrastructure/repositories/blob-capture.repository.js'
import {
  deriveRateLimitSecret,
  LibsqlRateLimitCounter,
} from '../infrastructure/system/rate-limit-counter.js'
import type { PlatformFactory } from './platform.js'

// Vercel の関数の部品（docs/specs/deploy-a/functional.md R3・R5・R7〜R9）。
// - DB: Turso に HTTP でつなぐ（ネイティブの libsql を読まない）。表は作らず、版だけを確かめる（古ければ組み立ての失敗）
// - レート制限: Turso の rate_limit_hits（鍵は HMAC）
// - Capture: 本文と数えは Turso、画像は Vercel Blob（非公開）
// - IP: Vercel のヘッダから（TRUST_PROXY は読まない）
// DB と画像の置き場所はテストで差し替えられる（env の file: の抜け道は作らない）。

export type VercelPlatformOverrides = {
  connection?: Connection
  images?: CaptureImageGateway
  nowMs?: () => number
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
        images: overrides.images ?? new VercelBlobImageGateway(),
        nowMs,
      }),
      remoteAddress: (c) => vercelClientIp(c.req),
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
