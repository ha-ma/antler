import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PERSONA_INPUT, type DriveRunInput } from '@antler/trip'
import { DeleteTripUseCase } from '../../src/application/usecases/record/delete-trip.usecase.js'
import { GetTripRecordUseCase } from '../../src/application/usecases/record/get-trip-record.usecase.js'
import { SaveRunUseCase } from '../../src/application/usecases/record/save-run.usecase.js'
import { CreateTripUseCase } from '../../src/application/usecases/trips/create-trip.usecase.js'
import { openDatabase, type Connection } from '../../src/infrastructure/db/connection.js'
import { DrizzleUnitOfWork } from '../../src/infrastructure/db/drizzle-unit-of-work.js'
import { ensureSchema } from '../../src/infrastructure/db/migrate.js'
import { DrizzleRecordRepository } from '../../src/infrastructure/repositories/drizzle-record.repository.js'
import { DrizzleTripRepository } from '../../src/infrastructure/repositories/drizzle-trip.repository.js'
import {
  HmacSha256TokenSigner,
  NodeRandomSource,
  NodeSha256Hasher,
} from '../../src/infrastructure/security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../src/infrastructure/system/in-process-concurrency-limiter.js'
import { FixedClock, KEY_A, MemoryLog, ScriptedWriter } from './trips.js'

// record のテストの組み立て（一時ファイルの SQLite ＋ 本物の Drizzle の実装 ＋ Claude のフェイク）。
// docs/specs/record/ の UC-3・UC-4・UC-5・AUTH-*・FAIL-*。本番の DI では使わない。

export const T0 = Date.parse('2026-11-04T12:00:00+09:00')
export const SECRET = 'test-owner-token-secret-0123456789abcdef'

let counter = 0
/** 正しい run（runId は呼ぶたびに変わる） */
export function makeRun(patch: Partial<DriveRunInput> = {}): DriveRunInput {
  counter += 1
  return {
    runId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    day: 1,
    alertEnabled: true,
    outcome: 'completed',
    zonePasses: 1,
    encounters: [
      {
        pattern: 'roadside',
        at: '2027-02-15T16:31:00+09:00',
        alertToBrakeMs: 1200,
        closestM: 18,
        outcome: 'avoided',
      },
    ],
    frames: { fpsMedian: 60, fpsP5: 50, frames: 1200 },
    ...patch,
  }
}

export type RecordHarness = Awaited<ReturnType<typeof openRecordHarness>>

export async function openRecordHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'antler-api-record-'))
  const conn: Connection = openDatabase(`file:${join(dir, 'trips.db')}`)
  await ensureSchema(conn.client)
  const trips = new DrizzleTripRepository(conn.db)
  const records = new DrizzleRecordRepository(conn.db)
  const uow = new DrizzleUnitOfWork(conn.db)
  const hasher = new NodeSha256Hasher()
  const clock = new FixedClock(T0)
  const log = new MemoryLog()

  const createTrip = new CreateTripUseCase({
    trips,
    uow,
    writer: new ScriptedWriter(),
    writerSlots: new InProcessConcurrencyLimiter(4),
    random: new NodeRandomSource(),
    hasher,
    ownerTokens: new HmacSha256TokenSigner(SECRET),
    clock,
    log,
    dailyWriterCallLimit: 400,
  })
  const saveRun = new SaveRunUseCase({ uow, hasher, clock, log })
  const deleteTrip = new DeleteTripUseCase({ uow, hasher, log })
  const getRecord = new GetTripRecordUseCase({ trips, records, log })

  /** ペルソナの旅を作る（Claude はフェイク）。所有者トークンを返す */
  const newTrip = async (idempotencyKey: string = KEY_A) => {
    const out = await createTrip.execute({ idempotencyKey, trip: PERSONA_INPUT })
    return { id: out.plan.id, plan: out.plan, ownerToken: out.ownerToken }
  }

  /** `trip_id`（trips は `id`）の列を持つすべての表で、その旅の行の数（UC-5a） */
  const rowsOfTrip = async (tripId: string): Promise<Record<string, number>> => {
    const tables = await conn.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    const counts: Record<string, number> = {}
    const text = (v: unknown) => (typeof v === 'string' ? v : '')
    for (const row of tables.rows) {
      const name = text(row['name'])
      const columns = await conn.client.execute(`PRAGMA table_info(${name})`)
      const names = columns.rows.map((c) => text(c['name']))
      const column = names.includes('trip_id') ? 'trip_id' : name === 'trips' ? 'id' : null
      if (!column) continue
      const result = await conn.client.execute({
        sql: `SELECT COUNT(*) AS n FROM ${name} WHERE ${column} = ?`,
        args: [tripId],
      })
      counts[name] = Number(result.rows[0]?.['n'] ?? 0)
    }
    return counts
  }

  const close = () => {
    conn.client.close()
    rmSync(dir, { recursive: true, force: true })
  }

  return {
    conn,
    trips,
    records,
    uow,
    hasher,
    clock,
    log,
    createTrip,
    saveRun,
    deleteTrip,
    getRecord,
    newTrip,
    rowsOfTrip,
    close,
  }
}
