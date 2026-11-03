// 旅の作成のドメイン例外。HTTP の status と code は infrastructure/http/error-mapper.ts が決める。

export abstract class TripError extends Error {}

/** 入力の形・範囲が違う・知らない欄・マスターに無い楽しみ（R1・R2） */
export class TripInputError extends TripError {
  override name = 'TripInputError'
  constructor(readonly issues: readonly string[] = []) {
    super('入力が正しくありません')
  }
}

/** 同じ冪等キーの要求が処理中（R8） */
export class TripInProgressError extends TripError {
  override name = 'TripInProgressError'
  constructor() {
    super('同じ要求を処理しています')
  }
}

/** 同じ冪等キーで body が違う（threat.md AUTH-4） */
export class IdempotencyMismatchError extends TripError {
  override name = 'IdempotencyMismatchError'
  constructor() {
    super('同じキーで別の内容が送られました')
  }
}

/** 全体の 1 日の上限（R9） */
export class DailyLimitError extends TripError {
  override name = 'DailyLimitError'
  constructor() {
    super('本日の生成上限に達しました')
  }
}

export type TripWriterFailure =
  'timeout' | 'upstream' | 'auth' | 'invalid' | 'truncated' | 'refused' | 'malformed'

/** Claude の失敗・時間切れ・検証で外れた（R5）。代わりの文は作らない */
export class TripWriterError extends TripError {
  override name = 'TripWriterError'
  constructor(readonly reason: TripWriterFailure) {
    super('しおりを仕上げられませんでした')
  }
}

/** 旅の id が既存の旅と衝突した（repository が投げ、usecase が作り直す） */
export class TripIdCollisionError extends TripError {
  override name = 'TripIdCollisionError'
  constructor() {
    super('旅の id が衝突しました')
  }
}
