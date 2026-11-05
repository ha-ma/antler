import type { TripDetails, TripPlan } from '@antler/schema'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { StopDeck } from '../../domain/stop-events/models/stop-deck.js'
import type { StopWriting } from '../../domain/stop-events/models/stop-writing.js'
import type { TripEventData } from '../../domain/stop-events/models/trip-event.js'

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

/** 出来事の束（stop-events。docs/specs/stop-events/plan.md「マイグレーション統合」）。旅と日で 1 行 */
export const stopDecks = sqliteTable(
  'stop_decks',
  {
    tripId: text('trip_id').notNull(),
    day: integer('day').notNull(),
    status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull(),
    deck: text('deck', { mode: 'json' }).$type<StopDeck>(),
    writing: text('writing', { mode: 'json' }).$type<StopWriting>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.day] })],
)

/** イベントログ（stop-events R10。record が読む）。run の中の seq で 1 行 */
export const tripEvents = sqliteTable(
  'trip_events',
  {
    tripId: text('trip_id').notNull(),
    runId: text('run_id').notNull(),
    seq: integer('seq').notNull(),
    day: integer('day').notNull(),
    kind: text('kind', { enum: ['choice', 'encounter', 'collision', 'avoidance'] }).notNull(),
    at: text('at').notNull(),
    alertEnabled: integer('alert_enabled', { mode: 'boolean' }).notNull(),
    leg: integer('leg'),
    km: real('km'),
    data: text('data', { mode: 'json' }).$type<TripEventData>().notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.runId, t.seq] }),
    index('trip_events_trip').on(t.tripId, t.receivedAt),
  ],
)

/**
 * 走行の記録（run）。1 日の運転 1 回の要約（docs/specs/record/plan.md「マイグレーション統合」）。
 * payload は DriveRunInput の JSON（読むときに形を確かめる）。外部キーは張らない（削除は usecase が明示的に消す）
 */
export const tripRuns = sqliteTable(
  'trip_runs',
  {
    tripId: text('trip_id').notNull(),
    runId: text('run_id').notNull(),
    day: integer('day').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
    /** 保存した時刻（ms） */
    createdAt: integer('created_at').notNull(),
    /** 旅の中の保存の順番（1 始まり）。日ごとの最新を決める */
    seq: integer('seq').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.runId] }),
    index('trip_runs_trip_seq').on(t.tripId, t.seq),
  ],
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
