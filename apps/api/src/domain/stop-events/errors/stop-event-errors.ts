import { TripError, type TripWriterFailure } from '../../trips/errors/trip-errors.js'

// 出来事の束とイベントログのドメイン例外（docs/specs/stop-events/functional.md「エラーパターン」）。
// 旅が無い・日が無い・入力・処理中・1 日の上限・同時の枠は trips の例外をそのまま使う。HTTP は error-mapper が決める。

/** ownerToken が無い・違う（R9。どちらも同じ応答） */
export class OwnerRequiredError extends TripError {
  override name = 'OwnerRequiredError'
  constructor() {
    super('この旅を作った端末からだけ書き込めます')
  }
}

/** 同じ (runId, seq) で中身が違う（R10） */
export class EventConflictError extends TripError {
  override name = 'EventConflictError'
  constructor() {
    super('同じ番号で別の内容が送られました')
  }
}

/** 1 つの旅のイベントの上限（R10） */
export class EventLimitError extends TripError {
  override name = 'EventLimitError'
  constructor() {
    super('この旅の記録はこれ以上残せません')
  }
}

/** Claude の失敗・時間切れ・検証で外れた（R7）。代わりの文は作らない */
export class SceneWriterError extends TripError {
  override name = 'SceneWriterError'
  constructor(readonly reason: TripWriterFailure) {
    super('出来事の文を用意できませんでした')
  }
}
