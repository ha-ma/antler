import { z } from 'zod'
import { LOG_LEVELS } from '../logging/logger.js'

// 環境変数の読み込み。足りない・形が違うときは起動を止める（秘密情報にフォールバック値を持たせない）。
// 秘密情報を足すときは z.string().min(1) にして .default() を付けない。見本は .env.example。

const corsOrigins = z
  .string()
  .min(1, 'CORS_ORIGINS に許可するオリジンをカンマ区切りで書く')
  .transform((raw) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .refine((list) => !list.includes('*'), 'CORS_ORIGINS に * は使えない（オリジンを明示する）')
  .refine(
    (list) => list.every((o) => /^https?:\/\/[^/]+$/.test(o)),
    'CORS_ORIGINS はスキーム付きのオリジン（例: http://localhost:5173）だけを並べる',
  )

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  CORS_ORIGINS: corsOrigins,
  // POST /api/trips（docs/specs/plan-trip/functional.md R5・R9）
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY が無いと旅のしおりを仕上げられない'),
  // 所有者トークン（HMAC）の秘密。変えると発行済みのトークンが全部使えなくなる（R7）
  OWNER_TOKEN_SECRET: z.string().min(32, 'OWNER_TOKEN_SECRET は 32 文字以上の乱数にする'),
  TRIPS_DAILY_LIMIT: z.coerce.number().int().min(1).default(200),
  TRIPS_DB_URL: z.string().min(1).default('file:./data/trips.db'),
  // プロキシの X-Forwarded-For を信じるか。信じるときは右端（直前のプロキシが付けた値）を使う
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

export type Env = z.infer<typeof envSchema>

export class EnvError extends Error {
  override name = 'EnvError'
}

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new EnvError(`環境変数が不正です: ${problems}`)
  }
  return parsed.data
}
