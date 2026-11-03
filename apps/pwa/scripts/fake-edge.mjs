#!/usr/bin/env node
// 開発用の偽 edge サーバー。実機の edge（edge/detector）の代わりに、AlertFlag をシナリオどおりに流す。
// 依存パッケージなし（Node の標準モジュールだけで WebSocket のサーバー側を最小限に実装）。
//
//   node apps/pwa/scripts/fake-edge.mjs --scenario deer --port 8765
//   → PWA は http://localhost:5174/?edge=localhost:8765 で開く（開発ビルドだけ ?edge= が効く）
//
// シナリオ: calm（ゾーン外）/ zone（ゾーン内）/ deer（ゾーン内 → 鹿 6 秒 L→R → 解除）/
//           drop（10 秒ごとに全接続を切る）/ silent（5 秒後から何も送らず、接続は閉じない）
// 仕様: docs/specs/pwa-connect/functional.md R11。ack は標準出力に 1 行の JSON で出す。

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024
const round1 = (n) => Math.round(n * 10) / 10

/** 経過 ms からフラグの中身（deer・zone まわり）を作る。 */
export const SCENARIOS = {
  calm: (t) => ({
    deer: false,
    zone: 'outside',
    zoneDistanceKm: round1(Math.max(0, 20 - t / 10_000)),
  }),
  zone: (t) => ({
    deer: false,
    zone: 'inside',
    zoneRemainingKm: round1(Math.max(0, 8 - t / 10_000)),
  }),
  deer: (t) => {
    const s = (t / 1000) % 16
    if (s >= 4 && s < 10) {
      return {
        deer: true,
        conf: 0.94,
        distanceM: Math.round(Math.max(10, 80 - (s - 4) * 10)),
        side: s < 7 ? 'L' : 'R',
        zone: 'inside',
        zoneRemainingKm: 5.2,
      }
    }
    return { deer: false, zone: 'inside', zoneRemainingKm: 5.2 }
  },
  drop: (t) => SCENARIOS.calm(t),
  silent: (t) => SCENARIOS.calm(t),
}

const SCENARIO_CONTROLS = {
  drop: { dropEveryMs: 10_000 },
  silent: { silentAfterMs: 5000 },
}

/** ISO 8601 の JST（+09:00、ミリ秒つき）。 */
export function jst(ms) {
  return `${new Date(ms + 9 * 3600_000).toISOString().slice(0, 23)}+09:00`
}

function frame(opcode, payload) {
  const length = payload.length
  const header =
    length < 126
      ? Buffer.from([0x80 | opcode, length])
      : Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
  return Buffer.concat([header, payload])
}

/** クライアント → サーバーのフレーム（マスク付き）を取り出す。足りなければ null。 */
function readFrame(buffer) {
  if (buffer.length < 2) return null
  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let length = buffer[1] & 0x7f
  let offset = 2
  if (length === 126) {
    if (buffer.length < 4) return null
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    return { tooLarge: true }
  }
  if (length > MAX_CLIENT_MESSAGE_BYTES) return { tooLarge: true }
  const maskLength = masked ? 4 : 0
  if (buffer.length < offset + maskLength + length) return null
  const mask = masked ? buffer.subarray(offset, offset + 4) : null
  const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length))
  if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4]
  return { opcode, payload, consumed: offset + maskLength + length }
}

/**
 * 偽 edge を起動する。戻り値の close() で止める。
 * @param {{ scenario?: string, port?: number, host?: string, heartbeatMs?: number, pollMs?: number,
 *           log?: (line: string) => void, dropEveryMs?: number, silentAfterMs?: number }} options
 */
export function startFakeEdge(options = {}) {
  const {
    scenario = 'calm',
    port = 8765,
    host = '127.0.0.1',
    heartbeatMs = 1000,
    pollMs = 100,
    // テスト用: シナリオの時間を速める・ずらす
    timeScale = 1,
    offsetMs = 0,
    log = (line) => process.stdout.write(`${line}\n`),
  } = options
  const make = typeof scenario === 'function' ? scenario : SCENARIOS[scenario]
  if (!make)
    throw new Error(`知らないシナリオです: ${scenario}（${Object.keys(SCENARIOS).join(' / ')}）`)
  const controls = { ...SCENARIO_CONTROLS[scenario], ...options }

  const clients = new Set()
  const startedAt = Date.now()
  let lastKey = null
  let lastSentAt = 0
  let deerOnsetFrame = null
  let silent = false

  const server = createServer((_req, res) => {
    res.writeHead(404).end()
  })

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const key = req.headers['sec-websocket-key']
    if (url.pathname !== '/alerts' || typeof key !== 'string') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      return
    }
    const accept = createHash('sha1')
      .update(key + GUID)
      .digest('base64')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    clients.add(socket)
    log(JSON.stringify({ event: 'client.connected', clients: clients.size }))
    let pending = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk])
      for (;;) {
        const f = readFrame(pending)
        if (f === null) return
        if (f.tooLarge) {
          socket.destroy()
          return
        }
        pending = pending.subarray(f.consumed)
        if (f.opcode === 8) {
          socket.end(frame(8, Buffer.alloc(0)))
          return
        }
        if (f.opcode === 9) socket.write(frame(10, f.payload))
        if (f.opcode === 1) handleClientMessage(f.payload.toString('utf8'))
      }
    })
    const gone = () => {
      if (clients.delete(socket))
        log(JSON.stringify({ event: 'client.closed', clients: clients.size }))
    }
    socket.on('close', gone)
    socket.on('error', gone)
  })

  function handleClientMessage(text) {
    let message
    try {
      message = JSON.parse(text)
    } catch {
      log(JSON.stringify({ event: 'client.invalid' }))
      return
    }
    if (message?.type === 'ack' && typeof message.t_shown === 'string') {
      // ack にフレームの ID は無い。最後に送った deer:true の最初の t_frame と組にする
      const sinceFrameMs =
        deerOnsetFrame === null ? null : Date.parse(message.t_shown) - Date.parse(deerOnsetFrame)
      log(
        JSON.stringify({
          event: 'ack',
          t_shown: message.t_shown,
          t_frame: deerOnsetFrame,
          sinceFrameMs,
        }),
      )
    } else {
      log(
        JSON.stringify({
          event: 'client.ignored',
          type: typeof message?.type === 'string' ? message.type : null,
        }),
      )
    }
  }

  function broadcast(flag) {
    const data = frame(1, Buffer.from(JSON.stringify(flag)))
    for (const socket of clients) socket.write(data)
  }

  function tick() {
    const now = Date.now()
    const elapsed = now - startedAt
    const scenarioMs = elapsed * timeScale + offsetMs
    if (
      controls.dropEveryMs &&
      elapsed > 0 &&
      Math.floor(elapsed / controls.dropEveryMs) !==
        Math.floor((elapsed - pollMs) / controls.dropEveryMs)
    ) {
      for (const socket of clients) socket.destroy()
      clients.clear()
    }
    if (controls.silentAfterMs && elapsed >= controls.silentAfterMs) silent = true
    if (silent) return
    const body = make(scenarioMs)
    const key = JSON.stringify([body.deer, body.zone, body.side ?? null])
    if (key === lastKey && now - lastSentAt < heartbeatMs) return
    const tFrame = jst(now - 120)
    if (body.deer && !(lastKey && JSON.parse(lastKey)[0])) deerOnsetFrame = tFrame
    lastKey = key
    lastSentAt = now
    broadcast({ type: 'flag', v: 1, ...body, t_frame: tFrame, t_sent: jst(now) })
  }

  const timer = setInterval(tick, pollMs)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const address = server.address()
      log(
        JSON.stringify({
          event: 'listening',
          scenario: String(scenario),
          host,
          port: typeof address === 'object' && address ? address.port : port,
        }),
      )
      resolve({
        port: typeof address === 'object' && address ? address.port : port,
        host,
        close: () =>
          new Promise((done) => {
            clearInterval(timer)
            for (const socket of clients) socket.destroy()
            server.close(() => done(undefined))
          }),
      })
    })
  })
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--scenario') out.scenario = value
    else if (flag === '--port') out.port = Number(value)
    else if (flag === '--host') out.host = value
    else throw new Error(`知らない引数です: ${flag}`)
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFakeEdge(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
