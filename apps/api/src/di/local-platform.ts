import { resolve } from 'node:path'
import { getConnInfo } from '@hono/node-server/conninfo'
import { isRemoteDbUrl } from '../infrastructure/config/env.js'
import { openDatabase } from '../infrastructure/db/connection.js'
import { ensureSchema } from '../infrastructure/db/migrate.js'
import { openRemoteDatabase } from '../infrastructure/db/remote-connection.js'
import { FileCaptureRepository } from '../infrastructure/repositories/file-capture.repository.js'
import type { PlatformFactory } from './platform.js'

// ローカル（Node の @hono/node-server・file の SQLite・Capture のファイル）の部品。
// 起動時に表を作る（MIGR-1。deploy-a でも変えない）。TRIPS_DB_URL が Turso なら HTTP でつなぐ（手元から Turso を見るとき）。

export const createLocalPlatform: PlatformFactory = async (env) => {
  const connection =
    isRemoteDbUrl(env.TRIPS_DB_URL) && env.TURSO_AUTH_TOKEN
      ? openRemoteDatabase({ url: env.TRIPS_DB_URL, authToken: env.TURSO_AUTH_TOKEN })
      : openDatabase(env.TRIPS_DB_URL)
  await ensureSchema(connection.client)
  return {
    connection,
    // ファイル保存（CAPTURES_DIR を 0700 で作り、件数と画像の合計を数える）
    captures: new FileCaptureRepository(resolve(env.CAPTURES_DIR)),
    remoteAddress: (c) => {
      try {
        return getConnInfo(c).remote.address
      } catch {
        // Node のソケットが無い（app.request のテストなど）
        return undefined
      }
    },
    readinessChecks: [
      {
        name: 'sqlite',
        check: async () => {
          await connection.client.execute('SELECT 1')
        },
      },
    ],
  }
}
