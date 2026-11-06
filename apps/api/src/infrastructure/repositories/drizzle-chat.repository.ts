import type { ResultSet } from '@libsql/client'
import { count, eq } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { ChatRepository } from '../../application/ports/repositories/chat.repository.js'
import type { StoredChat } from '../../domain/chats/models/chat-deck.js'
import * as schema from '../db/schema.js'

// ChatRepository の Drizzle（libsql）実装（docs/specs/drive-audio-chat/resilience.md）。
// 同じ鍵の衝突は例外の文言ではなく、ON CONFLICT DO NOTHING の件数で見分ける（CONC-41）。

type Db = BaseSQLiteDatabase<'async', ResultSet, typeof schema>

const { tripChats } = schema

export class DrizzleChatRepository implements ChatRepository {
  constructor(private readonly db: Db) {}

  async findChat(keyHash: string): Promise<StoredChat | null> {
    const rows = await this.db
      .select()
      .from(tripChats)
      .where(eq(tripChats.keyHash, keyHash))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      keyHash: row.keyHash,
      tripId: row.tripId,
      day: row.day,
      deck: row.deck,
      createdAtMs: row.createdAt,
    }
  }

  async countChats(tripId: string): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(tripChats)
      .where(eq(tripChats.tripId, tripId))
    return rows[0]?.n ?? 0
  }

  async insertChat(chat: StoredChat): Promise<boolean> {
    const result = await this.db
      .insert(tripChats)
      .values({
        keyHash: chat.keyHash,
        tripId: chat.tripId,
        day: chat.day,
        deck: chat.deck,
        createdAt: chat.createdAtMs,
      })
      .onConflictDoNothing()
    return result.rowsAffected === 1
  }
}
