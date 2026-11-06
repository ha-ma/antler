import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type {
  ChatWriterGateway,
  ChatWriterOutcome,
  ChatWriterRequest,
} from '../../application/ports/gateways/chat-writer.gateway.js'
import type { EventLog } from '../../application/ports/system/event-log.js'
import { ChatWriterError } from '../../domain/chats/errors/chat-errors.js'
import type { ChatWritingBrief } from '../../domain/chats/models/chat-deck.js'
import { CHAT_WRITING } from './prompts/chat-writing.js'

// Claude（Messages API）に車内の会話の一言を 4 言語で書かせる（docs/specs/drive-audio-chat/functional.md R16・R17）。
// loss の ClaudeLossWriterGateway と同じ作り: モデル claude-sonnet-5-5、決まった形の JSON（structured outputs）、
// 時間切れ 30 秒（AbortSignal で全体を区切る）、通信の再試行は SDK の 1 回まで。
// 上限で切れた・断られた・JSON の形が違う → rejected（usecase が 1 回だけ作り直す）。ログに本文・材料・API キーを出さない。
// 鹿の注意の書き方（DEER_SAFETY_WRITING）は入れない（会話では鹿に触れさせない。R17）。

export const CHAT_WRITER_MODEL = 'claude-sonnet-5-5'
/** 1 日の行は depart ＋ 話の行 10 まで（4 言語 × 60 文字が上限）。切れると作り直しになるので余裕を持たせる */
export const CHAT_WRITER_MAX_TOKENS = 4000
export const CHAT_WRITER_TIMEOUT_MS = 30_000

const TEXT_SCHEMA = {
  type: 'object',
  properties: {
    ja: { type: 'string' },
    en: { type: 'string' },
    zh: { type: 'string' },
    ko: { type: 'string' },
  },
  required: ['ja', 'en', 'zh', 'ko'],
  additionalProperties: false,
}

/** Claude に返させる JSON の形 */
export const CHAT_WRITING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: TEXT_SCHEMA },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
}

const WritingResponse = z.strictObject({
  lines: z.array(
    z.strictObject({
      id: z.string(),
      text: z.strictObject({ ja: z.string(), en: z.string(), zh: z.string(), ko: z.string() }),
    }),
  ),
})

export const CHAT_WRITER_SYSTEM_PROMPT = `あなたは北海道をレンタカーで旅するシミュレーションの書き手です。
運転中の画面に出す、車内の同乗者（1 人旅ならラジオの DJ）の短い一言を、日本語（ja）・英語（en）・繁体字中国語（zh）・韓国語（ko）の 4 言語で書きます。
いつ・誰が・何の話題で話すかは決まっています。あなたは各行の一言（text）だけを書きます。

守ること
- 出力は指定の JSON の形だけ。lines に、材料の行と同じ id・同じ順・同じ数で { id, text: { ja, en, zh, ko } } を入れる。
- 材料にない施設名・店名・地名を作らない。材料の地名と楽しみの名前を使う。

${CHAT_WRITING}`

/** Claude に渡す user メッセージ。材料はマスターの名前と api が決めた値だけ（WRITE-2d） */
export function renderChatRequest(request: ChatWriterRequest): string {
  const lines = [
    '次の運転の日の、車内の会話の一言を書いてください。',
    '<chat>',
    JSON.stringify(toPromptMaterial(request.brief)),
    '</chat>',
  ]
  if (request.previousProblems && request.previousProblems.length > 0) {
    lines.push(
      '前回の出力は次の理由で使えませんでした。直して書き直してください（理由のコード: 問題@場所）:',
      request.previousProblems.join(', '),
    )
  }
  return lines.join('\n')
}

function toPromptMaterial(brief: ChatWritingBrief): Record<string, unknown> {
  return {
    primaryLanguage: brief.lang,
    partySize: brief.partySize,
    experience: brief.experience,
    month: brief.month,
    conditions: brief.conditions,
    lines: brief.lines.map((l) => ({
      id: l.id,
      topic: l.topic,
      speaker: l.speaker,
      from: l.from,
      to: l.to,
      pleasure: l.pleasure,
      light: l.light,
    })),
  }
}

type MessagesClient = Pick<Anthropic['messages'], 'create'>

export class ClaudeChatWriterGateway implements ChatWriterGateway {
  constructor(
    private readonly messages: MessagesClient,
    private readonly log: EventLog,
    private readonly timeoutMs: number = CHAT_WRITER_TIMEOUT_MS,
  ) {}

  async write(request: ChatWriterRequest): Promise<ChatWriterOutcome> {
    const started = Date.now()
    let response: Anthropic.Message
    try {
      response = await this.messages.create(
        {
          model: CHAT_WRITER_MODEL,
          max_tokens: CHAT_WRITER_MAX_TOKENS,
          // 決まった形の短い文なので、拡張の思考はしない（思考は max_tokens を食う）
          thinking: { type: 'between_tools' },
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: CHAT_WRITING_JSON_SCHEMA },
          },
          system: [
            { type: 'text', text: CHAT_WRITER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: renderChatRequest(request) }],
        },
        { signal: AbortSignal.timeout(this.timeoutMs), timeout: this.timeoutMs, maxRetries: 1 },
      )
    } catch (error) {
      throw this.toWriterError(error, Date.now() - started)
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs: Date.now() - started,
    }
    if (response.stop_reason === 'max_tokens') {
      this.log.warn('chat.writer.truncated', usage)
      return { kind: 'rejected', reason: 'truncated' }
    }
    if (response.stop_reason === 'refusal') {
      this.log.warn('chat.writer.refused', usage)
      return { kind: 'rejected', reason: 'refused' }
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const parsed = WritingResponse.safeParse(safeJson(text))
    if (!parsed.success) {
      this.log.warn('chat.writer.malformed', usage)
      return { kind: 'rejected', reason: 'malformed' }
    }
    this.log.info('chat.writer.done', { ...usage, lines: parsed.data.lines.length })
    return { kind: 'draft', writing: parsed.data }
  }

  private toWriterError(error: unknown, durationMs: number): ChatWriterError {
    if (
      error instanceof Anthropic.APIUserAbortError ||
      error instanceof Anthropic.APIConnectionTimeoutError
    ) {
      this.log.warn('chat.writer.timeout', { durationMs })
      return new ChatWriterError('timeout')
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      this.log.error('chat.writer.auth', { status: error.status, durationMs })
      return new ChatWriterError('auth')
    }
    if (error instanceof Anthropic.APIError) {
      this.log.warn('chat.writer.upstream', { status: error.status ?? null, durationMs })
      return new ChatWriterError('upstream')
    }
    this.log.warn('chat.writer.upstream', {
      errorName: error instanceof Error ? error.name : 'unknown',
      durationMs,
    })
    return new ChatWriterError('upstream')
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
