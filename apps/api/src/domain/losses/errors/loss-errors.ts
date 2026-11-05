import { TripError, type TripWriterFailure } from '../../trips/errors/trip-errors.js'

// 喪失（A-6）のドメイン例外。HTTP の status と code は infrastructure/http/error-mapper.ts が決める。
// 入力の誤り・旅が無い・上限・混雑は plan-trip / brief-map の例外をそのまま使う（同じ code を返す）。

/** 1 つの旅に保存できる喪失文の上限に達した（R6） */
export class LossLimitError extends TripError {
  override name = 'LossLimitError'
  constructor() {
    super('この旅の上限に達しました')
  }
}

/** Claude の失敗・時間切れ・検証で外れた（docs/specs/loss/functional.md R5）。代わりの文は作らない */
export class LossWriterError extends TripError {
  override name = 'LossWriterError'
  constructor(readonly reason: TripWriterFailure) {
    super('失ったものの文を用意できませんでした')
  }
}
