import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TripDetailsSchema, TripPlanSchema, type TripDetails, type TripPlan } from '@antler/schema'
import type { StoredTrip } from '../../application/ports/repositories/trip.repository.js'
import { TripIdCollisionError } from '../../domain/trips/errors/trip-errors.js'
import { openDatabase, type Connection } from '../db/connection.js'
import { DrizzleUnitOfWork } from '../db/drizzle-unit-of-work.js'
import { ensureSchema } from '../db/migrate.js'
import { DrizzleTripRepository } from './drizzle-trip.repository.js'

// 一時ファイルの SQLite で、表の作成・冪等キーの行・旅の保存・トランザクションを確かめる（integration）。

const T0 = 1_800_000_000_000

const plan: TripPlan = {
  id: 'Ab3dEf7h',
  lang: 'zh',
  seed: 42,
  party: { size: 4, drivers: 2, experience: 'first' },
  depart: { at: '2027-02-14T10:00:00+09:00', place: 'CTS' },
  return: { at: '2027-02-15T17:00:00+09:00', place: 'CTS' },
  budgetPerPersonJPY: 0,
  area: 'doto',
  pleasures: [],
  title: '道東之旅',
  days: [
    { day: 1, from: 'cts', to: 'kushiro', stops: [], stay: 'kushiro' },
    { day: 2, from: 'kushiro', to: 'cts', stops: [], stay: null },
  ],
  riskScore: 0.5,
  alertEnabled: true,
}
const localized = { ja: 'あ', en: 'a', zh: '啊', ko: '아' }
const details: TripDetails = {
  tripId: plan.id,
  titles: localized,
  dayNotes: [
    { day: 1, note: localized },
    { day: 2, note: localized },
  ],
  skipped: [],
  createdAt: new Date(T0).toISOString(),
}
const stored = (overrides: Partial<StoredTrip> = {}): StoredTrip => ({
  plan,
  details,
  ownerTokenHash: 'h'.repeat(64),
  createdAtMs: T0,
  ...overrides,
})

let dir: string
let conn: Connection
let repo: DrizzleTripRepository

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'antler-trips-'))
  conn = openDatabase(`file:${join(dir, 'nested', 'trips.db')}`)
  await ensureSchema(conn.client)
  repo = new DrizzleTripRepository(conn.db)
})

afterEach(() => {
  conn.client.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ensureSchema', () => {
  it('MIGR-1: 空のデータファイル（フォルダも無い）から表が作られ、2 回目でも壊れない', async () => {
    await repo.insertTrip(stored())
    await ensureSchema(conn.client)
    const tables = await conn.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    expect(tables.rows.map((r) => r['name'])).toEqual(['trip_requests', 'trips'])
    expect(await repo.findTrip(plan.id)).not.toBeNull()
  })
})

describe('DrizzleTripRepository', () => {
  it('旅を保存して読める（JSON の列は TripPlan / TripDetails の形のまま戻る）', async () => {
    await repo.insertTrip(stored())
    const found = await repo.findTrip(plan.id)
    expect(found).toEqual(stored())
    expect(TripPlanSchema.parse(found?.plan)).toEqual(plan)
    expect(TripDetailsSchema.parse(found?.details)).toEqual(details)
    expect(await repo.findTrip('nothing1')).toBeNull()
  })

  it('CONC-2: id の衝突は TripIdCollisionError（例外の文言に頼らない）', async () => {
    await repo.insertTrip(stored())
    await expect(repo.insertTrip(stored({ ownerTokenHash: 'x' }))).rejects.toThrow(
      TripIdCollisionError,
    )
  })

  it('当日の件数は作成時刻で数える', async () => {
    await repo.insertTrip(stored({ createdAtMs: T0 - 1 }))
    await repo.insertTrip(
      stored({ plan: { ...plan, id: 'Zz9yXx8w' }, details: { ...details, tripId: 'Zz9yXx8w' } }),
    )
    expect(await repo.countTripsCreatedSince(T0)).toBe(1)
    expect(await repo.countTripsCreatedSince(T0 - 1)).toBe(2)
  })

  it('CONC-1: 同じキーの pending は片方だけが作れる', async () => {
    const results = await Promise.all([
      repo.insertPendingRequest({ keyHash: 'k', bodyHash: 'b', nowMs: T0 }),
      repo.insertPendingRequest({ keyHash: 'k', bodyHash: 'b', nowMs: T0 }),
    ])
    expect(results.sort()).toEqual([false, true])
    expect(await repo.findRequest('k')).toEqual({
      keyHash: 'k',
      bodyHash: 'b',
      status: 'pending',
      tripId: null,
      createdAtMs: T0,
      updatedAtMs: T0,
    })
    expect(await repo.findRequest('none')).toBeNull()
  })

  it('IDEM-2・IDEM-3: failed / 古い pending の作り直しは、読んだときの状態のままなら 1 回だけ通る', async () => {
    await repo.insertPendingRequest({ keyHash: 'k', bodyHash: 'b', nowMs: T0 })
    await repo.markRequestFailed('k', T0 + 5)
    expect((await repo.findRequest('k'))?.status).toBe('failed')
    const expected = { status: 'failed' as const, updatedAtMs: T0 + 5 }
    expect(await repo.reclaimRequest('k', expected, { bodyHash: 'b2', nowMs: T0 + 10 })).toBe(true)
    expect(await repo.reclaimRequest('k', expected, { bodyHash: 'b2', nowMs: T0 + 10 })).toBe(false)
    expect(await repo.findRequest('k')).toMatchObject({
      status: 'pending',
      bodyHash: 'b2',
      createdAtMs: T0 + 10,
      updatedAtMs: T0 + 10,
    })
  })

  it('done にした行は failed に戻さない', async () => {
    await repo.insertPendingRequest({ keyHash: 'k', bodyHash: 'b', nowMs: T0 })
    await repo.markRequestDone('k', plan.id, T0 + 1)
    await repo.markRequestFailed('k', T0 + 2)
    expect(await repo.findRequest('k')).toMatchObject({ status: 'done', tripId: plan.id })
  })
})

describe('DrizzleUnitOfWork', () => {
  it('旅の保存と冪等キーの done を 1 つのトランザクションで確定する', async () => {
    await repo.insertPendingRequest({ keyHash: 'k', bodyHash: 'b', nowMs: T0 })
    await new DrizzleUnitOfWork(conn.db).transaction(async ({ trips }) => {
      await trips.insertTrip(stored())
      await trips.markRequestDone('k', plan.id, T0 + 1)
    })
    expect(await repo.findTrip(plan.id)).not.toBeNull()
    expect((await repo.findRequest('k'))?.status).toBe('done')
  })

  it('FAIL-4: トランザクションの途中で失敗したら旅の行が残らない', async () => {
    await repo.insertPendingRequest({ keyHash: 'k', bodyHash: 'b', nowMs: T0 })
    await expect(
      new DrizzleUnitOfWork(conn.db).transaction(async ({ trips }) => {
        await trips.insertTrip(stored())
        throw new Error('SQLITE_IOERR')
      }),
    ).rejects.toThrow('SQLITE_IOERR')
    expect(await repo.findTrip(plan.id)).toBeNull()
    expect((await repo.findRequest('k'))?.status).toBe('pending')
  })
})
