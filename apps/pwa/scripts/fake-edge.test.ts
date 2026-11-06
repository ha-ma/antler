// @vitest-environment node
import { readAlertFlag } from '@antler/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EdgeClient } from '../src/features/connect/lib/edge-client.ts'
import { parseArgs, startFakeEdge } from './fake-edge.mjs'

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

  it('pwa-uplink R8: vehicle を 1 行の JSON で出す（3 項目だけ。余分な項目は写さない）', async () => {
    const { server, lines } = await start({ scenario: 'calm' })
    const c = connect(server)
    await until(() => c.messages.length >= 1)
    c.socket.send(
      JSON.stringify({ type: 'vehicle', speedKmh: 42, zone: 'inside', light: 'dusk', lat: 43.1 }),
    )
    await until(() => lines.some((l) => l.event === 'vehicle'))
    expect(lines.find((l) => l.event === 'vehicle')).toEqual({
      event: 'vehicle',
      speedKmh: 42,
      zone: 'inside',
      light: 'dusk',
    })
    c.socket.send(JSON.stringify({ type: 'vehicle' }))
    await until(() => lines.filter((l) => l.event === 'vehicle').length === 2)
    expect(lines.filter((l) => l.event === 'vehicle')[1]).toEqual({
      event: 'vehicle',
      speedKmh: null,
      zone: null,
      light: null,
    })
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

describe('UC-6 偽 edge の TLS（pwa-https R6）', () => {
  /** 127.0.0.1 の自己署名の証明書を作る（openssl が無ければ undefined）。 */
  async function selfSigned(): Promise<{ cert: Buffer; key: Buffer } | undefined> {
    const { execFileSync } = await import('node:child_process')
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'fake-edge-tls-'))
    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=fake-edge',
          '-addext',
          'subjectAltName=IP:127.0.0.1',
          '-keyout',
          join(dir, 'key.pem'),
          '-out',
          join(dir, 'cert.pem'),
        ],
        { stdio: 'ignore' },
      )
      return { cert: readFileSync(join(dir, 'cert.pem')), key: readFileSync(join(dir, 'key.pem')) }
    } catch {
      return undefined
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** CA を信頼した TLS で /alerts に upgrade し、最初のテキストフレームを読む。 */
  async function firstFlagOverWss(port: number, ca: Buffer): Promise<Record<string, unknown>> {
    const tls = await import('node:tls')
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', port, ca, servername: undefined }, () => {
        socket.write(
          'GET /alerts HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
        )
      })
      let buffer = Buffer.alloc(0)
      let upgraded = false
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        if (!upgraded) {
          const end = buffer.indexOf('\r\n\r\n')
          if (end < 0) return
          const head = buffer.subarray(0, end).toString('latin1')
          if (!head.startsWith('HTTP/1.1 101')) {
            socket.destroy()
            reject(new Error(head))
            return
          }
          upgraded = true
          buffer = buffer.subarray(end + 4)
        }
        if (buffer.length < 2) return
        let length = buffer[1] & 0x7f
        let offset = 2
        if (length === 126) {
          if (buffer.length < 4) return
          length = buffer.readUInt16BE(2)
          offset = 4
        }
        if (buffer.length < offset + length) return
        socket.destroy()
        resolve(JSON.parse(buffer.subarray(offset, offset + length).toString('utf8')))
      })
      socket.on('error', reject)
    })
  }

  it('UC-6a: --tls-cert・--tls-key で wss に待ち受け、CA を信頼したクライアントにフラグが届く', async () => {
    const pair = await selfSigned()
    if (!pair) return // openssl が無い環境では確かめない
    const files: Record<string, Buffer> = { 'c.pem': pair.cert, 'k.pem': pair.key }
    const options = parseArgs(
      ['--tls-cert', 'c.pem', '--tls-key', 'k.pem'],
      (p: string) => files[p],
    )
    const { server, lines } = await start({ scenario: 'calm', ...options })
    expect(server.tls).toBe(true)
    expect(lines.find((l) => l.event === 'listening').tls).toBe(true)
    const flag = await firstFlagOverWss(server.port, pair.cert)
    expect(readAlertFlag(flag).flag?.strict).toBe(true)

    // CA を信頼していないクライアントは握手で切られ、サーバーは落ちない
    await expect(firstFlagOverWss(server.port, Buffer.from(''))).rejects.toThrow()
    const again = await firstFlagOverWss(server.port, pair.cert)
    expect(again['type']).toBe('flag')
  })

  it('UC-6b: --tls-cert と --tls-key の片方だけ・値なしはエラーで終わる', () => {
    const read = () => Buffer.from('x')
    expect(() => parseArgs(['--tls-cert', 'c.pem'], read)).toThrow(/両方/)
    expect(() => parseArgs(['--tls-key', 'k.pem'], read)).toThrow(/両方/)
    expect(() => parseArgs(['--tls-key'], read)).toThrow(/値がありません/)
    expect(parseArgs(['--scenario', 'deer', '--port', '9000'], read)).toEqual({
      scenario: 'deer',
      port: 9000,
    })
  })
})
