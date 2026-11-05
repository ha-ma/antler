import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type {
  SceneWriterGateway,
  SceneWriterOutcome,
  SceneWriterRequest,
} from '../../application/ports/gateways/scene-writer.gateway.js'
import type { EventLog } from '../../application/ports/system/event-log.js'
import { SceneWriterError } from '../../domain/stop-events/errors/stop-event-errors.js'
import type { StopWritingBrief } from '../../domain/stop-events/models/stop-writing.js'
import { DEER_SAFETY_WRITING } from './prompts/deer-safety-writing.js'
import { HOKKAIDO_TRAVEL_KNOWLEDGE } from './prompts/hokkaido-travel-knowledge.js'

// Claude（Messages API）に、その日の停車の出来事の文を 4 言語で書かせる（docs/specs/stop-events/functional.md R7）。
// plan-trip の ClaudeTripWriterGateway と同じ作り（決まった形の JSON・上限で切れた / 断られた / 形が違う → rejected・
// 時間切れ / 認証 / 上流 → SceneWriterError・SDK の再試行 1 回・本文をログに出さない）。
// - モデル claude-sonnet-5-5、出力の上限 8,000 トークン、時間切れ 45 秒（1 日 6 場面 × 4 言語の量）

export const SCENE_WRITER_MODEL = 'claude-sonnet-5-5'
export const SCENE_WRITER_MAX_TOKENS = 8000
export const SCENE_WRITER_TIMEOUT_MS = 45_000

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
export const STOP_WRITING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          headline: localizedJsonSchema,
          body: localizedJsonSchema,
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: localizedJsonSchema,
                note: localizedJsonSchema,
              },
              required: ['id', 'label', 'note'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'headline', 'body', 'choices'],
        additionalProperties: false,
      },
    },
  },
  required: ['scenes'],
  additionalProperties: false,
}

const Localized = z.strictObject({ ja: z.string(), en: z.string(), zh: z.string(), ko: z.string() })
const WritingResponse = z.strictObject({
  scenes: z.array(
    z.strictObject({
      id: z.string(),
      headline: Localized,
      body: Localized,
      choices: z.array(z.strictObject({ id: z.string(), label: Localized, note: Localized })),
    }),
  ),
})

export const SCENE_WRITER_SYSTEM_PROMPT = `あなたは北海道をレンタカーで旅する人のための 3D ドライブ体験で、停車したときの「出来事」の文を書く書き手です。
渡される材料（JSON）の各場面について、見出し（headline）と短文（body）、各選択肢の言い回し（label）と結果の一言（note）を、
日本語（ja）・英語（en）・繁体字中国語（zh）・韓国語（ko）の 4 言語で書きます。

場面の種類
- pleasure: しおりの楽しみの地点に着いた。楽しみの名前を使い、その場の情景と同乗者の様子を書く。
- fuel: 燃料が気になってきた。traffic: 渋滞に出会った。weather: 天候が変わった。request: 同乗者が寄り道を頼んだ。

選択肢の種類（id と同じ。言い回しはこの意味から外れない）
- leave: 予定どおりいま出発する。linger: もう少しいる（delayMin 分）。stay: 予定を変えてここに泊まる。
- refuel: 給油する。skip: 寄らずに進む。wait: 渋滞を待つ。bypass: 迂回する。turn-back: 引き返して泊まる。
- slow: ゆっくり進む。wait-out: 道の駅で天候の回復を待つ。accept: 寄り道する。decline: 断って進む。
- zoneLight は、その選択のあとで鹿ゾーンを通るときの明るさ（day 昼・dusk 薄暮・dawn 薄明・night 夜。null は通らない）。
  薄暮・夜は鹿との衝突が多い時間帯。note ではそれを責めずに、落ち着いた言い方で触れてよい。
- lostPleasures は、泊まる選択で失う楽しみ。note で「何を失うか」を短く書く。

守ること
- 出力は指定の JSON の形だけ。scenes は材料と同じ数・同じ順・同じ id。choices も各場面の材料と同じ数・同じ順・同じ id。
- 4 言語とも必ず書く。空にしない。各言語はその言語だけで書く。
- headline は 1 行（日本語・中国語は 30 字程度、英語は 10 語程度まで）。body は 1〜2 文（日本語・中国語は 80 字程度まで）。
  label は行動を短く（日本語・中国語は 20 字程度まで）。note は結果の一言（日本語・中国語は 30 字程度まで）。
- 時刻を書かない（「16:20」「16時」「4時半」の形を使わない）。時刻と到着予定は画面が別に出す。「1時間」「少し」のような長さは書いてよい。
- 3 桁以上の数字を書かない。金額・料金・距離の km・件数・割合を書かない。「%」「％」「件」「円」「¥」「$」の文字を使わない。
- 統計の数字（事故の件数・金額・割合）を書かない。
- 絵文字や顔文字を使わない。
- 材料にない施設名・店名・料金・営業時間を作らない。材料の地名と楽しみの名前を使う。

${HOKKAIDO_TRAVEL_KNOWLEDGE}

${DEER_SAFETY_WRITING}`

/** Claude に渡す user メッセージ。材料はすべて選択肢由来の値（UC-2d） */
export function renderStopWritingRequest(request: SceneWriterRequest): string {
  const lines = [
    'その日の停車の出来事の文を書いてください。',
    '<day>',
    JSON.stringify(toPromptMaterial(request.brief)),
    '</day>',
  ]
  if (request.previousProblems && request.previousProblems.length > 0) {
    lines.push(
      '前回の出力は次の理由で使えませんでした。直して書き直してください（理由のコード: 問題@場所）:',
      request.previousProblems.join(', '),
    )
  }
  return lines.join('\n')
}

function toPromptMaterial(brief: StopWritingBrief): Record<string, unknown> {
  return {
    primaryLanguage: brief.lang,
    area: brief.area === 'doto' ? 'Eastern Hokkaido (Doto)' : 'Central Hokkaido (Doo)',
    month: brief.month,
    party: brief.party,
    conditions: brief.conditions,
    from: brief.from,
    to: brief.to,
    scenes: brief.scenes,
  }
}

type MessagesClient = Pick<Anthropic['messages'], 'create'>

export class ClaudeSceneWriterGateway implements SceneWriterGateway {
  constructor(
    private readonly messages: MessagesClient,
    private readonly log: EventLog,
    private readonly timeoutMs: number = SCENE_WRITER_TIMEOUT_MS,
  ) {}

  async write(request: SceneWriterRequest): Promise<SceneWriterOutcome> {
    const started = Date.now()
    let response: Anthropic.Message
    try {
      response = await this.messages.create(
        {
          model: SCENE_WRITER_MODEL,
          max_tokens: SCENE_WRITER_MAX_TOKENS,
          // 決まった形の短い文なので、拡張の思考はしない（思考は max_tokens を食う）
          thinking: { type: 'between_tools' },
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: STOP_WRITING_JSON_SCHEMA },
          },
          system: [
            {
              type: 'text',
              text: SCENE_WRITER_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: renderStopWritingRequest(request) }],
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
      this.log.warn('stop_deck.writer.truncated', usage)
      return { kind: 'rejected', reason: 'truncated' }
    }
    if (response.stop_reason === 'refusal') {
      this.log.warn('stop_deck.writer.refused', usage)
      return { kind: 'rejected', reason: 'refused' }
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const parsed = WritingResponse.safeParse(safeJson(text))
    if (!parsed.success) {
      this.log.warn('stop_deck.writer.malformed', usage)
      return { kind: 'rejected', reason: 'malformed' }
    }
    this.log.info('stop_deck.writer.done', usage)
    return { kind: 'draft', writing: parsed.data }
  }

  private toWriterError(error: unknown, durationMs: number): SceneWriterError {
    if (
      error instanceof Anthropic.APIUserAbortError ||
      error instanceof Anthropic.APIConnectionTimeoutError
    ) {
      this.log.warn('stop_deck.writer.timeout', { durationMs })
      return new SceneWriterError('timeout')
    }
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      this.log.error('stop_deck.writer.auth', { status: error.status, durationMs })
      return new SceneWriterError('auth')
    }
    if (error instanceof Anthropic.APIError) {
      this.log.warn('stop_deck.writer.upstream', { status: error.status ?? null, durationMs })
      return new SceneWriterError('upstream')
    }
    this.log.warn('stop_deck.writer.upstream', {
      errorName: error instanceof Error ? error.name : 'unknown',
      durationMs,
    })
    return new SceneWriterError('upstream')
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
