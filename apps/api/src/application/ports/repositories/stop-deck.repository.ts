import type { StopDeck } from '../../../domain/stop-events/models/stop-deck.js'
import type { StopWriting } from '../../../domain/stop-events/models/stop-writing.js'

// 出来事の束の行（docs/specs/stop-events/resilience.md「Concurrency / Idempotency」）。実装は infrastructure/repositories/。
// （trip_id, day）が自然なキー。pending → done / failed。

export type StopDeckStatus = 'pending' | 'done' | 'failed'

export type StopDeckRow = {
  tripId: string
  day: number
  status: StopDeckStatus
  deck: StopDeck | null
  writing: StopWriting | null
  updatedAtMs: number
}

export interface StopDeckRepository {
  /** pending の行を作る。同じ旅・同じ日の行が既にあれば false */
  insertPending(row: { tripId: string; day: number; nowMs: number }): Promise<boolean>
  find(tripId: string, day: number): Promise<StopDeckRow | null>
  /** 読んだときの status と updatedAtMs のままなら pending に戻して true（同時の作り直しは片方だけ） */
  reclaim(
    tripId: string,
    day: number,
    expected: { status: StopDeckStatus; updatedAtMs: number },
    nowMs: number,
  ): Promise<boolean>
  /**
   * 自分が立てた pending（claimedAtMs に作った・取り直した行）のままなら done にして true。
   * 作り直しに取られていたら書かずに false（CONC-33）
   */
  markDone(row: {
    tripId: string
    day: number
    deck: StopDeck
    writing: StopWriting
    claimedAtMs: number
    nowMs: number
  }): Promise<boolean>
  /** 自分が立てた pending のままなら failed にする */
  markFailed(tripId: string, day: number, claimedAtMs: number, nowMs: number): Promise<void>
}
