import { TripInputError } from '../../domain/trips/errors/trip-errors.js'

// zValidator の失敗を例外にして error-mapper に渡す（応答の形 {error:{code,message}} を 1 か所にそろえる）。
// route で zValidator(target, schema, hook) の hook に渡す。

/** Idempotency-Key ヘッダが無い・UUID でない */
export class IdempotencyKeyRequiredError extends Error {
  override name = 'IdempotencyKeyRequiredError'
  constructor() {
    super('Idempotency-Key ヘッダに UUID を入れてください')
  }
}

type ValidationResult =
  | { success: true }
  | {
      success: false
      error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }
    }

/** body の検証に外れたら TripInputError（400 INVALID_INPUT） */
export function throwOnInvalidTripBody(result: ValidationResult): void {
  if (!result.success) {
    throw new TripInputError(
      result.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`),
    )
  }
}

/** Idempotency-Key の検証に外れたら IdempotencyKeyRequiredError（400 IDEMPOTENCY_KEY_REQUIRED） */
export function throwOnMissingIdempotencyKey(result: ValidationResult): void {
  if (!result.success) throw new IdempotencyKeyRequiredError()
}
