import type { Context } from 'hono'
import type { CaptureRepository } from '../application/ports/repositories/capture.repository.js'
import type { Env } from '../infrastructure/config/env.js'
import type { Connection } from '../infrastructure/db/connection.js'
import type { ReadinessCheck } from '../infrastructure/http/routes/health.routes.js'
import type { Logger } from '../infrastructure/logging/logger.js'
import type { RateLimitCounter } from '../infrastructure/system/rate-limit-counter.js'

// 動く場所ごとに違う部品（docs/specs/deploy-a/functional.md R3・R5・R7〜R9）。
// container.ts は残りを組み立てる。ローカル（Node・file の SQLite）は local-platform.ts、Vercel は vercel-platform.ts。

export type Platform = {
  connection: Connection
  captures: CaptureRepository
  /** 利用者の IP（取れなければ undefined） */
  remoteAddress: (c: Context) => string | undefined
  /** X-Forwarded-For の右端を信じるか。無ければ env の TRUST_PROXY */
  trustProxy?: boolean
  /** レート制限の数え先。無ければプロセスのメモリ */
  rateLimitCounter?: RateLimitCounter
  readinessChecks: ReadinessCheck[]
}

export type PlatformFactory = (env: Env, logger: Logger) => Promise<Platform>
