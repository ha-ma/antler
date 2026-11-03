import type { Client } from '@libsql/client'

// 起動時の表の作成（MIGR-1）。空のデータファイルから作れて、2 回目の起動でも壊れない。
// 戻す操作は表の削除だけ（データファイルを消せば初期状態）。

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY NOT NULL,
    plan TEXT NOT NULL,
    details TEXT NOT NULL,
    owner_token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS trips_created_at ON trips (created_at)`,
  `CREATE TABLE IF NOT EXISTS trip_requests (
    key_hash TEXT PRIMARY KEY NOT NULL,
    body_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
    trip_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trip_writer_calls (
    day_start INTEGER PRIMARY KEY NOT NULL,
    calls INTEGER NOT NULL
  )`,
]

export async function ensureSchema(client: Client): Promise<void> {
  await client.batch(STATEMENTS, 'write')
}
