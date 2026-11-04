import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaptureSchema } from '@antler/schema'
import {
  buildCapture,
  buildForm,
  buildJpeg,
  buildPng,
  type FormOptions,
} from '../../../../tests/factories/captures.js'
import { FixedClock } from '../../../../tests/factories/trips.js'
import { SubmitCaptureUseCase } from '../../../application/usecases/captures/submit-capture.usecase.js'
import { createLogger } from '../../logging/logger.js'
import { FileCaptureRepository } from '../../repositories/file-capture.repository.js'
import { NodeSha256BytesHasher } from '../../security/node-bytes-hasher.js'
import { NodeSha256Hasher } from '../../security/node-crypto.js'
import { createApp } from '../app.js'

// POST /api/captures の e2e（Hono の app.request ＋ 一時ディレクトリのファイル保存）。

const T0 = Date.parse('2026-11-04T12:00:00+09:00')
const ORIGIN = 'http://localhost:5173'
let root: string
let dir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'antler-api-captures-'))
  dir = join(root, 'captures-received')
})

afterEach(() => {
  if (existsSync(dir)) chmodSync(dir, 0o700)
  rmSync(root, { recursive: true, force: true })
})

function setup(opts: { maxItems?: number; maxBytes?: number } = {}) {
  const captures = new FileCaptureRepository(dir)
  const lines: Record<string, unknown>[] = []
  const logger = createLogger('debug', {
    sink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
  })
  const submitCapture = new SubmitCaptureUseCase({
    captures,
    hasher: new NodeSha256Hasher(),
    bytesHasher: new NodeSha256BytesHasher(),
    clock: new FixedClock(T0),
    maxItems: opts.maxItems ?? 50_000,
    maxBytes: opts.maxBytes ?? 5 * 1024 ** 3,
  })
  const app = createApp({
    logger,
    corsOrigins: [ORIGIN],
    readinessChecks: [],
    exposeErrorDetails: false,
    captures: {
      submitCapture,
      rateLimitKey: (c) => c.req.header('x-test-ip') ?? 'unknown',
      log: logger,
      now: () => T0,
    },
  })
  const send = (body: string | FormData | null, headers: Record<string, string> = {}) =>
    app.request('/api/captures', {
      method: 'POST',
      headers: { 'x-test-ip': '203.0.113.1', ...headers },
      ...(body === null ? {} : { body }),
    })
  const post = (options: FormOptions = {}, headers: Record<string, string> = {}) =>
    send(buildForm(options), headers)
  return { app, post, send, lines, captures }
}

async function errorOf(res: Response): Promise<{ code?: string; message?: string }> {
  const body = (await res.json()) as { error?: { code?: string; message?: string } }
  return body.error ?? {}
}

const files = () => (existsSync(dir) ? readdirSync(dir).sort() : [])
const jsonFiles = () => files().filter((f) => f.endsWith('.json'))
const readJson = (name: string) =>
  JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
    capture: ReturnType<typeof buildCapture>
    file: string
    bodyHash: string
    receivedAt: string
  }

const ID_A = 'cap_aaaaaa000001'
const ID_B = 'cap_aaaaaa000002'

describe('POST /api/captures', () => {
  it('AC-2: multipart の Capture と画像を POST すると 201 でファイルに保存され、同じものの再送は 200（Idempotent-Replayed）、同じ id で中身が違えば 409、consent: false は 422 で何も保存されない', async () => {
    const { post } = setup()
    const first = await post({ capture: buildCapture({ id: ID_A }) })
    expect(first.status).toBe(201)
    expect(await first.json()).toEqual({ id: ID_A, image: `captures/${ID_A}.jpg` })
    expect(files()).toHaveLength(2)

    const replay = await post({ capture: buildCapture({ id: ID_A }) })
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true')
    expect(files()).toHaveLength(2)

    const conflict = await post({ capture: buildCapture({ id: ID_A, distanceM: 5 }) })
    expect(conflict.status).toBe(409)
    expect((await errorOf(conflict)).code).toBe('CAPTURE_CONFLICT')

    const noConsent = await post({ capture: buildCapture({ id: ID_B, consent: false }) })
    expect(noConsent.status).toBe(422)
    expect((await errorOf(noConsent)).code).toBe('CONSENT_REQUIRED')
    expect(files()).toHaveLength(2)
  })

  it('API-1a: 正しい multipart（JPEG・vehicle と PNG・sim）が 201 で {id, image}。保存した JSON の image はサーバーが決めたパス', async () => {
    const { post } = setup()
    const jpeg = await post({ capture: buildCapture({ id: ID_A, source: 'vehicle' }) })
    expect(jpeg.status).toBe(201)
    expect(jpeg.headers.get('Idempotent-Replayed')).toBeNull()
    const png = await post({
      capture: buildCapture({ id: ID_B, source: 'sim', image: 'captures/x.png' }),
      image: buildPng(),
      imageType: 'image/png',
      imageName: 'a.png',
    })
    expect(png.status).toBe(201)
    expect(await png.json()).toEqual({ id: ID_B, image: `captures/${ID_B}.png` })

    const stored = readJson(`${ID_A}.json`)
    expect(CaptureSchema.safeParse(stored.capture).success).toBe(true)
    expect(stored.capture.image).toBe(`captures/${ID_A}.jpg`)
    expect(stored.capture.consent).toBe(true)
    expect(stored.receivedAt).toBe(new Date(T0).toISOString())
    expect(stored.bodyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(files().filter((f) => f.endsWith('.jpg'))).toHaveLength(1)
    expect(files().filter((f) => f.endsWith('.png'))).toHaveLength(1)
  })

  it('API-1b・IDEM-1: 同じものの再送は 200 と Idempotent-Replayed: true。保存は 1 つのまま、応答も同じ', async () => {
    const { post } = setup()
    const a = await post({ capture: buildCapture({ id: ID_A }) })
    const b = await post({ capture: buildCapture({ id: ID_A }) })
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect(b.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await b.json()).toEqual(await a.json())
    expect(jsonFiles()).toEqual([`${ID_A}.json`])
    expect(files()).toHaveLength(2)
  })

  it('API-1c・IDEM-2・AUTH-2: 同じ id で Capture が違えば 409 CAPTURE_CONFLICT。既存のファイルは変わらない', async () => {
    const { post } = setup()
    await post({ capture: buildCapture({ id: ID_A }) })
    const before = readFileSync(join(dir, `${ID_A}.json`), 'utf8')
    const res = await post({ capture: buildCapture({ id: ID_A, outcome: 'collided' }) })
    expect(res.status).toBe(409)
    expect((await errorOf(res)).code).toBe('CAPTURE_CONFLICT')
    expect(readFileSync(join(dir, `${ID_A}.json`), 'utf8')).toBe(before)
  })

  it('API-1c・IDEM-2: 同じ id で画像だけ違えば 409。既存の画像は変わらず、新しい画像も残らない', async () => {
    const { post } = setup()
    await post({ capture: buildCapture({ id: ID_A }) })
    const filesBefore = files()
    const imageName = filesBefore.find((f) => f.endsWith('.jpg')) ?? ''
    const imageBefore = readFileSync(join(dir, imageName))
    const res = await post({
      capture: buildCapture({ id: ID_A }),
      image: buildJpeg({ scanWithMarkers: true }),
    })
    expect(res.status).toBe(409)
    expect(files()).toEqual(filesBefore)
    expect(readFileSync(join(dir, imageName))).toEqual(imageBefore)
  })

  it('API-1d・AUTH-1: consent: false は 422 CONSENT_REQUIRED。何も保存されない', async () => {
    const { post } = setup()
    const res = await post({ capture: buildCapture({ consent: false }) })
    expect(res.status).toBe(422)
    expect((await errorOf(res)).code).toBe('CONSENT_REQUIRED')
    expect(files()).toEqual([])
  })

  it('API-1e: capture が無い・image が無い・JSON でない・スキーマ違反・知らない欄（email・lat）は 400 INVALID_INPUT', async () => {
    const { post, send } = setup()
    const bad: FormOptions[] = [
      { capture: null },
      { image: null },
      { capture: '{not json' },
      { capture: '[]' },
      { capture: '"cap_a"' },
      { capture: { ...buildCapture(), source: 'drone' } },
      { capture: { ...buildCapture(), email: 'a@example.com' } },
      { capture: { ...buildCapture(), lat: 43.1751 } },
      { capture: { ...buildCapture(), lng: 144.3 } },
      { capture: { ...buildCapture(), deviceId: 'IDFA-1' } },
      { capture: { ...buildCapture(), roadSegment: '43.1,144.3' } },
      { capture: { ...buildCapture(), id: 'cap_' } },
    ]
    for (const options of bad) {
      const res = await post(options)
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('INVALID_INPUT')
    }
    // multipart でない本文・Content-Type 無し
    const json = await send(JSON.stringify(buildCapture()), { 'Content-Type': 'application/json' })
    expect(json.status).toBe(400)
    expect((await errorOf(json)).code).toBe('INVALID_INPUT')
    const empty = await send(null)
    expect(empty.status).toBe(400)
    // 壊れた multipart
    const broken = await send('--x\r\ngarbage', {
      'Content-Type': 'multipart/form-data; boundary=x',
    })
    expect(broken.status).toBe(400)
    expect((await errorOf(broken)).code).toBe('INVALID_INPUT')
    expect(files()).toEqual([])
  })

  it('API-1e: スキーマ違反の応答は欄名つき（値は返さない）', async () => {
    const { post } = setup()
    const res = await post({ capture: { ...buildCapture(), lat: 43.1751, source: 'drone' } })
    const body = (await res.json()) as {
      error: { code: string; message: string; issues?: string[] }
    }
    const text = JSON.stringify(body)
    expect(text).toContain('lat')
    expect(text).toContain('source')
    expect(text).not.toContain('43.1751')
  })

  it('API-1f・AUTH-3: クライアントの image のパス（/etc/passwd・../x.jpg）は 400。形の合うパスでも使われず、サーバーが決めたパスで保存される', async () => {
    const { post } = setup()
    for (const image of ['/etc/passwd', '../x.jpg', '/etc/passwd.jpg', 'C:\\x.jpg', 'a b.jpg']) {
      const res = await post({ capture: buildCapture({ id: ID_A, image }) })
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('INVALID_INPUT')
    }
    expect(files()).toEqual([])
    const ok = await post({
      capture: buildCapture({ id: ID_A, image: 'captures/elsewhere/other.png' }),
    })
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ id: ID_A, image: `captures/${ID_A}.jpg` })
    expect(readJson(`${ID_A}.json`).capture.image).toBe(`captures/${ID_A}.jpg`)
    expect(files().every((f) => f.startsWith(ID_A))).toBe(true)
  })

  it('API-1g: 本文が 640 KiB を超えたら 413 INVALID_INPUT', async () => {
    const { post } = setup()
    const huge = new Uint8Array(640 * 1024 + 1)
    huge.set(buildJpeg())
    const res = await post({ image: huge })
    expect(res.status).toBe(413)
    expect((await errorOf(res)).code).toBe('INVALID_INPUT')
    // Content-Length が大きいと申告された場合も本文を読まずに 413
    const { send } = setup()
    const declared = await send('x', {
      'Content-Type': 'multipart/form-data; boundary=x',
      'Content-Length': String(2 * 1024 * 1024),
    })
    expect(declared.status).toBe(413)
    expect(files()).toEqual([])
  })

  it('API-1g: capture が 8 KB を超えたら 400。画像が 512 KiB を超えるなら（本文は 640 KiB 以内でも）400 INVALID_IMAGE', async () => {
    const { post } = setup()
    const padded = JSON.stringify(buildCapture()) + ' '.repeat(8 * 1024)
    const tooBig = await post({ capture: padded })
    expect(tooBig.status).toBe(400)
    expect((await errorOf(tooBig)).code).toBe('INVALID_INPUT')

    const image = new Uint8Array(512 * 1024 + 1)
    image.set(buildJpeg())
    const bigImage = await post({ image })
    expect(bigImage.status).toBe(400)
    expect((await errorOf(bigImage)).code).toBe('INVALID_IMAGE')
    expect(files()).toEqual([])
  })

  it('API-1h・AUTH-5: 1 分 60 件を超えたら 429 RATE_LIMITED（IP ごと）', async () => {
    const { post } = setup()
    for (let i = 0; i < 60; i++) {
      expect((await post({ capture: null })).status).toBe(400)
    }
    const over = await post({ capture: buildCapture({ id: ID_A }) })
    expect(over.status).toBe(429)
    expect((await errorOf(over)).code).toBe('RATE_LIMITED')
    expect(over.headers.get('Retry-After')).not.toBeNull()
    expect(files()).toEqual([])
    // 別の IP は別の枠
    const other = await post(
      { capture: buildCapture({ id: ID_A }) },
      { 'x-test-ip': '203.0.113.2' },
    )
    expect(other.status).toBe(201)
  })

  it('API-1i・AUTH-5: 保存件数が上限なら 503 STORE_FULL。保存のたびに増えるので数え直しは要らない。再送は通る', async () => {
    const { post } = setup({ maxItems: 2 })
    expect((await post({ capture: buildCapture({ id: ID_A }) })).status).toBe(201)
    expect((await post({ capture: buildCapture({ id: ID_B }) })).status).toBe(201)
    const full = await post({ capture: buildCapture({ id: 'cap_aaaaaa000003' }) })
    expect(full.status).toBe(503)
    expect((await errorOf(full)).code).toBe('STORE_FULL')
    expect(jsonFiles()).toHaveLength(2)
    expect((await post({ capture: buildCapture({ id: ID_A }) })).status).toBe(200)
  })

  it('API-1j・CONC-1: 同じ id・同じ中身の同時の 2 リクエストは、保存は 1 組で 201 と 200', async () => {
    const { post } = setup()
    const [a, b] = await Promise.all([
      post({ capture: buildCapture({ id: ID_A }) }),
      post({ capture: buildCapture({ id: ID_A }) }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(files()).toHaveLength(2)
  })

  it('API-1j・CONC-1: 同じ id で中身が違う同時の 2 リクエストは、保存は片方だけ（もう片方は 409）', async () => {
    const { post } = setup()
    const [a, b] = await Promise.all([
      post({ capture: buildCapture({ id: ID_A }) }),
      post({
        capture: buildCapture({ id: ID_A, distanceM: 7 }),
        image: buildJpeg({ scanWithMarkers: true }),
      }),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(jsonFiles()).toEqual([`${ID_A}.json`])
    expect(files()).toHaveLength(2)
  })

  it('API-1k: ログに Capture の本文・roadSegment・画像が出ない（capture.received は id・source・大きさ・status だけ）', async () => {
    const { post, lines } = setup()
    const capture = buildCapture({ id: ID_A, roadSegment: 'secretroad-77', distanceM: 31.337 })
    await post({ capture })
    await post({ capture })
    await post({ capture: { ...capture, email: 'leak@example.com', consent: false } })
    const text = JSON.stringify(lines)
    for (const secret of [
      'secretroad-77',
      '31.337',
      'leak@example.com',
      'captures/cap_',
      'conditions',
      '203.0.113.1',
    ]) {
      expect(text).not.toContain(secret)
    }
    const received = lines.filter((l) => l['event'] === 'capture.received')
    expect(received).toHaveLength(2)
    expect(received[0]).toMatchObject({
      id: ID_A,
      source: 'vehicle',
      imageBytes: buildJpeg().byteLength,
      status: 201,
    })
    expect(received[1]).toMatchObject({ id: ID_A, status: 200 })
    expect(Object.keys(received[0] ?? {}).sort()).toEqual(
      ['event', 'id', 'imageBytes', 'level', 'source', 'status', 'ts'].sort(),
    )
  })

  it('API-1l: CORS で許可したオリジンに Access-Control-Allow-Origin が返る。許可しないオリジンには返らない', async () => {
    const { post } = setup()
    const allowed = await post({ capture: buildCapture({ id: ID_A }) }, { Origin: ORIGIN })
    expect(allowed.status).toBe(201)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const denied = await post(
      { capture: buildCapture({ id: ID_A }) },
      { Origin: 'https://evil.example' },
    )
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('API-1m: id は 40 文字までで、41 文字以上は 400。cap_A と cap_a は同じ key（同じ本文は 200、違えば 409）', async () => {
    const { post } = setup()
    const id40 = `cap_${'a'.repeat(36)}`
    const id41 = `cap_${'a'.repeat(37)}`
    expect((await post({ capture: buildCapture({ id: id40 }) })).status).toBe(201)
    const long = await post({ capture: buildCapture({ id: id41 }) })
    expect(long.status).toBe(400)
    expect((await errorOf(long)).code).toBe('INVALID_INPUT')

    const upper = 'cap_ABCDEF123456'
    expect((await post({ capture: buildCapture({ id: upper }) })).status).toBe(201)
    expect((await post({ capture: buildCapture({ id: upper }) })).status).toBe(200)
    expect((await post({ capture: buildCapture({ id: 'cap_abcdef123456' }) })).status).toBe(409)
    expect(jsonFiles()).toEqual([`${id40}.json`, 'cap_abcdef123456.json'])
  })

  it('API-1n: capture がファイルで来る・image が文字列で来る・同じ名前の欄が 2 つ → 400。ほかの欄は無視される', async () => {
    const { post } = setup()
    const asFile = await post({
      capture: new File([JSON.stringify(buildCapture({ id: ID_A }))], 'capture.json', {
        type: 'application/json',
      }),
    })
    expect(asFile.status).toBe(400)
    const imageText = await post({ capture: buildCapture({ id: ID_A }), image: 'not a file' })
    expect(imageText.status).toBe(400)
    const dupCapture = await post({ capture: buildCapture({ id: ID_A }), duplicate: 'capture' })
    expect(dupCapture.status).toBe(400)
    const dupImage = await post({ capture: buildCapture({ id: ID_A }), duplicate: 'image' })
    expect(dupImage.status).toBe(400)
    expect(files()).toEqual([])

    const extra = await post({
      capture: buildCapture({ id: ID_A }),
      extra: { email: 'a@example.com', note: 'x', 'capture[]': 'y' },
    })
    expect(extra.status).toBe(201)
    expect(readFileSync(join(dir, `${ID_A}.json`), 'utf8')).not.toContain('a@example.com')
  })

  it('API-1o: 画像の合計が CAPTURES_MAX_BYTES 以上なら 503。実ファイル名は {key}-{sha 先頭12桁}.{ext}、JSON の file がそれを指し、capture.image は論理のパス', async () => {
    const size = buildJpeg().byteLength
    const { post } = setup({ maxBytes: size * 2 })
    expect((await post({ capture: buildCapture({ id: 'cap_ABCDEF123456' }) })).status).toBe(201)
    const stored = readJson('cap_abcdef123456.json')
    expect(stored.file).toMatch(/^cap_abcdef123456-[0-9a-f]{12}\.jpg$/)
    expect(files()).toContain(stored.file)
    expect(stored.capture.image).toBe('captures/cap_ABCDEF123456.jpg')
    expect((await post({ capture: buildCapture({ id: ID_B }) })).status).toBe(201)
    const full = await post({ capture: buildCapture({ id: 'cap_aaaaaa000003' }) })
    expect(full.status).toBe(503)
    expect((await errorOf(full)).code).toBe('STORE_FULL')
  })

  it('AUTH-4: メタデータ付き・寸法違い・画像でないものは 400 INVALID_IMAGE。ファイル名や Content-Type が jpg でも信用しない', async () => {
    const { post } = setup()
    const images: Uint8Array[] = [
      buildJpeg({ exif: true }),
      buildPng({ chunks: ['tEXt'] }),
      buildJpeg({ width: 100, height: 100 }),
      buildJpeg({ trailing: [0] }),
      new TextEncoder().encode('GIF89a not a jpeg'),
      new TextEncoder().encode('<script>alert(1)</script>'),
    ]
    for (const image of images) {
      const res = await post({ image, imageName: 'x.jpg', imageType: 'image/jpeg' })
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('INVALID_IMAGE')
    }
    expect(files()).toEqual([])
  })

  it('A2: 検証の順。スキーマ違反は同意より先、同意は画像より先に当たる', async () => {
    const { post } = setup()
    const schemaFirst = await post({
      capture: { ...buildCapture({ consent: false }), email: 'x@example.com' },
      image: new Uint8Array([1, 2, 3]),
    })
    expect((await errorOf(schemaFirst)).code).toBe('INVALID_INPUT')
    const consentBeforeImage = await post({
      capture: buildCapture({ consent: false }),
      image: new Uint8Array([1, 2, 3]),
    })
    expect((await errorOf(consentBeforeImage)).code).toBe('CONSENT_REQUIRED')
    const imageLast = await post({ image: new Uint8Array([1, 2, 3]) })
    expect((await errorOf(imageLast)).code).toBe('INVALID_IMAGE')
  })

  it('AUTH-6: GET・PUT・PATCH・DELETE の /api/captures と /api/captures/{id} は 404（読み出し・削除の口が無い）', async () => {
    const { app, post } = setup()
    await post({ capture: buildCapture({ id: ID_A }) })
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of [
        '/api/captures',
        `/api/captures/${ID_A}`,
        `/api/captures/${ID_A}/image`,
      ]) {
        const res = await app.request(path, { method })
        expect(res.status).toBe(404)
        expect((await errorOf(res)).code).toBe('NOT_FOUND')
      }
    }
  })

  it('FAIL-8: 保存が失敗（書けない）したら 500、JSON が残らず、直したあとの同じ id の再送で保存できる。内部のエラー文は返さない', async () => {
    const { post } = setup()
    chmodSync(dir, 0o500)
    const failed = await post({ capture: buildCapture({ id: ID_A }) })
    expect(failed.status).toBe(500)
    const body = (await failed.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(body)).not.toContain(dir)
    chmodSync(dir, 0o700)
    expect(files()).toEqual([])
    const retry = await post({ capture: buildCapture({ id: ID_A }) })
    expect(retry.status).toBe(201)
  })
})
