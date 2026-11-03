import type { Context, MiddlewareHandler } from 'hono'

// 固定窓のレート制限（プロセス内メモリ）。ch6「A API はレート制限（記録作成 10/分/IP）」に使う。
// 複数インスタンスにするときは保存先を差し替える（今は 1 プロセス前提）。
// 鍵を増やされてもメモリが増え続けないように、窓が過ぎた項目を窓ごとに掃除し、項目の数にも上限を置く。

export type RateLimitOptions = {
  limit: number
  windowMs: number
  key: (c: Context) => string
  now?: () => number
  /** 覚えておく鍵の数の上限。超えたら古いものから忘れる */
  maxKeys?: number
}

export const DEFAULT_RATE_LIMIT_MAX_KEYS = 10_000

export type RateLimitStore = Map<string, { count: number; resetAt: number }>

export function rateLimit({
  limit,
  windowMs,
  key,
  now = Date.now,
  maxKeys = DEFAULT_RATE_LIMIT_MAX_KEYS,
  store,
}: RateLimitOptions & {
  /** 数えた中身（テストで覗くときだけ渡す） */
  store?: RateLimitStore
}): MiddlewareHandler {
  const hits: RateLimitStore = store ?? new Map<string, { count: number; resetAt: number }>()
  let nextSweepAt = 0

  const sweep = (t: number): void => {
    for (const [k, entry] of hits) {
      if (entry.resetAt <= t) hits.delete(k)
    }
    nextSweepAt = t + windowMs
  }

  return async (c, next) => {
    const t = now()
    if (t >= nextSweepAt) sweep(t)
    const k = key(c)
    let entry = hits.get(k)
    if (!entry || entry.resetAt <= t) {
      if (entry) hits.delete(k)
      // Map は入れた順を保つので、先頭がいちばん古い
      while (hits.size >= maxKeys) {
        const oldest = hits.keys().next()
        if (oldest.done) break
        hits.delete(oldest.value)
      }
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
