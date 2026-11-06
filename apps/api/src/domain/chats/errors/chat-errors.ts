import { TripError, type TripWriterFailure } from '../../trips/errors/trip-errors.js'

// 車内の会話の束のドメイン例外（docs/specs/drive-audio-chat/functional.md「エラーパターン」）。
// 旅が無い・日が無い・所有者・1 日の上限・同時の枠は trips / stop-events の例外をそのまま使う。HTTP は error-mapper が決める。

/** 1 つの旅に保存できる会話の束の上限に達した（R15） */
export class ChatLimitError extends TripError {
  override name = 'ChatLimitError'
  constructor() {
    super('この旅の会話はこれ以上作れません')
  }
}

/** Claude の失敗・時間切れ・検証で外れた（R15・R17）。代わりの文は作らない（端末が見本の会話で走る） */
export class ChatWriterError extends TripError {
  override name = 'ChatWriterError'
  constructor(readonly reason: TripWriterFailure) {
    super('会話を用意できませんでした')
  }
}
