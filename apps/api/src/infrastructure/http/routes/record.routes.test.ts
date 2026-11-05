import {
  buildRecordView,
  recordText,
  RecordTripSchema,
  summarizeRecord,
  TripRecordSchema,
} from '@antler/trip'
import type { Hono } from 'hono'
import {
  makeRun,
  openRecordHarness,
  type RecordHarness,
} from '../../../../tests/factories/record-harness.js'
import { KEY_A, KEY_B } from '../../../../tests/factories/trips.js'
import { createLogger } from '../../logging/logger.js'
import { createApp } from '../app.js'
import { OgImageRenderer, type Png } from '../views/og-image-renderer.js'
import { buildShioriSvg, OG_MAX_DAY_ROWS } from '../views/shiori-svg.js'
import {
  OG_IMAGES_PER_MINUTE_PER_IP,
  RECORD_WRITES_PER_MINUTE_PER_IP,
  RUN_BODY_MAX_BYTES,
  type RecordUrls,
} from './record.routes.js'

// 旅の記録の e2e（Hono の app.request ＋ 一時ファイルの SQLite）。
// docs/specs/record/functional.md AC-1・UC-3〜UC-7、threat.md AUTH-*・IDOR-2・MASS-1・SEC-2

const URLS: RecordUrls = {
  api: 'https://api.ezoroad.example',
  sim: 'https://ezoroad.example',
  pwa: 'https://b.ezoroad.example',
}

let h: RecordHarness

beforeEach(async () => {
  h = await openRecordHarness()
})

afterEach(() => {
  h.close()
})

function appWith(opts: { ogImages?: OgImageRenderer; ip?: () => string } = {}): Hono {
  return createApp({
    logger: createLogger('error'),
    corsOrigins: ['https://ezoroad.example'],
    readinessChecks: [],
    exposeErrorDetails: false,
    records: {
      getRecord: h.getRecord,
      saveRun: h.saveRun,
      deleteTrip: h.deleteTrip,
      ogImages: opts.ogImages ?? new OgImageRenderer({ fontFiles: [] }),
      urls: URLS,
      rateLimitKey: opts.ip ?? (() => '203.0.113.1'),
    },
  })
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function postRun(app: Hono, id: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/trips/${id}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('record の e2e', () => {
  it('AC-1: 走行を残す → 記録・SSR・OG → 削除のあとすべて 404', async () => {
    const app = appWith()
    const { id, ownerToken, plan } = await h.newTrip()
    const first = await postRun(
      app,
      id,
      makeRun({ day: 1, outcome: 'collided', zonePasses: 1 }),
      auth(ownerToken),
    )
    expect(first.status).toBe(201)
    await postRun(
      app,
      id,
      makeRun({ day: 1, outcome: 'completed', zonePasses: 2 }),
      auth(ownerToken),
    )
    await postRun(
      app,
      id,
      makeRun({ day: 2, outcome: 'completed', zonePasses: 3 }),
      auth(ownerToken),
    )

    const recordRes = await app.request(`/api/trips/${id}/record`)
    expect(recordRes.status).toBe(200)
    const body = (await recordRes.json()) as { trip: unknown; record: unknown }
    const record = TripRecordSchema.parse(body.record)
    expect(record.days.slice(0, 2).map((d) => d.result)).toEqual(['completed', 'completed'])
    expect(record.totals.zonePasses).toBe(5)
    expect(record.totals.encounters).toBe(2)
    expect(record.totals.avoided).toBe(2)
    expect(record.totals.alertToBrakeAvgMs).toBe(1200)
    expect(record.status).toBe(plan.days.length === 2 ? 'completed' : 'partial')

    const page = await app.request(`/t/${id}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`content="${URLS.api}/t/${id}/og.png"`)

    const og = await app.request(`/t/${id}/og.png`)
    expect(og.status).toBe(200)
    expect(og.headers.get('Content-Type')).toBe('image/png')

    const del = await app.request(`/api/trips/${id}`, {
      method: 'DELETE',
      headers: auth(ownerToken),
    })
    expect(del.status).toBe(204)
    for (const path of [`/api/trips/${id}/record`, `/t/${id}`, `/t/${id}/og.png`]) {
      expect((await app.request(path)).status, path).toBe(404)
    }
  })

  it('UC-3e: 書き込みは IP あたり 1 分 10 件（11 件目は 429）', async () => {
    const app = appWith()
    const { id, ownerToken } = await h.newTrip()
    for (let i = 0; i < RECORD_WRITES_PER_MINUTE_PER_IP; i += 1) {
      expect((await postRun(app, id, makeRun(), auth(ownerToken))).status).toBe(201)
    }
    expect((await postRun(app, id, makeRun(), auth(ownerToken))).status).toBe(429)
  })

  it('UC-3f: 16 KB を超える body → 413 PAYLOAD_TOO_LARGE', async () => {
    const app = appWith()
    const { id, ownerToken } = await h.newTrip()
    const res = await postRun(
      app,
      id,
      { ...makeRun(), pad: 'x'.repeat(RUN_BODY_MAX_BYTES) },
      auth(ownerToken),
    )
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('UC-3b: 同じ runId の再送は 200', async () => {
    const app = appWith()
    const { id, ownerToken } = await h.newTrip()
    const run = makeRun()
    expect((await postRun(app, id, run, auth(ownerToken))).status).toBe(201)
    expect((await postRun(app, id, run, auth(ownerToken))).status).toBe(200)
  })

  it('UC-3c / MASS-1: 日数を超える day・知らない欄 → 400、保存しない', async () => {
    const app = appWith()
    const { id, ownerToken, plan } = await h.newTrip()
    const tooFar = await postRun(app, id, makeRun({ day: plan.days.length + 1 }), auth(ownerToken))
    expect(tooFar.status).toBe(400)
    for (const extra of [{ tripId: id }, { createdAt: '2027-02-15T10:00:00+09:00' }, { seed: 1 }]) {
      const res = await postRun(app, id, { ...makeRun(), ...extra }, auth(ownerToken))
      expect(res.status).toBe(400)
    }
    expect((await h.records.listRuns(id)).runs).toHaveLength(0)
  })

  it('AUTH-1: トークンなし・形の違うトークン → 401 OWNER_TOKEN_REQUIRED', async () => {
    const app = appWith()
    const { id } = await h.newTrip()
    for (const headers of [{}, { Authorization: 'Basic abc' }, auth('xyz')]) {
      const res = await postRun(app, id, makeRun(), headers)
      expect(res.status).toBe(401)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'OWNER_TOKEN_REQUIRED',
      )
    }
  })

  it('AUTH-2 / AUTH-3 / IDOR-1: 別の旅のトークン → 403 NOT_OWNER（保存も削除もしない）', async () => {
    const app = appWith()
    const a = await h.newTrip(KEY_A)
    const b = await h.newTrip(KEY_B)
    expect((await postRun(app, b.id, makeRun(), auth(a.ownerToken))).status).toBe(403)
    const del = await app.request(`/api/trips/${b.id}`, {
      method: 'DELETE',
      headers: auth(a.ownerToken),
    })
    expect(del.status).toBe(403)
    expect((await app.request(`/api/trips/${b.id}`, { method: 'DELETE' })).status).toBe(401)
    expect((await app.request(`/api/trips/${b.id}/record`)).status).toBe(200)
  })

  it('AUTH-4: 削除のあと、同じトークンで DELETE・POST → 404', async () => {
    const app = appWith()
    const { id, ownerToken } = await h.newTrip()
    await app.request(`/api/trips/${id}`, { method: 'DELETE', headers: auth(ownerToken) })
    expect(
      (await app.request(`/api/trips/${id}`, { method: 'DELETE', headers: auth(ownerToken) }))
        .status,
    ).toBe(404)
    expect((await postRun(app, id, makeRun(), auth(ownerToken))).status).toBe(404)
  })

  it('AUTH-5 / UC-4a / IDOR-2: トークンなしで読め、応答にハッシュ・runId・予算・seed が無い', async () => {
    const app = appWith()
    const { id, ownerToken } = await h.newTrip()
    const run = makeRun()
    await postRun(app, id, run, auth(ownerToken))
    const res = await app.request(`/api/trips/${id}/record`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const text = await res.text()
    const body = JSON.parse(text) as { trip: unknown; record: unknown }
    expect(RecordTripSchema.safeParse(body.trip).success).toBe(true)
    for (const secret of [
      'ownerTokenHash',
      run.runId,
      ownerToken,
      'budgetPerPersonJPY',
      '"seed"',
    ]) {
      expect(text).not.toContain(secret)
    }
    const page = await (await app.request(`/t/${id}`)).text()
    for (const secret of ['ownerTokenHash', run.runId, ownerToken])
      expect(page).not.toContain(secret)
  })

  it('UC-4b: 無い id・形の違う id → 404 TRIP_NOT_FOUND', async () => {
    const app = appWith()
    for (const id of ['Zz99Zz99', 'a'.repeat(30)]) {
      const res = await app.request(`/api/trips/${id}/record`)
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TRIP_NOT_FOUND')
    }
  })
})

describe('GET /t/:id（SSR）', () => {
  it('UC-7a / SEC-2: OG の meta・noindex・CSP、スクリプトが無い', async () => {
    const app = appWith()
    const { id, plan } = await h.newTrip()
    const res = await app.request(`/t/${id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const csp = res.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    const page = await res.text()
    expect(page).toContain(`<meta property="og:title" content="${plan.title}"`)
    expect(page).toContain('og:description')
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image"')
    expect(page).toContain('noindex')
    expect(page).not.toMatch(/<script/i)
    // 文書は 1 つ（head のあとに body、最後に </html>）
    expect(page.indexOf('</head>')).toBeLessThan(page.indexOf('<body>'))
    expect(page.match(/<\/html>/g)).toHaveLength(1)
    expect(page.trimEnd().endsWith('</html>')).toBe(true)
  })

  it('UC-7b: 本文に StatTile・守れたもの・ログ・しおり・B の導線・sim へのリンク', async () => {
    const app = appWith()
    const { id, ownerToken, plan } = await h.newTrip()
    await postRun(app, id, makeRun({ day: 1 }), auth(ownerToken))
    const page = await (await app.request(`/t/${id}`)).text()
    const t = (key: Parameters<typeof recordText>[0], v?: Record<string, number>) =>
      recordText(key, plan.lang, v)
    for (const key of ['statPleasures', 'statZones', 'statDeer', 'statBrake'] as const) {
      expect(page).toContain(t(key))
    }
    expect(page).toContain(t('keptHeading'))
    expect(page).toContain(t('logHeading', { n: 1 }))
    expect(page).toContain(t('shioriHeading'))
    expect(page).toContain(`href="${URLS.pwa}"`)
    // REC-7a（deploy-a R2）: 同じオリジンの /t/:id は SSR になるので、A-7（SPA）へは ?app=1 で開く
    expect(page).toContain(`href="${URLS.sim}/t/${id}?app=1"`)
    expect(page).toContain(`href="${URLS.sim}/plan"`)
  })

  it('UC-7c: タイトルの <script> は文字としてエスケープされる', async () => {
    const { id } = await h.newTrip()
    await h.conn.client.execute({
      sql: "UPDATE trips SET plan = json_set(plan, '$.title', ?) WHERE id = ?",
      args: ['<script>alert(1)</script>&"', id],
    })
    const page = await (await appWith().request(`/t/${id}`)).text()
    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;')
  })

  it('UC-7d: 無い id → 404 の HTML（4 言語の「見つかりません」）', async () => {
    const res = await appWith().request('/t/Zz99Zz99')
    expect(res.status).toBe(404)
    const page = await res.text()
    expect(page).toContain('この記録は見つかりません')
    expect(page).toContain('This record was not found')
    expect(page).not.toMatch(/<script/i)
  })

  it('UC-7e: Host を書き換えても og:url・og:image は PUBLIC_API_URL', async () => {
    const { id } = await h.newTrip()
    const res = await appWith().request(`http://evil.example/t/${id}`, {
      headers: { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' },
    })
    const page = await res.text()
    expect(page).toContain(`<meta property="og:url" content="${URLS.api}/t/${id}"`)
    expect(page).not.toContain('evil.example')
    expect(page).toContain('TRIP RECORD ・ 2027.02.14')
  })
})

describe('GET /t/:id/og.png', () => {
  it('UC-6b: 1200×630 の PNG（resvg で描く）', async () => {
    const { id } = await h.newTrip()
    const res = await appWith().request(`/t/${id}/og.png`)
    expect(res.status).toBe(200)
    const png = new Uint8Array(await res.arrayBuffer())
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE)
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 })
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex')
  }, 20_000)

  it('UC-6c: 描画中が 2 枚あると 3 枚目は 503 OG_BUSY', async () => {
    const pending: (() => void)[] = []
    const render = () =>
      new Promise<Png>((resolve) => {
        pending.push(() => {
          resolve(new Uint8Array([1]))
        })
      })
    const app = appWith({ ogImages: new OgImageRenderer({ fontFiles: [], render }) })
    const trips = [
      await h.newTrip(KEY_A),
      await h.newTrip(KEY_B),
      await h.newTrip('99999999-9999-4999-8999-999999999999'),
    ]
    const [a, b, c] = trips.map((t) => app.request(`/t/${t.id}/og.png`))
    const third = await c
    expect(third?.status).toBe(503)
    expect(((await third?.json()) as { error: { code: string } }).error.code).toBe('OG_BUSY')
    await vi.waitFor(() => {
      expect(pending).toHaveLength(2)
    })
    pending.forEach((done) => {
      done()
    })
    expect((await a)?.status).toBe(200)
    expect((await b)?.status).toBe(200)
  })

  it('UC-6e: 同じ記録の 2 回目は描かない。run が増えると描き直す。削除のあとは 404', async () => {
    let renders = 0
    const render = () => {
      renders += 1
      return Promise.resolve(new Uint8Array([renders]))
    }
    const app = appWith({ ogImages: new OgImageRenderer({ fontFiles: [], render }) })
    const { id, ownerToken } = await h.newTrip()
    await app.request(`/t/${id}/og.png`)
    await app.request(`/t/${id}/og.png`)
    expect(renders).toBe(1)
    await postRun(app, id, makeRun(), auth(ownerToken))
    await app.request(`/t/${id}/og.png`)
    expect(renders).toBe(2)
    await app.request(`/api/trips/${id}`, { method: 'DELETE', headers: auth(ownerToken) })
    expect((await app.request(`/t/${id}/og.png`)).status).toBe(404)
  })

  it('UC-6e: 同じ記録を同時に 3 回取っても描くのは 1 回（503 にならない）', async () => {
    let renders = 0
    const render = () => {
      renders += 1
      return new Promise<Png>((resolve) => {
        setTimeout(() => {
          resolve(new Uint8Array([1]))
        }, 20)
      })
    }
    const app = appWith({ ogImages: new OgImageRenderer({ fontFiles: [], render }) })
    const { id } = await h.newTrip()
    const results = await Promise.all(
      [1, 2, 3].map(async () => await app.request(`/t/${id}/og.png`)),
    )
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(renders).toBe(1)
  })

  it('OG 画像の上限は IP あたり 1 分 20 件', async () => {
    const render = () => Promise.resolve(new Uint8Array([1]))
    const app = appWith({ ogImages: new OgImageRenderer({ fontFiles: [], render }) })
    const { id } = await h.newTrip()
    for (let i = 0; i < OG_IMAGES_PER_MINUTE_PER_IP; i += 1) {
      expect((await app.request(`/t/${id}/og.png`)).status).toBe(200)
    }
    expect((await app.request(`/t/${id}/og.png`)).status).toBe(429)
  })
})

describe('buildShioriSvg', () => {
  it('UC-6a: タイトル・日ごとの行と印・n / N、文字はエスケープ済み', async () => {
    const { plan } = await h.newTrip()
    const trip = RecordTripSchema.parse({
      id: plan.id,
      lang: 'ja',
      title: 'A<B & "C"',
      depart: plan.depart,
      return: plan.return,
      partySize: 4,
      days: plan.days,
    })
    const svg = buildShioriSvg(buildRecordView(trip, summarizeRecord(trip, [makeRun({ day: 1 })])))
    expect(svg).toContain('A&lt;B &amp; &quot;C&quot;')
    expect(svg).not.toContain('A<B')
    expect(svg).toMatch(/0 \/ \d|1 \/ \d/)
    expect(svg).toContain('D1 ')
  })

  it('UC-6d: 長いタイトルは 2 行で「…」、8 日以上は 7 行と「ほか n 日」、制御文字は取り除く', async () => {
    const { plan } = await h.newTrip()
    const base = plan.days[0]
    if (!base) throw new Error('日が無い')
    const days = Array.from({ length: 9 }, (_, i) => ({ ...base, day: i + 1 }))
    const trip = RecordTripSchema.parse({
      id: plan.id,
      lang: 'ja',
      title: `${'流氷とタンチョウと雪見の温泉。'.repeat(6)}\u0007`,
      depart: plan.depart,
      return: plan.return,
      partySize: 4,
      days,
    })
    const svg = buildShioriSvg(buildRecordView(trip, summarizeRecord(trip, [])))
    const titles = [...svg.matchAll(/font-size="50"[^>]*>([^<]*)</g)].map((m) => m[1] ?? '')
    expect(titles).toHaveLength(2)
    expect(titles[1]?.endsWith('…')).toBe(true)
    expect(svg).toContain('ほか 3 日')
    expect(svg).not.toContain('D7 ')
    expect(svg).toContain(`D${String(OG_MAX_DAY_ROWS - 1)} `)
    expect(svg).not.toContain('\u0007')
  })
})
