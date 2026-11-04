import { logger } from '@/shared/utils/logger'
import type { TripEventDraft } from '../types'
import { apiBase, errorCode, OWNER_TOKEN_HEADER } from './api'

// イベントの送信（POST /api/trips/:id/events。docs/specs/stop-events/functional.md R10・R12、resilience.md）。
// - seq は 0 から 1 つずつ振る。runId と seq はメモリだけ（再読み込みは新しい run。seq が戻って衝突しない）
// - 通信の失敗・5xx は同じ seq で 2 回まで送り直す（api は同じ (runId, seq) を重複として受ける）
// - それでも届かない・4xx は捨てて警告のログ（画面は止めない）

export type EventSenderOptions = {
  tripId: string
  runId: string
  ownerToken: string
  /** 送り直しの間隔（テストで縮める） */
  retryDelaysMs?: readonly number[]
}

const DEFAULT_DELAYS = [1_000, 3_000] as const
const TIMEOUT_MS = 10_000

/** 走行（run）の ID。UUID v4 */
export function newRunId(): string {
  return crypto.randomUUID()
}

export class TripEventSender {
  private nextSeq = 0

  constructor(private readonly options: EventSenderOptions) {}

  /**
   * seq を振って送る。結果（届いたか）を返すが、呼ぶ側は待たなくてよい。
   * alertEnabled は送るときの値（走行の途中で切り替えても、seq は run の中で続く。component-guard W1）
   */
  log(draft: TripEventDraft, alertEnabled: boolean): Promise<boolean> {
    const event = { ...draft, seq: this.nextSeq++ }
    return this.send(event, alertEnabled)
  }

  private async send(
    event: TripEventDraft & { seq: number },
    alertEnabled: boolean,
  ): Promise<boolean> {
    const { tripId, runId, ownerToken } = this.options
    const delays = this.options.retryDelaysMs ?? DEFAULT_DELAYS
    const url = `${apiBase()}/api/trips/${encodeURIComponent(tripId)}/events`
    const body = JSON.stringify({ runId, alertEnabled, events: [event] })
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      let status: number | null = null
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [OWNER_TOKEN_HEADER]: ownerToken },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (res.ok) return true
        status = res.status
        if (status < 500) {
          logger.warn('stop-events.log.rejected', {
            status,
            code: errorCode(await res.json().catch(() => null)),
            kind: event.kind,
            seq: event.seq,
          })
          return false
        }
      } catch {
        status = null
      }
      const delay = delays[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    logger.warn('stop-events.log.failed', { kind: event.kind, seq: event.seq })
    return false
  }
}
