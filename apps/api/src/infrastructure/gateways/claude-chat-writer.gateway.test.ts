import Anthropic from '@anthropic-ai/sdk'
import { validChatWriting } from '../../../tests/factories/chats.js'
import { MemoryLog } from '../../../tests/factories/trips.js'
import { ChatWriterError } from '../../domain/chats/errors/chat-errors.js'
import type { ChatWritingBrief } from '../../domain/chats/models/chat-deck.js'
import {
  CHAT_WRITER_MAX_TOKENS,
  CHAT_WRITER_MODEL,
  CHAT_WRITER_SYSTEM_PROMPT,
  ClaudeChatWriterGateway,
  renderChatRequest,
} from './claude-chat-writer.gateway.js'

// docs/specs/drive-audio-chat/functional.md R16・R17、resilience.md（WRITE-2d・WRITE-2e）

const L = (ja: string, en: string, zh: string, ko: string) => ({ ja, en, zh, ko })
const brief: ChatWritingBrief = {
  lang: 'zh',
  partySize: 4,
  experience: 'first',
  month: 2,
  conditions: { weather: 'clear', surface: 'packed-snow' },
  lines: [
    {
      id: 'l01',
      topic: 'depart',
      speaker: 'p1',
      from: L('新千歳空港', 'New Chitose Airport', '新千歲機場', '신치토세 공항'),
      to: L('鶴居村', 'Tsurui', '鶴居村', '쓰루이무라'),
      pleasure: null,
      light: null,
    },
    {
      id: 'l02',
      topic: 'pleasure',
      speaker: 'p2',
      from: L('鶴居村', 'Tsurui', '鶴居村', '쓰루이무라'),
      to: L('知床（ウトロ）', 'Shiretoko (Utoro)', '知床（宇登呂）', '시레토코(우토로)'),
      pleasure: {
        name: L('流氷ウォーク', 'Drift ice walk', '流冰漫步', '유빙 워크'),
        place: L('知床（ウトロ）', 'Shiretoko (Utoro)', '知床（宇登呂）', '시레토코(우토로)'),
        timeOfDay: 'day',
        length: 'half',
        timing: 'ahead',
        angle: 'highlight',
      },
      light: 'dusk',
    },
  ],
}

function message(overrides: Partial<Anthropic.Message> & { text?: string }): Anthropic.Message {
  const { text, ...rest } = overrides
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: CHAT_WRITER_MODEL,
    content: [{ type: 'text', text: text ?? '', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
    ...rest,
  } as Anthropic.Message
}

function setup(respond: () => Promise<Anthropic.Message>) {
  const calls: { params: Anthropic.MessageCreateParamsNonStreaming; options: unknown }[] = []
  const messages = {
    create: (params: Anthropic.MessageCreateParamsNonStreaming, options: unknown) => {
      calls.push({ params, options })
      return respond()
    },
  } as unknown as Pick<Anthropic['messages'], 'create'>
  const log = new MemoryLog()
  return { gateway: new ClaudeChatWriterGateway(messages, log, 50), calls, log }
}

describe('ClaudeChatWriterGateway', () => {
  it('WRITE-2e: claude-sonnet-5-5・max_tokens・決まった形の JSON で頼み、draft を返す。ログに本文を出さない', async () => {
    const writing = validChatWriting(brief)
    const { gateway, calls, log } = setup(() =>
      Promise.resolve(message({ text: JSON.stringify(writing) })),
    )
    expect(await gateway.write({ brief })).toEqual({ kind: 'draft', writing })
    const params = calls[0]?.params
    if (!params) throw new Error('Claude が呼ばれていない')
    expect(params.model).toBe('claude-sonnet-5-5')
    expect(params.max_tokens).toBe(CHAT_WRITER_MAX_TOKENS)
    expect(params.output_config?.format?.type).toBe('json_schema')
    expect(calls[0]?.options).toMatchObject({ timeout: 50, maxRetries: 1 })
    expect(log.has('chat.writer.done')).toBe(true)
    expect(JSON.stringify(log.events)).not.toContain(writing.lines[0]?.text.ja ?? '?')
    expect(JSON.stringify(log.events)).not.toContain('流氷')
  })

  it('WRITE-2d: 材料は話題・席・人数・経験・月・天気・路面・光・マスターの名前だけ。作り直しには理由のコードだけ', () => {
    const text = renderChatRequest({ brief, previousProblems: ['digit@lines.0.ja'] })
    expect(text).toContain('"topic":"pleasure"')
    expect(text).toContain('"speaker":"p2"')
    expect(text).toContain('"light":"dusk"')
    expect(text).toContain('流冰漫步')
    expect(text).toContain('"surface":"packed-snow"')
    expect(text).toContain('digit@lines.0.ja')
    const material = /<chat>\n(.*)\n<\/chat>/.exec(text)?.[1] ?? ''
    expect(Object.keys(JSON.parse(material) as object).sort()).toEqual(
      ['conditions', 'experience', 'lines', 'month', 'partySize', 'primaryLanguage'].sort(),
    )
    expect(material).not.toMatch(/[0-9]{3,}|:\d{2}|km|JPY|budget/)
  })

  it('UC-2a: 楽しみの行の材料は名前・拠点の地名・時間帯・所要の区分・timing・angle だけ（note・時間の数を含まない）', () => {
    const text = renderChatRequest({ brief })
    const material = /<chat>\n(.*)\n<\/chat>/.exec(text)?.[1] ?? ''
    const lines = (
      JSON.parse(material) as { lines: { pleasure: Record<string, unknown> | null }[] }
    ).lines
    expect(Object.keys(lines[1]?.pleasure ?? {}).sort()).toEqual(
      ['angle', 'length', 'name', 'place', 'timeOfDay', 'timing'].sort(),
    )
    expect(lines[1]?.pleasure).toMatchObject({
      timing: 'ahead',
      angle: 'highlight',
      length: 'half',
    })
    expect(JSON.stringify(lines.map((l) => l.pleasure))).not.toMatch(/\d/)
  })

  it('UC-2b: system は楽しみの話の切り口の書き分けと、作らないもの（施設名・料金・時刻）を持つ', () => {
    for (const word of ['anticipation', 'highlight', 'tip', 'memory']) {
      expect(CHAT_WRITER_SYSTEM_PROMPT).toContain(word)
    }
    expect(CHAT_WRITER_SYSTEM_PROMPT).toContain('材料に無い施設名・店名・料金・時刻を作らない')
  })

  it('WRITE-2d: system は会話の書き方の部品を持ち、繁体字・鹿の語・数字・運転の指図・長い問いかけを禁じる。鹿の注意の部品は入れない', () => {
    expect(CHAT_WRITER_SYSTEM_PROMPT).toContain('<guide name="chat-writing">')
    expect(CHAT_WRITER_SYSTEM_PROMPT).not.toContain('<guide name="deer-safety-writing">')
    expect(CHAT_WRITER_SYSTEM_PROMPT).toContain('繁體中文')
    expect(CHAT_WRITER_SYSTEM_PROMPT).toContain('「鹿」「シカ」「deer」「사슴」')
    expect(CHAT_WRITER_SYSTEM_PROMPT).toContain('数字（0-9）を一切書かない')
    expect(CHAT_WRITER_SYSTEM_PROMPT).toContain('運転の指図をしない')
    expect(CHAT_WRITER_SYSTEM_PROMPT).toContain('長い問いかけをしない')
  })

  it('WRITE-2e: 上限で切れた・断られた・形の違う JSON は rejected', async () => {
    const cases: [Partial<Anthropic.Message> & { text?: string }, string][] = [
      [{ stop_reason: 'max_tokens', text: '{"lines":' }, 'truncated'],
      [{ stop_reason: 'refusal' }, 'refused'],
      [{ text: '{"lines":[{"id":"l01","text":{"ja":"a"}}]}' }, 'malformed'],
      [{ text: '{"lines":[],"extra":true}' }, 'malformed'],
      [{ text: 'not json' }, 'malformed'],
    ]
    for (const [overrides, reason] of cases) {
      const { gateway } = setup(() => Promise.resolve(message(overrides)))
      expect(await gateway.write({ brief })).toEqual({ kind: 'rejected', reason })
    }
  })

  it('WRITE-2e: 時間切れ・認証・上流の失敗は ChatWriterError（理由つき）', async () => {
    const timeout = setup(() => Promise.reject(new Anthropic.APIConnectionTimeoutError()))
    await expect(timeout.gateway.write({ brief })).rejects.toMatchObject({ reason: 'timeout' })
    const abort = setup(() => Promise.reject(new Anthropic.APIUserAbortError()))
    await expect(abort.gateway.write({ brief })).rejects.toMatchObject({ reason: 'timeout' })
    const auth = setup(() =>
      Promise.reject(new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers())),
    )
    await expect(auth.gateway.write({ brief })).rejects.toMatchObject({ reason: 'auth' })
    expect(auth.log.has('chat.writer.auth')).toBe(true)
    const upstream = setup(() =>
      Promise.reject(new Anthropic.InternalServerError(500, undefined, 'boom', new Headers())),
    )
    await expect(upstream.gateway.write({ brief })).rejects.toMatchObject({ reason: 'upstream' })
    const other = setup(() => Promise.reject(new Error('socket')))
    const error = await other.gateway.write({ brief }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChatWriterError)
    expect((error as ChatWriterError).reason).toBe('upstream')
  })
})
