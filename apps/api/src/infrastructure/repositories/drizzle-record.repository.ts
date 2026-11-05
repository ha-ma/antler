import type { ResultSet } from '@libsql/client'
import { DriveRunInputSchema, type DriveRunInput } from '@antler/trip'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type {
  RecordRepository,
  StoredRun,
} from '../../application/ports/repositories/record.repository.js'
import * as schema from '../db/schema.js'

// RecordRepository の Drizzle（libsql）実装。トランザクションの確定は DrizzleUnitOfWork が持つ。
// 保存した run の JSON は読むときに DriveRunInputSchema で確かめ、合わない行は数えるだけにする（FAIL-1）。

type Db = BaseSQLiteDatabase<'async', ResultSet, typeof schema>

const { trips, tripRuns, tripRequests, tripEvents, stopDecks } = schema

type RunRow = typeof tripRuns.$inferSelect

function toStored(row: RunRow): StoredRun | null {
  const parsed = DriveRunInputSchema.safeParse(row.payload)
  if (!parsed.success) return null
  return { run: parsed.data, seq: row.seq, createdAtMs: row.createdAt }
}

export class DrizzleRecordRepository implements RecordRepository {
  constructor(private readonly db: Db) {}

  async findRun(tripId: string, runId: string): Promise<StoredRun | null> {
    const rows = await this.db
      .select()
      .from(tripRuns)
      .where(and(eq(tripRuns.tripId, tripId), eq(tripRuns.runId, runId)))
      .limit(1)
    const row = rows[0]
    return row ? toStored(row) : null
  }

  async countRuns(tripId: string, day: number): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(tripRuns)
      .where(and(eq(tripRuns.tripId, tripId), eq(tripRuns.day, day)))
    return rows[0]?.n ?? 0
  }

  async insertRun(tripId: string, run: DriveRunInput, nowMs: number): Promise<StoredRun | null> {
    const seq = sql<number>`(SELECT COALESCE(MAX(${tripRuns.seq}), 0) + 1 FROM ${tripRuns} WHERE ${tripRuns.tripId} = ${tripId})`
    const rows = await this.db
      .insert(tripRuns)
      .values({ tripId, runId: run.runId, day: run.day, payload: run, createdAt: nowMs, seq })
      .onConflictDoNothing()
      .returning({ seq: tripRuns.seq })
    const inserted = rows[0]
    return inserted ? { run, seq: inserted.seq, createdAtMs: nowMs } : null
  }

  async listRuns(tripId: string): Promise<{ runs: StoredRun[]; invalid: number }> {
    const rows = await this.db
      .select()
      .from(tripRuns)
      .where(eq(tripRuns.tripId, tripId))
      .orderBy(asc(tripRuns.seq))
    const runs: StoredRun[] = []
    let invalid = 0
    for (const row of rows) {
      const stored = toStored(row)
      if (stored) runs.push(stored)
      else invalid += 1
    }
    return { runs, invalid }
  }

  async deleteTrip(tripId: string): Promise<number> {
    await this.db.delete(tripRuns).where(eq(tripRuns.tripId, tripId))
    // stop-events の出来事の束とイベントログ（docs/specs/stop-events/functional.md R10）
    await this.db.delete(tripEvents).where(eq(tripEvents.tripId, tripId))
    await this.db.delete(stopDecks).where(eq(stopDecks.tripId, tripId))
    await this.db.delete(tripRequests).where(eq(tripRequests.tripId, tripId))
    const result = await this.db.delete(trips).where(eq(trips.id, tripId))
    return result.rowsAffected
  }
}
