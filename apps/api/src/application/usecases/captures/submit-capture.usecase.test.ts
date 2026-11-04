import {
  buildCapture,
  buildJpeg,
  buildPng,
  MemoryCaptureRepository,
} from '../../../../tests/factories/captures.js'
import { FixedClock } from '../../../../tests/factories/trips.js'
import {
  CaptureConflictError,
  ConsentRequiredError,
  InvalidImageError,
  StoreFullError,
} from '../../../domain/captures/errors/capture-errors.js'
import { NodeSha256Hasher } from '../../../infrastructure/security/node-crypto.js'
import { NodeSha256BytesHasher } from '../../../infrastructure/security/node-bytes-hasher.js'
import { SubmitCaptureUseCase } from './submit-capture.usecase.js'

const NOW = Date.parse('2026-11-04T12:00:00+09:00')

function setup(limits: { maxItems?: number; maxBytes?: number } = {}) {
  const captures = new MemoryCaptureRepository()
  const useCase = new SubmitCaptureUseCase({
    captures,
    hasher: new NodeSha256Hasher(),
    bytesHasher: new NodeSha256BytesHasher(),
    clock: new FixedClock(NOW),
    maxItems: limits.maxItems ?? 50_000,
    maxBytes: limits.maxBytes ?? 5 * 1024 ** 3,
  })
  return { captures, useCase }
}

describe('SubmitCaptureUseCase', () => {
  it('API-1a: 保存すると、サーバーが決めた論理の画像パスと consent: true で記録し、受け取った時刻を持つ', async () => {
    const { captures, useCase } = setup()
    const image = buildJpeg()
    const out = await useCase.execute({
      capture: buildCapture({ image: 'captures/whatever-the-client-said.png' }),
      image,
    })
    expect(out).toEqual({
      id: 'cap_0a1b2c3d4e5f',
      image: 'captures/cap_0a1b2c3d4e5f.jpg',
      replayed: false,
      imageBytes: image.byteLength,
    })
    const saved = captures.items.get('cap_0a1b2c3d4e5f')
    expect(saved?.capture.image).toBe('captures/cap_0a1b2c3d4e5f.jpg')
    expect(saved?.capture.consent).toBe(true)
    expect(saved?.receivedAt).toBe(new Date(NOW).toISOString())
    expect(saved?.image.format).toBe('jpeg')
    expect(saved?.image.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(saved?.bodyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('API-1a: PNG の論理パスは .png', async () => {
    const { useCase } = setup()
    const out = await useCase.execute({
      capture: buildCapture({ id: 'cap_pngcase1', source: 'sim', image: 'captures/x.png' }),
      image: buildPng(),
    })
    expect(out.image).toBe('captures/cap_pngcase1.png')
  })

  it('API-1d・AUTH-1: consent: false は ConsentRequiredError。画像の検査より先で、何も保存しない', async () => {
    const { captures, useCase } = setup()
    // 画像も壊れているが、同意の検査が先に当たる（A2 の順）
    await expect(
      useCase.execute({
        capture: buildCapture({ consent: false }),
        image: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toBeInstanceOf(ConsentRequiredError)
    expect(captures.items.size).toBe(0)
  })

  it('AUTH-4: メタデータ付き・寸法違い・画像でないものは InvalidImageError。保存しない', async () => {
    const { captures, useCase } = setup()
    for (const image of [
      buildJpeg({ exif: true }),
      buildJpeg({ width: 100, height: 100 }),
      new TextEncoder().encode('not an image'),
    ]) {
      await expect(useCase.execute({ capture: buildCapture(), image })).rejects.toBeInstanceOf(
        InvalidImageError,
      )
    }
    expect(captures.items.size).toBe(0)
  })

  it('API-1b・IDEM-1: 同じ id・同じ中身の再送は replayed: true で、保存は 1 つのまま', async () => {
    const { captures, useCase } = setup()
    const input = { capture: buildCapture(), image: buildJpeg() }
    const first = await useCase.execute(input)
    const second = await useCase.execute(input)
    expect(first.replayed).toBe(false)
    expect(second).toEqual({ ...first, replayed: true })
    expect(captures.items.size).toBe(1)
  })

  it('API-1b: 再送はクライアントが送った image のパスが違っても同じ（サーバーの形で比べる）', async () => {
    const { useCase } = setup()
    await useCase.execute({
      capture: buildCapture({ image: 'captures/a.jpg' }),
      image: buildJpeg(),
    })
    const again = await useCase.execute({
      capture: buildCapture({ image: 'captures/b.jpg' }),
      image: buildJpeg(),
    })
    expect(again.replayed).toBe(true)
  })

  it('API-1c・IDEM-2・AUTH-2: 同じ id で Capture が違えば CaptureConflictError。既存は変わらない', async () => {
    const { captures, useCase } = setup()
    await useCase.execute({ capture: buildCapture(), image: buildJpeg() })
    const before = captures.items.get('cap_0a1b2c3d4e5f')
    await expect(
      useCase.execute({ capture: buildCapture({ distanceM: 10 }), image: buildJpeg() }),
    ).rejects.toBeInstanceOf(CaptureConflictError)
    expect(captures.items.get('cap_0a1b2c3d4e5f')).toBe(before)
  })

  it('IDEM-2: 同じ id で画像だけ違えば CaptureConflictError', async () => {
    const { captures, useCase } = setup()
    await useCase.execute({ capture: buildCapture(), image: buildJpeg() })
    await expect(
      useCase.execute({ capture: buildCapture(), image: buildJpeg({ scanWithMarkers: true }) }),
    ).rejects.toBeInstanceOf(CaptureConflictError)
    expect(captures.items.size).toBe(1)
  })

  it('API-1m: cap_A と cap_a は同じ key。同じ本文（同じ id）なら replay、id の綴りが違えば本文が違うので 409', async () => {
    const { captures, useCase } = setup()
    const upper = buildCapture({ id: 'cap_ABCDEF123456' })
    await useCase.execute({ capture: upper, image: buildJpeg() })
    expect((await useCase.execute({ capture: upper, image: buildJpeg() })).replayed).toBe(true)
    await expect(
      useCase.execute({ capture: buildCapture({ id: 'cap_abcdef123456' }), image: buildJpeg() }),
    ).rejects.toBeInstanceOf(CaptureConflictError)
    expect([...captures.items.keys()]).toEqual(['cap_abcdef123456'])
  })

  it('API-1i: 件数が上限なら StoreFullError。保存のたびに増えるので数え直しは要らない', async () => {
    const { captures, useCase } = setup({ maxItems: 2 })
    await useCase.execute({ capture: buildCapture({ id: 'cap_aaaaaa000001' }), image: buildJpeg() })
    await useCase.execute({ capture: buildCapture({ id: 'cap_aaaaaa000002' }), image: buildJpeg() })
    await expect(
      useCase.execute({ capture: buildCapture({ id: 'cap_aaaaaa000003' }), image: buildJpeg() }),
    ).rejects.toBeInstanceOf(StoreFullError)
    expect(captures.items.size).toBe(2)
  })

  it('API-1i: 上限でも、すでにあるものの再送（replay）は通る（空きの確認は同じ id の判定のあと）', async () => {
    const { useCase } = setup({ maxItems: 1 })
    const input = { capture: buildCapture(), image: buildJpeg() }
    await useCase.execute(input)
    expect((await useCase.execute(input)).replayed).toBe(true)
  })

  it('API-1o: 画像の合計が上限以上なら StoreFullError', async () => {
    const size = buildJpeg().byteLength
    const { useCase } = setup({ maxBytes: size + 1 })
    await useCase.execute({ capture: buildCapture({ id: 'cap_bbbbbb000001' }), image: buildJpeg() })
    // 合計 = size < size + 1 なので、もう 1 枚は入る
    await useCase.execute({ capture: buildCapture({ id: 'cap_bbbbbb000002' }), image: buildJpeg() })
    // 合計 = 2 * size >= size + 1
    await expect(
      useCase.execute({ capture: buildCapture({ id: 'cap_bbbbbb000003' }), image: buildJpeg() }),
    ).rejects.toBeInstanceOf(StoreFullError)
  })

  it('CONC-1: 同じ id の同時の 2 要求は、片方が created で、もう片方は同じ中身なら replay', async () => {
    const { captures, useCase } = setup()
    const input = { capture: buildCapture(), image: buildJpeg() }
    const [a, b] = await Promise.all([useCase.execute(input), useCase.execute(input)])
    expect([a.replayed, b.replayed].sort()).toEqual([false, true])
    expect(captures.items.size).toBe(1)
  })

  it('FAIL-8: 保存が失敗（書けない）したら例外をそのまま投げ、同じ id の再送で保存できる', async () => {
    const { captures, useCase } = setup()
    captures.failNextCreate = new Error('ENOSPC')
    const input = { capture: buildCapture(), image: buildJpeg() }
    await expect(useCase.execute(input)).rejects.toThrow('ENOSPC')
    expect(captures.items.size).toBe(0)
    expect((await useCase.execute(input)).replayed).toBe(false)
  })
})
