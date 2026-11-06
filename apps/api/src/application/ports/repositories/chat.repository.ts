import type { StoredChat } from '../../../domain/chats/models/chat-deck.js'

// 会話の束の保存（docs/specs/drive-audio-chat/resilience.md「トランザクション境界」）。実装は infrastructure/repositories/。

export interface ChatRepository {
  findChat(keyHash: string): Promise<StoredChat | null>
  /** その旅に保存した会話の束の数（1 つの旅の上限に使う） */
  countChats(tripId: string): Promise<number>
  /** 保存する。同じ鍵の行が既にあれば false（主キーで片方だけが通る。CONC-41） */
  insertChat(chat: StoredChat): Promise<boolean>
}
