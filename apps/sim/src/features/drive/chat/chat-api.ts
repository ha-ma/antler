import { z } from 'zod'
import { logger } from '@/shared/utils/logger'
import type { ChatDeck } from './chat-types'

// 会話の束の POST（docs/specs/drive-audio-chat/functional.md R15・R18）。応答の形を zod で確かめ、
// さらに日・版・移動の数がいまの場面と合うときだけ使う（合わなければ見本の会話）。

/** 生成（Claude を含む）は最悪 30 秒 × 2 回 */
const TIMEOUT_MS = 60_000

const Text = z.object({
  ja: z.string().min(1),
  en: z.string().min(1),
  zh: z.string().min(1),
  ko: z.string().min(1),
})

const ChatLineSchema = z.object({
  id: z.string().min(1),
  cue: z.object({
    kind: z.literal('road'),
    leg: z.number().int().min(0),
    km: z.number().min(0),
  }),
  topic: z.enum(['depart', 'pleasure', 'weather', 'light', 'scenery', 'snack', 'music']),
  speaker: z.enum(['p1', 'p2', 'p3', 'radio']),
  text: Text,
})

const ChatResponseSchema = z.object({
  chat: z.object({
    tripId: z.string(),
    day: z.number().int(),
    lines: z.array(ChatLineSchema).max(40),
    data: z.object({ routes: z.string(), zones: z.string() }),
  }),
})

export class ChatDeckError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(`chat deck failed: ${String(status)} ${String(code)}`)
    this.name = 'ChatDeckError'
  }
}

function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined
  return (base ?? '').replace(/\/+$/, '')
}

function errorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null
  const error = (body as { error?: { code?: unknown } | null }).error
  return typeof error?.code === 'string' ? error.code : null
}

export function parseChatResponse(body: unknown): ChatDeck | null {
  const parsed = ChatResponseSchema.safeParse(body)
  if (!parsed.success) return null
  const { chat } = parsed.data
  return {
    tripId: chat.tripId,
    day: chat.day,
    lines: chat.lines,
    data: { routes: chat.data.routes, zones: chat.data.zones },
  }
}

export async function fetchChatDeck(
  tripId: string,
  day: number,
  ownerToken: string,
  signal: AbortSignal,
): Promise<ChatDeck> {
  const url = `${apiBase()}/api/trips/${encodeURIComponent(tripId)}/day/${String(day)}/chat`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
  } catch (cause) {
    // 通信の失敗・時間切れ・中断。見本の会話に落ちる理由をログに残す（本文やトークンは出さない）
    logger.warn('drive.chat.network', { reason: cause instanceof Error ? cause.name : 'unknown' })
    throw new ChatDeckError(null, null)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code = errorCode(body)
    logger.warn('drive.chat.failed', { status: res.status, code })
    throw new ChatDeckError(res.status, code)
  }
  const deck = parseChatResponse(body)
  if (!deck) {
    const error = new ChatDeckError(null, 'INVALID_RESPONSE')
    logger.error('drive.chat.invalid', error, { status: res.status })
    throw error
  }
  return deck
}

/** やり直すのは通信の失敗の 1 回だけ（4xx・5xx・形の違いはやり直さない。R18） */
export function shouldRetryChat(count: number, error: unknown): boolean {
  return error instanceof ChatDeckError && error.status === null && error.code === null && count < 1
}

/** いまの場面に使える束か（日・版・移動の数。R18） */
export function deckFits(
  deck: ChatDeck,
  scene: {
    tripId: string
    day: number
    data: { routes: string; zones: string } | null
    legCount: number
  },
): boolean {
  if (deck.tripId !== scene.tripId || deck.day !== scene.day) return false
  if (!deck.data || !scene.data) return false
  if (deck.data.routes !== scene.data.routes || deck.data.zones !== scene.data.zones) return false
  return deck.lines.every((l) => l.cue.leg < scene.legCount)
}
