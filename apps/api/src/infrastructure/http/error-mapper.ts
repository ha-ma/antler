import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  CaptureConflictError,
  CaptureInputError,
  ConsentRequiredError,
  InvalidImageError,
  StoreFullError,
} from '../../domain/captures/errors/capture-errors.js'
import {
  DailyLimitError,
  IdempotencyMismatchError,
  ItineraryChangedError,
  TripDayNotFoundError,
  TripInProgressError,
  TripNotFoundError,
  TripInputError,
  TripWriterBusyError,
  TripWriterError,
} from '../../domain/trips/errors/trip-errors.js'
import { LossLimitError, LossWriterError } from '../../domain/losses/errors/loss-errors.js'
import { IdempotencyKeyRequiredError } from './validation.js'

// 例外 → HTTP 応答。HTTP の status と code を知るのはここだけ（Hono stack の規約）。
// ドメイン例外を足したら、ここに code と status の対応を足す（docs/specs/plan-trip/functional.md「エラーパターン」）。

export type HttpError = { status: ContentfulStatusCode; code: string; message: string }

export function toHttpError(error: unknown): HttpError {
  if (error instanceof TripInputError) {
    return { status: 400, code: 'INVALID_INPUT', message: error.message }
  }
  if (error instanceof TripNotFoundError) {
    return { status: 404, code: 'TRIP_NOT_FOUND', message: error.message }
  }
  if (error instanceof TripDayNotFoundError) {
    return { status: 404, code: 'DAY_NOT_FOUND', message: error.message }
  }
  if (error instanceof ItineraryChangedError) {
    return { status: 409, code: 'ITINERARY_CHANGED', message: error.message }
  }
  if (error instanceof IdempotencyKeyRequiredError) {
    return { status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED', message: error.message }
  }
  if (error instanceof TripInProgressError) {
    return { status: 409, code: 'IN_PROGRESS', message: error.message }
  }
  if (error instanceof IdempotencyMismatchError) {
    return { status: 409, code: 'IDEMPOTENCY_MISMATCH', message: error.message }
  }
  if (error instanceof DailyLimitError) {
    return { status: 429, code: 'DAILY_LIMIT', message: error.message }
  }
  if (error instanceof TripWriterBusyError) {
    return { status: 503, code: 'WRITER_BUSY', message: error.message }
  }
  if (error instanceof TripWriterError) {
    return { status: 502, code: 'WRITER_FAILED', message: error.message }
  }
  // loss（docs/specs/loss/functional.md「エラーパターン」）
  if (error instanceof LossLimitError) {
    return { status: 429, code: 'LOSS_LIMIT', message: error.message }
  }
  if (error instanceof LossWriterError) {
    return { status: 502, code: 'WRITER_FAILED', message: error.message }
  }
  // POST /api/captures（docs/specs/edge-capture/functional.md「エラーパターン」）
  if (error instanceof CaptureInputError) {
    // 欄名と規則だけを返す（送られた値は入れない）。長くなりすぎないよう切る
    const detail = error.issues.join('; ').slice(0, 300)
    return {
      status: 400,
      code: 'INVALID_INPUT',
      message: detail === '' ? error.message : `${error.message}: ${detail}`,
    }
  }
  if (error instanceof ConsentRequiredError) {
    return { status: 422, code: 'CONSENT_REQUIRED', message: error.message }
  }
  if (error instanceof InvalidImageError) {
    return { status: 400, code: 'INVALID_IMAGE', message: error.message }
  }
  if (error instanceof CaptureConflictError) {
    return { status: 409, code: 'CAPTURE_CONFLICT', message: error.message }
  }
  if (error instanceof StoreFullError) {
    return { status: 503, code: 'STORE_FULL', message: error.message }
  }
  if (error instanceof HTTPException) {
    // 読めない JSON（zValidator が 400 の HTTPException を投げる）は入力エラーとして返す
    if (error.status === 400) return { status: 400, code: 'INVALID_INPUT', message: error.message }
    return { status: error.status, code: 'HTTP_ERROR', message: error.message }
  }
  // 想定外の例外。利用者には中身（スタックトレース・内部メッセージ）を見せない
  return { status: 500, code: 'INTERNAL_ERROR', message: '内部エラーが発生しました' }
}
