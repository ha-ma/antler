import type { TripEventRecord } from '../../../domain/stop-events/models/trip-event.js'

// イベントログの行（docs/specs/stop-events/functional.md R10、resilience.md）。実装は infrastructure/repositories/。
// （trip_id, run_id, seq）が主キー。record の feature は listByTrip で読む。

export interface TripEventRepository {
  /** その run の、指定した seq の既存の行 */
  findBySeqs(tripId: string, runId: string, seqs: readonly number[]): Promise<TripEventRecord[]>
  countByTrip(tripId: string): Promise<number>
  /** 1 つの文でまとめて入れる（主キーが重なる行は入れない） */
  insertMany(records: readonly TripEventRecord[]): Promise<void>
  /** 旅のイベントを、run の最初の受信順 → seq で返す（record が読む） */
  listByTrip(tripId: string): Promise<TripEventRecord[]>
}
