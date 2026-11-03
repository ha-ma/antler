import type { Context, MiddlewareHandler } from 'hono'

// 固定窓のレート制限（プロセス内メモリ）。ch6「A API はレート制限（記録作成 10/分/IP）」に使う。
// 複数インスタンスにするときは保存先を差し替える（今は 1 プロセス前提）。

export type RateLimitOptions = {
  limit: number
  windowMs: number
  key: (c: Context) => string
  now?: () => number
}

export function rateLimit({
  limit,
  windowMs,
  key,
  now = Date.now,
}: RateLimitOptions): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return async (c, next) => {
    const t = now()
    const k = key(c)
    let entry = hits.get(k)
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs }
      hits.set(k, entry)
    }
    entry.count += 1
    c.header('RateLimit-Limit', String(limit))
    c.header('RateLimit-Remaining', String(Math.max(0, limit - entry.count)))
    if (entry.count > limit) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - t) / 1000)))
      return c.json(
        { error: { code: 'RATE_LIMITED', message: 'しばらくしてからもう一度試してください' } },
        429,
      )
    }
    await next()
    return undefined
  }
}
