import type { Client } from '@libsql/client'

// 表の作成（MIGR-1）。空のデータファイルから作れて、2 回目でも壊れない。
// 戻す操作は表の削除だけ（データファイルを消せば初期状態）。
// ローカル（file:）とテストは起動時に流す。Vercel（Turso）はデプロイの前に 1 回、
// `npm run db:migrate`（commands/migrate-db.ts）で流し、関数は版だけを確かめる（deploy-a R6）。

/** 表の版。表を足す・変えるときに 1 つ上げる（2 = deploy-a: rate_limit_hits・captures・schema_meta） */
export const SCHEMA_VERSION = 2

/** DB の表の版が、このコードが要る版より古い（マイグレーションの前） */
export class SchemaOutdatedError extends Error {
  override name = 'SchemaOutdatedError'
  constructor(found: number | null) {
    super(
      `DB の表の版が古い（見つかった版: ${found === null ? 'なし' : String(found)}、要る版: ${String(SCHEMA_VERSION)}）。npm run db:migrate を流す`,
    )
  }
}

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
  // loss（A-6 の喪失文）
  `CREATE TABLE IF NOT EXISTS trip_losses (
    key_hash TEXT PRIMARY KEY NOT NULL,
    trip_id TEXT NOT NULL,
    collision TEXT NOT NULL,
    story TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS trip_losses_trip_id ON trip_losses (trip_id)`,
  // stop-events（docs/specs/stop-events/plan.md「マイグレーション統合」）
  `CREATE TABLE IF NOT EXISTS stop_decks (
    trip_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
    deck TEXT,
    writing TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (trip_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS trip_events (
    trip_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    day INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('choice', 'encounter', 'collision', 'avoidance')),
    at TEXT NOT NULL,
    alert_enabled INTEGER NOT NULL,
    leg INTEGER,
    km REAL,
    data TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (trip_id, run_id, seq)
  )`,
  `CREATE INDEX IF NOT EXISTS trip_events_trip ON trip_events (trip_id, received_at)`,
  // 走行の記録（record）
  `CREATE TABLE IF NOT EXISTS trip_runs (
    trip_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (trip_id, run_id)
  )`,
  `CREATE INDEX IF NOT EXISTS trip_runs_trip_seq ON trip_runs (trip_id, seq)`,
  // レート制限の数え（deploy-a R7）。bucket は HMAC（IP を置かない）。expires_at を過ぎた行は掃除で消す
  `CREATE TABLE IF NOT EXISTS rate_limit_hits (
    bucket TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (bucket, window_start)
  )`,
  `CREATE INDEX IF NOT EXISTS rate_limit_hits_expires ON rate_limit_hits (expires_at)`,
  // Vercel の Capture（deploy-a R9）。画像は Vercel Blob、本文と数えはここ。done の行が完成のしるし
  `CREATE TABLE IF NOT EXISTS captures (
    key TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
    capture TEXT NOT NULL,
    file TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    image_bytes INTEGER NOT NULL,
    received_at TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  // 表の版（1 行だけ）。下げない
  `CREATE TABLE IF NOT EXISTS schema_meta (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    version INTEGER NOT NULL
  )`,
  {
    sql: `INSERT INTO schema_meta (id, version) VALUES (1, ?)
      ON CONFLICT (id) DO UPDATE SET version = max(version, excluded.version)`,
    args: [SCHEMA_VERSION],
  },
]

/** 表を作り、版を SCHEMA_VERSION まで上げる（1 つのバッチ。途中で失敗したら全部戻る） */
export async function ensureSchema(client: Client): Promise<void> {
  await client.batch(STATEMENTS, 'write')
}

/** DB の表の版を読む。版の表が無ければ null */
export async function readSchemaVersion(client: Client): Promise<number | null> {
  const table = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
  )
  if (table.rows.length === 0) return null
  const row = (await client.execute('SELECT version FROM schema_meta WHERE id = 1')).rows[0]
  const version = row?.['version']
  return typeof version === 'number' || typeof version === 'bigint' ? Number(version) : null
}

/** 版が SCHEMA_VERSION より古い・版の表が無い → SchemaOutdatedError */
export async function checkSchema(client: Client): Promise<void> {
  const version = await readSchemaVersion(client)
  if (version === null || version < SCHEMA_VERSION) throw new SchemaOutdatedError(version)
}
