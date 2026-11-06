import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoredChat } from '../../domain/chats/models/chat-deck.js'
import { openDatabase, type Connection } from '../db/connection.js'
import { ensureSchema, readSchemaVersion, SCHEMA_VERSION } from '../db/migrate.js'
import { DrizzleChatRepository } from './drizzle-chat.repository.js'

// 会話の束の保存（docs/specs/drive-audio-chat/resilience.md MIGR-41・CONC-41）。

const chat = (keyHash: string, tripId = 'K7m2abcd'): StoredChat => ({
  keyHash,
  tripId,
  day: 1,
  deck: {
    tripId,
    day: 1,
    lines: [
      {
        id: 'l01',
        cue: { kind: 'road', leg: 0, km: 0.2 },
        topic: 'depart',
        speaker: 'p1',
        pleasure: null,
        text: { ja: '出発だね', en: 'Off we go', zh: '出發囉', ko: '출발이다' },
      },
    ],
    data: { routes: '2026-11-03', zones: 'hash' },
  },
  createdAtMs: 1,
})

let dir: string
const opened: Connection[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'antler-chats-'))
})
afterEach(() => {
  for (const c of opened.splice(0)) c.client.close()
  rmSync(dir, { recursive: true, force: true })
})
function open(): Connection {
  const c = openDatabase(`file:${join(dir, 'trips.db')}`)
  opened.push(c)
  return c
}

describe('DrizzleChatRepository', () => {
  it('MIGR-41: 空のデータファイルから trip_chats と索引が作られ、2 回目の起動でも壊れず行が残る。表の版は 3', async () => {
    const first = open()
    await ensureSchema(first.client)
    expect(SCHEMA_VERSION).toBe(3)
    expect(await readSchemaVersion(first.client)).toBe(3)
    const index = await first.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'trip_chats_trip_id'",
    )
    expect(index.rows).toHaveLength(1)
    expect(await new DrizzleChatRepository(first.db).insertChat(chat('k1'))).toBe(true)
    first.client.close()
    opened.length = 0

    const second = open()
    await ensureSchema(second.client)
    const repo = new DrizzleChatRepository(second.db)
    expect(await repo.findChat('k1')).toEqual(chat('k1'))
    expect(await readSchemaVersion(second.client)).toBe(3)
  })

  it('CONC-41: 同じ鍵の 2 回目の INSERT は false（先の行が残る）。数えるのは旅ごと', async () => {
    const c = open()
    await ensureSchema(c.client)
    const repo = new DrizzleChatRepository(c.db)
    expect(await repo.insertChat(chat('k1'))).toBe(true)
    const other = chat('k1')
    other.deck.lines = []
    expect(await repo.insertChat(other)).toBe(false)
    expect((await repo.findChat('k1'))?.deck.lines).toHaveLength(1)
    await repo.insertChat(chat('k2'))
    await repo.insertChat(chat('k3', 'Other123'))
    expect(await repo.countChats('K7m2abcd')).toBe(2)
    expect(await repo.findChat('nope')).toBeNull()
  })
})
