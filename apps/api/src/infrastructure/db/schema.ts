import type { TripDetails, TripPlan } from '@antler/schema'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const tripRequests = sqliteTable('trip_requests', {
  /** 冪等キーのハッシュ（キーそのものは保存しない） */
  keyHash: text('key_hash').primaryKey(),
  bodyHash: text('body_hash').notNull(),
  status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull(),
  tripId: text('trip_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
