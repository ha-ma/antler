import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type {
  TripWriterGateway,
  TripWriterOutcome,
  TripWriterRequest,
} from '../../application/ports/gateways/trip-writer.gateway.js'
import type { EventLog } from '../../application/ports/system/event-log.js'
import { TripWriterError } from '../../domain/trips/errors/trip-errors.js'
import type { TripWritingBrief } from '../../domain/trips/models/trip-writing.js'
import { DEER_SAFETY_WRITING } from './prompts/deer-safety-writing.js'
import { HOKKAIDO_TRAVEL_KNOWLEDGE } from './prompts/hokkaido-travel-knowledge.js'

// Claude（Messages API）にタイトルと各日の 1 行説明を 4 言語で書かせる（docs/specs/plan-trip/functional.md R5）。
// - モデル claude-sonnet-5-5、出力の上限 4,000 トークン、時間切れ 30 秒（AbortSignal で全体を区切る）
// - 決まった形の JSON（structured outputs: output_config.format）で返させる
// - 通信の失敗の再試行は SDK の 1 回まで。時間切れ・認証・上流の失敗は TripWriterError（作り直さない）
// - 上限で切れた・断られた・JSON の形が違う → rejected（usecase が 1 回だけ作り直す）
// - ログに Claude の本文・API キーを出さない（threat.md）

export const TRIP_WRITER_MODEL = 'claude-sonnet-5-5'
export const TRIP_WRITER_MAX_TOKENS = 4000
export const TRIP_WRITER_TIMEOUT_MS = 30_000

const localizedJsonSchema = {
  type: 'object',
  properties: {
    ja: { type: 'string' },
    en: { type: 'string' },
    zh: { type: 'string' },
    ko: { type: 'string' },
  },
  required: ['ja', 'en', 'zh', 'ko'],
  additionalProperties: false,
} as const

/** Claude に返させる JSON の形 */
export const TRIP_WRITING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    titles: localizedJsonSchema,
    dayNotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { day: { type: 'integer' }, note: localizedJsonSchema },
        required: ['day', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['titles', 'dayNotes'],
  additionalProperties: false,
}

const Localized = z.strictObject({ ja: z.string(), en: z.string(), zh: z.string(), ko: z.string() })
const WritingResponse = z.strictObject({
  titles: Localized,
  dayNotes: z.array(z.strictObject({ day: z.number().int(), note: Localized })),
})

export const TRIP_WRITER_SYSTEM_PROMPT = `あなたは北海道をレンタカーで旅する人のための「旅のしおり」の書き手です。
渡される旅の材料（JSON）から、しおりのタイトルと、各日の 1 行説明を、日本語（ja）・英語（en）・繁体字中国語（zh）・韓国語（ko）の 4 言語で書きます。

守ること
- 出力は指定の JSON の形だけ。titles に 4 言語のタイトル、dayNotes に days と同じ数・同じ順で { day, note } を並べる。
- 4 言語とも必ず書く。空にしない。各言語はその言語だけで書く（訳し忘れの日本語を混ぜない）。
- タイトルは短く（どの言語も 40 字程度まで）。各日の説明は 1 文か 2 文の 1 行（日本語・中国語は 80 字程度、英語は 30 語程度まで）。
- 3 桁以上の数字を書かない（西暦の年、予算の金額、距離、件数を含む）。日付は「2月14日」のような月日までにする。
- 「%」「％」「件」「円」の文字を使わない（「条件」「円山」のような語も別の言い方にする）。
- 統計の数字（事故の件数・金額・割合）を書かない。
- 絵文字や顔文字を使わない。
- 材料にない施設名・店名・料金・営業時間を作らない。材料の地名と楽しみの名前を使う。
- 入りきらなかった楽しみ（skipped）は、無理に日程に入れない。
- 予算は雰囲気の参考にだけ使い、金額を書かない。

${HOKKAIDO_TRAVEL_KNOWLEDGE}

${DEER_SAFETY_WRITING}`

/** Claude に渡す user メッセージ。材料はすべて選択肢由来の値（UC-5d）。 */
export function renderTripWritingRequest(request: TripWriterRequest): string {
  const lines = [
    '次の旅のしおりの、タイトルと各日の 1 行説明を書いてください。',
    '<trip>',
    JSON.stringify(toPromptMaterial(request.brief)),
    '</trip>',
  ]
  if (request.previousProblems && request.previousProblems.length > 0) {
    lines.push(
      '前回の出力は次の理由で使えませんでした。直して書き直してください（理由のコード: 問題@場所）:',
      request.previousProblems.join(', '),
    )
  }
  return lines.join('\n')
}

function toPromptMaterial(brief: TripWritingBrief): Record<string, unknown> {
  return {
    primaryLanguage: brief.lang,
    area: brief.area === 'doto' ? 'Eastern Hokkaido (Doto)' : 'Central Hokkaido (Doo)',
    party: brief.party,
    depart: brief.depart,
    return: brief.return,
    budgetPerPersonJPY: brief.budgetPerPersonJPY,
    deerRiskLevel: brief.riskLevel,
    days: brief.days,
    skipped: brief.skipped,
  }
}

type MessagesClient = Pick<Anthropic['messages'], 'create'>

export class ClaudeTripWriterGateway implements TripWriterGateway {
  constructor(
    private readonly messages: MessagesClient,
    private readonly log: EventLog,
    private readonly timeoutMs: number = TRIP_WRITER_TIMEOUT_MS,
  ) {}

  async write(request: TripWriterRequest): Promise<TripWriterOutcome> {
    const started = Date.now()
    let response: Anthropic.Message
    try {
      response = await this.messages.create(
        {
          model: TRIP_WRITER_MODEL,
          max_tokens: TRIP_WRITER_MAX_TOKENS,
          // 決まった形の短い文なので、拡張の思考はしない（思考は max_tokens を食う）
          thinking: { type: 'between_tools' },
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: TRIP_WRITING_JSON_SCHEMA },
          },
          system: [
            { type: 'text', text: TRIP_WRITER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: renderTripWritingRequest(request) }],
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
      this.log.warn('trip.writer.truncated', usage)
      return { kind: 'rejected', reason: 'truncated' }
    }
    if (response.stop_reason === 'refusal') {
      this.log.warn('trip.writer.refused', usage)
      return { kind: 'rejected', reason: 'refused' }
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const parsed = WritingResponse.safeParse(safeJson(text))
    if (!parsed.success) {
      this.log.warn('trip.writer.malformed', usage)
      return { kind: 'rejected', reason: 'malformed' }
    }
    this.log.info('trip.writer.done', usage)
    return { kind: 'draft', writing: parsed.data }
  }

  private toWriterError(error: unknown, durationMs: number): TripWriterError {
    if (
      error instanceof Anthropic.APIUserAbortError ||
      error instanceof Anthropic.APIConnectionTimeoutError
    ) {
      this.log.warn('trip.writer.timeout', { durationMs })
      return new TripWriterError('timeout')
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      this.log.error('trip.writer.auth', { status: error.status, durationMs })
      return new TripWriterError('auth')
    }
    if (error instanceof Anthropic.APIError) {
      this.log.warn('trip.writer.upstream', { status: error.status ?? null, durationMs })
      return new TripWriterError('upstream')
    }
    this.log.warn('trip.writer.upstream', {
      errorName: error instanceof Error ? error.name : 'unknown',
      durationMs,
    })
    return new TripWriterError('upstream')
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
