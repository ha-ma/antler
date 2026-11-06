import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vercelPlatform } from '../../src/di/vercel-platform.js'
import type { Connection } from '../../src/infrastructure/db/connection.js'
import { ensureSchema, SCHEMA_VERSION } from '../../src/infrastructure/db/migrate.js'
import { createLogger } from '../../src/infrastructure/logging/logger.js'
import { createVercelHandler } from '../../src/vercel.js'
import { buildCapture, buildForm } from '../factories/captures.js'
import { FakeImageGateway, openTestDb, VERCEL_SOURCE } from './harness.js'

// deploy-a R1〜R4・R7〜R9 の受け入れ（docs/specs/deploy-a/functional.md の UC-1〜UC-4）。
// DB と画像の置き場所は vercelPlatform の差し込み口から渡す（env の file: の抜け道は作らない）。

const ORIGIN = 'https://antler-git-feat-deploy-a.vercel.app'

describe('Vercel の関数の入口（deploy-a R3）', () => {
  let dir: string
  let lines: string[]
  const connections: Connection[] = []
  const logger = () => createLogger('info', { sink: (l) => lines.push(l) })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'antler-vercel-'))
    lines = []
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    // 数えの窓は時計の分にそろうので、分の境目をまたがない時刻に止める（code-reviewer W8）
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T10:00:05.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    for (const c of connections.splice(0)) c.client.close()
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  const db = async (name: string, migrate = true) => {
    const conn = await openTestDb(dir, name, migrate)
    connections.push(conn)
    return conn
  }

  const handlerWith = (
    connection: Connection,
    images = new FakeImageGateway(),
    source: Record<string, string | undefined> = VERCEL_SOURCE,
  ) =>
    createVercelHandler({
      source,
      platform: vercelPlatform({ connection, images }),
      logger: logger(),
    })

  const req = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}${path}`, init)

  it('VH-1a・AUTH-5: 組み立ての失敗は 503 UNAVAILABLE。応答に env の名前・メッセージが無く、ログにある。次の要求でやり直す', async () => {
    const conn = await db('a.db')
    const source: Record<string, string | undefined> = {
      ...VERCEL_SOURCE,
      TURSO_AUTH_TOKEN: undefined,
    }
    const handler = handlerWith(conn, new FakeImageGateway(), source)
    const res = await handler(req('/health'))
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'UNAVAILABLE' } })
    expect(body).not.toContain('TURSO_AUTH_TOKEN')
    expect(body).not.toContain('環境変数')
    expect(
      lines.some((l) => l.includes('vercel.boot_failed') && l.includes('TURSO_AUTH_TOKEN')),
    ).toBe(true)
    expect(lines.join('\n')).not.toContain('test-owner-token-secret')
    // env を直したら次の要求で組み立て直す
    source['TURSO_AUTH_TOKEN'] = 'test-turso-token'
    expect((await handler(req('/health'))).status).toBe(200)
  })

  it('VH-1b: 同時の最初の要求 2 つでも組み立ては 1 回', async () => {
    const conn = await db('b.db')
    let builds = 0
    const inner = vercelPlatform({ connection: conn, images: new FakeImageGateway() })
    const handler = createVercelHandler({
      source: VERCEL_SOURCE,
      platform: (env, log) => {
        builds += 1
        return inner(env, log)
      },
      logger: logger(),
    })
    const [a, b] = await Promise.all([handler(req('/health')), handler(req('/health'))])
    expect([a.status, b.status]).toEqual([200, 200])
    await handler(req('/health'))
    expect(builds).toBe(1)
  })

  it('VH-1c・VH-1d・AC-4: 空の DB・古い版は全部 503（表を作らない）。マイグレーションのあとは次の要求から 200', async () => {
    const conn = await db('empty.db', false)
    const handler = handlerWith(conn)
    expect((await handler(req('/health'))).status).toBe(503)
    expect(lines.some((l) => l.includes('SchemaOutdatedError'))).toBe(true)
    const tables = await conn.client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    expect(tables.rows).toHaveLength(0)

    await ensureSchema(conn.client)
    await conn.client.execute('UPDATE schema_meta SET version = 1 WHERE id = 1')
    expect((await handler(req('/api/trips', { method: 'POST' }))).status).toBe(503)

    await ensureSchema(conn.client)
    await conn.client.execute({
      sql: 'UPDATE schema_meta SET version = ? WHERE id = 1',
      args: [SCHEMA_VERSION],
    })
    expect((await handler(req('/health'))).status).toBe(200)
    expect((await handler(req('/health/ready'))).status).toBe(200)
    // 成功した組み立てのあとは版を見に行かない（版を下げても /health は 200 のまま）
    await conn.client.execute('UPDATE schema_meta SET version = 1 WHERE id = 1')
    expect((await handler(req('/health'))).status).toBe(200)
  })

  it('AC-2・AUTH-1・IP-5b: 2 つのインスタンスが同じ DB で数える。偽の x-forwarded-for で枠は増えない。表に IP が無い', async () => {
    const conn = await db('shared.db')
    const first = handlerWith(conn)
    const second = handlerWith(conn)
    const post = (h: typeof first, ip: string, spoof: string) =>
      h(
        req('/api/trips', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-vercel-forwarded-for': ip,
            // TRUST_PROXY に関係なく、利用者が書ける x-forwarded-for は使わない
            'x-forwarded-for': spoof,
          },
          body: '{}',
        }),
      )
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await post(i % 2 === 0 ? first : second, '203.0.113.7', `10.0.0.${String(i)}`)).status,
      )
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true)
    expect(statuses[10]).toBe(429)
    expect((await post(first, '198.51.100.20', '10.0.0.1')).status).not.toBe(429)
    const all = JSON.stringify((await conn.client.execute('SELECT * FROM rate_limit_hits')).rows)
    expect(all).not.toContain('203.0.113.7')
    expect(all).not.toContain('198.51.100.20')
  })

  it('AC-2・IP-5b: TRUST_PROXY=true でも Vercel のヘッダを先に読む', async () => {
    const conn = await db('trust.db')
    const handler = handlerWith(conn, new FakeImageGateway(), {
      ...VERCEL_SOURCE,
      TRUST_PROXY: 'true',
    })
    const post = (spoof: string) =>
      handler(
        req('/api/trips', {
          method: 'POST',
          headers: { 'x-vercel-forwarded-for': '203.0.113.8', 'x-forwarded-for': spoof },
          body: '{}',
        }),
      )
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await post(`10.1.0.${String(i)}`)).status)
    expect(statuses[10]).toBe(429)
  })

  it('AC-3・AUTH-2: POST /api/captures → 201・行 1 つ・画像 1 つ。再送 200、違う本文 409。表に IP が無い', async () => {
    const conn = await db('cap.db')
    const images = new FakeImageGateway()
    const handler = handlerWith(conn, images)
    const post = (form: FormData) =>
      handler(
        req('/api/captures', {
          method: 'POST',
          headers: { 'x-vercel-forwarded-for': '203.0.113.9' },
          body: form,
        }),
      )
    const created = await post(buildForm())
    expect(created.status).toBe(201)
    const replay = await post(buildForm())
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true')
    const conflict = await post(buildForm({ capture: buildCapture({ distanceM: 7 }) }))
    expect(conflict.status).toBe(409)
    const rows = await conn.client.execute('SELECT * FROM captures')
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]?.['status']).toBe('done')
    expect(JSON.stringify(rows.rows)).not.toContain('203.0.113.9')
    const names = [...images.images.keys()]
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^captures\/images\/cap_0a1b2c3d4e5f-[0-9a-f]{64}\.jpg$/)
  })

  it('FAIL-2: Blob に置けない → 500（行なし）。再送で 201', async () => {
    const conn = await db('fail2.db')
    const images = new FakeImageGateway()
    images.failPut = true
    const handler = handlerWith(conn, images)
    const post = () => handler(req('/api/captures', { method: 'POST', body: buildForm() }))
    expect((await post()).status).toBe(500)
    expect((await conn.client.execute('SELECT * FROM captures')).rows).toHaveLength(0)
    images.failPut = false
    expect((await post()).status).toBe(201)
  })

  it('AUTH-3・AUTH-4: Capture の読み出し・一覧・削除、マイグレーションの HTTP の口が無い', async () => {
    const conn = await db('authz.db')
    const handler = handlerWith(conn)
    for (const [method, path] of [
      ['GET', '/api/captures'],
      ['GET', '/api/captures/cap_0a1b2c3d4e5f'],
      ['DELETE', '/api/captures/cap_0a1b2c3d4e5f'],
      ['POST', '/api/migrate'],
      ['POST', '/api/db/migrate'],
    ] as const) {
      expect((await handler(req(path, { method }))).status).toBe(404)
    }
  })

  it('AUTH-6・FAIL-1: Turso に届かない → /health/ready は 503 で検査の名前と unavailable だけ。レート制限は通す', async () => {
    const conn = await db('down.db')
    const handler = handlerWith(conn)
    expect((await handler(req('/health'))).status).toBe(200)
    // 組み立てのあとで DB を落とす（表を消して、数えも版の検査も失敗させる）
    await conn.client.execute('DROP TABLE rate_limit_hits')
    await conn.client.execute('DROP TABLE schema_meta')
    const ready = await handler(req('/health/ready'))
    expect(ready.status).toBe(503)
    expect(await ready.json()).toEqual({ status: 'error', details: { database: 'unavailable' } })
    // 数えられないあいだは、このインスタンスのメモリで数える（上限なしにしない）
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await handler(
        req('/api/trips', {
          method: 'POST',
          headers: { 'x-vercel-forwarded-for': '203.0.113.10' },
          body: '{}',
        }),
      )
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429 && s !== 503)).toBe(true)
    expect(statuses[10]).toBe(429)
    // 組み立てたアプリのログ（標準出力）に warn が出る
    const stdout = vi.mocked(process.stdout.write).mock.calls.map((c) => String(c[0]))
    expect(stdout.some((l) => l.includes('rate_limit.counter_unavailable'))).toBe(true)
    expect(stdout.join('')).not.toContain('203.0.113.10')
  })

  it('ENV-2a: 公開の URL は Vercel の値から作り、SSR の共有ページはそのオリジンを使う', async () => {
    const conn = await db('urls.db')
    const handler = handlerWith(conn)
    const res = await handler(req('/t/AbCdEfGh'))
    expect(res.status).toBe(404)
    expect(await res.text()).toContain(`${ORIGIN}/plan`)
  })
})

describe('Vercel のプロジェクトの設定（deploy-a R1・R2）', () => {
  const simDir = join(import.meta.dirname, '../../../sim')

  it('CFG-1d: vercel.json の形・関数・書き換えの順', () => {
    const config = JSON.parse(readFileSync(join(simDir, 'vercel.json'), 'utf8')) as {
      framework: string
      buildCommand: string
      outputDirectory: string
      regions: string[]
      functions: Record<string, { maxDuration: number }>
      rewrites: { source: string; destination: string; missing?: { type: string; key: string }[] }[]
    }
    expect(config.framework).toBe('vite')
    expect(config.buildCommand).toBe('npm run build:vercel')
    expect(config.outputDirectory).toBe('dist')
    expect(config.regions).toEqual(['hnd1'])
    expect(config.functions['api/index.mjs']?.maxDuration).toBe(60)
    expect(config.rewrites.map((r) => r.source)).toEqual([
      '/api/(.*)',
      '/health',
      '/health/ready',
      '/t/:id/og.png',
      '/t/:id',
      '/(.*)',
    ])
    expect(config.rewrites.slice(0, 5).every((r) => r.destination === '/api')).toBe(true)
    expect(config.rewrites[4]?.missing).toEqual([{ type: 'query', key: 'app' }])
    expect(config.rewrites[5]?.destination).toBe('/index.html')
  })

  it('CFG-1e: 関数の入口は bundle の再輸出だけ。sim に build:vercel と Node 22', () => {
    const entry = readFileSync(join(simDir, 'api/index.mjs'), 'utf8')
    const code = entry.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('//'))
    expect(code).toEqual(["export { default } from '../../api/dist/vercel/handler.mjs'"])
    const pkg = JSON.parse(readFileSync(join(simDir, 'package.json'), 'utf8')) as {
      engines: { node: string }
      scripts: Record<string, string>
    }
    expect(pkg.engines.node).toBe('22.x')
    expect(pkg.scripts['build:vercel']).toContain('build:vercel')
  })
})
