import Anthropic from '@anthropic-ai/sdk'
import { validStory } from '../../../tests/factories/losses.js'
import { MemoryLog } from '../../../tests/factories/trips.js'
import { LossWriterError } from '../../domain/losses/errors/loss-errors.js'
import type { LossBrief } from '../../domain/losses/models/loss.js'
import {
  ClaudeLossWriterGateway,
  LOSS_WRITER_MAX_TOKENS,
  LOSS_WRITER_MODEL,
  LOSS_WRITER_SYSTEM_PROMPT,
  renderLossRequest,
} from './claude-loss-writer.gateway.js'

// docs/specs/loss/functional.md R5、resilience.md（UC-5a・FAIL-1・FAIL-3）

const L = (ja: string, en: string) => ({ ja, en, zh: ja, ko: '두루미' })
const brief: LossBrief = {
  lang: 'zh',
  partySize: 4,
  totalDays: 5,
  collisionDay: 2,
  lostDays: 4,
  collisionLeg: { from: L('鶴居', 'Tsurui'), to: L('知床', 'Shiretoko') },
  achieved: [L('タンチョウ', 'Cranes')],
  lost: [L('流氷ウォーク', 'Drift ice walk')],
  lostStays: [L('知床', 'Shiretoko')],
  alertEnabled: false,
}

function message(overrides: Partial<Anthropic.Message> & { text?: string }): Anthropic.Message {
  const { text, ...rest } = overrides
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: LOSS_WRITER_MODEL,
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
  return { gateway: new ClaudeLossWriterGateway(messages, log, 50), calls, log }
}

describe('ClaudeLossWriterGateway', () => {
  it('UC-5a: claude-sonnet-5-5・max_tokens 1500・決まった形の JSON で頼み、draft を返す', async () => {
    const story = validStory()
    const { gateway, calls, log } = setup(() =>
      Promise.resolve(message({ text: JSON.stringify(story) })),
    )
    expect(await gateway.write({ brief })).toEqual({ kind: 'draft', output: story })
    const params = calls[0]?.params
    if (!params) throw new Error('Claude が呼ばれていない')
    expect(params.model).toBe('claude-sonnet-5-5')
    expect(params.max_tokens).toBe(LOSS_WRITER_MAX_TOKENS)
    expect(params.output_config?.format?.type).toBe('json_schema')
    expect(log.has('loss.writer.done')).toBe(true)
    // ログに本文を出さない
    expect(JSON.stringify(log.events)).not.toContain(story.story.ja)
  })

  it('UC-5a: 材料は名前と選択肢由来の値だけ。喪失の部品と注意喚起の部品を system に持つ', () => {
    const text = renderLossRequest({ brief, previousProblems: ['empty@story.ko'] })
    expect(text).toContain('"alertEnabled":false')
    expect(text).toContain('流氷ウォーク')
    expect(text).toContain('empty@story.ko')
    expect(text).not.toMatch(/[0-9]{3,}/)
    expect(LOSS_WRITER_SYSTEM_PROMPT).toContain('<guide name="loss-writing">')
    expect(LOSS_WRITER_SYSTEM_PROMPT).toContain('<guide name="deer-safety-writing">')
  })

  it('FAIL-3: 上限で切れた・断られた・形の違う JSON は rejected', async () => {
    const cases: [Partial<Anthropic.Message> & { text?: string }, string][] = [
      [{ stop_reason: 'max_tokens', text: '{"story":' }, 'truncated'],
      [{ stop_reason: 'refusal' }, 'refused'],
      [{ text: '{"story":{"ja":"a"}}' }, 'malformed'],
      [{ text: 'not json' }, 'malformed'],
    ]
    for (const [overrides, reason] of cases) {
      const { gateway } = setup(() => Promise.resolve(message(overrides)))
      expect(await gateway.write({ brief })).toEqual({ kind: 'rejected', reason })
    }
  })

  it('FAIL-1: 時間切れ・認証・上流の失敗は LossWriterError（理由つき）', async () => {
    // フェイクは signal を見ないので、時間切れは SDK の例外の形で確かめる
    const timeout = setup(() => Promise.reject(new Anthropic.APIConnectionTimeoutError()))
    await expect(timeout.gateway.write({ brief })).rejects.toMatchObject({ reason: 'timeout' })
    const auth = setup(() =>
      Promise.reject(new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers())),
    )
    await expect(auth.gateway.write({ brief })).rejects.toMatchObject({ reason: 'auth' })
    const other = setup(() => Promise.reject(new Error('socket')))
    const error = await other.gateway.write({ brief }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LossWriterError)
    expect((error as LossWriterError).reason).toBe('upstream')
  })
})
