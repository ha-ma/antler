import { recordTripOf, summarizeRecord, type RecordTrip, type TripRecord } from '@antler/trip'
import { TripNotFoundError } from '../../../domain/trips/errors/trip-errors.js'
import { TRIP_ID_PATTERN } from '../../../domain/trips/rules/trip-rules.js'
import type { RecordRepository } from '../../ports/repositories/record.repository.js'
import type { TripRepository } from '../../ports/repositories/trip.repository.js'
import type { EventLog } from '../../ports/system/event-log.js'

// 旅の記録の読み出し（docs/specs/record/functional.md R3・R4。JSON・SSR・OG 画像が同じものを使う）。
// 認証なし（ID を知る人が読める。brief-map と同じ）。無い id と形の違う id は区別しない。
// 毎回 DB を読む（削除がすぐ効く）。保存した行（ownerTokenHash・runId）は返さない。
// 旅は画面に出す欄だけ（RecordTrip。予算・seed を出さない。R4）。

export type GetTripRecordDeps = {
  trips: Pick<TripRepository, 'findTrip'>
  records: Pick<RecordRepository, 'listRuns'>
  log: EventLog
}

/** 記録に見せる旅の欄と集計。`seq` は保存した最後の run の番号（OG 画像のメモリの鍵。応答には出さない） */
export type GetTripRecordOutput = {
  trip: RecordTrip
  record: TripRecord
  version: { runs: number; lastSeq: number }
}

export class GetTripRecordUseCase {
  constructor(private readonly deps: GetTripRecordDeps) {}

  async execute({ id }: { id: string }): Promise<GetTripRecordOutput> {
    if (!TRIP_ID_PATTERN.test(id)) throw new TripNotFoundError()
    const stored = await this.deps.trips.findTrip(id)
    if (!stored) throw new TripNotFoundError()
    const { runs, invalid } = await this.deps.records.listRuns(id)
    if (invalid > 0) this.deps.log.warn('record.run.invalid', { tripId: id, count: invalid })
    const record = summarizeRecord(
      stored.plan,
      runs.map((r) => r.run),
    )
    return {
      trip: recordTripOf(stored.plan),
      record,
      version: { runs: runs.length, lastSeq: runs.at(-1)?.seq ?? 0 },
    }
  }
}
