import type { DriveRunInput } from '@antler/trip'
import type {
  RecordRepository,
  StoredRun,
} from '../../src/application/ports/repositories/record.repository.js'
import type { InMemoryTripRepository } from './trips.js'

// メモリの RecordRepository（InMemoryUnitOfWork 用）。削除は旅のリポジトリの旅と冪等キーの行も消す。

export class InMemoryRecordRepository implements RecordRepository {
  runs = new Map<string, (StoredRun & { tripId: string })[]>()

  constructor(private readonly trips: InMemoryTripRepository) {}

  private list(tripId: string) {
    return this.runs.get(tripId) ?? []
  }

  findRun(tripId: string, runId: string) {
    return Promise.resolve(this.list(tripId).find((r) => r.run.runId === runId) ?? null)
  }
  countRuns(tripId: string, day: number) {
    return Promise.resolve(this.list(tripId).filter((r) => r.run.day === day).length)
  }
  insertRun(tripId: string, run: DriveRunInput, nowMs: number) {
    const list = this.list(tripId)
    if (list.some((r) => r.run.runId === run.runId)) return Promise.resolve(null)
    const stored = { tripId, run, seq: list.length + 1, createdAtMs: nowMs }
    this.runs.set(tripId, [...list, stored])
    return Promise.resolve(stored)
  }
  listRuns(tripId: string) {
    return Promise.resolve({ runs: [...this.list(tripId)], invalid: 0 })
  }
  deleteTrip(tripId: string) {
    this.runs.delete(tripId)
    for (const [key, r] of this.trips.requests)
      if (r.tripId === tripId) this.trips.requests.delete(key)
    const existed = this.trips.trips.delete(tripId)
    return Promise.resolve(existed ? 1 : 0)
  }
}
