import type { DriveRunInput } from '@antler/trip'

// 走行の記録（run）の保存と、旅の削除（docs/specs/record/functional.md R2・R10、resilience.md）。
// 実装は infrastructure/repositories/drizzle-record.repository.ts。トランザクションは UnitOfWork が持つ。

export type StoredRun = {
  run: DriveRunInput
  /** 旅の中の保存の順番（1 始まり） */
  seq: number
  createdAtMs: number
}

export interface RecordRepository {
  findRun(tripId: string, runId: string): Promise<StoredRun | null>
  /** その旅のその日の run の数 */
  countRuns(tripId: string, day: number): Promise<number>
  /** run を保存する（seq は今ある数 + 1）。同じ (tripId, runId) が既にあれば null（上書きしない） */
  insertRun(tripId: string, run: DriveRunInput, nowMs: number): Promise<StoredRun | null>
  /**
   * 旅の run を保存順に読む。保存した JSON が形に合わない行は runs に入れず、invalid に数える
   * （resilience.md FAIL-1: 壊れた行を飛ばして集計する）
   */
  listRuns(tripId: string): Promise<{ runs: StoredRun[]; invalid: number }>
  /** 旅・その旅の run・その旅を指す冪等キーの行を消す（R10）。消した旅の数（0 か 1）を返す */
  deleteTrip(tripId: string): Promise<number>
}
