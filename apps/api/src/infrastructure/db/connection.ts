import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from './schema.js'

// libsql（SQLite のファイル）への接続。データファイルは env の TRIPS_DB_URL（既定 file:./data/trips.db）。

export type Database = LibSQLDatabase<typeof schema>
export type Connection = { client: Client; db: Database }

export function openDatabase(url: string): Connection {
  if (url.startsWith('file:') && !url.startsWith('file::memory:')) {
    // 初回の起動でフォルダが無くても作れるように
    mkdirSync(dirname(url.slice('file:'.length)), { recursive: true })
  }
  const client = createClient({ url })
  return { client, db: drizzle(client, { schema }) }
}
