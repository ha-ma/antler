import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NewStoredCapture } from '../../src/application/ports/repositories/capture.repository.js'
import type { Connection } from '../../src/infrastructure/db/connection.js'
import { isStalePending } from '../../src/domain/captures/policies/capture-claim-policy.js'
import { CAPTURE_STALE_PENDING_MS as STALE_PENDING_MS } from '../../src/domain/captures/rules/capture-rules.js'
import {
  BlobCaptureRepository,
  blobImagePath,
} from '../../src/infrastructure/repositories/blob-capture.repository.js'
import {
  VercelBlobImageStore,
  type BlobClient,
} from '../../src/infrastructure/repositories/vercel-blob-image-store.js'
import { buildCapture } from '../factories/captures.js'
import { FakeImageGateway, openTestDb } from './harness.js'

// deploy-a R9（docs/specs/deploy-a/functional.md の UC-6）

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function item(overrides: Partial<NewStoredCapture> = {}, sha = SHA_A): NewStoredCapture {
  return {
    key: 'cap_0a1b2c3d4e5f',
    capture: buildCapture({ image: 'captures/cap_0a1b2c3d4e5f.jpg' }),
    bodyHash: `body-${sha.slice(0, 4)}`,
    receivedAt: '2026-11-05T10:00:00.000Z',
    image: { bytes: new Uint8Array([1, 2, 3, 4]), format: 'jpeg', sha256: sha },
    ...overrides,
  }
}

describe('BlobCaptureRepository（deploy-a R9）', () => {
  let dir: string
  let conn: Connection
  let images: FakeImageGateway
  const clock = { t: 1_000_000 }
  const repo = () => new BlobCaptureRepository({ db: conn.db, images, nowMs: () => clock.t })
  const rows = async () =>
    (await conn.client.execute('SELECT key, status, file, image_bytes FROM captures')).rows

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'antler-blob-capture-'))
    conn = await openTestDb(dir, 'cap.db')
    images = new FakeImageGateway()
    clock.t = 1_000_000
  })
  afterEach(() => {
    conn.client.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('CAP-6a: 行を取り、画像を captures/images/{key}-{sha256}.jpg に置き、done にする', async () => {
    expect(await repo().create(item())).toEqual({ status: 'created' })
    const path = `captures/images/cap_0a1b2c3d4e5f-${SHA_A}.jpg`
    expect(blobImagePath(item())).toBe(path)
    expect([...images.images.keys()]).toEqual([path])
    expect(images.images.get(path)?.contentType).toBe('image/jpeg')
    const [row] = await rows()
    expect(row?.['status']).toBe('done')
    expect(row?.['file']).toBe(path)
    expect(row?.['image_bytes']).toBe(4)
    const png = item({
      key: 'cap_png',
      image: { bytes: new Uint8Array([9]), format: 'png', sha256: SHA_B },
    })
    await repo().create(png)
    expect(images.images.get(`captures/images/cap_png-${SHA_B}.png`)?.contentType).toBe('image/png')
  })

  it('CAP-6b: 同じ key（done・10 分以内の pending）→ exists と既存のハッシュ。画像は置かない', async () => {
    await repo().create(item())
    expect(await repo().create(item({}, SHA_B))).toEqual({
      status: 'exists',
      existingBodyHash: 'body-aaaa',
    })
    expect(images.puts).toBe(1)
    // 10 分以内の pending も exists
    await conn.client.execute(
      `INSERT INTO captures VALUES ('cap_pending', 'pending', '{}', 'f', 'body-pend', 1, 'x', ${String(clock.t - 1000)})`,
    )
    expect(await repo().create(item({ key: 'cap_pending' }))).toEqual({
      status: 'exists',
      existingBodyHash: 'body-pend',
    })
    expect(images.puts).toBe(1)
  })

  it('CAP-6c・FAIL-2: 画像を置けない → 例外。自分の pending は消え、再送で created', async () => {
    images.failPut = true
    await expect(repo().create(item())).rejects.toThrow('blob unavailable')
    expect(await rows()).toHaveLength(0)
    images.failPut = false
    expect(await repo().create(item())).toEqual({ status: 'created' })
  })

  it('CAP-6d: find と stats（pending も含む。別のインスタンスでも同じ値）', async () => {
    expect(await repo().find('cap_0a1b2c3d4e5f')).toBeNull()
    await repo().create(item())
    expect(await repo().find('cap_0a1b2c3d4e5f')).toEqual({ bodyHash: 'body-aaaa' })
    await conn.client.execute(
      `INSERT INTO captures VALUES ('cap_pending', 'pending', '{}', 'f', 'body-pend', 10, 'x', ${String(clock.t)})`,
    )
    expect(await repo().find('cap_pending')).toEqual({ bodyHash: 'body-pend' })
    clock.t += STALE_PENDING_MS
    expect(await repo().find('cap_pending')).toBeNull()
    expect(await repo().stats()).toEqual({ count: 2, bytes: 14 })
    const other = new BlobCaptureRepository({
      db: conn.db,
      images: new FakeImageGateway(),
      nowMs: () => 0,
    })
    expect(await other.stats()).toEqual({ count: 2, bytes: 14 })
  })

  it('CAP-6d: 空の表の stats は 0', async () => {
    expect(await repo().stats()).toEqual({ count: 0, bytes: 0 })
  })

  it('CAP-6e: 不正な key は置き場所の名前に使う前に止める', async () => {
    await expect(repo().create(item({ key: '../etc' }))).rejects.toThrow('invalid capture key')
    await expect(repo().find('cap_/x')).rejects.toThrow('invalid capture key')
    expect(images.puts).toBe(0)
  })

  it('CAP-6g: 行を取れない（INSERT が例外）→ 例外。画像は置かない', async () => {
    await conn.client.execute('DROP TABLE captures')
    for (let i = 0; i < 3; i++) await expect(repo().create(item())).rejects.toThrow()
    expect(images.puts).toBe(0)
  })

  it('CAP-6h: 10 分より古い pending は引き継ぐ。10 分以内は引き継がない', async () => {
    const stale = clock.t - STALE_PENDING_MS
    await conn.client.execute(
      `INSERT INTO captures VALUES ('cap_0a1b2c3d4e5f', 'pending', '{}', 'old', 'body-old', 1, 'x', ${String(stale + 1)})`,
    )
    expect((await repo().create(item())).status).toBe('exists')
    clock.t += 1
    expect(await repo().create(item())).toEqual({ status: 'created' })
    const [row] = await rows()
    expect(row?.['status']).toBe('done')
    expect(row?.['file']).toBe(blobImagePath(item()))
  })

  it('CAP-6i・FAIL-3: done にできない → 例外。画像は残り行は pending。10 分後の再送が引き継ぐ（画像は 1 つ）', async () => {
    await conn.client.execute(
      "CREATE TRIGGER no_done BEFORE UPDATE ON captures WHEN NEW.status = 'done' BEGIN SELECT RAISE(ABORT, 'no done'); END",
    )
    await expect(repo().create(item())).rejects.toThrow()
    expect(images.images.size).toBe(1)
    expect((await rows())[0]?.['status']).toBe('pending')
    await conn.client.execute('DROP TRIGGER no_done')
    expect((await repo().create(item())).status).toBe('exists')
    clock.t += STALE_PENDING_MS
    expect(await repo().create(item())).toEqual({ status: 'created' })
    expect(images.images.size).toBe(1)
    expect((await rows())[0]?.['status']).toBe('done')
  })

  it('CAP-6b: 同時の同じ id は片方だけが行を取り、もう片方は exists（画像は 1 回だけ置く）', async () => {
    const results = await Promise.all([repo().create(item()), repo().create(item())])
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'exists'])
    expect(images.puts).toBe(1)
    expect(await rows()).toHaveLength(1)
  })

  it('CAP-6h: done にする前に引き継がれていたら例外（created と言わない）', async () => {
    const slow = new FakeImageGateway()
    const original = slow.put.bind(slow)
    let takeOver: (() => Promise<void>) | undefined
    slow.put = async (p, b, t) => {
      await original(p, b, t)
      await takeOver?.()
    }
    takeOver = async () => {
      takeOver = undefined
      // 画像を置いているあいだに古い扱いになり、別の要求が引き継いだ
      clock.t += STALE_PENDING_MS
      await repo().create(item())
    }
    const first = new BlobCaptureRepository({ db: conn.db, images: slow, nowMs: () => clock.t })
    await expect(first.create(item())).rejects.toThrow('capture claim lost')
    expect((await rows())[0]?.['status']).toBe('done')
  })

  it('CAP-6b: 取れなかったのに行が無い（相手が消した直後）→ 409 にせず例外（再送で直る）', async () => {
    // INSERT は競合で 0 行、そのあとの読み出しでは行が無い（本物の DB の select は空の表を読む）
    const vanishing = new BlobCaptureRepository({
      db: {
        select: conn.db.select.bind(conn.db),
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
          }),
        }),
      } as unknown as Connection['db'],
      images,
      nowMs: () => clock.t,
    })
    await expect(vanishing.create(item())).rejects.toThrow('vanished')
    expect(images.puts).toBe(0)
  })
})

describe('VercelBlobImageStore（deploy-a R9）', () => {
  it('CAP-6f: put に非公開・上書き可・接尾辞なし・contentType を渡す', async () => {
    const put = vi.fn().mockResolvedValue({})
    const store = new VercelBlobImageStore({ put } as unknown as BlobClient)
    await store.put('captures/images/x.jpg', new Uint8Array([1, 2]), 'image/jpeg')
    expect(put).toHaveBeenCalledWith('captures/images/x.jpg', Buffer.from([1, 2]), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'image/jpeg',
    })
  })
})

describe('書きかけの扱い（deploy-a R9）', () => {
  it('CAP-6h: isStalePending は 90 秒ちょうどから古い扱い', () => {
    expect(STALE_PENDING_MS).toBe(90_000)
    expect(isStalePending(1_000_000, 1_000_000 + 89_999)).toBe(false)
    expect(isStalePending(1_000_000, 1_000_000 + 90_000)).toBe(true)
  })
})
