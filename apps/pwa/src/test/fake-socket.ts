// テスト用の偽 WebSocket。EdgeClient の SocketLike を満たし、サーバー側の操作（open・message・close）をテストから呼ぶ。

export class FakeSocket {
  static instances: FakeSocket[] = []

  readyState = 0
  sent: string[] = []
  closeCalls = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  static reset(): void {
    FakeSocket.instances = []
  }

  static get last(): FakeSocket {
    const s = FakeSocket.instances[FakeSocket.instances.length - 1]
    if (!s) throw new Error('FakeSocket がまだ作られていません')
    return s
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls += 1
    this.readyState = 3
  }

  // --- サーバー側の操作 ---
  serverOpen(): void {
    this.readyState = 1
    this.onopen?.()
  }

  serverSend(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }

  serverSendRaw(data: unknown): void {
    this.onmessage?.({ data })
  }

  serverClose(): void {
    this.readyState = 3
    this.onclose?.()
  }

  serverError(): void {
    this.onerror?.()
  }
}
