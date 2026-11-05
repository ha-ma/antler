import type { ResultSet } from '@libsql/client'
import { and, eq } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type {
  StopDeckRepository,
  StopDeckRow,
  StopDeckStatus,
} from '../../application/ports/repositories/stop-deck.repository.js'
import type { StopDeck } from '../../domain/stop-events/models/stop-deck.js'
import type { StopWriting } from '../../domain/stop-events/models/stop-writing.js'
import * as schema from '../db/schema.js'

// StopDeckRepository の Drizzle（libsql）実装（docs/specs/stop-events/resilience.md）。
// 2 回目の要求は主キー（trip_id, day）の ON CONFLICT DO NOTHING の件数で見分ける。

type Db = BaseSQLiteDatabase<'async', ResultSet, typeof schema>

const { stopDecks } = schema

export class DrizzleStopDeckRepository implements StopDeckRepository {
  constructor(private readonly db: Db) {}

  async insertPending(row: { tripId: string; day: number; nowMs: number }): Promise<boolean> {
    const result = await this.db
      .insert(stopDecks)
      .values({
        tripId: row.tripId,
        day: row.day,
        status: 'pending',
        deck: null,
        writing: null,
        createdAt: row.nowMs,
        updatedAt: row.nowMs,
      })
      .onConflictDoNothing()
    return result.rowsAffected === 1
  }

  async find(tripId: string, day: number): Promise<StopDeckRow | null> {
    const rows = await this.db
      .select()
      .from(stopDecks)
      .where(and(eq(stopDecks.tripId, tripId), eq(stopDecks.day, day)))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      tripId: row.tripId,
      day: row.day,
      status: row.status,
      deck: row.deck ?? null,
      writing: row.writing ?? null,
      updatedAtMs: row.updatedAt,
    }
  }

  async reclaim(
    tripId: string,
    day: number,
    expected: { status: StopDeckStatus; updatedAtMs: number },
    nowMs: number,
  ): Promise<boolean> {
    const result = await this.db
      .update(stopDecks)
      .set({ status: 'pending', deck: null, writing: null, updatedAt: nowMs })
      .where(
        and(
          eq(stopDecks.tripId, tripId),
          eq(stopDecks.day, day),
          eq(stopDecks.status, expected.status),
          eq(stopDecks.updatedAt, expected.updatedAtMs),
        ),
      )
    return result.rowsAffected === 1
  }

  async markDone(row: {
    tripId: string
    day: number
    deck: StopDeck
    writing: StopWriting
    claimedAtMs: number
    nowMs: number
  }): Promise<boolean> {
    const result = await this.db
      .update(stopDecks)
      .set({ status: 'done', deck: row.deck, writing: row.writing, updatedAt: row.nowMs })
      .where(this.ownPending(row.tripId, row.day, row.claimedAtMs))
    return result.rowsAffected === 1
  }

  async markFailed(tripId: string, day: number, claimedAtMs: number, nowMs: number): Promise<void> {
    await this.db
      .update(stopDecks)
      .set({ status: 'failed', updatedAt: nowMs })
      .where(this.ownPending(tripId, day, claimedAtMs))
  }

  /** 自分が claimedAtMs に立てた pending の行 */
  private ownPending(tripId: string, day: number, claimedAtMs: number) {
    return and(
      eq(stopDecks.tripId, tripId),
      eq(stopDecks.day, day),
      eq(stopDecks.status, 'pending'),
      eq(stopDecks.updatedAt, claimedAtMs),
    )
  }
}
