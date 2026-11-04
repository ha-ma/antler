import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { jsonResponse, makeCapture } from '../__tests__/fake-edge'
import { classifyStatus, parseRetryAfter, uploadCapture, type FetchLike } from './upload'

const image = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })

describe('uploadCapture（P5）', () => {
  it('UP-1f: api へのリクエストは credentials omit・referrerPolicy no-referrer、本文は capture と image の 2 欄だけ', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetch: FetchLike = (url, init) => {
      calls.push({ url, init: init ?? {} })
      return Promise.resolve(jsonResponse(201, {}))
    }
    const capture = makeCapture(1, { consent: true })
    const result = await uploadCapture({
      baseUrl: 'https://api.example.com',
      capture,
      image: image(),
      fetch,
    })

    expect(result).toEqual({ kind: 'ok' })
    const call = calls[0]
    expect(call?.url).toBe('https://api.example.com/api/captures')
    expect(call?.init.method).toBe('POST')
    expect(call?.init.credentials).toBe('omit')
    expect(call?.init.referrerPolicy).toBe('no-referrer')
    // Content-Type はブラウザが境界つきで付ける。クッキー・認証などのヘッダを足さない
    expect(call?.init.headers).toBeUndefined()
    const form = call?.init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect([...form.keys()]).toEqual(['capture', 'image'])
    expect(JSON.parse(form.get('capture') as string)).toEqual(capture)
    expect(form.get('image')).toBeInstanceOf(Blob)
  })

  it('UP-1g: uploadCapture は PWA・sim のどちらにも依存せず（import は @antler/schema の型だけ）、fetch を差し込める', async () => {
    const source = readFileSync(resolve(__dirname, 'upload.ts'), 'utf8')
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    expect(imports).toEqual(['@antler/schema'])
    expect(source).not.toMatch(/\bwindow\b|\bdocument\b|\bnavigator\b|globalThis\.fetch/)

    const fetch = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(200, {})))
    await uploadCapture({
      baseUrl: 'http://x',
      capture: makeCapture(1, { consent: true }),
      image: image(),
      fetch,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('UP-1g: PNG の画像は png の名前で送る', async () => {
    let form: FormData | undefined
    const fetch: FetchLike = (_url, init) => {
      form = init?.body as FormData
      return Promise.resolve(jsonResponse(201, {}))
    }
    await uploadCapture({
      baseUrl: 'http://x',
      capture: makeCapture(1, { consent: true }),
      image: new Blob([new Uint8Array([1])], { type: 'image/png' }),
      fetch,
    })
    expect((form?.get('image') as File).name).toBe('cap_000000000001.png')
  })

  it.each([
    [201, { kind: 'ok' }],
    [200, { kind: 'replayed' }],
    [400, { kind: 'permanent', status: 400, code: null }],
    [409, { kind: 'permanent', status: 409, code: null }],
    [413, { kind: 'permanent', status: 413, code: null }],
    [422, { kind: 'permanent', status: 422, code: null }],
    [500, { kind: 'retryable', status: 500 }],
    [503, { kind: 'retryable', status: 503 }],
    [404, { kind: 'misconfigured', status: 404 }],
    [405, { kind: 'misconfigured', status: 405 }],
    [401, { kind: 'misconfigured', status: 401 }],
    [204, { kind: 'misconfigured', status: 204 }],
  ])('UP-1e/UP-1i: status %i の分類', (status, expected) => {
    expect(classifyStatus(status, null)).toEqual(expected)
  })

  it('UP-1c: isUploadable でない Capture（同意なし・壊れた形）は fetch せず permanent を返す（sim が共用しても同意のないものを送らない）', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(201, {})))
    const noConsent = makeCapture(1, { consent: false })
    const broken = makeCapture(2, { consent: true, roadSegment: '43.1,144.3' })
    for (const capture of [noConsent, broken]) {
      const result = await uploadCapture({
        baseUrl: 'http://x',
        capture,
        image: image(),
        fetch,
      })
      expect(result).toEqual({ kind: 'permanent', status: 0, code: null })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('UP-1e: 400 はエラー本文 {error:{code}} の code を読む。読めなければ null。ほかの status では本文を読まない', async () => {
    const send = (response: Awaited<ReturnType<FetchLike>> | 'throws') =>
      uploadCapture({
        baseUrl: 'http://x',
        capture: makeCapture(1, { consent: true }),
        image: image(),
        fetch: () => Promise.resolve(response === 'throws' ? brokenBody() : response),
      })
    const brokenBody = () => ({
      ...jsonResponse(400, {}),
      json: () => Promise.reject(new Error('bad json')),
    })
    expect(
      await send(jsonResponse(400, { error: { code: 'INVALID_IMAGE', message: 'x' } })),
    ).toEqual({
      kind: 'permanent',
      status: 400,
      code: 'INVALID_IMAGE',
    })
    expect(await send(jsonResponse(400, { error: { code: 5 } }))).toMatchObject({ code: null })
    expect(await send(jsonResponse(400, 'text'))).toMatchObject({ code: null })
    expect(await send(jsonResponse(400, null))).toMatchObject({ code: null })
    expect(await send('throws')).toEqual({ kind: 'permanent', status: 400, code: null })
    // 422 は本文を読まない（code は不要）
    expect(await send(jsonResponse(422, { error: { code: 'CONSENT_REQUIRED' } }))).toEqual({
      kind: 'permanent',
      status: 422,
      code: null,
    })
  })

  it('UP-1i: 429 以外の Retry-After は無視する（500 に付いていても待たない分類のまま）', () => {
    expect(classifyStatus(503, '30')).toEqual({ kind: 'retryable', status: 503 })
    expect(classifyStatus(400, '30', 'INVALID_INPUT')).toEqual({
      kind: 'permanent',
      status: 400,
      code: 'INVALID_INPUT',
    })
  })

  it('UP-1d: 回線の失敗（fetch の例外）は retryable', async () => {
    const fetch: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'))
    const result = await uploadCapture({
      baseUrl: 'http://x',
      capture: makeCapture(1, { consent: true }),
      image: image(),
      fetch,
    })
    expect(result).toEqual({ kind: 'retryable', status: null })
  })

  it('UP-1i: 429 は Retry-After の秒（最大 65）。読めなければ 5 秒', async () => {
    expect(classifyStatus(429, '30')).toEqual({ kind: 'busy', retryAfterSeconds: 30 })
    expect(parseRetryAfter('999')).toBe(65)
    expect(parseRetryAfter('0')).toBe(0)
    expect(parseRetryAfter(null)).toBe(5)
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(5)
    expect(parseRetryAfter('-3')).toBe(5)
    const fetch: FetchLike = () => Promise.resolve(jsonResponse(429, {}, { 'Retry-After': '12' }))
    const result = await uploadCapture({
      baseUrl: 'http://x',
      capture: makeCapture(1, { consent: true }),
      image: image(),
      fetch,
    })
    expect(result).toEqual({ kind: 'busy', retryAfterSeconds: 12 })
  })
})
