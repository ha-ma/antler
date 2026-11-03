import Anthropic from '@anthropic-ai/sdk'
import { MemoryLog, validWriting } from '../../../tests/factories/trips.js'
import type { TripWritingBrief } from '../../domain/trips/models/trip-writing.js'
import {
  ClaudeTripWriterGateway,
  renderTripWritingRequest,
  TRIP_WRITER_MAX_TOKENS,
  TRIP_WRITER_MODEL,
  TRIP_WRITER_SYSTEM_PROMPT,
} from './claude-trip-writer.gateway.js'

const name = { ja: '釧路', en: 'Kushiro', zh: '釧路', ko: '구시로' }
const brief: TripWritingBrief = {
  lang: 'zh',
  area: 'doto',
  party: { size: 4, drivers: 2, experience: 'first' },
  depart: { place: name, date: { month: 2, dayOfMonth: 14 }, time: '10:00' },
  return: { place: name, date: { month: 2, dayOfMonth: 15 }, time: '17:00' },
  budgetPerPersonJPY: 0,
  days: [
    { day: 1, date: { month: 2, dayOfMonth: 14 }, from: name, to: name, stay: name, stops: [] },
    { day: 2, date: { month: 2, dayOfMonth: 15 }, from: name, to: name, stay: null, stops: [] },
  ],
  skipped: [],
  riskLevel: 'high',
}

function message(overrides: Partial<Anthropic.Message> & { text?: string }): Anthropic.Message {
  const { text, ...rest } = overrides
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: TRIP_WRITER_MODEL,
    content: [{ type: 'text', text: text ?? '', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
    ...rest,
  } as Anthropic.Message
}

function setup(respond: (params: unknown, options: unknown) => Promise<Anthropic.Message>) {
  const calls: { params: Anthropic.MessageCreateParamsNonStreaming; options: unknown }[] = []
  const messages = {
    create: (params: Anthropic.MessageCreateParamsNonStreaming, options: unknown) => {
      calls.push({ params, options })
      return respond(params, options)
    },
  } as unknown as Pick<Anthropic['messages'], 'create'>
  const log = new MemoryLog()
  return { gateway: new ClaudeTripWriterGateway(messages, log, 50), calls, log }
}

describe('ClaudeTripWriterGateway', () => {
  it('UC-5a: claude-sonnet-5-5・max_tokens 4000・決まった形の JSON で頼み、draft を返す', async () => {
    const writing = validWriting(brief)
    const { gateway, calls, log } = setup(() =>
      Promise.resolve(message({ text: JSON.stringify(writing) })),
    )
    const out = await gateway.write({ brief })
    expect(out).toEqual({ kind: 'draft', writing })
    const params = calls[0]?.params
    if (!params) throw new Error('Claude が呼ばれていない')
    expect(params.model).toBe('claude-sonnet-5-5')
    expect(params.max_tokens).toBe(TRIP_WRITER_MAX_TOKENS)
    expect(params.output_config?.format?.type).toBe('json_schema')
    expect(params).not.toHaveProperty('temperature')
    expect(log.events.find((e) => e.event === 'trip.writer.done')?.fields).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
    })
  })

  it('UC-5d: プロンプトは材料の JSON だけ。2 部品（観光知識・注意喚起の書き方）を system に持つ', () => {
    const text = renderTripWritingRequest({ brief })
    expect(text).toContain(JSON.stringify(brief.days))
    expect(text).not.toContain('前回の出力')
    expect(TRIP_WRITER_SYSTEM_PROMPT).toContain('<knowledge name="hokkaido-travel">')
    expect(TRIP_WRITER_SYSTEM_PROMPT).toContain('<guide name="deer-safety-writing">')
    // 統計の数字をプロンプトに入れない（3 桁以上の数が無い）
    expect(TRIP_WRITER_SYSTEM_PROMPT).not.toMatch(/[0-9]{3,}/)
    expect(renderTripWritingRequest({ brief, previousProblems: ['empty@titles.ko'] })).toContain(
      'empty@titles.ko',
    )
  })

  it('FAIL-3: max_tokens で切れた応答 → rejected: truncated', async () => {
    const { gateway, log } = setup(() =>
      Promise.resolve(message({ text: '{"titles":', stop_reason: 'max_tokens' })),
    )
    expect(await gateway.write({ brief })).toEqual({ kind: 'rejected', reason: 'truncated' })
    expect(log.has('trip.writer.truncated')).toBe(true)
  })

  it('断られた（refusal）→ rejected: refused', async () => {
    const { gateway } = setup(() => Promise.resolve(message({ stop_reason: 'refusal' })))
    expect(await gateway.write({ brief })).toEqual({ kind: 'rejected', reason: 'refused' })
  })

  it('JSON でない・形が違う → rejected: malformed（本文はログに出さない）', async () => {
    for (const text of ['not json', JSON.stringify({ titles: {}, dayNotes: [] })]) {
      const { gateway, log } = setup(() => Promise.resolve(message({ text })))
      expect(await gateway.write({ brief })).toEqual({ kind: 'rejected', reason: 'malformed' })
      expect(JSON.stringify(log.events)).not.toContain(text)
    }
  })

  it('FAIL-1: 時間切れ → TripWriterError(timeout)。AbortSignal で全体を区切る', async () => {
    const { gateway, calls, log } = setup(
      (_p, options) =>
        new Promise((_resolve, reject) => {
          const signal = (options as { signal: AbortSignal }).signal
          signal.addEventListener('abort', () => {
            reject(new Anthropic.APIUserAbortError())
          })
        }),
    )
    await expect(gateway.write({ brief })).rejects.toMatchObject({ reason: 'timeout' })
    expect(calls[0]?.options).toMatchObject({ maxRetries: 1, timeout: 50 })
    expect(log.has('trip.writer.timeout')).toBe(true)
  })

  it('認証の失敗 → TripWriterError(auth) と error のログ', async () => {
    const { gateway, log } = setup(() =>
      Promise.reject(new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers())),
    )
    await expect(gateway.write({ brief })).rejects.toMatchObject({ reason: 'auth' })
    expect(log.events.find((e) => e.event === 'trip.writer.auth')?.level).toBe('error')
  })

  it('上流の失敗・ネットワーク → TripWriterError(upstream)', async () => {
    const upstream = setup(() =>
      Promise.reject(new Anthropic.InternalServerError(500, undefined, 'boom', new Headers())),
    )
    await expect(upstream.gateway.write({ brief })).rejects.toMatchObject({ reason: 'upstream' })
    const network = setup(() => Promise.reject(new TypeError('fetch failed')))
    await expect(network.gateway.write({ brief })).rejects.toMatchObject({ reason: 'upstream' })
    expect(network.log.has('trip.writer.upstream')).toBe(true)
  })
})
