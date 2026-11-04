import { AlertSoundController, type AudioPort } from '@antler/alert-ui'
import { ClientMessageSchema } from '@antler/schema'
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

// docs/specs/pwa-uplink AC-c・UP-3: B-1 のあいだ 1 Hz で vehicle を送る。B-0 では送らない。座標は出ない。

const zones: ZoneCollection = parseZoneCollection(
  readFileSync(resolve(process.cwd(), '../../packages/zones/data/zones.geojson'), 'utf8'),
)
const START = { lon: 142.205679, lat: 43.728511 } // R12-kamuikotan-1 の中心線の始点（inside）

function rig(permission = 'granted') {
  const port = {
    unlock: vi.fn(() => Promise.resolve()),
    playChime: vi.fn(),
    playBeep: vi.fn(),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
  } satisfies AudioPort
  let emit: (p: PositionLike) => void = () => undefined
  const geo = {
    watchPosition: vi.fn((ok: typeof emit) => {
      emit = ok
      return 3
    }),
    clearWatch: vi.fn(),
  }
  const status: PermissionStatusLike = { state: permission, onchange: null }
  const services: ConnectServices = {
    url: 'ws://ezoroad.local:8765/alerts',
    createSocket: (u) => new FakeSocket(u),
    location: {
      isSecureContext: true,
      geolocation: { getCurrentPosition: vi.fn() },
      permissions: { query: () => Promise.resolve(status) },
    },
    geo,
    loadZones: () => Promise.resolve(zones),
    wakeLock: { wakeLock: undefined, orientation: undefined },
    sound: new AlertSoundController(port),
    playTestSound: vi.fn(),
    primeSpeech: vi.fn(),
    languages: ['ja-JP'],
  }
  return {
    services,
    fix(speed: number | null = 10) {
      act(() => {
        emit({
          coords: { latitude: START.lat, longitude: START.lon, accuracy: 10, speed },
          timestamp: Date.now(),
        })
      })
    },
  }
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })

/** 1 秒進める。edge からフラグを送って、接続が半開きと見なされないようにする。 */
const second = (heartbeat = true) =>
  act(async () => {
    if (heartbeat) {
      FakeSocket.last.serverSend({
        type: 'flag',
        v: 1,
        deer: false,
        zone: 'outside',
        t_frame: '2027-02-15T16:31:08.120+09:00',
        t_sent: '2027-02-15T16:31:08.310+09:00',
      })
    }
    await vi.advanceTimersByTimeAsync(1000)
  })

const vehicleMessages = (): Record<string, unknown>[] =>
  FakeSocket.instances
    .flatMap((s) => s.sent)
    .map((t) => JSON.parse(t) as Record<string, unknown>)
    .filter((m) => m.type === 'vehicle')

async function open(r = rig()) {
  const view = render(<ConnectFlow services={r.services} />)
  await flush()
  act(() => {
    FakeSocket.last.serverOpen()
  })
  return { r, ...view }
}

async function depart() {
  fireEvent.click(screen.getByRole('button'))
  await flush()
}

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

describe('UP-3a B-1 のあいだ 1 Hz で送る', () => {
  it('B-0 では送らず、B-1 に入ると 1 秒に 1 通。ClientMessage に通り、座標・精度・時刻が無い (AC-c)', async () => {
    const { r } = await open()
    r.fix(10)
    await second()
    await second()
    expect(vehicleMessages()).toHaveLength(0) // B-0 のプレビューでは送らない
    await depart()
    for (let i = 0; i < 5; i += 1) {
      r.fix(10)
      await second()
    }
    const sent = vehicleMessages()
    expect(sent.length).toBeGreaterThanOrEqual(5)
    expect(sent.length).toBeLessThanOrEqual(6)
    for (const m of sent) {
      expect(ClientMessageSchema.safeParse(m).success).toBe(true)
      expect(Object.keys(m).sort()).toEqual(['light', 'speedKmh', 'type', 'zone'])
      expect(m).toMatchObject({ speedKmh: 36, zone: 'inside' })
    }
    const text = JSON.stringify(sent)
    expect(text).not.toMatch(/43\.7|142\.2|accuracy|timestamp|lat|lon/)
  })

  it('速さが無い（speed: null）端末は速度の項目だけ無い', async () => {
    const { r } = await open()
    await depart()
    r.fix(null)
    await second()
    const m = vehicleMessages()[0]
    expect(m).toBeDefined()
    expect(m).not.toHaveProperty('speedKmh')
    expect(m).toMatchObject({ zone: 'inside' })
  })

  it('UP-3a: 二度描画されても 1 秒に 1 通を超えない', async () => {
    const { r } = await open()
    await depart()
    r.fix(10)
    r.fix(10)
    r.fix(10)
    await second()
    r.fix(10)
    r.fix(10)
    await second()
    expect(vehicleMessages().length).toBeLessThanOrEqual(3)
  })
})

describe('S-1・VR-2f 測位が使えない', () => {
  it('位置の許可なし → 送らない', async () => {
    const { r } = await open(rig('denied'))
    await depart()
    r.fix(10)
    await second()
    await second()
    expect(vehicleMessages()).toHaveLength(0)
  })

  it('測位が途絶えて 5 秒を超えたら送らなくなる（古い値を送り続けない）', async () => {
    const { r } = await open()
    await depart()
    r.fix(10)
    await second()
    expect(vehicleMessages().length).toBeGreaterThanOrEqual(1)
    const before = vehicleMessages().length
    for (let i = 0; i < 8; i += 1) await second() // 測位が来ないまま 8 秒
    // 最初の 5 秒までは送りうる。それを超えたあとは増えない
    const afterFive = vehicleMessages().length
    await second()
    await second()
    expect(vehicleMessages().length).toBe(afterFive)
    expect(afterFive - before).toBeLessThanOrEqual(5)
  })
})

describe('UP-3b・UP-3c 再接続と ack', () => {
  it('接続が切れているあいだは送らず、溜めない。再接続したら次の更新で送る', async () => {
    const { r } = await open()
    await depart()
    r.fix(10)
    await second()
    const first = FakeSocket.last
    act(() => {
      first.serverClose()
    })
    const sentBefore = vehicleMessages().length
    r.fix(10)
    await second(false) // closed のあいだ
    expect(vehicleMessages().length).toBe(sentBefore)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000) // 再接続のタイマー
    })
    act(() => {
      FakeSocket.last.serverOpen()
    })
    // 切れていたあいだの分は送らない（開いた直後の再描画で、今の値が 1 通出るのは溜めた分ではない）
    expect(FakeSocket.last.sent.length).toBeLessThanOrEqual(1)
    r.fix(10)
    await second()
    expect(FakeSocket.last.sent.some((t) => t.includes('"vehicle"'))).toBe(true)
  })

  it('ack は danger を表示し始めたときに 1 回。vehicle は ack を邪魔しない', async () => {
    const { r } = await open()
    await depart()
    r.fix(10)
    act(() => {
      FakeSocket.last.serverSend({
        type: 'flag',
        v: 1,
        deer: true,
        conf: 0.9,
        distanceM: 40,
        side: 'L',
        zone: 'inside',
        t_frame: '2027-02-15T16:31:08.120+09:00',
        t_sent: '2027-02-15T16:31:08.310+09:00',
      })
    })
    await second(false)
    await second(false)
    const acks = FakeSocket.instances.flatMap((s) => s.sent).filter((t) => t.includes('"ack"'))
    expect(acks).toHaveLength(1)
    expect(vehicleMessages().length).toBeGreaterThanOrEqual(1)
  })
})
