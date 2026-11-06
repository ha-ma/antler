import type { ChatWriting, ChatWritingBrief } from '../../../domain/chats/models/chat-deck.js'

// Claude に車内の会話の一言（4 言語）を書かせる外部 transport（docs/specs/drive-audio-chat/functional.md R16・R17）。
// 通信の失敗・時間切れ・認証の失敗は ChatWriterError を投げる（作り直さない）。
// 応答はあったが使えない（上限で切れた・断られた・JSON の形が違う）は rejected で返す（usecase が 1 回だけ作り直す）。

export type ChatWriterOutcome =
  | { kind: 'draft'; writing: ChatWriting }
  | { kind: 'rejected'; reason: 'truncated' | 'refused' | 'malformed' }

export type ChatWriterRequest = {
  brief: ChatWritingBrief
  /** 前の回が検証で外れた理由のコード（作り直しのときだけ）。本文は渡さない */
  previousProblems?: readonly string[]
}

export interface ChatWriterGateway {
  write(request: ChatWriterRequest): Promise<ChatWriterOutcome>
}
