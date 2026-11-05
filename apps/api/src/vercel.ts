import type { Hono } from 'hono'
import { buildContainer } from './di/container.js'
import type { PlatformFactory } from './di/platform.js'
import { vercelPlatform } from './di/vercel-platform.js'
import { loadVercelEnv, withVercelDefaults } from './infrastructure/config/vercel-env.js'
import { unavailableResponse } from './infrastructure/http/unavailable.js'
import { createLogger, type Logger } from './infrastructure/logging/logger.js'

// Vercel の関数の入口（docs/specs/deploy-a/functional.md R3）。apps/sim/api/index.mjs が bundle を再輸出する。
// - Hono アプリは最初の要求で 1 回だけ組み立てる（同時の最初の要求でも 1 回）
// - 組み立ての失敗（env・古い版の DB）は 503 UNAVAILABLE。理由は応答に出さずログに出す。覚えずに次の要求でやり直す
// - 表は作らない（npm run db:migrate で先に作る）

export type VercelHandlerOptions = {
  source?: Record<string, string | undefined>
  platform?: PlatformFactory
  /** 組み立ての失敗を書くログ（env を読む前なので LOG_LEVEL に関係なく info） */
  logger?: Logger
}

export type FetchHandler = (request: Request) => Promise<Response>

export function createVercelHandler({
  source = process.env,
  platform = vercelPlatform(),
  logger = createLogger('info', { base: { service: 'api', runtime: 'vercel' } }),
}: VercelHandlerOptions = {}): FetchHandler {
  let ready: Promise<Hono> | undefined

  const boot = (): Promise<Hono> => {
    if (ready) return ready
    const attempt = buildContainer(withVercelDefaults(source), {
      loadEnv: loadVercelEnv,
      platform,
    }).then((container) => container.app)
    ready = attempt
    // 失敗した組み立ては覚えない（後から始まった別の組み立てを消さない）
    attempt.catch(() => {
      if (ready === attempt) ready = undefined
    })
    return attempt
  }

  return async (request) => {
    let app: Hono
    try {
      app = await boot()
    } catch (error) {
      // 名前とメッセージだけ（EnvError のメッセージは変数の名前だけで、値を含まない）
      const fields =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) }
      logger.error('vercel.boot_failed', { error: fields })
      return unavailableResponse()
    }
    return app.fetch(request)
  }
}

// bundle の受け入れ試験（tests/vercel/bundle.test.ts）が DB を差し替えて組み立てるための口
export { vercelPlatform }

const handler = createVercelHandler()

export default { fetch: handler }
