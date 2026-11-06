import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'vite'
import { openDatabase } from '../../src/infrastructure/db/connection.js'
import { ensureSchema } from '../../src/infrastructure/db/migrate.js'
import { VERCEL_SOURCE } from './harness.js'

// AC-1（docs/specs/deploy-a/functional.md R1・R3・R5）: vite.vercel.config.ts で作った bundle を、
// vitest の外の素の Node（ESM）で import して fetch を呼ぶ。Vercel の関数と同じ読み方で読めることを確かめる。
// 出力は apps/api の下に置く（外の依存 hono などを node_modules から解決するため）。試験のあとで消す。

const API_DIR = join(import.meta.dirname, '../..')
const MARKER = 'build-time-marker-secret-5f1c2e'

describe('Vercel の関数の bundle（deploy-a AC-1）', () => {
  const outDir = join(API_DIR, 'dist', `vercel-test-${String(process.pid)}`)

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it('AC-1: bundle を Node で import し、/health 200・/api/nope 404。@antler/* と拡張子なしの import が無く、ネイティブの libsql が実行の経路に無い。build の env が焼き込まれない', async () => {
    process.env['ANTLER_BUILD_MARKER'] = MARKER
    try {
      await build({
        configFile: join(API_DIR, 'vite.vercel.config.ts'),
        root: API_DIR,
        logLevel: 'silent',
        build: { outDir },
      })
    } finally {
      delete process.env['ANTLER_BUILD_MARKER']
    }

    const files = readdirSync(outDir).filter((f) => f.endsWith('.mjs'))
    const handler = readFileSync(join(outDir, 'handler.mjs'), 'utf8')
    const all = files.map((f) => readFileSync(join(outDir, f), 'utf8')).join('\n')
    // @antler/* は bundle の中（import 文に残らない）。相対 import はすべて拡張子つき
    expect(all).not.toMatch(/from\s+["']@antler\//)
    expect(all).not.toMatch(/from\s+["']\.{1,2}\/[^"']*(?<!\.mjs)["']/)
    // 入口はネイティブの libsql（@libsql/client の Node の入口・libsql）を静的に読まない。ローカルの部品は動的 import の先
    expect(handler).not.toMatch(/from\s+["']@libsql\/client["']/)
    expect(handler).not.toMatch(/from\s+["']libsql["']/)
    expect(handler).toMatch(/from\s+["']@libsql\/client\/http["']/)
    expect(handler).toMatch(/import\(["']\.\/local-platform-[^"']+\.mjs["']\)/)
    expect(handler).toMatch(/from\s+["']@resvg\/resvg-js["']/)
    // OG 画像のフォント（og-font）は handler.mjs と同じ場所に写され、handler がその相対 URL で読む（Vercel の追跡が辿る形）
    for (const name of ['NotoSansJP-Bold.otf', 'NotoSansTC-Bold.otf', 'NotoSansKR-Bold.otf']) {
      expect(statSync(join(outDir, name)).size).toBeGreaterThan(1_000_000)
      expect(handler).toContain(`new URL("./${name}", import.meta.url)`)
    }
    expect(statSync(join(outDir, 'OFL.txt')).size).toBeGreaterThan(1000)
    // build の env も、テストの秘密も焼き込まれていない
    expect(all).not.toContain(MARKER)
    expect(all).not.toContain(VERCEL_SOURCE['ANTHROPIC_API_KEY'])

    // 表を作った file の DB を用意し、素の Node の子で bundle を import して組み立てる
    mkdirSync(outDir, { recursive: true })
    const dbFile = join(outDir, 'smoke.db')
    const conn = openDatabase(`file:${dbFile}`)
    await ensureSchema(conn.client)
    conn.client.close()
    const child = join(outDir, 'smoke.mjs')
    writeFileSync(
      child,
      `import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import entry, { createVercelHandler, vercelPlatform } from './handler.mjs'
const client = createClient({ url: process.env.SMOKE_DB })
const connection = { client, db: drizzle(client) }
const images = { put: async () => {}, delete: async () => {} }
const handler = createVercelHandler({ source: process.env, platform: vercelPlatform({ connection, images }) })
const o = 'https://antler-git-feat-deploy-a.vercel.app'
const health = await handler(new Request(o + '/health'))
const nope = await handler(new Request(o + '/api/nope'))
const real = await entry.fetch(new Request(o + '/health'))
console.log(JSON.stringify({ health: health.status, nope: nope.status, nopeBody: await nope.json(), entryType: typeof entry.fetch, real: real.status }))
client.close()
`,
    )
    const out = execFileSync(process.execPath, [child], {
      cwd: outDir,
      env: {
        ...VERCEL_SOURCE,
        // 外へ通信しない（閉じたポート。既定の入口の版の検査はすぐ失敗する）
        TRIPS_DB_URL: 'https://127.0.0.1:9',
        PATH: process.env['PATH'] ?? '',
        SMOKE_DB: `file:${dbFile}`,
      },
      encoding: 'utf8',
      timeout: 60_000,
    })
    const result = JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
    expect(result).toMatchObject({
      health: 200,
      nope: 404,
      nopeBody: { error: { code: 'NOT_FOUND' } },
      entryType: 'function',
    })
    // 既定の入口は本物の Turso（届かない）を見るので、版の検査で 503 になる（DB の差し替えなしでは組み立てない）
    expect(result['real']).toBe(503)
  }, 120_000)
})
