import type { ResultSet } from '@libsql/client'
import { and, asc, count, eq, inArray, min } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { TripEventRepository } from '../../application/ports/repositories/trip-event.repository.js'
import type { TripEventRecord } from '../../domain/stop-events/models/trip-event.js'
import * as schema from '../db/schema.js'

// TripEventRepository の Drizzle（libsql）実装（docs/specs/stop-events/functional.md R10、resilience.md）。
// 新しい行は 1 つの INSERT … ON CONFLICT DO NOTHING で入れる（SQLite の 1 文は原子的。半端に残らない）。

type Db = BaseSQLiteDatabase<'async', ResultSet, typeof schema>
type Row = typeof schema.tripEvents.$inferSelect

const { tripEvents } = schema

function toRecord(row: Row): TripEventRecord {
  return {
    tripId: row.tripId,
    runId: row.runId,
    seq: row.seq,
    day: row.day,
    kind: row.kind,
    at: row.at,
    alertEnabled: row.alertEnabled,
    leg: row.leg ?? null,
    km: row.km ?? null,
    data: row.data,
    receivedAtMs: row.receivedAt,
  }
}

export class DrizzleTripEventRepository implements TripEventRepository {
  constructor(private readonly db: Db) {}

  async findBySeqs(
    tripId: string,
    runId: string,
    seqs: readonly number[],
  ): Promise<TripEventRecord[]> {
    if (seqs.length === 0) return []
    const rows = await this.db
      .select()
      .from(tripEvents)
      .where(
        and(
          eq(tripEvents.tripId, tripId),
          eq(tripEvents.runId, runId),
          inArray(tripEvents.seq, [...seqs]),
        ),
      )
    return rows.map(toRecord)
  }

  async countByTrip(tripId: string): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(tripEvents)
      .where(eq(tripEvents.tripId, tripId))
    return rows[0]?.n ?? 0
  }

  async insertMany(records: readonly TripEventRecord[]): Promise<void> {
    if (records.length === 0) return
    await this.db
      .insert(tripEvents)
      .values(
        records.map((r) => ({
          tripId: r.tripId,
          runId: r.runId,
          seq: r.seq,
          day: r.day,
          kind: r.kind,
          at: r.at,
          alertEnabled: r.alertEnabled,
          leg: r.leg,
          km: r.km,
          data: r.data,
          receivedAt: r.receivedAtMs,
        })),
      )
      .onConflictDoNothing()
  }

  async listByTrip(tripId: string): Promise<TripEventRecord[]> {
    // run の最初の受信時刻で run を並べ、run の中は seq の順
    const firsts = this.db
      .select({ runId: tripEvents.runId, firstAt: min(tripEvents.receivedAt).as('first_at') })
      .from(tripEvents)
      .where(eq(tripEvents.tripId, tripId))
      .groupBy(tripEvents.runId)
      .as('firsts')
    const rows = await this.db
      .select({ event: tripEvents })
      .from(tripEvents)
      .innerJoin(firsts, eq(firsts.runId, tripEvents.runId))
      .where(eq(tripEvents.tripId, tripId))
      .orderBy(asc(firsts.firstAt), asc(tripEvents.runId), asc(tripEvents.seq))
    return rows.map((r) => toRecord(r.event))
  }
}
