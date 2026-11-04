import type { CaptureImageRejection } from '../models/capture-image.js'

// Capture の受け口のドメイン例外。HTTP の status と code は infrastructure/http/error-mapper.ts が決める。

export abstract class CaptureError extends Error {}

/** capture・image が無い、JSON が読めない、スキーマ違反、知らない欄（A2 の 2〜4・A9） */
export class CaptureInputError extends CaptureError {
  override name = 'CaptureInputError'
  constructor(readonly issues: readonly string[] = []) {
    super('入力が正しくありません')
  }
}

/** consent が true でない（A2 の 5。何も保存しない） */
export class ConsentRequiredError extends CaptureError {
  override name = 'ConsentRequiredError'
  constructor() {
    super('提供の同意がないものは受け取れません')
  }
}

/** 画像が JPEG/PNG でない、寸法が違う、メタデータがある、壊れている（A3） */
export class InvalidImageError extends CaptureError {
  override name = 'InvalidImageError'
  constructor(readonly reason: CaptureImageRejection) {
    super('画像を受け取れません')
  }
}

/** 同じ id で中身が違う（A4。既存は上書きしない） */
export class CaptureConflictError extends CaptureError {
  override name = 'CaptureConflictError'
  constructor() {
    super('同じ id で別の内容が送られました')
  }
}

/** 保存件数または画像の合計が上限（A5） */
export class StoreFullError extends CaptureError {
  override name = 'StoreFullError'
  constructor() {
    super('いまは受け取れません')
  }
}
