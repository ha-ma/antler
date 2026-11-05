import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import {
  provideRateLimitCounter,
  rateLimit,
} from '../../src/infrastructure/http/middleware/rate-limit.js'
import { createLogger } from '../../src/infrastructure/logging/logger.js'
import {
  deriveRateLimitSecret,
  LibsqlRateLimitCounter,
  rateLimitBucketKey,
  type RateLimitCounter,
  type RateLimitHit,
} from '../../src/infrastructure/system/rate-limit-counter.js'
import { openTestDb } from './harness.js'

// deploy-a R7（docs/specs/deploy-a/functional.md の UC-4）。
// 変数名を app にしない（sfad-drift が `app.post(` を実在のルートとして数えるため）。

/** 呼ばれた回数を数え、メモリで数えるだけの差し込み */
class SpyCounter implements RateLimitCounter {
  calls: { scope: string; key: string }[] = []
  private readonly counts = new Map<string, number>()
  fail = false
  hit(scope: string, key: string, now: number, windowMs: number): Promise<RateLimitHit | null> {
    this.calls.push({ scope, key })
    if (this.fail) return Promise.resolve(null)
    const windowStart = Math.floor(now / windowMs) * windowMs
    const k = `${scope}|${key}|${String(windowStart)}`
    const count = (this.counts.get(k) ?? 0) + 1
    this.counts.set(k, count)
    return Promise.resolve({ count, resetAt: windowStart + windowMs })
  }
}

function serverWith(counter: RateLimitCounter | undefined, now: { t: number }) {
  const server = new Hono()
  if (counter) server.use(provideRateLimitCounter(counter))
  const key = (c: { req: { header(n: string): string | undefined } }) =>
    c.req.header('x-test-ip') ?? 'unknown'
  const shared = rateLimit({
    name: 'test.shared',
    limit: 3,
    windowMs: 60_000,
    key,
    now: () => now.t,
  })
  const other = rateLimit({ name: 'test.other', limit: 3, windowMs: 60_000, key, now: () => now.t })
  server.get('/a', shared, (c) => c.text('a'))
  server.get('/b', shared, (c) => c.text('b'))
  server.get('/c', other, (c) => c.text('c'))
  return server
}

const get = (server: Hono, path: string, ip = '1.1.1.1') =>
  server.request(path, { headers: { 'x-test-ip': ip } })

describe('rateLimit の差し込みの数え（deploy-a R7）', () => {
  it('RL-4a: 差さなければメモリで数える（今までどおり）', async () => {
    const server = serverWith(undefined, { t: 0 })
    for (let i = 0; i < 3; i++) expect((await get(server, '/a')).status).toBe(200)
    expect((await get(server, '/a')).status).toBe(429)
  })

  it('RL-4b: 差した数えで数え、上限を超えたら 429 と Retry-After（窓の終わりまで）', async () => {
    const counter = new SpyCounter()
    const now = { t: 15_000 }
    const server = serverWith(counter, now)
    const first = await get(server, '/a')
    expect(first.status).toBe(200)
    expect(first.headers.get('RateLimit-Remaining')).toBe('2')
    await get(server, '/a')
    await get(server, '/a')
    const blocked = await get(server, '/a')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('45')
    expect(counter.calls).toHaveLength(4)
  })

  it('RL-4c: scope は名前。同じ rateLimit の 2 つの route は分け合い、別の名前は別に数える', async () => {
    const counter = new SpyCounter()
    const server = serverWith(counter, { t: 0 })
    await get(server, '/a')
    await get(server, '/b')
    await get(server, '/a')
    expect((await get(server, '/b')).status).toBe(429)
    expect((await get(server, '/c')).status).toBe(200)
    expect(new Set(counter.calls.map((c) => c.scope))).toEqual(
      new Set(['test.shared', 'test.other']),
    )
  })

  it('RL-4c: route のファイルの名前はすべて違う', () => {
    const dir = join(import.meta.dirname, '../../src/infrastructure/http/routes')
    const names: string[] = []
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.routes.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8')
      for (const m of text.matchAll(/name: ['"]([^'"]+)['"]/g)) names.push(m[1] ?? '')
      for (const m of text.matchAll(/limit\(['"]([^'"]+)['"]/g)) names.push(m[1] ?? '')
      // name を渡さない rateLimit が無い（型でも必須）
      expect(text.match(/rateLimit\(\{/g)?.length ?? 0).toBe(
        text.match(/rateLimit\(\{\s*name[,:]/g)?.length ?? 0,
      )
    }
    expect(names.length).toBeGreaterThanOrEqual(9)
    expect(new Set(names).size).toBe(names.length)
  })

  it('RL-4d: 数えが null（Turso に届かない）なら、このインスタンスのメモリで数える（上限なしにしない）', async () => {
    const counter = new SpyCounter()
    counter.fail = true
    const server = serverWith(counter, { t: 0 })
    for (let i = 0; i < 3; i++) expect((await get(server, '/a')).status).toBe(200)
    expect((await get(server, '/a')).status).toBe(429)
    // 数えが戻れば、差し込みの数えに戻る
    counter.fail = false
    expect((await get(server, '/a', '9.9.9.9')).status).toBe(200)
    expect(counter.calls.at(-1)?.key).toBe('9.9.9.9')
  })

  it('RL-4i: 上限を超えた鍵は、窓の終わりまで数えを呼ばずに 429。窓が過ぎたらまた数える', async () => {
    const counter = new SpyCounter()
    const now = { t: 0 }
    const server = serverWith(counter, now)
    for (let i = 0; i < 4; i++) await get(server, '/a')
    expect(counter.calls).toHaveLength(4)
    now.t = 30_000
    const blocked = await get(server, '/a')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('30')
    expect(counter.calls).toHaveLength(4)
    // 別の IP は数える
    expect((await get(server, '/a', '2.2.2.2')).status).toBe(200)
    now.t = 60_000
    expect((await get(server, '/a')).status).toBe(200)
    expect(counter.calls).toHaveLength(6)
  })

  it('RL-4i: 上限を超えた鍵の記憶は 10,000 まで（古いものから忘れる）', async () => {
    const counter = new SpyCounter()
    const server = new Hono()
    server.use(provideRateLimitCounter(counter))
    server.get(
      '/x',
      rateLimit({
        name: 'test.keys',
        limit: 0,
        windowMs: 60_000,
        key: (c) => c.req.header('x-test-ip') ?? 'unknown',
        now: () => 0,
        maxKeys: 2,
      }),
      (c) => c.text('x'),
    )
    for (const ip of ['a', 'b', 'c']) await get(server, '/x', ip)
    expect(counter.calls).toHaveLength(3)
    // a は忘れられたので、もう一度数えに行く。c は覚えている
    await get(server, '/x', 'c')
    expect(counter.calls).toHaveLength(3)
    await get(server, '/x', 'a')
    expect(counter.calls).toHaveLength(4)
  })
})

describe('LibsqlRateLimitCounter（deploy-a R7）', () => {
  let dir: string
  const lines: string[] = []
  const log = createLogger('info', { sink: (l) => lines.push(l) })
  const secret = deriveRateLimitSecret('test-owner-token-secret-0123456789abcdef')
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'antler-ratelimit-'))
    lines.length = 0
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('RL-4e: 同じ窓で 1・2・3、次の窓で 1。別の鍵は別。resetAt は窓の終わり', async () => {
    const conn = await openTestDb(dir, 'rl.db')
    const counter = new LibsqlRateLimitCounter({ client: conn.client, secret, log })
    const hit = (key: string, t: number) => counter.hit('trips.create', key, t, 60_000)
    expect(await hit('1.1.1.1', 1_000)).toEqual({ count: 1, resetAt: 60_000 })
    expect(await hit('1.1.1.1', 2_000)).toEqual({ count: 2, resetAt: 60_000 })
    expect((await hit('1.1.1.1', 59_999))?.count).toBe(3)
    expect((await hit('2.2.2.2', 3_000))?.count).toBe(1)
    expect(await hit('1.1.1.1', 60_000)).toEqual({ count: 1, resetAt: 120_000 })
    expect((await counter.hit('record.reads', '1.1.1.1', 61_000, 60_000))?.count).toBe(1)
    conn.client.close()
  })

  it('RL-4e: DB のエラーで null。warn は 1 分に 1 回まで（鍵・IP を出さない）', async () => {
    const conn = await openTestDb(dir, 'rl-bad.db', false)
    const counter = new LibsqlRateLimitCounter({ client: conn.client, secret, log })
    expect(await counter.hit('trips.create', '9.9.9.9', 0, 60_000)).toBeNull()
    expect(await counter.hit('trips.create', '9.9.9.9', 1_000, 60_000)).toBeNull()
    const warns = lines.filter((l) => l.includes('rate_limit.counter_unavailable'))
    expect(warns).toHaveLength(1)
    expect(warns.join('')).not.toContain('9.9.9.9')
    conn.client.close()
  })

  it('RL-4h: 2 秒で答えない数えは null（通す）', async () => {
    const hanging = { execute: () => new Promise<never>(() => undefined) }
    const counter = new LibsqlRateLimitCounter({ client: hanging, secret, log, timeoutMs: 20 })
    expect(await counter.hit('trips.create', '1.1.1.1', 0, 60_000)).toBeNull()
  })

  it('RL-4f: 窓が過ぎた行を 1 分に 1 回まで消す', async () => {
    const conn = await openTestDb(dir, 'rl-sweep.db')
    const counter = new LibsqlRateLimitCounter({ client: conn.client, secret, log })
    await counter.hit('s', 'a', 0, 60_000)
    await counter.hit('s', 'b', 30_000, 60_000)
    const rows = async () =>
      Number(
        (await conn.client.execute('SELECT COUNT(*) AS n FROM rate_limit_hits')).rows[0]?.['n'],
      )
    expect(await rows()).toBe(2)
    // 30 秒後: まだ掃除の時刻ではない
    await counter.hit('s', 'c', 59_000, 60_000)
    expect(await rows()).toBe(3)
    // 1 分後: 窓（0〜60 秒）の行を消してから数える
    await counter.hit('s', 'd', 60_000, 60_000)
    expect(await rows()).toBe(1)
    conn.client.close()
  })

  it('RL-4g・AUTH-2: 鍵は HMAC。表に IP の文字列が無い', async () => {
    const conn = await openTestDb(dir, 'rl-hmac.db')
    const counter = new LibsqlRateLimitCounter({ client: conn.client, secret, log })
    await counter.hit('trips.create', '203.0.113.7', 0, 60_000)
    await counter.hit('trips.create', '2001:0db8:0001:0002::/64', 0, 60_000)
    const all = await conn.client.execute('SELECT * FROM rate_limit_hits')
    const text = JSON.stringify(all.rows)
    expect(text).not.toContain('203.0.113.7')
    expect(text).not.toContain('2001:0db8')
    expect(all.rows.map((r) => r['bucket'])).toEqual(
      expect.arrayContaining([rateLimitBucketKey(secret, 'trips.create', '203.0.113.7')]),
    )
    conn.client.close()
  })

  it('RL-4g・AUTH-7: 同じ IP・scope で同じ鍵、scope・秘密が違えば違う鍵。鍵は IP を含まない', () => {
    const a = rateLimitBucketKey(secret, 'trips.create', '203.0.113.7')
    expect(rateLimitBucketKey(secret, 'trips.create', '203.0.113.7')).toBe(a)
    expect(rateLimitBucketKey(secret, 'record.reads', '203.0.113.7')).not.toBe(a)
    const otherSecret = deriveRateLimitSecret('another-owner-token-secret-0123456789abcd')
    expect(rateLimitBucketKey(otherSecret, 'trips.create', '203.0.113.7')).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toContain('203')
    // 派生した秘密は元の秘密と違う
    expect(secret).not.toBe('test-owner-token-secret-0123456789abcdef')
  })
})
