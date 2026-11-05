import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { EnvError, isRemoteDbUrl } from '../config/env.js'
import { openDatabase, type Connection } from '../db/connection.js'
import { ensureSchema, readSchemaVersion } from '../db/migrate.js'
import { openRemoteDatabase } from '../db/remote-connection.js'
import { createLogger, serializeError, type Logger } from '../logging/logger.js'

// 表を作るコマンド（docs/specs/deploy-a/functional.md R6）。デプロイの前に 1 回、手元から流す。
//   npm run db:migrate -w @antler/api -- --env-file .env.turso-production
// 読むのは TRIPS_DB_URL と TURSO_AUTH_TOKEN だけ。トークンの値はどこにも出さない（出すのは DB のホスト名と版）。
// 何度流しても壊れない（CREATE TABLE IF NOT EXISTS・版は下げない）。

const migrationEnvSchema = z
  .object({
    TRIPS_DB_URL: z.string().min(1, 'TRIPS_DB_URL（libsql://… か file:…）を書く'),
    TURSO_AUTH_TOKEN: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (isRemoteDbUrl(env.TRIPS_DB_URL) && !env.TURSO_AUTH_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURSO_AUTH_TOKEN'],
        message: 'Turso の URL には TURSO_AUTH_TOKEN が要る',
      })
    }
  })

export type MigrationResult = {
  /** 流したあとの表の版 */
  version: number
  /** 流した先（ホスト名か file）。トークン・パスの中身は含めない */
  target: string
}

/** ログに出してよい流した先（libsql://host か file） */
export function describeTarget(url: string): string {
  if (!isRemoteDbUrl(url)) return 'file'
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return 'remote'
  }
}

export async function runMigration(
  source: Record<string, string | undefined>,
): Promise<MigrationResult> {
  const parsed = migrationEnvSchema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new EnvError(`環境変数が不正です: ${problems}`)
  }
  const { TRIPS_DB_URL: url, TURSO_AUTH_TOKEN: authToken } = parsed.data
  const connection: Connection =
    isRemoteDbUrl(url) && authToken ? openRemoteDatabase({ url, authToken }) : openDatabase(url)
  try {
    await ensureSchema(connection.client)
    const version = await readSchemaVersion(connection.client)
    return { version: version ?? 0, target: describeTarget(url) }
  } finally {
    connection.client.close()
  }
}

/** 引数の `--env-file <path>` を読む（Node の process.loadEnvFile。値は出さない） */
export function loadEnvFileArg(
  argv: readonly string[],
  load: (path: string) => void = (path) => {
    process.loadEnvFile(path)
  },
): void {
  const at = argv.indexOf('--env-file')
  if (at === -1) return
  const path = argv[at + 1]
  if (!path) throw new EnvError('--env-file のあとにファイルのパスを書く')
  load(path)
}

export async function main(
  argv: readonly string[],
  source: Record<string, string | undefined>,
  logger: Logger,
): Promise<number> {
  try {
    loadEnvFileArg(argv)
    const result = await runMigration(source)
    logger.info('db.migrated', { ...result })
    return 0
  } catch (error) {
    logger.error('db.migrate_failed', { error: serializeError(error) })
    return 1
  }
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const logger = createLogger('info', { base: { service: 'api', command: 'db:migrate' } })
  process.exitCode = await main(process.argv.slice(2), process.env, logger)
}
