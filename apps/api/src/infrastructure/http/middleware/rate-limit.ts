import type { Context, MiddlewareHandler } from 'hono'
import type { RateLimitCounter } from '../../system/rate-limit-counter.js'

// 固定窓のレート制限。ch6「A API はレート制限（記録作成 10/分/IP）」に使う。
// 数え先は 2 つ（docs/specs/deploy-a/functional.md R7）:
// - 既定: プロセス内メモリ。鍵を増やされてもメモリが増え続けないように、窓が過ぎた項目を窓ごとに掃除し、項目の数にも上限を置く
// - 差し込み: アプリが要求ごとに Hono の変数 `rateLimitCounter` に置いた数え（Vercel では Turso）。
//   数えの単位（scope）は name。同じ rateLimit を 2 つの route で使えば 2 つで分け合う（メモリと同じ意味）。
//   上限を超えた鍵は窓の終わりまでメモリで覚え、数えを呼ばずに 429（Turso の書き込みを使わせない）。
//   数えられない（null。Turso に届かない）→ このインスタンスのメモリで数える（インスタンスごとの上限に落とす）。

declare module 'hono' {
  interface ContextVariableMap {
    rateLimitCounter: RateLimitCounter | undefined
  }
}

export type RateLimitOptions = {
  /** 数えの単位の名前（例: trips.create）。差し込みの数えで、インスタンスをまたいで同じ枠にする */
  name: string
  limit: number
  windowMs: number
  key: (c: Context) => string
  now?: () => number
  /** 覚えておく鍵の数の上限（メモリの数え・上限を超えた鍵の記憶）。超えたら古いものから忘れる */
  maxKeys?: number
}

export const DEFAULT_RATE_LIMIT_MAX_KEYS = 10_000

export type RateLimitStore = Map<string, { count: number; resetAt: number }>

/** アプリの全要求で、差し込みの数えを Hono の変数に置く（createApp が使う） */
export function provideRateLimitCounter(counter: RateLimitCounter): MiddlewareHandler {
  return async (c, next) => {
    c.set('rateLimitCounter', counter)
    await next()
  }
}

/** Map を「入れた順」の LRU として使い、上限を超えたら先頭（いちばん古い）から捨てる */
function evictOldest<V>(map: Map<string, V>, maxKeys: number): void {
  while (map.size >= maxKeys) {
    const oldest = map.keys().next()
    if (oldest.done) break
    map.delete(oldest.value)
  }
}

function tooMany(c: Context, limit: number, resetAt: number, t: number): Response {
  c.header('RateLimit-Limit', String(limit))
  c.header('RateLimit-Remaining', '0')
  c.header('Retry-After', String(Math.max(1, Math.ceil((resetAt - t) / 1000))))
  return c.json(
    { error: { code: 'RATE_LIMITED', message: 'しばらくしてからもう一度試してください' } },
    429,
  )
}

export function rateLimit({
  name,
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
  /** 差し込みの数えで上限を超えた鍵 → 窓の終わり */
  const blocked = new Map<string, number>()
  let nextSweepAt = 0

  const sweep = (t: number): void => {
    for (const [k, entry] of hits) {
      if (entry.resetAt <= t) hits.delete(k)
    }
    for (const [k, resetAt] of blocked) {
      if (resetAt <= t) blocked.delete(k)
    }
    nextSweepAt = t + windowMs
  }

  const inMemory = (k: string, t: number): { count: number; resetAt: number } => {
    let entry = hits.get(k)
    if (!entry || entry.resetAt <= t) {
      if (entry) hits.delete(k)
      evictOldest(hits, maxKeys)
      entry = { count: 0, resetAt: t + windowMs }
      hits.set(k, entry)
    }
    entry.count += 1
    return entry
  }

  return async (c, next) => {
    const t = now()
    if (t >= nextSweepAt) sweep(t)
    const k = key(c)
    const counter = c.get('rateLimitCounter')

    let entry: { count: number; resetAt: number } | null
    if (counter) {
      const until = blocked.get(k)
      if (until !== undefined && until > t) return tooMany(c, limit, until, t)
      entry = await counter.hit(name, k, t, windowMs)
      if (entry === null) {
        // 数えられない（Turso に届かない）→ このインスタンスのメモリで数える（上限なしにしない。security-auditor W2）。
        // warn は数えの側が出す
        entry = inMemory(k, t)
      } else if (entry.count > limit) {
        blocked.delete(k)
        evictOldest(blocked, maxKeys)
        blocked.set(k, entry.resetAt)
      }
    } else {
      entry = inMemory(k, t)
    }

    c.header('RateLimit-Limit', String(limit))
    c.header('RateLimit-Remaining', String(Math.max(0, limit - entry.count)))
    if (entry.count > limit) return tooMany(c, limit, entry.resetAt, t)
    await next()
    return undefined
  }
}
