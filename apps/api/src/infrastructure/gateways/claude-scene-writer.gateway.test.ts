import Anthropic from '@anthropic-ai/sdk'
import { validStopWriting } from '../../../tests/factories/stop-events.js'
import { MemoryLog } from '../../../tests/factories/trips.js'
import { SceneWriterError } from '../../domain/stop-events/errors/stop-event-errors.js'
import type { StopWritingBrief } from '../../domain/stop-events/models/stop-writing.js'
import {
  ClaudeSceneWriterGateway,
  renderStopWritingRequest,
  SCENE_WRITER_MAX_TOKENS,
  SCENE_WRITER_MODEL,
  SCENE_WRITER_SYSTEM_PROMPT,
} from './claude-scene-writer.gateway.js'

// WRITE-2e（docs/specs/stop-events/functional.md R7）。Messages API はフェイク。

const name = { ja: '鶴居', en: 'Tsurui', zh: '鶴居', ko: '쓰루이' }
const brief: StopWritingBrief = {
  lang: 'zh',
  area: 'doto',
  month: 2,
  party: { size: 4, experience: 'first' },
  conditions: { weather: 'snow', surface: 'packed-snow' },
  from: name,
  to: name,
  scenes: [
    {
      id: 'p-red-crowned-crane',
      kind: 'pleasure',
      pleasure: {
        name: { ja: 'タンチョウ', en: 'Cranes', zh: '丹頂鶴', ko: '두루미' },
        weight: 4,
        timeOfDay: 'day',
      },
      place: name,
      choices: [
        {
          id: 'leave',
          kind: 'leave',
          delayMin: 0,
          endsDay: false,
          zoneLight: 'day',
          lostWeight: 0,
          lostPleasures: [],
        },
        {
          id: 'linger',
          kind: 'linger',
          delayMin: 60,
          endsDay: false,
          zoneLight: 'dusk',
          lostWeight: 0,
          lostPleasures: [],
        },
      ],
    },
  ],
}

function message(overrides: Partial<Anthropic.Message> & { text?: string }): Anthropic.Message {
  const { text, ...rest } = overrides
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: SCENE_WRITER_MODEL,
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
  return { gateway: new ClaudeSceneWriterGateway(messages, log, 50), calls, log }
}

describe('ClaudeSceneWriterGateway（WRITE-2e）', () => {
  it('claude-sonnet-5-5・max_tokens 8000・決まった形の JSON で頼み、draft を返す', async () => {
    const writing = validStopWriting(brief)
    const { gateway, calls } = setup(() =>
      Promise.resolve(message({ text: JSON.stringify(writing) })),
    )
    expect(await gateway.write({ brief })).toEqual({ kind: 'draft', writing })
    const params = calls[0]?.params
    expect(params?.model).toBe('claude-sonnet-5-5')
    expect(params?.max_tokens).toBe(SCENE_WRITER_MAX_TOKENS)
    expect(params?.output_config?.format?.type).toBe('json_schema')
  })

  it('プロンプトは材料の JSON だけで、2 部品を system に持ち、統計の数字を含まない', () => {
    const text = renderStopWritingRequest({ brief })
    expect(text).toContain(JSON.stringify(brief.scenes))
    expect(SCENE_WRITER_SYSTEM_PROMPT).toContain('<knowledge name="hokkaido-travel">')
    expect(SCENE_WRITER_SYSTEM_PROMPT).toContain('<guide name="deer-safety-writing">')
    expect(SCENE_WRITER_SYSTEM_PROMPT).not.toMatch(/[0-9]{3,}/)
    expect(renderStopWritingRequest({ brief, previousProblems: ['digit@scenes.0'] })).toContain(
      'digit@scenes.0',
    )
  })

  it('max_tokens・refusal・形の違う JSON → rejected（本文はログに出さない）', async () => {
    const truncated = setup(() =>
      Promise.resolve(message({ text: '{"scenes":', stop_reason: 'max_tokens' })),
    )
    expect(await truncated.gateway.write({ brief })).toEqual({
      kind: 'rejected',
      reason: 'truncated',
    })
    const refused = setup(() => Promise.resolve(message({ stop_reason: 'refusal' })))
    expect(await refused.gateway.write({ brief })).toEqual({ kind: 'rejected', reason: 'refused' })
    for (const text of ['not json', JSON.stringify({ scenes: [{ id: 'x' }] })]) {
      const { gateway, log } = setup(() => Promise.resolve(message({ text })))
      expect(await gateway.write({ brief })).toEqual({ kind: 'rejected', reason: 'malformed' })
      expect(JSON.stringify(log.events)).not.toContain(text)
    }
  })

  it('時間切れ → SceneWriterError(timeout)、認証 → auth（error のログ）、上流 → upstream', async () => {
    const slow = setup(
      (_p, options) =>
        new Promise((_resolve, reject) => {
          ;(options as { signal: AbortSignal }).signal.addEventListener('abort', () => {
            reject(new Anthropic.APIUserAbortError())
          })
        }),
    )
    await expect(slow.gateway.write({ brief })).rejects.toMatchObject({ reason: 'timeout' })
    expect(slow.calls[0]?.options).toMatchObject({ maxRetries: 1, timeout: 50 })

    const auth = setup(() =>
      Promise.reject(new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers())),
    )
    await expect(auth.gateway.write({ brief })).rejects.toBeInstanceOf(SceneWriterError)
    expect(auth.log.events.find((e) => e.event === 'stop_deck.writer.auth')?.level).toBe('error')

    const upstream = setup(() =>
      Promise.reject(new Anthropic.InternalServerError(500, undefined, 'boom', new Headers())),
    )
    await expect(upstream.gateway.write({ brief })).rejects.toMatchObject({ reason: 'upstream' })
    const network = setup(() => Promise.reject(new TypeError('fetch failed')))
    await expect(network.gateway.write({ brief })).rejects.toMatchObject({ reason: 'upstream' })
  })
})
