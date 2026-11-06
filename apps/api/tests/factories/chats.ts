// drive-audio-chat のテスト用のフェイクとビルダー（docs/specs/drive-audio-chat/functional.md の Test List）。
// 本番の DI では使わない。DB はメモリの SQLite に本物の repository を載せる（stop-events の openTestDb に足す）。

import type {
  ChatWriterGateway,
  ChatWriterOutcome,
  ChatWriterRequest,
} from '../../src/application/ports/gateways/chat-writer.gateway.js'
import type { ChatWriting, ChatWritingBrief } from '../../src/domain/chats/models/chat-deck.js'
import { DrizzleChatRepository } from '../../src/infrastructure/repositories/drizzle-chat.repository.js'
import { openTestDb, type TestDb } from './stop-events.js'

export type ChatTestDb = TestDb & { chats: DrizzleChatRepository }

/** メモリの SQLite に表を作り、ペルソナの旅（所有者のトークンは OWNER_TOKEN）を保存する */
export async function openChatTestDb(): Promise<ChatTestDb> {
  const db = await openTestDb()
  return { ...db, chats: new DrizzleChatRepository(db.connection.db) }
}

/** 検証を通る一言（材料の行の id・数・順のまま） */
export function validChatWriting(brief: Pick<ChatWritingBrief, 'lines'>): ChatWriting {
  return {
    lines: brief.lines.map((line) => ({
      id: line.id,
      text: {
        ja: '雪の道もいい景色だね',
        en: 'The snowy road looks lovely',
        zh: '雪中的路景色真美',
        ko: '눈 덮인 길이 참 예쁘다',
      },
    })),
  }
}

type Step =
  | 'valid'
  | ChatWriterOutcome
  | Error
  | ((request: ChatWriterRequest) => ChatWriterOutcome | Promise<ChatWriterOutcome>)

/** 決めた順に応える Claude のフェイク。手順が尽きたら valid を返す。gate を渡すと、それが解けるまで応えない */
export class ScriptedChatWriter implements ChatWriterGateway {
  readonly calls: ChatWriterRequest[] = []
  constructor(
    private readonly steps: Step[] = [],
    private readonly gate: Promise<void> = Promise.resolve(),
  ) {}

  async write(request: ChatWriterRequest): Promise<ChatWriterOutcome> {
    this.calls.push(request)
    const step = this.steps.shift() ?? 'valid'
    await this.gate
    if (step instanceof Error) throw step
    if (step === 'valid') return { kind: 'draft', writing: validChatWriting(request.brief) }
    if (typeof step === 'function') return step(request)
    return step
  }
}
