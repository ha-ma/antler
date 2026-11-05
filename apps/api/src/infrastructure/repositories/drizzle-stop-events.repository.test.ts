import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StopDeck } from '../../domain/stop-events/models/stop-deck.js'
import { openDatabase } from '../db/connection.js'
import { ensureSchema } from '../db/migrate.js'
import { DrizzleStopDeckRepository } from './drizzle-stop-deck.repository.js'
import { DrizzleTripEventRepository } from './drizzle-trip-event.repository.js'

// 一時ファイルの SQLite で、stop-events の 2 つの表を確かめる（integration。MIGR-31・resilience.md）。

const T0 = 1_800_000_000_000
const deck = {
  tripId: 'K7m2abcd',
  day: 1,
  date: '2027-02-14',
  dayBudgetJPY: 0,
  scenes: [],
  data: { routes: 'r', zones: 'z' },
} as StopDeck

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'antler-stop-events-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('stop-events の表', () => {
  it('MIGR-31: 空のデータファイルから 2 つの表が作られ、2 回目の起動でも壊れず行が残る', async () => {
    const url = `file:${join(dir, 'trips.db')}`
    const first = openDatabase(url)
    await ensureSchema(first.client)
    const decks = new DrizzleStopDeckRepository(first.db)
    expect(await decks.insertPending({ tripId: 'K7m2abcd', day: 1, nowMs: T0 })).toBe(true)
    first.client.close()

    const second = openDatabase(url)
    await ensureSchema(second.client)
    const tables = await second.client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('stop_decks','trip_events') ORDER BY name",
    )
    expect(tables.rows.map((r) => r['name'])).toEqual(['stop_decks', 'trip_events'])
    expect((await new DrizzleStopDeckRepository(second.db).find('K7m2abcd', 1))?.status).toBe(
      'pending',
    )
    second.client.close()
  })

  it('束の行: 2 回目の insertPending は false。done・failed は自分の pending のときだけ書く', async () => {
    const conn = openDatabase(`file:${join(dir, 'trips.db')}`)
    await ensureSchema(conn.client)
    const decks = new DrizzleStopDeckRepository(conn.db)
    expect(await decks.insertPending({ tripId: 'K7m2abcd', day: 1, nowMs: T0 })).toBe(true)
    expect(await decks.insertPending({ tripId: 'K7m2abcd', day: 1, nowMs: T0 + 1 })).toBe(false)
    // 別の時刻の pending（取り直された）には書かない
    const writing = { scenes: [] }
    expect(
      await decks.markDone({
        tripId: 'K7m2abcd',
        day: 1,
        deck,
        writing,
        claimedAtMs: T0 + 5,
        nowMs: T0 + 9,
      }),
    ).toBe(false)
    await decks.markFailed('K7m2abcd', 1, T0 + 5, T0 + 9)
    expect((await decks.find('K7m2abcd', 1))?.status).toBe('pending')
    expect(
      await decks.markDone({
        tripId: 'K7m2abcd',
        day: 1,
        deck,
        writing,
        claimedAtMs: T0,
        nowMs: T0 + 9,
      }),
    ).toBe(true)
    const row = await decks.find('K7m2abcd', 1)
    expect(row).toMatchObject({ status: 'done', deck, writing, updatedAtMs: T0 + 9 })
    // reclaim は読んだときの status と updatedAt のままのときだけ
    expect(await decks.reclaim('K7m2abcd', 1, { status: 'done', updatedAtMs: T0 }, T0 + 20)).toBe(
      false,
    )
    expect(
      await decks.reclaim('K7m2abcd', 1, { status: 'done', updatedAtMs: T0 + 9 }, T0 + 20),
    ).toBe(true)
    conn.client.close()
  })

  it('イベントの行: 主キーが重なる行は入れず、旅ごとに数える', async () => {
    const conn = openDatabase(`file:${join(dir, 'trips.db')}`)
    await ensureSchema(conn.client)
    const events = new DrizzleTripEventRepository(conn.db)
    const row = {
      tripId: 'K7m2abcd',
      runId: '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f',
      seq: 0,
      day: 1,
      kind: 'collision' as const,
      at: '2027-02-14T16:00:00+09:00',
      alertEnabled: true,
      leg: 0,
      km: 12.25,
      data: { pattern: 'frozen' as const, speedKmh: 50 },
      receivedAtMs: T0,
    }
    await events.insertMany([row, { ...row, seq: 1 }])
    await events.insertMany([{ ...row, data: { pattern: 'herd' as const, speedKmh: 1 } }])
    expect(await events.countByTrip('K7m2abcd')).toBe(2)
    expect(await events.countByTrip('Other123')).toBe(0)
    const found = await events.findBySeqs('K7m2abcd', row.runId, [0, 5])
    expect(found).toEqual([row])
    expect(await events.findBySeqs('K7m2abcd', row.runId, [])).toEqual([])
    conn.client.close()
  })
})
