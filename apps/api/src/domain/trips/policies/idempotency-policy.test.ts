import { IdempotencyMismatchError, TripInProgressError } from '../errors/trip-errors.js'
import type { TripRequest } from '../models/trip-request.js'
import { IDEMPOTENCY_TTL_MS, PENDING_STALE_MS } from '../rules/trip-rules.js'
import { decideOnExistingRequest } from './idempotency-policy.js'

const T0 = 1_800_000_000_000

function request(overrides: Partial<TripRequest> = {}): TripRequest {
  return {
    keyHash: 'k',
    bodyHash: 'body',
    status: 'pending',
    tripId: null,
    createdAtMs: T0,
    updatedAtMs: T0,
    ...overrides,
  }
}

describe('decideOnExistingRequest（R8）', () => {
  it('IDEM-1: done → 保存済みの旅を返す', () => {
    expect(
      decideOnExistingRequest(request({ status: 'done', tripId: 'Ab3dEf7h' }), 'body', T0 + 1000),
    ).toEqual({ kind: 'replay', tripId: 'Ab3dEf7h' })
  })

  it('AUTH-4: body が違う → IdempotencyMismatchError（状態に依らない）', () => {
    for (const status of ['pending', 'done', 'failed'] as const) {
      expect(() =>
        decideOnExistingRequest(request({ status, tripId: 'x' }), 'other', T0 + 1000),
      ).toThrow(IdempotencyMismatchError)
    }
  })

  it('CONC-1: pending で 2 分以内 → TripInProgressError', () => {
    expect(() => decideOnExistingRequest(request(), 'body', T0 + PENDING_STALE_MS - 1)).toThrow(
      TripInProgressError,
    )
  })

  it('IDEM-3: pending が 2 分を過ぎた → 作り直す', () => {
    expect(decideOnExistingRequest(request(), 'body', T0 + PENDING_STALE_MS)).toEqual({
      kind: 'reclaim',
    })
  })

  it('IDEM-2: failed → 作り直す', () => {
    expect(decideOnExistingRequest(request({ status: 'failed' }), 'body', T0 + 1)).toEqual({
      kind: 'reclaim',
    })
  })

  it('24 時間を過ぎたキーは無視して作り直す（body が違っても）', () => {
    expect(
      decideOnExistingRequest(
        request({ status: 'done', tripId: 'x' }),
        'other',
        T0 + IDEMPOTENCY_TTL_MS,
      ),
    ).toEqual({ kind: 'reclaim' })
  })
})
