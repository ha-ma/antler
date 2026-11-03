import { IdempotencyMismatchError, TripInProgressError } from '../errors/trip-errors.js'
import type { TripRequest } from '../models/trip-request.js'
import { IDEMPOTENCY_TTL_MS, PENDING_STALE_MS } from '../rules/trip-rules.js'

// 同じ冪等キーの 2 回目をどう扱うか（docs/specs/plan-trip/resilience.md「Concurrency / Idempotency」）。
// - 24 時間を過ぎたキー → 無視して作り直す
// - body のハッシュが違う → IdempotencyMismatchError（別の人の旅を返さない）
// - done → 保存済みの旅を返す
// - pending で 2 分以内 → TripInProgressError
// - pending で 2 分を過ぎた・failed → 作り直す

export type ExistingRequestDecision = { kind: 'replay'; tripId: string } | { kind: 'reclaim' }

export function decideOnExistingRequest(
  existing: TripRequest,
  bodyHash: string,
  nowMs: number,
): ExistingRequestDecision {
  if (nowMs - existing.createdAtMs >= IDEMPOTENCY_TTL_MS) return { kind: 'reclaim' }
  if (existing.bodyHash !== bodyHash) throw new IdempotencyMismatchError()
  if (existing.status === 'done' && existing.tripId !== null) {
    return { kind: 'replay', tripId: existing.tripId }
  }
  if (existing.status === 'pending' && nowMs - existing.updatedAtMs < PENDING_STALE_MS) {
    throw new TripInProgressError()
  }
  return { kind: 'reclaim' }
}
