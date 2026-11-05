import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type {
  LossWriterGateway,
  LossWriterOutcome,
  LossWriterRequest,
} from '../../application/ports/gateways/loss-writer.gateway.js'
import type { EventLog } from '../../application/ports/system/event-log.js'
import { LossWriterError } from '../../domain/losses/errors/loss-errors.js'
import type { LossBrief } from '../../domain/losses/models/loss.js'
import { DEER_SAFETY_WRITING } from './prompts/deer-safety-writing.js'
import { LOSS_WRITING } from './prompts/loss-writing.js'

// Claude（Messages API）に「失ったもの」の文を 4 言語で書かせる（docs/specs/loss/functional.md R5）。
// plan-trip の ClaudeTripWriterGateway と同じ作り: モデル claude-sonnet-5-5、決まった形の JSON（structured outputs）、
// 時間切れ 30 秒（AbortSignal で全体を区切る）、通信の再試行は SDK の 1 回まで。
// 上限で切れた・断られた・JSON の形が違う → rejected（usecase が 1 回だけ作り直す）。ログに本文・材料・API キーを出さない。

export const LOSS_WRITER_MODEL = 'claude-sonnet-5-5'
export const LOSS_WRITER_MAX_TOKENS = 1500
export const LOSS_WRITER_TIMEOUT_MS = 30_000

/** Claude に返させる JSON の形 */
export const LOSS_STORY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    story: {
      type: 'object',
      properties: {
        ja: { type: 'string' },
        en: { type: 'string' },
        zh: { type: 'string' },
        ko: { type: 'string' },
      },
      required: ['ja', 'en', 'zh', 'ko'],
      additionalProperties: false,
    },
  },
  required: ['story'],
  additionalProperties: false,
}

const StoryResponse = z.strictObject({
  story: z.strictObject({ ja: z.string(), en: z.string(), zh: z.string(), ko: z.string() }),
})

export const LOSS_WRITER_SYSTEM_PROMPT = `あなたは北海道をレンタカーで旅するシミュレーションの書き手です。
旅の途中で鹿と衝突し、旅が終わった場面で表示する「失ったもの」の短い文を、日本語（ja）・英語（en）・繁体字中国語（zh）・韓国語（ko）の 4 言語で書きます。

守ること
- 出力は指定の JSON の形だけ。story に 4 言語の文を入れる。
- 4 言語とも必ず書く。空にしない。各言語はその言語だけで書く（訳し忘れの日本語を混ぜない）。
- 長さは、日本語・中国語は 120 字程度まで、英語は 50 語程度まで。
- 3 桁以上の数字を書かない（西暦の年、金額、距離、件数、道路の番号を含む）。
- 「%」「％」「件」「円」の文字を使わない（「条件」「円山」のような語も別の言い方にする）。
- 統計の数字（事故の件数・金額・割合）を書かない。
- 絵文字や顔文字を使わない。
- 材料にない施設名・店名・地名を作らない。材料の地名と楽しみの名前を使う。

${LOSS_WRITING}

${DEER_SAFETY_WRITING}`

/** Claude に渡す user メッセージ。材料はすべてマスターの名前と選択肢由来の値（UC-5a）。 */
export function renderLossRequest(request: LossWriterRequest): string {
  const lines = [
    '次の旅で、鹿と衝突して旅が終わりました。「失ったもの」の文を書いてください。',
    '<loss>',
    JSON.stringify(toPromptMaterial(request.brief)),
    '</loss>',
  ]
  if (request.previousProblems && request.previousProblems.length > 0) {
    lines.push(
      '前回の出力は次の理由で使えませんでした。直して書き直してください（理由のコード: 問題@場所）:',
      request.previousProblems.join(', '),
    )
  }
  return lines.join('\n')
}

function toPromptMaterial(brief: LossBrief): Record<string, unknown> {
  return {
    primaryLanguage: brief.lang,
    partySize: brief.partySize,
    totalDays: brief.totalDays,
    collisionDay: brief.collisionDay,
    lostDays: brief.lostDays,
    collisionLeg: brief.collisionLeg,
    achieved: brief.achieved,
    lost: brief.lost,
    lostStays: brief.lostStays,
    alertEnabled: brief.alertEnabled,
  }
}

type MessagesClient = Pick<Anthropic['messages'], 'create'>

export class ClaudeLossWriterGateway implements LossWriterGateway {
  constructor(
    private readonly messages: MessagesClient,
    private readonly log: EventLog,
    private readonly timeoutMs: number = LOSS_WRITER_TIMEOUT_MS,
  ) {}

  async write(request: LossWriterRequest): Promise<LossWriterOutcome> {
    const started = Date.now()
    let response: Anthropic.Message
    try {
      response = await this.messages.create(
        {
          model: LOSS_WRITER_MODEL,
          max_tokens: LOSS_WRITER_MAX_TOKENS,
          // 決まった形の短い文なので、拡張の思考はしない（思考は max_tokens を食う）
          thinking: { type: 'between_tools' },
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: LOSS_STORY_JSON_SCHEMA },
          },
          system: [
            { type: 'text', text: LOSS_WRITER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: renderLossRequest(request) }],
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
      this.log.warn('loss.writer.truncated', usage)
      return { kind: 'rejected', reason: 'truncated' }
    }
    if (response.stop_reason === 'refusal') {
      this.log.warn('loss.writer.refused', usage)
      return { kind: 'rejected', reason: 'refused' }
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const parsed = StoryResponse.safeParse(safeJson(text))
    if (!parsed.success) {
      this.log.warn('loss.writer.malformed', usage)
      return { kind: 'rejected', reason: 'malformed' }
    }
    this.log.info('loss.writer.done', usage)
    return { kind: 'draft', output: parsed.data }
  }

  private toWriterError(error: unknown, durationMs: number): LossWriterError {
    if (
      error instanceof Anthropic.APIUserAbortError ||
      error instanceof Anthropic.APIConnectionTimeoutError
    ) {
      this.log.warn('loss.writer.timeout', { durationMs })
      return new LossWriterError('timeout')
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      this.log.error('loss.writer.auth', { status: error.status, durationMs })
      return new LossWriterError('auth')
    }
    if (error instanceof Anthropic.APIError) {
      this.log.warn('loss.writer.upstream', { status: error.status ?? null, durationMs })
      return new LossWriterError('upstream')
    }
    this.log.warn('loss.writer.upstream', {
      errorName: error instanceof Error ? error.name : 'unknown',
      durationMs,
    })
    return new LossWriterError('upstream')
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
