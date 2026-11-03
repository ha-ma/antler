import type { TripDetails, TripPlan } from '@antler/schema'
import type { TripRequest, TripRequestStatus } from '../../../domain/trips/models/trip-request.js'

// 旅と冪等キーの行の保存（docs/specs/plan-trip/resilience.md）。実装は infrastructure/repositories/。

export type StoredTrip = {
  plan: TripPlan
  details: TripDetails
  ownerTokenHash: string
  createdAtMs: number
}

export interface TripRepository {
  /** pending の行を作る。同じキーの行が既にあれば false（主キーで片方だけが通る） */
  insertPendingRequest(row: { keyHash: string; bodyHash: string; nowMs: number }): Promise<boolean>
  findRequest(keyHash: string): Promise<TripRequest | null>
  /**
   * 失敗・古い pending・期限切れの行を pending に戻して自分のものにする。
   * 読んだときの status と updatedAtMs のままであれば true（同時の作り直しは片方だけが通る）
   */
  reclaimRequest(
    keyHash: string,
    expected: { status: TripRequestStatus; updatedAtMs: number },
    next: { bodyHash: string; nowMs: number },
  ): Promise<boolean>
  markRequestFailed(keyHash: string, nowMs: number): Promise<void>
  markRequestDone(keyHash: string, tripId: string, nowMs: number): Promise<void>
  /** 旅を保存する。id が既存の旅と衝突したら TripIdCollisionError */
  insertTrip(trip: StoredTrip): Promise<void>
  findTrip(id: string): Promise<StoredTrip | null>
  /** sinceMs 以降に作られた旅の件数（1 日の上限に使う） */
  countTripsCreatedSince(sinceMs: number): Promise<number>
}
