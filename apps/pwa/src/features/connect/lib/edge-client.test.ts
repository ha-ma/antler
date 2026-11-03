import { ClientMessageSchema } from '@antler/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/shared/utils/logger'
import { FakeSocket } from '@/test/fake-socket'
import { EdgeClient } from './edge-client'

const URL_ = 'ws://ezoroad.local:8765/alerts'

function flag(over: Record<string, unknown> = {}) {
  return {
    type: 'flag',
    v: 1,
    deer: false,
    zone: 'outside',
    zoneDistanceKm: 12.3,
    t_frame: '2027-02-15T16:31:08.120+09:00',
    t_sent: '2027-02-15T16:31:08.310+09:00',
    ...over,
  }
}

function start() {
  const client = new EdgeClient({
    url: URL_,
    createSocket: (u) => new FakeSocket(u),
  })
  client.start()
  return client
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

describe('UC-1 接続・受信', () => {
  it('UC-1a: connecting → open になり、受け取ったフラグと受信時刻が最新になる', () => {
    const client = start()
    expect(client.getSnapshot().status).toBe('connecting')
    FakeSocket.last.serverOpen()
    expect(client.getSnapshot().status).toBe('open')
    FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 40, side: 'L' }))
    const snap = client.getSnapshot()
    expect(snap.flag?.deer).toBe(true)
    expect(snap.flag?.distanceM).toBe(40)
    expect(snap.flagReceivedAt).toBe(Date.now())
    expect(snap.lastDelayMs).toBe(190)
  })

  it('UC-1b: 接続先は渡された URL', () => {
    start()
    expect(FakeSocket.last.url).toBe(URL_)
  })

  it('UC-1e: 壊れた JSON・flag でない・deer が真偽値でない → 捨てて直前のフラグを残す', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSend(flag({ zone: 'inside', zoneRemainingKm: 3 }))
    const before = client.getSnapshot().flag
    FakeSocket.last.serverSend('{not json')
    FakeSocket.last.serverSend({ type: 'hello' })
    FakeSocket.last.serverSend(flag({ deer: 'yes' }))
    FakeSocket.last.serverSend('null')
    expect(client.getSnapshot().flag).toBe(before)
    expect(logger.warn).toHaveBeenCalledWith('flag.invalid', expect.anything())
  })

  it('UC-1f: deer:true で他の項目が壊れていても deer は読む（partial）', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSend(flag({ deer: true, distanceM: 'far', side: 'X', conf: 7 }))
    expect(client.getSnapshot().flag?.deer).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith('flag.partial', expect.anything())
  })

  it('UC-1g: バイナリ・256 KB 超の文字列は捨てる（切断しない）', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSendRaw(new ArrayBuffer(8))
    FakeSocket.last.serverSendRaw('x'.repeat(262_145))
    expect(client.getSnapshot().flag).toBeNull()
    expect(client.getSnapshot().status).toBe('open')
    expect(FakeSocket.last.closeCalls).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith('flag.oversize', expect.anything())
  })

  it('UC-1h: ログに受け取った本文を出さない', () => {
    start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSend('SECRET-BODY{')
    FakeSocket.last.serverSend(flag({ deer: true, frameJpegB64: 'JPEGDATA', distanceM: 'SECRET' }))
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).not.toContain('SECRET')
    expect(logged).not.toContain('JPEGDATA')
  })

  it('UC-1a: 直近の受信時刻の一覧を持つ（受信/秒の計算用）', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSend(flag())
    vi.advanceTimersByTime(1000)
    FakeSocket.last.serverSend(flag())
    expect(client.getSnapshot().receivedAt).toHaveLength(2)
  })
})

describe('UC-2 再接続', () => {
  it('UC-2a: close が来たら closed になり、1 秒後に再接続して open に戻る', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverClose()
    expect(client.getSnapshot().status).toBe('closed')
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(client.getSnapshot().status).toBe('connecting')
    FakeSocket.last.serverOpen()
    expect(client.getSnapshot().status).toBe('open')
  })

  it('UC-2b: error も同じ', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverError()
    expect(client.getSnapshot().status).toBe('closed')
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('UC-2c: 3 秒なにも受信しなければ半開きとみなして閉じ、再接続する', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSend(flag())
    const first = FakeSocket.last
    vi.advanceTimersByTime(2999)
    expect(client.getSnapshot().status).toBe('open')
    vi.advanceTimersByTime(1)
    expect(client.getSnapshot().status).toBe('closed')
    expect(first.closeCalls).toBe(1)
    expect(logger.warn).toHaveBeenCalledWith('ws.stale', expect.anything())
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('UC-2c: 受信のたびに切れの検知は延びる', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(1000)
      FakeSocket.last.serverSend(flag())
    }
    expect(client.getSnapshot().status).toBe('open')
  })

  it('UC-2d: 接続の試行が 3 秒で終わらなければ諦めて次の試行へ', () => {
    const client = start()
    const first = FakeSocket.last
    vi.advanceTimersByTime(3000)
    expect(client.getSnapshot().status).toBe('closed')
    expect(first.closeCalls).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('UC-2e: サーバーが戻ってから 5 秒以内に open になる', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverClose()
    // サーバー不在の 20 秒（試行は 3 秒ごとに諦め、1 秒おいて繰り返す）
    vi.advanceTimersByTime(20_000)
    const comeBackAt = Date.now()
    let openedAt: number | null = null
    for (let t = 0; t < 5000 && openedAt === null; t += 100) {
      vi.advanceTimersByTime(100)
      const s = FakeSocket.last
      if (s.readyState === 0 && !s.closeCalls) {
        s.serverOpen()
        openedAt = Date.now()
      }
    }
    expect(client.getSnapshot().status).toBe('open')
    expect(openedAt! - comeBackAt).toBeLessThanOrEqual(5000)
  })

  it('UC-2f: 停止で接続もタイマーも残らない。start → stop → start でも接続は 1 本', () => {
    const client = start()
    client.stop()
    client.start()
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[0]?.closeCalls).toBe(1)
    client.stop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('UC-2g: 再接続しても、前のフラグの受信時刻は変わらない', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSend(flag())
    const at = client.getSnapshot().flagReceivedAt
    FakeSocket.last.serverClose()
    vi.advanceTimersByTime(1000)
    FakeSocket.last.serverOpen()
    expect(client.getSnapshot().flagReceivedAt).toBe(at)
  })

  it('UC-2h: 古い socket のイベントは新しい socket の状態を壊さない', () => {
    const client = start()
    const old = FakeSocket.last
    old.serverOpen()
    old.serverClose()
    vi.advanceTimersByTime(1000)
    FakeSocket.last.serverOpen()
    old.serverSend(flag({ deer: true, distanceM: 1, side: 'R' }))
    old.serverClose()
    old.serverError()
    expect(client.getSnapshot().status).toBe('open')
    expect(client.getSnapshot().flag).toBeNull()
  })

  it('UC-2h: 切断のあと、遅れて close が来ても再接続は 1 回だけ', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverError()
    FakeSocket.last.serverClose()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(client.getSnapshot().status).toBe('connecting')
  })
})

describe('UC-1/2 追加（spec-adversary）', () => {
  it('UC-1i: partial の deer:false は直前のフラグを変えない。partial の deer:true は赤に上げる', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 40, side: 'L' }))
    const before = client.getSnapshot()
    vi.advanceTimersByTime(1000)
    FakeSocket.last.serverSend(flag({ deer: false, zone: 'nowhere' }))
    expect(client.getSnapshot().flag).toBe(before.flag)
    expect(client.getSnapshot().flagReceivedAt).toBe(before.flagReceivedAt)
    FakeSocket.last.serverSend(flag({ deer: true, distanceM: 'far' }))
    expect(client.getSnapshot().flag?.deer).toBe(true)
  })

  it('UC-1j: 1 秒あたり 20 件を超えた分は捨てる', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    for (let i = 0; i < 30; i += 1) FakeSocket.last.serverSend(flag())
    expect(client.getSnapshot().receivedAt).toHaveLength(20)
    expect(logger.warn).toHaveBeenCalledWith('flag.flood', expect.anything())
    vi.advanceTimersByTime(1000)
    FakeSocket.last.serverSend(flag())
    expect(client.getSnapshot().receivedAt.length).toBeGreaterThan(20 - 1)
  })

  it('UC-2i: 壊れたメッセージ・バイナリだけが届き続けても 3 秒で切れとみなす', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(500)
      FakeSocket.last.serverSend('{broken')
      FakeSocket.last.serverSendRaw(new ArrayBuffer(1))
    }
    expect(client.getSnapshot().status).toBe('closed')
  })

  it('UC-2j: closed のとき wake は待たずに再接続する', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverClose()
    client.wake()
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(5000)
    expect(FakeSocket.instances.length).toBeLessThanOrEqual(3)
  })

  it('UC-2j: 受信が 3 秒以上無い open は wake で作り直す。受信が新しければ何もしない', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.serverSend(flag())
    vi.advanceTimersByTime(2000)
    client.wake()
    expect(client.getSnapshot().status).toBe('open')
    // タイマーが止まっていた（背景）想定で、時計だけ進める
    vi.setSystemTime(Date.now() + 10_000)
    client.wake()
    expect(client.getSnapshot().status).toBe('closed')
  })
})

describe('UC-3 ack', () => {
  it('UC-3a: open のとき ack を送る。t_shown は JST で ClientMessageSchema を通る', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    expect(client.sendAck(Date.now())).toBe(true)
    const msg = JSON.parse(FakeSocket.last.sent[0] ?? '') as unknown
    expect(ClientMessageSchema.safeParse(msg).success).toBe(true)
    expect(msg).toEqual({ type: 'ack', t_shown: '2027-02-15T16:31:08.500+09:00' })
  })

  it('UC-3c: open でないときは送らず、あとから送り直さない', () => {
    const client = start()
    expect(client.sendAck(Date.now())).toBe(false)
    FakeSocket.last.serverOpen()
    expect(FakeSocket.last.sent).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith('ack.skipped', expect.anything())
  })

  it('UC-3c: send が例外でも落ちない', () => {
    const client = start()
    FakeSocket.last.serverOpen()
    FakeSocket.last.send = () => {
      throw new Error('boom')
    }
    expect(client.sendAck(Date.now())).toBe(false)
  })
})
