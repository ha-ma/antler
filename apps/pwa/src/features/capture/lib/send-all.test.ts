import { describe, expect, it, vi } from 'vitest'
import {
  API_BASE,
  captureId,
  createBackend,
  EDGE_BASE,
  jsonResponse,
  makeCapture,
  type ApiBehavior,
  type BackendOptions,
} from '../__tests__/fake-edge'
import { createEdgeApi } from './edge-api'
import { createLedger, sendAll, type SendProgress } from './send-all'
import { uploadCapture } from './upload'

function setup(options: BackendOptions) {
  const backend = createBackend(options)
  const edge = createEdgeApi({
    baseUrl: EDGE_BASE,
    fetch: backend.fetch,
    listMs: 1000,
    edgeMs: 1000,
  })
  const sleep = vi.fn((_ms: number) => Promise.resolve())
  const progress: SendProgress[] = []
  // 「もう一度」をまたぐ記録。同じ setup の run は同じ記録を渡し続ける（画面の useSend と同じ）
  const ledger = createLedger()
  const run = (consent: boolean) =>
    sendAll({
      consent,
      edge,
      sleep,
      ledger,
      upload: (capture, image) =>
        uploadCapture({ baseUrl: API_BASE, capture, image, fetch: backend.fetch }),
      onProgress: (p) => progress.push(p),
    })
  return { backend, sleep, progress, run }
}

const created: ApiBehavior = (call) =>
  jsonResponse(201, { id: call.capture.id, image: call.capture.image })
const status =
  (code: number, headers: Record<string, string> = {}, errorCode = 'X'): ApiBehavior =>
  () =>
    jsonResponse(code, { error: { code: errorCode, message: 'x' } }, headers)

/** 同じ id は 2 回目から 200（Idempotent-Replayed）を返す api */
function idempotentApi(): ApiBehavior {
  const seen = new Set<string>()
  return (call) => {
    const again = seen.has(call.capture.id)
    seen.add(call.capture.id)
    return jsonResponse(
      again ? 200 : 201,
      { id: call.capture.id },
      again ? { 'Idempotent-Replayed': 'true' } : {},
    )
  }
}

describe('sendAll（P3）', () => {
  it('UP-1a: OFF で「提供しない」→ edge に consent:false を送り、api には何も送らない', async () => {
    const { backend, run } = setup({ items: [makeCapture(1), makeCapture(2)] })
    const outcome = await run(false)

    expect(backend.edgeCalls.filter((c) => c.route === 'consent').map((c) => c.body)).toEqual([
      { consent: false, ids: [captureId(1), captureId(2)] },
    ])
    expect(backend.apiCalls).toHaveLength(0)
    expect(backend.edgeCalls.some((c) => c.route === 'image' || c.route === 'uploaded')).toBe(false)
    expect(outcome).toEqual({ provided: 0, failed: 0, removed: 2, stopped: null })
    expect(backend.state.items).toHaveLength(0)
  })

  it('UP-1k: OFF の consent:false は edge の削除。扱ったものは二度扱わない（同じ一覧が返り続けてもループしない）', async () => {
    const { backend, run } = setup({ items: [makeCapture(1)] })
    // 削除に失敗する（件数 0 のまま残る）edge でも止まる
    const stubborn = createBackend({ items: [makeCapture(1)] })
    const original = stubborn.fetch
    const edge = createEdgeApi({
      baseUrl: EDGE_BASE,
      fetch: (url, init) =>
        url.endsWith('/captures/consent')
          ? Promise.resolve(jsonResponse(200, { updated: 0 }))
          : original(url, init),
      listMs: 1000,
      edgeMs: 1000,
    })
    const outcome = await sendAll({
      consent: false,
      edge,
      sleep: () => Promise.resolve(),
      upload: () => Promise.reject(new Error('呼ばれない')),
    })
    expect(outcome).toEqual({ provided: 0, failed: 0, removed: 0, stopped: null })
    expect(stubborn.state.items).toHaveLength(1)
    await run(false)
    expect(backend.edgeCalls.find((c) => c.route === 'consent')?.body).toEqual({
      consent: false,
      ids: [captureId(1)],
    })
  })

  it('UP-1b: ON で「送る」→ 同意 → 取り直し → 画像 → api の multipart → 成功した id だけ送信済み（この順）', async () => {
    const { backend, run, progress } = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: created,
    })
    const outcome = await run(true)

    expect(outcome).toEqual({ provided: 2, failed: 0, removed: 0, stopped: null })
    expect(backend.edgeCalls.map((c) => c.route)).toEqual([
      'list',
      'consent',
      'list',
      'image',
      'uploaded',
      'image',
      'uploaded',
      'list',
    ])
    expect(backend.edgeCalls.find((c) => c.route === 'consent')?.body).toEqual({
      consent: true,
      ids: [captureId(1), captureId(2)],
    })
    expect(backend.apiCalls.map((c) => c.keys)).toEqual([
      ['capture', 'image'],
      ['capture', 'image'],
    ])
    expect(backend.apiCalls.map((c) => c.capture.consent)).toEqual([true, true])
    expect(backend.edgeCalls.filter((c) => c.route === 'uploaded').map((c) => c.body)).toEqual([
      { ids: [captureId(1)] },
      { ids: [captureId(2)] },
    ])
    expect(backend.state.items.every((i) => i.uploaded)).toBe(true)
    expect(progress.at(-1)).toMatchObject({ provided: 2, waiting: false })
  })

  it('UP-1c: isUploadable でない Capture（壊れた形）は api に送らず失敗に数える', async () => {
    const broken = makeCapture(1, { roadSegment: '43.1,144.3' })
    const { backend, run } = setup({ items: [broken, makeCapture(2)], api: created })
    const outcome = await run(true)

    expect(outcome).toEqual({ provided: 1, failed: 1, removed: 0, stopped: null })
    expect(backend.apiCalls.map((c) => c.capture.id)).toEqual([captureId(2)])
    expect(backend.edgeCalls.filter((c) => c.route === 'image')).toHaveLength(1)
  })

  it('AUTH-12: OFF なら api に何も送らず、ON でも isUploadable でない Capture は送らない', async () => {
    const off = setup({ items: [makeCapture(1)], api: created })
    await off.run(false)
    expect(off.backend.apiCalls).toHaveLength(0)

    const on = setup({ items: [makeCapture(1, { roadSegment: 'x y' })], api: created })
    const outcome = await on.run(true)
    expect(on.backend.apiCalls).toHaveLength(0)
    expect(outcome.failed).toBe(1)
  })

  it('UP-1d: ネットワークの失敗で止めて残りは未送信のまま。もう一度で続きから（送信済みは飛ばす）', async () => {
    let offline = true
    const { backend, run } = setup({
      items: [makeCapture(1), makeCapture(2), makeCapture(3)],
      api: (call, n) => (n === 2 && offline ? 'network' : created(call, n)),
    })
    const first = await run(true)
    expect(first).toEqual({ provided: 1, failed: 0, removed: 0, stopped: 'network' })
    expect(backend.state.items.map((i) => i.uploaded)).toEqual([true, false, false])

    offline = false
    const second = await run(true)
    expect(second).toEqual({ provided: 3, failed: 0, removed: 0, stopped: null })
    expect(backend.apiCalls.map((c) => c.capture.id)).toEqual([
      captureId(1),
      captureId(2),
      captureId(2),
      captureId(3),
    ])
    expect(backend.state.items.every((i) => i.uploaded)).toBe(true)
  })

  it('FAIL-9: 途中でネットワークが切れても、送れた分だけ edge に送信済みが付き、残りは未送信', async () => {
    const { backend, run } = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: (call, n) => (n === 2 ? 'network' : created(call, n)),
    })
    const outcome = await run(true)
    expect(outcome.stopped).toBe('network')
    expect(backend.edgeCalls.filter((c) => c.route === 'uploaded').map((c) => c.body)).toEqual([
      { ids: [captureId(1)] },
    ])
    expect(backend.state.items.filter((i) => !i.uploaded).map((i) => i.capture.id)).toEqual([
      captureId(2),
    ])
  })

  it('UP-1d: 5xx でも止まる（api の STORE_FULL=503 を含む）', async () => {
    for (const code of [500, 502, 503]) {
      const { backend, run } = setup({ items: [makeCapture(1), makeCapture(2)], api: status(code) })
      const outcome = await run(true)
      expect(outcome.stopped).toBe('network')
      expect(backend.apiCalls).toHaveLength(1)
      expect(backend.state.items.every((i) => !i.uploaded)).toBe(true)
    }
  })

  it.each([400, 409, 413, 422])(
    'UP-1e: %i はその 1 件を失敗に数え、edge に consent:false（削除）を送って未送信から外し、続ける',
    async (code) => {
      const { backend, run } = setup({
        items: [makeCapture(1), makeCapture(2)],
        api: (call, n) => (n === 1 ? status(code)(call, n) : created(call, n)),
      })
      const outcome = await run(true)

      expect(outcome).toEqual({ provided: 1, failed: 1, removed: 0, stopped: null })
      const consentBodies = backend.edgeCalls
        .filter((c) => c.route === 'consent')
        .map((c) => c.body)
      expect(consentBodies).toContainEqual({ consent: false, ids: [captureId(1)] })
      expect(backend.state.items.map((i) => i.capture.id)).toEqual([captureId(2)])
      expect(backend.state.items[0]?.uploaded).toBe(true)
    },
  )

  it('UP-1e: 400 でも code が INVALID_INPUT か本文が読めない（不明）なら削除する', async () => {
    for (const body of [
      status(400, {}, 'INVALID_INPUT'),
      (): ReturnType<ApiBehavior> => jsonResponse(400, 'not an error object'),
    ]) {
      const { backend, run } = setup({ items: [makeCapture(1)], api: body })
      const outcome = await run(true)
      expect(outcome).toEqual({ provided: 0, failed: 1, removed: 0, stopped: null })
      expect(backend.state.items).toHaveLength(0)
    }
  })

  it('UP-1e: 400 INVALID_IMAGE は失敗に数えるが、edge に consent:false（削除）を送らない（未送信のまま保持期間に任せる）', async () => {
    const { backend, run } = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: (call, n) => (n === 1 ? status(400, {}, 'INVALID_IMAGE')(call, n) : created(call, n)),
    })
    const outcome = await run(true)

    expect(outcome).toEqual({ provided: 1, failed: 1, removed: 0, stopped: null })
    const consentBodies = backend.edgeCalls.filter((c) => c.route === 'consent').map((c) => c.body)
    expect(consentBodies).toEqual([{ consent: true, ids: [captureId(1), captureId(2)] }])
    expect(backend.state.items.map((i) => i.capture.id)).toEqual([captureId(1), captureId(2)])
    expect(backend.state.items[0]?.uploaded).toBe(false)
  })

  it('UP-1d: 「もう一度」で、edge に残った失敗を二重に数えない（件数は id の集合）', async () => {
    let offline = true
    const { run } = setup({
      items: [makeCapture(1), makeCapture(2), makeCapture(3)],
      api: (call, n) =>
        call.capture.id === captureId(1)
          ? status(400, {}, 'INVALID_IMAGE')(call, n)
          : call.capture.id === captureId(3) && offline
            ? 'network'
            : created(call, n),
    })
    const first = await run(true)
    expect(first).toEqual({ provided: 1, failed: 1, removed: 0, stopped: 'network' })
    offline = false
    // id1（INVALID_IMAGE で edge に残る）は再実行でもう一度送られて失敗する。failed は 1 のまま
    const second = await run(true)
    expect(second).toEqual({ provided: 2, failed: 1, removed: 0, stopped: null })
  })

  it('UP-1e: 削除の POST が失敗しても続ける（未送信に残るだけ）', async () => {
    const { run, backend } = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: (call, n) => (n === 1 ? status(422)(call, n) : created(call, n)),
      edgeFault: (route, n) => (route === 'consent' && n === 2 ? 'network' : undefined),
    })
    const outcome = await run(true)
    expect(outcome).toEqual({ provided: 1, failed: 1, removed: 0, stopped: null })
    expect(backend.state.items.find((i) => i.capture.id === captureId(1))?.uploaded).toBe(false)
  })

  it('UP-1i: 429 は Retry-After の秒だけ待って同じ 1 件をもう一度送る', async () => {
    const { backend, run, sleep, progress } = setup({
      items: [makeCapture(1)],
      api: (call, n) =>
        n === 1 ? status(429, { 'Retry-After': '30' })(call, n) : created(call, n),
    })
    const outcome = await run(true)
    expect(sleep).toHaveBeenCalledWith(30000)
    expect(backend.apiCalls.map((c) => c.capture.id)).toEqual([captureId(1), captureId(1)])
    expect(outcome).toEqual({ provided: 1, failed: 0, removed: 0, stopped: null })
    expect(progress.some((p) => p.waiting)).toBe(true)
    expect(progress.at(-1)?.waiting).toBe(false)
  })

  it('UP-1i: Retry-After は最大 65 秒', async () => {
    const { run, sleep } = setup({
      items: [makeCapture(1)],
      api: (call, n) =>
        n === 1 ? status(429, { 'Retry-After': '3600' })(call, n) : created(call, n),
    })
    await run(true)
    expect(sleep).toHaveBeenCalledWith(65000)
  })

  it('UP-1i: 待ってもまた 429 なら止めて「混み合っています」（busy）。未送信のまま', async () => {
    const { backend, run } = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: status(429, { 'Retry-After': '1' }),
    })
    const outcome = await run(true)
    expect(outcome.stopped).toBe('busy')
    expect(backend.apiCalls).toHaveLength(2)
    expect(backend.state.items.every((i) => !i.uploaded)).toBe(true)
  })

  it.each([404, 405])(
    'UP-1i: %i は「送り先に届きませんでした」で止める（全件を失敗にしない）',
    async (code) => {
      const { backend, run } = setup({ items: [makeCapture(1), makeCapture(2)], api: status(code) })
      const outcome = await run(true)
      expect(outcome).toEqual({ provided: 0, failed: 0, removed: 0, stopped: 'misconfigured' })
      expect(backend.apiCalls).toHaveLength(1)
      expect(backend.state.items).toHaveLength(2)
    },
  )

  it('UP-1j: 200 件を超える未送信はページを繰り返して全部扱う', async () => {
    const items = Array.from({ length: 205 }, (_, i) => makeCapture(i + 1))
    const { backend, run } = setup({ items, api: created })
    const outcome = await run(true)

    expect(outcome).toEqual({ provided: 205, failed: 0, removed: 0, stopped: null })
    const consentSizes = backend.edgeCalls
      .filter((c) => c.route === 'consent')
      .map((c) => (c.body as { ids: string[] }).ids.length)
    expect(consentSizes).toEqual([200, 5])
    expect(backend.apiCalls).toHaveLength(205)
    expect(new Set(backend.apiCalls.map((c) => c.capture.id)).size).toBe(205)
  })

  it('UP-1j: OFF でも 200 件ずつのページを繰り返して全部消す', async () => {
    const items = Array.from({ length: 205 }, (_, i) => makeCapture(i + 1))
    const { backend, run } = setup({ items })
    const outcome = await run(false)
    expect(outcome.removed).toBe(205)
    expect(backend.state.items).toHaveLength(0)
  })

  it('UP-1j: 同意の POST が失敗したら api に何も送らない', async () => {
    const { backend, run } = setup({
      items: [makeCapture(1)],
      api: created,
      edgeFault: (route) => (route === 'consent' ? 500 : undefined),
    })
    const outcome = await run(true)
    expect(outcome.stopped).toBe('edge')
    expect(backend.apiCalls).toHaveLength(0)
  })

  it('UP-1j: 取り直した一覧で consent が true のものだけを送る（送れない 1 件は失敗に数える）', async () => {
    const { backend, run } = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: created,
      stuckConsent: [captureId(1)],
    })
    const outcome = await run(true)
    expect(outcome).toEqual({ provided: 1, failed: 1, removed: 0, stopped: null })
    expect(backend.apiCalls.map((c) => c.capture.id)).toEqual([captureId(2)])
  })

  it('UP-1j: 同意のあと保持期間で消えた分は数えない', async () => {
    const { backend, run } = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: created,
      vanishOnConsent: [captureId(1)],
    })
    const outcome = await run(true)
    expect(outcome).toEqual({ provided: 1, failed: 0, removed: 0, stopped: null })
    expect(backend.apiCalls.map((c) => c.capture.id)).toEqual([captureId(2)])
  })

  it('UP-1j: 未送信が 0 件なら何もしない。一覧が取れなければ edge の失敗で止まる', async () => {
    const empty = setup({ items: [], api: created })
    expect(await empty.run(true)).toEqual({ provided: 0, failed: 0, removed: 0, stopped: null })
    expect(empty.backend.edgeCalls.map((c) => c.route)).toEqual(['list'])

    const down = setup({ items: [makeCapture(1)], edgeFault: () => 'network' })
    expect((await down.run(true)).stopped).toBe('edge')
  })

  it('FAIL-10: 送信済みの更新だけ失敗 → edge の失敗で止まる。次回の再送で api は 200（二重保存にならない）', async () => {
    const { backend, run } = setup({
      items: [makeCapture(1)],
      api: idempotentApi(),
      edgeFault: (route, n) => (route === 'uploaded' && n === 1 ? 'network' : undefined),
    })
    const first = await run(true)
    expect(first).toEqual({ provided: 1, failed: 0, removed: 0, stopped: 'edge' })
    expect(backend.state.items[0]?.uploaded).toBe(false)

    const second = await run(true)
    // 同じ id の再送は 200（replayed）。提供は id の集合なので 1 件のまま（二重に数えない）
    expect(second).toEqual({ provided: 1, failed: 0, removed: 0, stopped: null })
    expect(backend.apiCalls).toHaveLength(2)
    expect(backend.state.items[0]?.uploaded).toBe(true)
  })

  it('UP-1b: 画像が edge から消えていれば（404）その 1 件を失敗に数えて続ける。画像の取得が切れたら edge の失敗で止まる', async () => {
    const gone = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: created,
      edgeFault: (route, n) => (route === 'image' && n === 1 ? 404 : undefined),
    })
    expect(await gone.run(true)).toEqual({ provided: 1, failed: 1, removed: 0, stopped: null })

    const cut = setup({
      items: [makeCapture(1)],
      api: created,
      edgeFault: (route) => (route === 'image' ? 'network' : undefined),
    })
    expect((await cut.run(true)).stopped).toBe('edge')
    expect(cut.backend.apiCalls).toHaveLength(0)
  })

  it('UP-1h: 進み具合は扱った件数（提供・失敗・削除）を足し続ける', async () => {
    const { run, progress } = setup({
      items: [makeCapture(1), makeCapture(2)],
      api: (call, n) => (n === 1 ? status(400)(call, n) : created(call, n)),
    })
    await run(true)
    const handled = progress.map((p) => p.provided + p.failed)
    expect(handled).toEqual([...handled].sort((a, b) => a - b))
    expect(progress.at(-1)).toMatchObject({ provided: 1, failed: 1 })
  })
})
