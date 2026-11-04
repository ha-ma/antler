import type { TripDetails, TripPlan } from '@antler/schema'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { CollisionDescriptor } from '../../domain/losses/models/loss.js'
import type { LocalizedText } from '../../domain/trips/models/trip-writing.js'

// 旅（TripPlan・TripDetails・所有者トークンのハッシュ）と冪等キーの行（docs/specs/plan-trip/plan.md「マイグレーション統合」）。
// 表は起動時に migrate.ts の CREATE TABLE IF NOT EXISTS で作る。列を変えるときは両方を直す。

export const trips = sqliteTable(
  'trips',
  {
    id: text('id').primaryKey(),
    plan: text('plan', { mode: 'json' }).$type<TripPlan>().notNull(),
    details: text('details', { mode: 'json' }).$type<TripDetails>().notNull(),
    ownerTokenHash: text('owner_token_hash').notNull(),
    /** 作成時刻（ms）。1 日の上限の数え上げに使う */
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('trips_created_at').on(t.createdAt)],
)

/** 日（日本時間の暦日）ごとの Claude の呼び出しの数（1 日の上限。作り直し・失敗も数える） */
export const tripWriterCalls = sqliteTable('trip_writer_calls', {
  /** 日本時間の暦日の始まり（ms） */
  dayStart: integer('day_start').primaryKey(),
  calls: integer('calls').notNull(),
})

/** 喪失文（loss、docs/specs/loss/plan.md「マイグレーション統合」）。鍵は文の材料の記述子のハッシュ */
export const tripLosses = sqliteTable(
  'trip_losses',
  {
    keyHash: text('key_hash').primaryKey(),
    tripId: text('trip_id').notNull(),
    collision: text('collision', { mode: 'json' }).$type<CollisionDescriptor>().notNull(),
    story: text('story', { mode: 'json' }).$type<LocalizedText>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('trip_losses_trip_id').on(t.tripId)],
)

export const tripRequests = sqliteTable('trip_requests', {
  /** 冪等キーのハッシュ（キーそのものは保存しない） */
  keyHash: text('key_hash').primaryKey(),
  bodyHash: text('body_hash').notNull(),
  status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull(),
  tripId: text('trip_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
