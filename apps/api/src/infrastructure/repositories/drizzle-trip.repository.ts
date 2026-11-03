import type { ResultSet } from '@libsql/client'
import { and, count, eq, gte } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type {
  StoredTrip,
  TripRepository,
} from '../../application/ports/repositories/trip.repository.js'
import { TripIdCollisionError } from '../../domain/trips/errors/trip-errors.js'
import type { TripRequest, TripRequestStatus } from '../../domain/trips/models/trip-request.js'
import * as schema from '../db/schema.js'

// TripRepository の Drizzle（libsql）実装。トランザクションの確定は DrizzleUnitOfWork が持つ。
// 衝突は例外の文言ではなく、ON CONFLICT DO NOTHING の件数で見分ける。

type Db = BaseSQLiteDatabase<'async', ResultSet, typeof schema>

const { trips, tripRequests } = schema

export class DrizzleTripRepository implements TripRepository {
  constructor(private readonly db: Db) {}

  async insertPendingRequest(row: {
    keyHash: string
    bodyHash: string
    nowMs: number
  }): Promise<boolean> {
    const result = await this.db
      .insert(tripRequests)
      .values({
        keyHash: row.keyHash,
        bodyHash: row.bodyHash,
        status: 'pending',
        tripId: null,
        createdAt: row.nowMs,
        updatedAt: row.nowMs,
      })
      .onConflictDoNothing()
    return result.rowsAffected === 1
  }

  async findRequest(keyHash: string): Promise<TripRequest | null> {
    const rows = await this.db
      .select()
      .from(tripRequests)
      .where(eq(tripRequests.keyHash, keyHash))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      keyHash: row.keyHash,
      bodyHash: row.bodyHash,
      status: row.status,
      tripId: row.tripId,
      createdAtMs: row.createdAt,
      updatedAtMs: row.updatedAt,
    }
  }

  async reclaimRequest(
    keyHash: string,
    expected: { status: TripRequestStatus; updatedAtMs: number },
    next: { bodyHash: string; nowMs: number },
  ): Promise<boolean> {
    const result = await this.db
      .update(tripRequests)
      .set({
        bodyHash: next.bodyHash,
        status: 'pending',
        tripId: null,
        createdAt: next.nowMs,
        updatedAt: next.nowMs,
      })
      .where(
        and(
          eq(tripRequests.keyHash, keyHash),
          eq(tripRequests.status, expected.status),
          eq(tripRequests.updatedAt, expected.updatedAtMs),
        ),
      )
    return result.rowsAffected === 1
  }

  async markRequestFailed(keyHash: string, nowMs: number): Promise<void> {
    await this.db
      .update(tripRequests)
      .set({ status: 'failed', tripId: null, updatedAt: nowMs })
      .where(and(eq(tripRequests.keyHash, keyHash), eq(tripRequests.status, 'pending')))
  }

  async markRequestDone(keyHash: string, tripId: string, nowMs: number): Promise<void> {
    await this.db
      .update(tripRequests)
      .set({ status: 'done', tripId, updatedAt: nowMs })
      .where(eq(tripRequests.keyHash, keyHash))
  }

  async insertTrip(trip: StoredTrip): Promise<void> {
    const result = await this.db
      .insert(trips)
      .values({
        id: trip.plan.id,
        plan: trip.plan,
        details: trip.details,
        ownerTokenHash: trip.ownerTokenHash,
        createdAt: trip.createdAtMs,
      })
      .onConflictDoNothing()
    if (result.rowsAffected === 0) throw new TripIdCollisionError()
  }

  async findTrip(id: string): Promise<StoredTrip | null> {
    const rows = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      plan: row.plan,
      details: row.details,
      ownerTokenHash: row.ownerTokenHash,
      createdAtMs: row.createdAt,
    }
  }

  async countTripsCreatedSince(sinceMs: number): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(trips)
      .where(gte(trips.createdAt, sinceMs))
    return rows[0]?.n ?? 0
  }
}
