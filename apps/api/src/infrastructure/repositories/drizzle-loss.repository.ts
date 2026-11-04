import type { ResultSet } from '@libsql/client'
import { count, eq } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { LossRepository } from '../../application/ports/repositories/loss.repository.js'
import type { StoredLoss } from '../../domain/losses/models/loss.js'
import * as schema from '../db/schema.js'

// LossRepository の Drizzle（libsql）実装（docs/specs/loss/resilience.md）。
// 同じ鍵の衝突は例外の文言ではなく、ON CONFLICT DO NOTHING の件数で見分ける（CONC-1）。

type Db = BaseSQLiteDatabase<'async', ResultSet, typeof schema>

const { tripLosses } = schema

export class DrizzleLossRepository implements LossRepository {
  constructor(private readonly db: Db) {}

  async findLoss(keyHash: string): Promise<StoredLoss | null> {
    const rows = await this.db
      .select()
      .from(tripLosses)
      .where(eq(tripLosses.keyHash, keyHash))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      keyHash: row.keyHash,
      tripId: row.tripId,
      collision: row.collision,
      story: row.story,
      createdAtMs: row.createdAt,
    }
  }

  async countLosses(tripId: string): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(tripLosses)
      .where(eq(tripLosses.tripId, tripId))
    return rows[0]?.n ?? 0
  }

  async insertLoss(loss: StoredLoss): Promise<boolean> {
    const result = await this.db
      .insert(tripLosses)
      .values({
        keyHash: loss.keyHash,
        tripId: loss.tripId,
        collision: loss.collision,
        story: loss.story,
        createdAt: loss.createdAtMs,
      })
      .onConflictDoNothing()
    return result.rowsAffected === 1
  }
}
