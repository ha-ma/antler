import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/shared/utils/logger'
import { toFix, watchFixes, type GeoWatch, type PositionLike } from './gps'

function position(over: Partial<PositionLike['coords']> = {}, timestamp = 1000): PositionLike {
  return {
    coords: { latitude: 43.7, longitude: 142.2, accuracy: 12, speed: 10, ...over },
    timestamp,
  }
}

function geoMock() {
  let ok: (p: PositionLike) => void = () => undefined
  let fail: (e: { code: number }) => void = () => undefined
  const geo = {
    watchPosition: vi.fn((o: typeof ok, f: typeof fail, _options: unknown) => {
      ok = o
      fail = f
      return 7
    }),
    clearWatch: vi.fn(),
  } satisfies GeoWatch
  return { geo, ok: (p: PositionLike) => ok(p), fail: (code: number) => fail({ code }) }
}

beforeEach(() => {
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('UC-1 位置の購読', () => {
  it('UC-1a: 高精度・maximumAge 0 で購読し、解除で clearWatch', () => {
    const m = geoMock()
    const stop = watchFixes(
      m.geo,
      () => undefined,
      () => undefined,
    )
    expect(m.geo.watchPosition).toHaveBeenCalledTimes(1)
    expect(m.geo.watchPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
    })
    stop()
    expect(m.geo.clearWatch).toHaveBeenCalledWith(7)
  })

  it('UC-1c / UC-2g: 測位を Fix に直す（時刻は受け取った時刻）。speed が無い・NaN は undefined、数でない座標は捨てる', () => {
    expect(toFix(position(), 5000)).toEqual({
      lon: 142.2,
      lat: 43.7,
      accuracyM: 12,
      timestamp: 5000,
      speedMps: 10,
    })
    expect(toFix(position({ speed: null }), 1)?.speedMps).toBeUndefined()
    expect(toFix(position({ speed: Number.NaN }), 1)?.speedMps).toBeUndefined()
    expect(toFix(position({ accuracy: Number.NaN }), 1)?.accuracyM).toBeUndefined()
    expect(toFix(position({ latitude: Number.NaN }), 1)).toBeNull()
    expect(toFix(position({}, Number.NaN), Number.NaN)).toBeNull()
  })

  it('UC-1c: 数でない座標の測位は onFix に渡さない', () => {
    const m = geoMock()
    const onFix = vi.fn()
    watchFixes(m.geo, onFix, () => undefined)
    m.ok(position({ longitude: Number.NaN }))
    m.ok(position())
    expect(onFix).toHaveBeenCalledTimes(1)
  })

  it('UC-1d: エラーはコードだけをログに残し、許可なし（1）は onDenied', () => {
    const m = geoMock()
    const onDenied = vi.fn()
    watchFixes(m.geo, () => undefined, onDenied)
    m.fail(2)
    expect(onDenied).not.toHaveBeenCalled()
    m.fail(1)
    expect(onDenied).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.warn).mock.calls[0]).toEqual(['gps.error', { code: 2 }])
  })

  it('UC-1d: 測位の座標はログに出ない', () => {
    const m = geoMock()
    watchFixes(
      m.geo,
      () => undefined,
      () => undefined,
    )
    m.ok(position())
    m.fail(3)
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toMatch(/43\.7|142\.2/)
  })

  it('UC-1b: geolocation が無ければ購読しない（例外にならない）。watchPosition の例外も握る', () => {
    expect(() =>
      watchFixes(
        undefined,
        () => undefined,
        () => undefined,
      )(),
    ).not.toThrow()
    const geo = {
      watchPosition: () => {
        throw new Error('x')
      },
      clearWatch: vi.fn(),
    }
    const stop = watchFixes(
      geo,
      () => undefined,
      () => undefined,
    )
    stop()
    expect(geo.clearWatch).not.toHaveBeenCalled()
  })
})
