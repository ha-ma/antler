import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PERSONA_COLLISION, validStory } from '../../../tests/factories/losses.js'
import { openDatabase, type Connection } from '../db/connection.js'
import { ensureSchema } from '../db/migrate.js'
import { DrizzleLossRepository } from './drizzle-loss.repository.js'

// docs/specs/loss/resilience.md（MIGR-1・CONC-1）。一時ファイルの SQLite。

let dir: string
let conn: Connection

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'antler-api-loss-'))
  conn = openDatabase(`file:${join(dir, 'trips.db')}`)
})

afterEach(() => {
  conn.client.close()
  rmSync(dir, { recursive: true, force: true })
})

const row = (keyHash: string, tripId = 'K7m2abcd') => ({
  keyHash,
  tripId,
  collision: PERSONA_COLLISION,
  story: validStory().story,
  createdAtMs: 1_700_000_000_000,
})

describe('DrizzleLossRepository', () => {
  it('MIGR-1: 空のデータファイルから trip_losses が作られ、2 回目の起動でも壊れず行が残る', async () => {
    await ensureSchema(conn.client)
    const repo = new DrizzleLossRepository(conn.db)
    expect(await repo.insertLoss(row('a'.repeat(64)))).toBe(true)
    await ensureSchema(conn.client)
    expect(await repo.findLoss('a'.repeat(64))).toEqual(row('a'.repeat(64)))
  })

  it('CONC-1: 同じ鍵の 2 回目の INSERT は false で、最初の行が残る。数は旅ごと', async () => {
    await ensureSchema(conn.client)
    const repo = new DrizzleLossRepository(conn.db)
    expect(await repo.insertLoss(row('b'.repeat(64)))).toBe(true)
    const other = { ...row('b'.repeat(64)), story: { ...validStory().story, ja: '別の文' } }
    expect(await repo.insertLoss(other)).toBe(false)
    expect((await repo.findLoss('b'.repeat(64)))?.story.ja).toBe(validStory().story.ja)
    await repo.insertLoss(row('c'.repeat(64)))
    await repo.insertLoss(row('d'.repeat(64), 'Other123'))
    expect(await repo.countLosses('K7m2abcd')).toBe(2)
    expect(await repo.countLosses('Other123')).toBe(1)
    expect(await repo.findLoss('e'.repeat(64))).toBeNull()
  })
})
