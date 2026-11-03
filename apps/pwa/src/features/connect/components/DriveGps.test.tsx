import { AlertSoundController, type AudioPort } from '@antler/alert-ui'
import { parseZoneCollection, type ZoneCollection } from '@antler/zones'
import { act, fireEvent, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/shared/utils/logger'
import { FakeSocket } from '@/test/fake-socket'
import { renderWithProviders as render } from '@/test/render'
import type { PositionLike } from '../lib/gps'
import type { PermissionStatusLike } from '../lib/location'
import type { ConnectServices } from '../types'
import { ConnectFlow } from './ConnectFlow'

// pwa-drive の画面側のテスト。実在のゾーン（国道 12 号 神居古潭）の中心線の上と、そこから 12 km 離れた点で確かめる。

const zones: ZoneCollection = parseZoneCollection(
  readFileSync(resolve(process.cwd(), '../../packages/zones/data/zones.geojson'), 'utf8'),
)
const START = { lon: 142.205679, lat: 43.728511 } // R12-kamuikotan-1 の中心線の始点
const FAR = { lon: 142.03, lat: 43.728511 } // 西へ約 14 km
const SIDE_180M = { lon: 142.205679, lat: 43.728511 + 0.0016 } // 中心線から約 180 m（150 m の外、200 m の内）

function rig(
  over: {
    permission?: string
    loadZones?: ConnectServices['loadZones']
    wakeLock?: ConnectServices['wakeLock']
    secure?: boolean
  } = {},
) {
  const port = {
    unlock: vi.fn(() => Promise.resolve()),
    playChime: vi.fn(),
    playBeep: vi.fn(),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
  } satisfies AudioPort
  let emit: (p: PositionLike) => void = () => undefined
  let fail: (e: { code: number }) => void = () => undefined
  const geo = {
    watchPosition: vi.fn((ok: typeof emit, err: typeof fail, _o: unknown) => {
      emit = ok
      fail = err
      return 3
    }),
    clearWatch: vi.fn(),
  }
  const status: PermissionStatusLike = { state: over.permission ?? 'granted', onchange: null }
  const services: ConnectServices = {
    url: 'ws://ezoroad.local:8765/alerts',
    createSocket: (u) => new FakeSocket(u),
    location: {
      isSecureContext: over.secure ?? true,
      geolocation: { getCurrentPosition: vi.fn() },
      permissions: { query: () => Promise.resolve(status) },
    },
    geo,
    loadZones: over.loadZones ?? (() => Promise.resolve(zones)),
    wakeLock: over.wakeLock ?? { wakeLock: undefined, orientation: undefined },
    sound: new AlertSoundController(port),
    playTestSound: vi.fn(),
    primeSpeech: vi.fn(),
    languages: ['ja-JP'],
  }
  return {
    services,
    geo,
    fix(p: { lon: number; lat: number }, accuracy = 10, speed: number | null = null) {
      act(() => {
        emit({
          coords: { latitude: p.lat, longitude: p.lon, accuracy, speed },
          timestamp: Date.now(),
        })
      })
    },
    deny() {
      act(() => {
        fail({ code: 1 })
      })
    },
  }
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function start(r = rig()) {
  const view = render(<ConnectFlow services={r.services} />)
  await flush()
  fireEvent.click(screen.getByRole('button'))
  await flush()
  return { r, ...view }
}

const alertState = () =>
  document.querySelector('[data-alert-state]')?.getAttribute('data-alert-state') ?? null
const note = (key: string) => screen.queryByTestId(`note-${key}`)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2027-02-15T07:31:08.500Z'))
  FakeSocket.reset()
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('UC-1 位置の購読', () => {
  it('UC-1a: B-1 を開くと高精度・maximumAge 0 で購読し、閉じると clearWatch', async () => {
    const { r, unmount } = await start()
    expect(r.geo.watchPosition).toHaveBeenCalledTimes(1)
    expect(r.geo.watchPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
    })
    unmount()
    expect(r.geo.clearWatch).toHaveBeenCalledWith(3)
  })

  it('UC-1b: 許可が denied・安全でないなら購読しない', async () => {
    const denied = await start(rig({ permission: 'denied' }))
    expect(denied.r.geo.watchPosition).not.toHaveBeenCalled()
    denied.unmount()
    const insecure = await start(rig({ secure: false }))
    expect(insecure.r.geo.watchPosition).not.toHaveBeenCalled()
  })

  it('UC-1d: 座標をログ・storage・画面に出さない（エラーはコードだけ）', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { r } = await start()
    r.fix(START, 10, 15)
    r.fix(FAR)
    r.deny()
    await advance(12_000)
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).not.toMatch(/43\.7|142\.[0-9]/)
    expect(setItem).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(/43\.7|142\.[0-9]/)
  })
})

describe('UC-2 ゾーン判定（Mac Mini なし）', () => {
  it('UC-2a / S-3: ゾーンの中心線上 → 琥珀、残り km と路線名', async () => {
    const { r } = await start()
    r.fix(START, 10, 10)
    expect(alertState()).toBe('zone')
    expect(Number(screen.getByTestId('alert-value').textContent)).toBeGreaterThan(0)
    expect(screen.getByTestId('route').textContent).toBe('国道12号')
  })

  it('UC-2b / S-2: ゾーンから離れた測位 → 緑、次のゾーンまでの km', async () => {
    const { r } = await start()
    r.fix(FAR)
    expect(alertState()).toBe('safe')
    expect(Number(screen.getByTestId('alert-value').textContent)).toBeGreaterThan(5)
  })

  it('UC-2c / UC-4e: 測位が 10 秒途絶えたら緑を持ち越さず琥珀に倒し、「位置を取得できません」', async () => {
    const { r } = await start()
    r.fix(FAR)
    expect(alertState()).toBe('safe')
    await advance(11_000)
    expect(alertState()).toBe('zone')
    expect(screen.getByTestId('alert-value').textContent).toBe('--')
    expect(note('gps-lost')).not.toBeNull()
  })

  it('UC-2d: 外からは 150 m 以内で入る（180 m は緑）。中に入ったあとは 200 m まで出ない', async () => {
    const outside = await start()
    outside.r.fix(SIDE_180M)
    expect(alertState()).toBe('safe')
    outside.unmount()

    const { r } = await start()
    r.fix(START)
    expect(alertState()).toBe('zone')
    r.fix(SIDE_180M)
    expect(alertState()).toBe('zone')
  })

  it('UC-2e: GPS が緑でも、edge のフラグが inside なら琥珀（どちらかが inside なら内側）', async () => {
    const { r } = await start()
    r.fix(FAR)
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend({
        type: 'flag',
        v: 1,
        deer: false,
        zone: 'inside',
        zoneRemainingKm: 2,
        t_frame: new Date().toISOString(),
        t_sent: new Date().toISOString(),
      })
    })
    expect(alertState()).toBe('zone')
  })

  it('UC-2f / S-7: 未接続でも GPS だけで緑・琥珀が出て、赤は出ない', async () => {
    const { r } = await start()
    expect(screen.getByTestId('band').textContent).toBe('未接続')
    r.fix(FAR)
    expect(alertState()).toBe('safe')
    r.fix(START)
    expect(alertState()).toBe('zone')
  })
})

describe('UC-3 ゾーン DB', () => {
  it('UC-3b / S-6: 読み込み・照合の失敗では使わず、「鹿ゾーンのデータを読めません」。琥珀のまま', async () => {
    const { r } = await start(rig({ loadZones: () => Promise.reject(new Error('hash')) }))
    r.fix(FAR)
    await flush()
    expect(note('zones-unavailable')?.textContent).toBe('鹿ゾーンのデータを読めません')
    expect(alertState()).toBe('zone')
  })

  it('UC-3c / S-1: 読み込み中は gps unknown（琥珀、距離「--」）', async () => {
    const { r } = await start(rig({ loadZones: () => new Promise(() => undefined) }))
    r.fix(FAR)
    expect(alertState()).toBe('zone')
    expect(screen.getByTestId('alert-value').textContent).toBe('--')
    expect(note('zones-unavailable')).toBeNull()
  })
})

describe('UC-4 位置が取れない・誤差が大きい', () => {
  it('UC-4a / S-4: 許可なし → 琥珀のまま「位置情報なし」。購読中の許可なしエラーでも同じ', async () => {
    const denied = await start(rig({ permission: 'denied' }))
    expect(alertState()).toBe('zone')
    expect(note('no-location')?.textContent).toBe('位置情報なし')
    denied.unmount()

    const { r } = await start()
    expect(note('no-location')).toBeNull()
    r.deny()
    expect(note('no-location')?.textContent).toBe('位置情報なし')
    expect(alertState()).toBe('zone')
  })

  it('UC-4b / S-5 / AC-2: 許可ありで 10 秒測位が無いと「位置を取得できません」、測位が戻れば消える', async () => {
    const { r } = await start()
    expect(note('gps-lost')).toBeNull()
    await advance(11_000)
    expect(note('gps-lost')).not.toBeNull()
    expect(alertState()).toBe('zone')
    r.fix(FAR)
    expect(note('gps-lost')).toBeNull()
    expect(alertState()).toBe('safe')
  })

  it('UC-4c: 誤差 100 m 超の inside は残り km「--」で「位置の誤差が大きい」。100 m 以下に戻れば km が出る', async () => {
    const { r } = await start()
    r.fix(START, 150)
    expect(alertState()).toBe('zone')
    expect(screen.getByTestId('alert-value').textContent).toBe('--')
    expect(note('poor-accuracy')?.textContent).toBe('位置の誤差が大きい')
    r.fix(START, 20)
    expect(note('poor-accuracy')).toBeNull()
    expect(screen.getByTestId('alert-value').textContent).not.toBe('--')
  })

  it('UC-4d / UC-4f: 位置が取れない間（起動直後・途絶・測位が使えない・北海道の外）は緑にならない', async () => {
    const { r } = await start()
    expect(alertState()).toBe('zone')
    // 北海道の外（東京）の測位は使えない
    r.fix({ lon: 139.7, lat: 35.7 })
    expect(alertState()).toBe('zone')
    expect(note('gps-lost')).not.toBeNull()
  })
})

describe('UC-5 路線名と到達予定', () => {
  it('UC-5a: outside で速さが 5 km/h 以上 → 路線名と HH:MM（JST）', async () => {
    const { r } = await start()
    r.fix(FAR, 10, 20)
    expect(screen.getByTestId('route').textContent).toMatch(/^国道12号 ・ 到達予定 \d\d:\d\d$/)
  })

  it('UC-5b: 速さが無い・5 km/h 未満 → 路線名のみ', async () => {
    const { r } = await start()
    r.fix(FAR, 10, null)
    expect(screen.getByTestId('route').textContent).toBe('国道12号')
    r.fix(FAR, 10, 0.5)
    expect(screen.getByTestId('route').textContent).toBe('国道12号')
  })

  it('UC-5c: inside → 路線名のみ。面（色）は琥珀のトークン', async () => {
    const { r } = await start()
    r.fix(START, 10, 20)
    expect(screen.getByTestId('route').textContent).toBe('国道12号')
    expect(document.querySelector('[data-alert-state]')?.getAttribute('style')).toContain(
      'var(--alert-zone)',
    )
  })
})

describe('UC-6 Wake Lock と回転ロック', () => {
  it('UC-6a: B-1 を開くと取り、画面が戻ったら取り直し、閉じたら解放する', async () => {
    const release = vi.fn(() => Promise.resolve())
    const request = vi.fn(() => Promise.resolve({ release }))
    const lock = vi.fn(() => Promise.resolve())
    const { unmount } = await start(
      rig({ wakeLock: { wakeLock: { request }, orientation: { lock } } }),
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('screen')
    expect(lock).toHaveBeenCalledWith('portrait')
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    unmount()
    await flush()
    expect(release).toHaveBeenCalled()
    expect(note('no-wake-lock')).toBeNull()
  })

  it('UC-6b: Wake Lock が取れなければ「画面が消えることがあります」', async () => {
    await start(
      rig({
        wakeLock: {
          wakeLock: { request: () => Promise.reject(new Error('x')) },
          orientation: undefined,
        },
      }),
    )
    await flush()
    expect(note('no-wake-lock')?.textContent).toBe('画面が消えることがあります')
    expect(alertState()).toBe('zone')
  })

  it('UC-6c: orientation.lock が拒否されても落ちない', async () => {
    const lock = vi.fn(() => Promise.reject(new Error('not fullscreen')))
    await start(
      rig({
        wakeLock: {
          wakeLock: { request: () => Promise.resolve({ release: () => Promise.resolve() }) },
          orientation: { lock },
        },
      }),
    )
    await flush()
    expect(lock).toHaveBeenCalled()
    expect(alertState()).toBe('zone')
  })
})

describe('AC-1 受け入れ（Mac Mini なし）', () => {
  it('AC-1: 外 → 中 → 外 の測位で 緑 → 琥珀 → 緑。WebSocket は開かないまま', async () => {
    const { r } = await start()
    expect(FakeSocket.last.readyState).toBe(0)
    r.fix(FAR)
    expect(alertState()).toBe('safe')
    r.fix(START)
    expect(alertState()).toBe('zone')
    r.fix(FAR)
    expect(alertState()).toBe('safe')
  })
})
