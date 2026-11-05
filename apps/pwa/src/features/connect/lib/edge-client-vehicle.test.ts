import { ClientMessageSchema } from '@antler/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/shared/utils/logger'
import { FakeSocket } from '@/test/fake-socket'
import { EdgeClient } from './edge-client'

// docs/specs/pwa-uplink UC-3（R3）: sendVehicle は open のときだけ・検証してから・0.9 秒に 1 通。

function start() {
  const client = new EdgeClient({
    url: 'ws://ezoroad.local:8765/alerts',
    createSocket: (u) => new FakeSocket(u),
  })
  client.start()
  return client
}

const REPORT = { speedKmh: 45, zone: 'inside', light: 'dusk' } as const

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

describe('EC-3a open のときだけ送る', () => {
  it('connecting・closed では送らず、溜めない', () => {
    const client = start()
    expect(client.sendVehicle(REPORT)).toBe(false)
    FakeSocket.last.serverOpen()
    expect(FakeSocket.last.sent).toHaveLength(0) // 開いてからも古い分を送らない
    FakeSocket.last.serverClose()
    vi.advanceTimersByTime(10)
    expect(client.sendVehicle(REPORT)).toBe(false)
    expect(logger.warn).not.toHaveBeenCalledWith('vehicle.skipped', expect.anything()) // 頻繁なので記録しない
  })

  it('open のとき ClientMessage に通る vehicle を送る', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    expect(client.sendVehicle(REPORT)).toBe(true)
    const msg = JSON.parse(FakeSocket.last.sent[0] ?? '') as unknown
    expect(msg).toEqual({ type: 'vehicle', speedKmh: 45, zone: 'inside', light: 'dusk' })
    expect(ClientMessageSchema.safeParse(msg).success).toBe(true)
  })
})

describe('EC-3b 検証', () => {
  it('通らない値は送らず vehicle.skipped（理由だけ）', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    expect(client.sendVehicle({ speedKmh: Number.NaN })).toBe(false)
    expect(client.sendVehicle({ speedKmh: 999 })).toBe(false)
    expect(client.sendVehicle({ zone: 'unknown' } as never)).toBe(false)
    expect(FakeSocket.last.sent).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith('vehicle.skipped', { reason: 'invalid' })
  })

  it('FAIL-1: send が例外でも落ちず、ack は送れる', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    const real = FakeSocket.last.send.bind(FakeSocket.last)
    FakeSocket.last.send = () => {
      throw new Error('boom')
    }
    expect(client.sendVehicle(REPORT)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('vehicle.skipped', { reason: 'send_failed' })
    FakeSocket.last.send = real
    expect(client.sendAck(Date.now())).toBe(true)
  })
})

describe('EC-3c 0.9 秒に 1 通', () => {
  it('0.9 秒以内の 2 回目は送らず、0.9 秒後はまた送る', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    expect(client.sendVehicle(REPORT)).toBe(true)
    vi.advanceTimersByTime(500)
    expect(client.sendVehicle(REPORT)).toBe(false)
    vi.advanceTimersByTime(399)
    expect(client.sendVehicle(REPORT)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(client.sendVehicle(REPORT)).toBe(true)
    expect(FakeSocket.last.sent).toHaveLength(2)
  })

  it('壁時計を戻しても止まらない（間隔は performance.now で測る）', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    expect(client.sendVehicle(REPORT)).toBe(true)
    vi.advanceTimersByTime(1000)
    vi.setSystemTime(new Date('2020-01-01T00:00:00Z')) // 1 時間どころか何年も戻る
    expect(client.sendVehicle(REPORT)).toBe(true)
  })

  it('ack は vehicle の間隔に数えない', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    expect(client.sendVehicle(REPORT)).toBe(true)
    expect(client.sendAck(Date.now())).toBe(true)
  })
})
