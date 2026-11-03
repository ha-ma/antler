// @vitest-environment node
import { readAlertFlag } from '@antler/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EdgeClient } from '../src/features/connect/lib/edge-client.ts'
import { startFakeEdge } from './fake-edge.mjs'

const servers = []
const sockets = []

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close()
  for (const server of servers.splice(0)) await server.close()
  vi.restoreAllMocks()
})

async function start(options = {}) {
  const lines = []
  const server = await startFakeEdge({
    port: 0,
    heartbeatMs: 100,
    pollMs: 20,
    log: (line) => lines.push(JSON.parse(line)),
    ...options,
  })
  servers.push(server)
  return { server, lines }
}

function connect(server, path = '/alerts') {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}${path}`)
  sockets.push(socket)
  const messages = []
  const events = []
  socket.addEventListener('message', (e) => messages.push(JSON.parse(e.data)))
  socket.addEventListener('open', () => events.push('open'))
  socket.addEventListener('close', () => events.push('close'))
  socket.addEventListener('error', () => events.push('error'))
  return { socket, messages, events }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(predicate, timeoutMs = 3000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('待ちきれませんでした')
    await wait(10)
  }
}

describe('UC-7 偽 edge', () => {
  it.each(['calm', 'zone', 'deer'])(
    'UC-7a: %s のシナリオが AlertFlag の形で届く（readAlertFlag が strict）',
    async (scenario) => {
      // deer は 4 秒目から鹿。時間を 50 倍にして短く確かめる
      const { server } = await start({ scenario, timeScale: scenario === 'deer' ? 50 : 1 })
      const c = connect(server)
      await until(() => c.messages.length >= 8)
      for (const m of c.messages) {
        const r = readAlertFlag(m)
        expect(r.flag?.strict, JSON.stringify(m)).toBe(true)
      }
      if (scenario === 'deer') expect(c.messages.some((m) => m.deer === true)).toBe(true)
    },
  )

  it('UC-7b: 1 Hz 相当のハートビートと、変化時の即時送信', async () => {
    const { server } = await start({ scenario: 'calm', heartbeatMs: 100 })
    const c = connect(server)
    await wait(550)
    expect(c.messages.length).toBeGreaterThanOrEqual(4)

    // deer は鹿の始まり（4 秒）を 20 ms ごとの確認のうちに送る（ハートビートの 5 秒を待たない）
    const fast = await start({ scenario: 'deer', heartbeatMs: 5000, offsetMs: 3900 })
    const d = connect(fast.server)
    await until(() => d.messages.some((m) => m.deer === true), 1000)
  })

  it('UC-7c: ack を標準出力に出す。UC-7g: 最後の deer:true の最初の t_frame と組にする', async () => {
    const { server, lines } = await start({ scenario: 'deer', offsetMs: 3950, timeScale: 1 })
    const c = connect(server)
    await until(() => c.messages.some((m) => m.deer === true))
    const onset = c.messages.find((m) => m.deer === true)
    await wait(30)
    c.socket.send(JSON.stringify({ type: 'ack', t_shown: new Date().toISOString() }))
    await until(() => lines.some((l) => l.event === 'ack'))
    const ack = lines.find((l) => l.event === 'ack')
    expect(ack.t_frame).toBe(onset.t_frame)
    expect(typeof ack.sinceFrameMs).toBe('number')
    expect(ack.sinceFrameMs).toBeGreaterThan(0)
  })

  it('UC-7d: /alerts 以外は 404', async () => {
    const { server } = await start()
    const res = await fetch(`http://127.0.0.1:${server.port}/other`)
    expect(res.status).toBe(404)
    const c = connect(server, '/other')
    await until(() => c.events.includes('error') || c.events.includes('close'))
    expect(c.events).not.toContain('open')
  })

  it('UC-7d: 壊れた URL の upgrade でもサーバーは落ちない', async () => {
    const { server } = await start()
    const net = await import('node:net')
    await new Promise<void>((resolve) => {
      const s = net.connect(server.port, '127.0.0.1', () => {
        s.write(
          'GET http://[ HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: abc\r\n\r\n',
        )
      })
      s.on('close', () => resolve())
      s.on('error', () => resolve())
      setTimeout(() => {
        s.destroy()
        resolve()
      }, 300)
    })
    const res = await fetch(`http://127.0.0.1:${server.port}/other`)
    expect(res.status).toBe(404)
  })

  it('UC-7d: 64 KB 超のクライアントメッセージで切る', async () => {
    const { server } = await start()
    const c = connect(server)
    await until(() => c.events.includes('open'))
    c.socket.send('x'.repeat(70 * 1024))
    await until(() => c.events.includes('close'))
  })

  it('UC-7e: drop は全接続を切り、silent は送信を止める（接続は閉じない）', async () => {
    const drop = await start({ scenario: 'drop', dropEveryMs: 300 })
    const a = connect(drop.server)
    await until(() => a.events.includes('close'))

    const silent = await start({ scenario: 'silent', silentAfterMs: 200 })
    const b = connect(silent.server)
    await wait(400)
    const count = b.messages.length
    await wait(400)
    expect(b.messages.length).toBe(count)
    expect(b.events).not.toContain('close')
  })

  it('UC-7f: 既定は 127.0.0.1 に待ち受ける', async () => {
    const server = await startFakeEdge({ port: 0, log: () => undefined })
    servers.push(server)
    expect(server.host).toBe('127.0.0.1')
  })

  it('知らないシナリオは起動しない', () => {
    expect(() => startFakeEdge({ scenario: 'nope', port: 0, log: () => undefined })).toThrow(
      /知らないシナリオ/,
    )
  })
})

describe('AC-1 受け入れ（実際につなぐ）', () => {
  it('AC-1: deer シナリオに EdgeClient をつなぐと、ゾーン内 → deer:true → ack が届き → 解除で戻る', async () => {
    // 時間を 8 倍にして deer シナリオ（16 秒周期）を 2 秒で一巡させる
    const { server, lines } = await start({ scenario: 'deer', timeScale: 8, heartbeatMs: 100 })
    const client = new EdgeClient({
      url: `ws://127.0.0.1:${server.port}/alerts`,
      createSocket: (url) => new WebSocket(url),
    })
    client.start()
    try {
      await until(() => client.getSnapshot().status === 'open')
      await until(() => client.getSnapshot().flag?.deer === false)
      await until(() => client.getSnapshot().flag?.deer === true)
      expect(client.sendAck(Date.now())).toBe(true)
      await until(() => lines.some((l) => l.event === 'ack'))
      await until(() => client.getSnapshot().flag?.deer === false)
    } finally {
      client.stop()
    }
    expect(lines.find((l) => l.event === 'ack').sinceFrameMs).toBeGreaterThanOrEqual(0)
  })

  it('AC-1: drop で切れても、クライアントは 5 秒以内につなぎ直す', async () => {
    const { server } = await start({ scenario: 'drop', dropEveryMs: 1500 })
    const client = new EdgeClient({
      url: `ws://127.0.0.1:${server.port}/alerts`,
      createSocket: (url) => new WebSocket(url),
    })
    client.start()
    try {
      await until(() => client.getSnapshot().status === 'open')
      await until(() => client.getSnapshot().status === 'closed', 3000)
      const lostAt = Date.now()
      await until(() => client.getSnapshot().status === 'open', 5000)
      expect(Date.now() - lostAt).toBeLessThan(5000)
    } finally {
      client.stop()
    }
  }, 15_000)
})
