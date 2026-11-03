import { ClientMessageSchema, readAlertFlag, toJst, type ReceivedFlag } from '@antler/schema'
import { logger } from '@/shared/utils/logger'

// 車載 Mac Mini の WebSocket につながり、AlertFlag を受ける（ch4 B3、ch6「B 可用性」、ch7）。
// 切れたら 1 秒後に再接続。3 秒なにも受け取らなければ半開きとみなして閉じる（エッジは 1 秒ごとにハートビートを送る）。

export type LinkStatus = 'connecting' | 'open' | 'closed'

/** 受信と同じ形の WebSocket のうち、使うところだけ。テストでは偽物を差し込む。 */
export type SocketLike = {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  send(data: string): void
  close(): void
}

export type EdgeSnapshot = {
  status: LinkStatus
  /** 最後に読めたフラグ。切れても消さない（deriveAlertState が古さを見る） */
  flag: ReceivedFlag | null
  flagReceivedAt: number | null
  /** 直近のフラグの t_sent − t_frame（ms）。エッジ内の遅延で、端末の時計に左右されない */
  lastDelayMs: number | undefined
  /** 直近に読めたフラグの受信時刻（ms）。受信/秒の計算に使う */
  receivedAt: readonly number[]
}

export type EdgeClientOptions = {
  url: string
  createSocket: (url: string) => SocketLike
}

export const RECONNECT_DELAY_MS = 1000
export const STALE_AFTER_MS = 3000
export const CONNECT_TIMEOUT_MS = 3000
export const MAX_MESSAGE_CHARS = 256 * 1024
export const MAX_MESSAGES_PER_SECOND = 20
/** 受信の履歴として持つ長さ（B-0 の受信/秒は直近 5 秒） */
export const RECEIVE_WINDOW_MS = 5000

export class EdgeClient {
  private readonly url: string
  private readonly createSocket: EdgeClientOptions['createSocket']
  private socket: SocketLike | null = null
  private running = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private staleTimer: ReturnType<typeof setTimeout> | null = null
  private snapshot: EdgeSnapshot = {
    status: 'closed',
    flag: null,
    flagReceivedAt: null,
    lastDelayMs: undefined,
    receivedAt: [],
  }
  private readonly listeners = new Set<() => void>()
  private lastLiveAt: number | null = null
  private recent: number[] = []

  constructor({ url, createSocket }: EdgeClientOptions) {
    this.url = url
    this.createSocket = createSocket
  }

  // useSyncExternalStore 用
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): EdgeSnapshot => this.snapshot

  start(): void {
    if (this.running) return
    this.running = true
    this.connect()
  }

  stop(): void {
    this.running = false
    this.clearTimers()
    const socket = this.socket
    this.socket = null
    if (socket) this.detachAndClose(socket)
    this.update({ status: 'closed' })
  }

  /** danger を表示し始めたときに呼ぶ（R4）。送れたら true。open でなければ送らない。 */
  sendAck(now: number): boolean {
    const socket = this.socket
    if (!socket || this.snapshot.status !== 'open') {
      logger.warn('ack.skipped', { reason: 'not_open' })
      return false
    }
    try {
      const message = ClientMessageSchema.parse({
        type: 'ack',
        t_shown: toJst(new Date(now).toISOString()),
      })
      socket.send(JSON.stringify(message))
      return true
    } catch {
      logger.warn('ack.skipped', { reason: 'send_failed' })
      return false
    }
  }

  private connect(): void {
    if (!this.running) return
    let socket: SocketLike
    try {
      socket = this.createSocket(this.url)
    } catch {
      logger.warn('ws.closed', { reason: 'create_failed' })
      this.update({ status: 'closed' })
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    this.update({ status: 'connecting' })
    this.connectTimer = setTimeout(() => {
      this.down(socket, 'connect_timeout')
    }, CONNECT_TIMEOUT_MS)

    // 古い socket のイベントは無視する（新しい接続の状態を壊さない）
    socket.onopen = () => {
      if (socket !== this.socket) return
      this.clearTimer('connect')
      this.update({ status: 'open' })
      this.armStale(socket)
    }
    socket.onmessage = (event) => {
      if (socket !== this.socket) return
      this.receive(socket, event.data)
    }
    socket.onclose = () => {
      this.down(socket, 'close')
    }
    socket.onerror = () => {
      this.down(socket, 'error')
    }
  }

  /** 画面が見える状態に戻ったとき。つながっていなければ待たずに再接続、受信が途絶えた open は作り直す。 */
  wake(): void {
    if (!this.running) return
    const socket = this.socket
    if (!socket) {
      this.clearTimer('reconnect')
      this.connect()
      return
    }
    const lastLive = this.lastLiveAt
    if (
      this.snapshot.status === 'open' &&
      (lastLive === null || Date.now() - lastLive >= STALE_AFTER_MS)
    ) {
      this.down(socket, 'stale')
    }
  }

  private floodAllowed(now: number): boolean {
    this.recent = this.recent.filter((t) => now - t < 1000)
    if (this.recent.length >= MAX_MESSAGES_PER_SECOND) return false
    this.recent.push(now)
    return true
  }

  private receive(socket: SocketLike, data: unknown): void {
    if (!this.floodAllowed(Date.now())) {
      logger.warn('flag.flood', {})
      return
    }
    if (typeof data !== 'string') {
      logger.warn('flag.invalid', { reason: 'not_text' })
      return
    }
    if (data.length > MAX_MESSAGE_CHARS) {
      logger.warn('flag.oversize', { chars: data.length })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      logger.warn('flag.invalid', { reason: 'invalid_json' })
      return
    }
    const result = readAlertFlag(parsed)
    if (!result.flag) {
      logger.warn('flag.invalid', { reason: result.problem ?? 'not_flag' })
      return
    }
    if (result.problem === 'partial') logger.warn('flag.partial', {})
    const now = Date.now()
    this.armStale(socket)
    // 壊れた deer:false は赤を解く根拠にしない（生存の印にだけする）
    if (!result.flag.deer && !result.flag.strict) return
    this.update({
      flag: result.flag,
      flagReceivedAt: now,
      lastDelayMs: delayOf(parsed) ?? this.snapshot.lastDelayMs,
      receivedAt: [...this.snapshot.receivedAt.filter((t) => now - t <= RECEIVE_WINDOW_MS), now],
    })
  }

  private armStale(socket: SocketLike): void {
    this.clearTimer('stale')
    this.lastLiveAt = Date.now()
    this.staleTimer = setTimeout(() => {
      this.down(socket, 'stale')
    }, STALE_AFTER_MS)
  }

  /** 接続が使えなくなった。現在の socket のときだけ扱い、1 秒後に再接続する。 */
  private down(socket: SocketLike, reason: string): void {
    if (socket !== this.socket) return
    this.socket = null
    this.clearTimer('connect')
    this.clearTimer('stale')
    this.detachAndClose(socket)
    logger.warn(reason === 'stale' ? 'ws.stale' : 'ws.closed', { reason })
    this.update({ status: 'closed' })
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, RECONNECT_DELAY_MS)
  }

  private detachAndClose(socket: SocketLike): void {
    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    try {
      socket.close()
    } catch {
      // 閉じられなくても捨てる
    }
  }

  private clearTimer(which: 'connect' | 'stale' | 'reconnect'): void {
    if (which === 'connect' && this.connectTimer) clearTimeout(this.connectTimer)
    if (which === 'stale' && this.staleTimer) clearTimeout(this.staleTimer)
    if (which === 'reconnect' && this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (which === 'connect') this.connectTimer = null
    if (which === 'stale') this.staleTimer = null
    if (which === 'reconnect') this.reconnectTimer = null
  }

  private clearTimers(): void {
    this.clearTimer('connect')
    this.clearTimer('stale')
    this.clearTimer('reconnect')
  }

  private update(patch: Partial<EdgeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}

/** t_sent − t_frame（ms）。読めなければ undefined。 */
function delayOf(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { t_frame: frame, t_sent: sent } = raw as Record<string, unknown>
  if (typeof frame !== 'string' || typeof sent !== 'string') return undefined
  const delay = Date.parse(sent) - Date.parse(frame)
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined
}
