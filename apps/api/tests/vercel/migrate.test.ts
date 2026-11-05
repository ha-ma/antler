import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describeTarget,
  loadEnvFileArg,
  main,
  runMigration,
} from '../../src/infrastructure/commands/migrate-db.js'
import { EnvError } from '../../src/infrastructure/config/env.js'
import { openDatabase } from '../../src/infrastructure/db/connection.js'
import {
  checkSchema,
  ensureSchema,
  readSchemaVersion,
  SCHEMA_VERSION,
  SchemaOutdatedError,
} from '../../src/infrastructure/db/migrate.js'
import {
  fetchWithTimeout,
  openRemoteDatabase,
} from '../../src/infrastructure/db/remote-connection.js'
import { createLogger } from '../../src/infrastructure/logging/logger.js'

// deploy-a R5・R6（docs/specs/deploy-a/functional.md の UC-3）

describe('マイグレーション（deploy-a R6）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'antler-migrate-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const tables = async (url: string) => {
    const conn = openDatabase(url)
    const rows = await conn.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    conn.client.close()
    return rows.rows.map((r) => r['name'])
  }

  it('MIG-3b: 新しい表と版ができ、2 回流しても壊れない。版は下がらない', async () => {
    const conn = openDatabase(`file:${join(dir, 'a.db')}`)
    await ensureSchema(conn.client)
    await ensureSchema(conn.client)
    expect(await readSchemaVersion(conn.client)).toBe(SCHEMA_VERSION)
    // 未来の版が入っていても下げない
    await conn.client.execute('UPDATE schema_meta SET version = 99 WHERE id = 1')
    await ensureSchema(conn.client)
    expect(await readSchemaVersion(conn.client)).toBe(99)
    conn.client.close()
    const names = await tables(`file:${join(dir, 'a.db')}`)
    for (const t of ['rate_limit_hits', 'captures', 'schema_meta']) expect(names).toContain(t)
  })

  it('MIG-3c: 空の DB・古い版は SchemaOutdatedError。ensureSchema のあとは通る', async () => {
    const conn = openDatabase(`file:${join(dir, 'b.db')}`)
    await expect(checkSchema(conn.client)).rejects.toBeInstanceOf(SchemaOutdatedError)
    await ensureSchema(conn.client)
    await expect(checkSchema(conn.client)).resolves.toBeUndefined()
    await conn.client.execute('UPDATE schema_meta SET version = 1 WHERE id = 1')
    await expect(checkSchema(conn.client)).rejects.toThrow(/版が古い/)
    conn.client.close()
  })

  it('MIG-3f: 版の表が無い今までの DB（trips に行がある）を版 2 にしても、既存の行は消えない', async () => {
    const url = `file:${join(dir, 'old.db')}`
    const conn = openDatabase(url)
    await conn.client.execute(
      'CREATE TABLE trips (id TEXT PRIMARY KEY NOT NULL, plan TEXT NOT NULL, details TEXT NOT NULL, owner_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL)',
    )
    await conn.client.execute("INSERT INTO trips VALUES ('AbCdEfGh', '{}', '{}', 'hash', 1)")
    expect(await readSchemaVersion(conn.client)).toBeNull()
    await ensureSchema(conn.client)
    expect(await readSchemaVersion(conn.client)).toBe(SCHEMA_VERSION)
    const rows = await conn.client.execute('SELECT id FROM trips')
    expect(rows.rows.map((r) => r['id'])).toEqual(['AbCdEfGh'])
    conn.client.close()
  })

  it('MIG-3d: runMigration は file の URL で表を作って版を返す。出力にトークンが出ない', async () => {
    const url = `file:${join(dir, 'c.db')}`
    await expect(runMigration({ TRIPS_DB_URL: url })).resolves.toEqual({
      version: SCHEMA_VERSION,
      target: 'file',
    })
    expect(await tables(url)).toContain('schema_meta')

    // Turso の URL でトークンが無い → EnvError（名前だけ）
    const noToken = runMigration({ TRIPS_DB_URL: 'libsql://antler-prod.turso.io' })
    await expect(noToken).rejects.toBeInstanceOf(EnvError)
    await expect(noToken).rejects.toThrow(/TURSO_AUTH_TOKEN/)
    expect(describeTarget('libsql://antler-prod.turso.io?authToken=secret-value')).toBe(
      'libsql://antler-prod.turso.io',
    )

    // main は失敗を終了コード 1 にし、ログにトークンの値を出さない
    const lines: string[] = []
    const logger = createLogger('info', { sink: (l) => lines.push(l) })
    const code = await main(
      [],
      { TRIPS_DB_URL: 'libsql://127.0.0.1:1', TURSO_AUTH_TOKEN: 'super-secret-token' },
      logger,
    )
    expect(code).toBe(1)
    expect(lines.join('\n')).not.toContain('super-secret-token')
    const ok = await main([], { TRIPS_DB_URL: `file:${join(dir, 'd.db')}` }, logger)
    expect(ok).toBe(0)
    expect(lines.at(-1)).toContain('"event":"db.migrated"')
  })

  it('MIG-3d: --env-file のファイルを読む。パスが無ければ EnvError', () => {
    const path = join(dir, '.env.turso-test')
    writeFileSync(path, 'X=1\nTRIPS_DB_URL=file:./x.db\n')
    expect(loadEnvFileArg(['--env-file', path])).toEqual({ X: '1', TRIPS_DB_URL: 'file:./x.db' })
    expect(loadEnvFileArg([])).toEqual({})
    expect(() => {
      loadEnvFileArg(['--env-file'])
    }).toThrow(EnvError)
  })

  it('MIG-3d: --env-file の値は、シェルにすでにある同じ名前の値より優先する（別の DB に流さない）', async () => {
    const wanted = join(dir, 'wanted.db')
    const other = join(dir, 'other.db')
    const path = join(dir, '.env.turso-wanted')
    writeFileSync(path, `TRIPS_DB_URL=file:${wanted}\n`)
    const logger = createLogger('info', { sink: () => undefined })
    expect(await main(['--env-file', path], { TRIPS_DB_URL: `file:${other}` }, logger)).toBe(0)
    expect(await tables(`file:${wanted}`)).toContain('schema_meta')
    expect(await tables(`file:${other}`)).toEqual([])
  })
})

describe('Turso の接続（deploy-a R5）', () => {
  it('DB-3a: libsql:// を HTTP のクライアントで開く。file: は拒む', () => {
    const conn = openRemoteDatabase({ url: 'libsql://antler.turso.io', authToken: 't' })
    expect(conn.client.protocol).toBe('http')
    conn.client.close()
    expect(() => openRemoteDatabase({ url: 'file:./x.db', authToken: 't' })).toThrow(/libsql/)
  })

  it('DB-3a: クライアントの fetch は時間切れで止まる（答えない fetch）', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    const timed = fetchWithTimeout(hanging, 20)
    await expect(timed('https://example.invalid')).rejects.toThrow('aborted')

    // 呼び出し側の signal でも止まる
    const ctrl = new AbortController()
    const pending = fetchWithTimeout(hanging, 10_000)('https://example.invalid', {
      signal: ctrl.signal,
    })
    ctrl.abort()
    await expect(pending).rejects.toThrow('aborted')

    // 時間切れの fetch を渡した Turso のクライアントは、答えない DB で例外になる
    const conn = openRemoteDatabase({
      url: 'https://antler.turso.io',
      authToken: 't',
      timeoutMs: 20,
      fetch: hanging,
    })
    await expect(conn.client.execute('SELECT 1')).rejects.toThrow()
    conn.client.close()
  })
})
