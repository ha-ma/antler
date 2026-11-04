import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
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
import {
  NotOwnerError,
  OwnerTokenRequiredError,
  RunDayOutOfRangeError,
  RunLimitError,
} from '../../domain/record/errors/record-errors.js'
import { IdempotencyKeyRequiredError } from './validation.js'
import { OgImageBusyError } from './views/og-image-renderer.js'

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
  // 旅の記録（docs/specs/record/functional.md「エラーパターン」）
  if (error instanceof OwnerTokenRequiredError) {
    return { status: 401, code: 'OWNER_TOKEN_REQUIRED', message: error.message }
  }
  if (error instanceof NotOwnerError) {
    return { status: 403, code: 'NOT_OWNER', message: error.message }
  }
  if (error instanceof RunDayOutOfRangeError) {
    return { status: 400, code: 'INVALID_INPUT', message: error.message }
  }
  if (error instanceof RunLimitError) {
    return { status: 409, code: 'RUN_LIMIT', message: error.message }
  }
  if (error instanceof OgImageBusyError) {
    return { status: 503, code: 'OG_BUSY', message: error.message }
  }
  if (error instanceof HTTPException) {
    // 読めない JSON（zValidator が 400 の HTTPException を投げる）は入力エラーとして返す
    if (error.status === 400) return { status: 400, code: 'INVALID_INPUT', message: error.message }
    return { status: error.status, code: 'HTTP_ERROR', message: error.message }
  }
  // 想定外の例外。利用者には中身（スタックトレース・内部メッセージ）を見せない
  return { status: 500, code: 'INTERNAL_ERROR', message: '内部エラーが発生しました' }
}
