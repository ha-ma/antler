import { createHmac } from 'node:crypto'
import type { Client } from '@libsql/client'
import type { EventLog } from '../../application/ports/system/event-log.js'

// レート制限の数え先（docs/specs/deploy-a/functional.md R7）。
// rateLimit（http/middleware）が差し込みで使う。差さなければ rateLimit はプロセスのメモリで数える。
// Turso の実装は、インスタンスをまたいで 1 つの数えにする。
// - 固定の窓（floor(now / windowMs) * windowMs）ごとに 1 文で足す（INSERT … ON CONFLICT DO UPDATE … RETURNING）
// - 鍵は HMAC（scope + IP の枠）。IP を表に置かない（plan-trip の threat.md「IP は保存しない」）
// - 窓が過ぎた行は、インスタンスごとに 1 分に 1 回まで消す
// - 失敗・2 秒で答えない → null（呼ぶ側は通す。fail-open）

export type RateLimitHit = {
  /** この窓での回数（今回を含む） */
  count: number
  /** 窓の終わり（ミリ秒） */
  resetAt: number
}

export interface RateLimitCounter {
  /** scope（rateLimit の名前）と鍵（IP の枠）で 1 回数える。数えられなければ null */
  hit(scope: string, key: string, now: number, windowMs: number): Promise<RateLimitHit | null>
}

export const RATE_LIMIT_COUNTER_TIMEOUT_MS = 2_000
const SWEEP_EVERY_MS = 60_000
const WARN_EVERY_MS = 60_000

/** レート制限の鍵の HMAC の秘密を、OWNER_TOKEN_SECRET から派生する（同じ秘密を 2 つの用途にそのまま使わない） */
export function deriveRateLimitSecret(ownerTokenSecret: string): string {
  return createHmac('sha256', ownerTokenSecret).update('rate-limit', 'utf8').digest('hex')
}

/** 表に置く鍵。IP に戻せない（秘密が要る） */
export function rateLimitBucketKey(secret: string, scope: string, key: string): string {
  return createHmac('sha256', secret).update(`${scope}\n${key}`, 'utf8').digest('hex').slice(0, 32)
}

export type LibsqlRateLimitCounterOptions = {
  client: Pick<Client, 'execute'>
  /** deriveRateLimitSecret で作った秘密 */
  secret: string
  log: EventLog
  timeoutMs?: number
}

export class LibsqlRateLimitCounter implements RateLimitCounter {
  private nextSweepAt = 0
  private nextWarnAt = 0
  private readonly timeoutMs: number

  constructor(private readonly options: LibsqlRateLimitCounterOptions) {
    this.timeoutMs = options.timeoutMs ?? RATE_LIMIT_COUNTER_TIMEOUT_MS
  }

  async hit(
    scope: string,
    key: string,
    now: number,
    windowMs: number,
  ): Promise<RateLimitHit | null> {
    const windowStart = Math.floor(now / windowMs) * windowMs
    const resetAt = windowStart + windowMs
    const bucket = rateLimitBucketKey(this.options.secret, scope, key)
    try {
      const count = await this.withTimeout(this.count(bucket, windowStart, resetAt, now))
      return { count, resetAt }
    } catch (error) {
      this.warn(now, error)
      return null
    }
  }

  private async count(
    bucket: string,
    windowStart: number,
    resetAt: number,
    now: number,
  ): Promise<number> {
    if (now >= this.nextSweepAt) {
      this.nextSweepAt = now + SWEEP_EVERY_MS
      // 掃除の失敗は数えを止めない（次の分にまた試す）
      await this.options.client
        .execute({ sql: 'DELETE FROM rate_limit_hits WHERE expires_at <= ?', args: [now] })
        .catch((error: unknown) => {
          this.warn(now, error)
        })
    }
    const result = await this.options.client.execute({
      sql: `INSERT INTO rate_limit_hits (bucket, window_start, count, expires_at) VALUES (?, ?, 1, ?)
        ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
        RETURNING count`,
      args: [bucket, windowStart, resetAt],
    })
    const value = result.rows[0]?.['count']
    if (typeof value !== 'number' && typeof value !== 'bigint') {
      throw new Error('rate_limit_hits の count が読めない')
    }
    return Number(value)
  }

  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`rate limit counter timed out after ${String(this.timeoutMs)} ms`))
      }, this.timeoutMs)
    })
    return Promise.race([work, timeout]).finally(() => {
      clearTimeout(timer)
    })
  }

  private warn(now: number, error: unknown): void {
    if (now < this.nextWarnAt) return
    this.nextWarnAt = now + WARN_EVERY_MS
    // 例外の名前とメッセージだけ（鍵・IP は出さない）
    const fields =
      error instanceof Error ? { name: error.name, message: error.message } : { message: 'unknown' }
    this.options.log.warn('rate_limit.counter_unavailable', { error: fields })
  }
}
