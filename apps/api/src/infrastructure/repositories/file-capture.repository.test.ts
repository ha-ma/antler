import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NewStoredCapture } from '../../application/ports/repositories/capture.repository.js'
import { buildCapture, buildJpeg, buildPng } from '../../../tests/factories/captures.js'
import { FileCaptureRepository } from './file-capture.repository.js'

let root: string
let dir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'antler-captures-'))
  dir = join(root, 'captures-received')
})

afterEach(() => {
  chmodSync(root, 0o700)
  if (existsSync(dir)) chmodSync(dir, 0o700)
  rmSync(root, { recursive: true, force: true })
})

function sha(char: string): string {
  return char.repeat(64)
}

function entry(
  key: string,
  overrides: { bodyHash?: string; imageSha?: string; image?: Uint8Array; png?: boolean } = {},
): NewStoredCapture {
  const bytes = overrides.image ?? (overrides.png ? buildPng() : buildJpeg())
  const format = overrides.png ? 'png' : 'jpeg'
  return {
    key,
    capture: buildCapture({
      id: key,
      image: `captures/${key}.${overrides.png ? 'png' : 'jpg'}`,
      consent: true,
    }),
    bodyHash: overrides.bodyHash ?? sha('a'),
    receivedAt: '2026-11-04T03:00:00.000Z',
    image: { bytes, format, sha256: overrides.imageSha ?? sha('1') },
  }
}

const names = () => readdirSync(dir).sort()

describe('FileCaptureRepository', () => {
  it('API-1a・API-1o: 保存すると {key}.json と {key}-{sha 先頭12桁}.jpg ができ、JSON は {capture, file, bodyHash, receivedAt}', async () => {
    const repo = new FileCaptureRepository(dir)
    const item = entry('cap_aaaaaa000001')
    expect(await repo.create(item)).toEqual({ status: 'created' })
    expect(names()).toEqual(['cap_aaaaaa000001-111111111111.jpg', 'cap_aaaaaa000001.json'])
    const json = JSON.parse(readFileSync(join(dir, 'cap_aaaaaa000001.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(Object.keys(json).sort()).toEqual(['bodyHash', 'capture', 'file', 'receivedAt'])
    expect(json['file']).toBe('cap_aaaaaa000001-111111111111.jpg')
    expect(json['bodyHash']).toBe(sha('a'))
    expect(json['receivedAt']).toBe('2026-11-04T03:00:00.000Z')
    expect((json['capture'] as { image: string }).image).toBe('captures/cap_aaaaaa000001.jpg')
    expect(readFileSync(join(dir, 'cap_aaaaaa000001-111111111111.jpg'))).toEqual(
      Buffer.from(item.image.bytes),
    )
  })

  it('API-1a: PNG は .png で保存する', async () => {
    const repo = new FileCaptureRepository(dir)
    await repo.create(entry('cap_aaaaaa000002', { png: true, imageSha: sha('2') }))
    expect(names()).toEqual(['cap_aaaaaa000002-222222222222.png', 'cap_aaaaaa000002.json'])
  })

  it('AUTH-4: ディレクトリは 0700、ファイルは 0600。一時ファイルは残らない', async () => {
    const repo = new FileCaptureRepository(dir)
    await repo.create(entry('cap_aaaaaa000003'))
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    for (const name of names()) {
      expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600)
      expect(name.startsWith('.tmp-')).toBe(false)
    }
  })

  it('API-1i: stats は保存のたびに増え、作り直した直後（起動時）の数え直しと一致する', async () => {
    const repo = new FileCaptureRepository(dir)
    expect(await repo.stats()).toEqual({ count: 0, bytes: 0 })
    const a = entry('cap_aaaaaa000004')
    const b = entry('cap_aaaaaa000005', { png: true, imageSha: sha('2') })
    await repo.create(a)
    await repo.create(b)
    const expected = { count: 2, bytes: a.image.bytes.byteLength + b.image.bytes.byteLength }
    expect(await repo.stats()).toEqual(expected)
    expect(await new FileCaptureRepository(dir).stats()).toEqual(expected)
  })

  it('API-1b・IDEM-1: 同じ key の 2 回目は上書きせず exists と既存の本文ハッシュを返す。ファイルは 1 組のまま', async () => {
    const repo = new FileCaptureRepository(dir)
    await repo.create(entry('cap_aaaaaa000006'))
    const before = names()
    const result = await repo.create(entry('cap_aaaaaa000006'))
    expect(result).toEqual({ status: 'exists', existingBodyHash: sha('a') })
    expect(names()).toEqual(before)
    expect((await repo.stats()).count).toBe(1)
  })

  it('API-1c・IDEM-2・AUTH-2: 同じ key で画像が違う要求は exists になり、既存の JSON・画像は変わらず、負けた側の画像は残らない', async () => {
    const repo = new FileCaptureRepository(dir)
    await repo.create(entry('cap_aaaaaa000007'))
    const jsonBefore = readFileSync(join(dir, 'cap_aaaaaa000007.json'), 'utf8')
    const imageBefore = readFileSync(join(dir, 'cap_aaaaaa000007-111111111111.jpg'))

    const other = entry('cap_aaaaaa000007', {
      bodyHash: sha('b'),
      imageSha: sha('9'),
      image: buildJpeg({ scanWithMarkers: true }),
    })
    expect(await repo.create(other)).toEqual({ status: 'exists', existingBodyHash: sha('a') })
    expect(readFileSync(join(dir, 'cap_aaaaaa000007.json'), 'utf8')).toBe(jsonBefore)
    expect(readFileSync(join(dir, 'cap_aaaaaa000007-111111111111.jpg'))).toEqual(imageBefore)
    expect(names()).toEqual(['cap_aaaaaa000007-111111111111.jpg', 'cap_aaaaaa000007.json'])
    expect((await repo.stats()).bytes).toBe(imageBefore.byteLength)
  })

  it('CONC-1・API-1j: 同じ key の同時の 10 要求は 1 つだけ created で、ほかは exists。ファイルは 1 組', async () => {
    const repo = new FileCaptureRepository(dir)
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.create(entry('cap_aaaaaa000008'))),
    )
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'exists')).toHaveLength(9)
    expect(names()).toEqual(['cap_aaaaaa000008-111111111111.jpg', 'cap_aaaaaa000008.json'])
    expect(await repo.stats()).toEqual({ count: 1, bytes: buildJpeg().byteLength })
  })

  it('CONC-1: 同じ key で画像が違う同時の 2 要求は、負けた側の画像が残らない', async () => {
    const repo = new FileCaptureRepository(dir)
    const [a, b] = await Promise.all([
      repo.create(entry('cap_aaaaaa000009')),
      repo.create(
        entry('cap_aaaaaa000009', {
          bodyHash: sha('b'),
          imageSha: sha('9'),
          image: buildJpeg({ scanWithMarkers: true }),
        }),
      ),
    ])
    expect([a.status, b.status].sort()).toEqual(['created', 'exists'])
    const files = names()
    expect(files).toHaveLength(2)
    expect(files.some((f) => f.endsWith('.json'))).toBe(true)
  })

  it('FAIL-8: 書けない（権限なし）と例外を投げ、JSON も一時ファイルも残らず、直したあとの同じ key の再送で保存できる', async () => {
    const repo = new FileCaptureRepository(dir)
    chmodSync(dir, 0o500)
    await expect(repo.create(entry('cap_aaaaaa000010'))).rejects.toThrow()
    chmodSync(dir, 0o700)
    expect(names()).toEqual([])
    expect(await repo.stats()).toEqual({ count: 0, bytes: 0 })
    expect(await repo.create(entry('cap_aaaaaa000010'))).toEqual({ status: 'created' })
    expect(names()).toContain('cap_aaaaaa000010.json')
  })

  it('FAIL-8: 画像は書けたが JSON を作れなかった（読めない既存がある）ときは 409 側の exists（本文のハッシュ null）で、作った画像を消す', async () => {
    const repo = new FileCaptureRepository(dir)
    // JSON の位置がディレクトリ（読めない既存）
    mkdirSync(join(dir, 'cap_aaaaaa000011.json'))
    const result = await repo.create(entry('cap_aaaaaa000011'))
    expect(result).toEqual({ status: 'exists', existingBodyHash: null })
    expect(names()).toEqual(['cap_aaaaaa000011.json'])
  })

  it('FAIL-8: 画像だけ残った（JSON が無い）あとの同じ中身の再送は、画像の EEXIST を無視して JSON を作る', async () => {
    const repo = new FileCaptureRepository(dir)
    const item = entry('cap_aaaaaa000012')
    writeFileSync(join(dir, 'cap_aaaaaa000012-111111111111.jpg'), item.image.bytes)
    expect(await repo.create(item)).toEqual({ status: 'created' })
    expect(names()).toEqual(['cap_aaaaaa000012-111111111111.jpg', 'cap_aaaaaa000012.json'])
    expect(readFileSync(join(dir, 'cap_aaaaaa000012-111111111111.jpg'))).toEqual(
      Buffer.from(item.image.bytes),
    )
  })

  it('API-1m: find は key で既存の本文ハッシュを返す。無ければ null、壊れていれば bodyHash null', async () => {
    const repo = new FileCaptureRepository(dir)
    await repo.create(entry('cap_aaaaaa000013', { bodyHash: sha('c') }))
    expect(await repo.find('cap_aaaaaa000013')).toEqual({ bodyHash: sha('c') })
    expect(await repo.find('cap_aaaaaa999999')).toBeNull()
    writeFileSync(join(dir, 'cap_aaaaaa000014.json'), '{"capture":')
    expect(await repo.find('cap_aaaaaa000014')).toEqual({ bodyHash: null })
    writeFileSync(join(dir, 'cap_aaaaaa000015.json'), '{"capture":{},"file":"x"}')
    expect(await repo.find('cap_aaaaaa000015')).toEqual({ bodyHash: null })
  })

  it('AUTH-3: パスに使えない key は拒否する（ファイルシステムに触れない）', async () => {
    const repo = new FileCaptureRepository(dir)
    for (const bad of ['../cap_a', 'cap_a/b', 'CAP_A', 'cap_', 'cap_a.json', '']) {
      await expect(repo.find(bad)).rejects.toThrow()
      await expect(repo.create(entry(bad))).rejects.toThrow()
    }
    expect(names()).toEqual([])
  })

  it('起動時: ディレクトリを 0700 で作り、孤児の一時ファイルを消し、既存の JSON と画像を数える', () => {
    mkdirSync(dir, { mode: 0o700 })
    writeFileSync(join(dir, '.tmp-1234'), 'partial')
    writeFileSync(join(dir, 'cap_aaaaaa000016.json'), '{}')
    writeFileSync(join(dir, 'cap_aaaaaa000016-0123456789ab.jpg'), 'x'.repeat(100))
    writeFileSync(join(dir, 'README.txt'), 'ignored')
    const repo = new FileCaptureRepository(dir)
    expect(names()).toEqual([
      'README.txt',
      'cap_aaaaaa000016-0123456789ab.jpg',
      'cap_aaaaaa000016.json',
    ])
    return expect(repo.stats()).resolves.toEqual({ count: 1, bytes: 100 })
  })

  it('起動時: 無いディレクトリ（入れ子）を作る', () => {
    const nested = join(root, 'a', 'b', 'captures')
    new FileCaptureRepository(nested)
    expect(statSync(nested).mode & 0o777).toBe(0o700)
  })
})
