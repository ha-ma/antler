import { MAX_RUNS_PER_DAY, RecordTripSchema, TripRecordSchema } from '@antler/trip'
import {
  makeRun,
  openRecordHarness,
  type RecordHarness,
} from '../../../../tests/factories/record-harness.js'
import { KEY_A, KEY_B } from '../../../../tests/factories/trips.js'
import {
  NotOwnerError,
  OwnerTokenRequiredError,
  RunDayOutOfRangeError,
  RunLimitError,
} from '../../../domain/record/errors/record-errors.js'
import { TripNotFoundError } from '../../../domain/trips/errors/trip-errors.js'
import { DeleteTripUseCase } from './delete-trip.usecase.js'

// record の UseCase（実 SQLite）。docs/specs/record/functional.md UC-3・UC-4・UC-5、threat.md AUTH-*、resilience.md FAIL-*

let h: RecordHarness

beforeEach(async () => {
  h = await openRecordHarness()
})

afterEach(() => {
  h.close()
})

describe('SaveRunUseCase', () => {
  it('UC-3a: 正しいトークンで保存し、記録に出る', async () => {
    const { id, ownerToken } = await h.newTrip()
    const out = await h.saveRun.execute({ tripId: id, ownerToken, run: makeRun({ day: 2 }) })
    expect(out.replayed).toBe(false)
    expect(out.run).toMatchObject({ day: 2, alertEnabled: true, outcome: 'completed' })
    expect(out.run.createdAt).toMatch(/\+09:00$/)
    const { record } = await h.getRecord.execute({ id })
    expect(record.days[1]?.result).toBe('completed')
  })

  it('UC-3b / IDEM-1: 同じ runId を 2 回 → 2 回目は replayed、行は 1 つ、最初のまま', async () => {
    const { id, ownerToken } = await h.newTrip()
    const run = makeRun({ day: 1, outcome: 'completed' })
    await h.saveRun.execute({ tripId: id, ownerToken, run })
    const again = await h.saveRun.execute({
      tripId: id,
      ownerToken,
      run: { ...run, outcome: 'collided' },
    })
    expect(again.replayed).toBe(true)
    expect(again.run.outcome).toBe('completed')
    expect(await h.records.countRuns(id, 1)).toBe(1)
  })

  it('UC-3c: day が日数を超える → RunDayOutOfRangeError、保存しない', async () => {
    const { id, ownerToken, plan } = await h.newTrip()
    await expect(
      h.saveRun.execute({ tripId: id, ownerToken, run: makeRun({ day: plan.days.length + 1 }) }),
    ).rejects.toBeInstanceOf(RunDayOutOfRangeError)
    expect((await h.records.listRuns(id)).runs).toHaveLength(0)
  })

  it('UC-3d: その日に 20 件ある旅に 21 件目 → RunLimitError。別の日は残せる', async () => {
    const { id, ownerToken } = await h.newTrip()
    for (let i = 0; i < MAX_RUNS_PER_DAY; i += 1) {
      await h.saveRun.execute({ tripId: id, ownerToken, run: makeRun({ day: 1 }) })
    }
    await expect(
      h.saveRun.execute({ tripId: id, ownerToken, run: makeRun({ day: 1 }) }),
    ).rejects.toBeInstanceOf(RunLimitError)
    const other = await h.saveRun.execute({ tripId: id, ownerToken, run: makeRun({ day: 2 }) })
    expect(other.replayed).toBe(false)
  })

  it('AUTH-1: トークンなし・形の違うトークン → OwnerTokenRequiredError、保存しない', async () => {
    const { id } = await h.newTrip()
    for (const ownerToken of ['', 'abc', 'G'.repeat(64)]) {
      await expect(
        h.saveRun.execute({ tripId: id, ownerToken, run: makeRun() }),
      ).rejects.toBeInstanceOf(OwnerTokenRequiredError)
    }
    expect((await h.records.listRuns(id)).runs).toHaveLength(0)
  })

  it('AUTH-2: 別の旅のトークン → NotOwnerError、保存しない', async () => {
    const a = await h.newTrip(KEY_A)
    const b = await h.newTrip(KEY_B)
    await expect(
      h.saveRun.execute({ tripId: b.id, ownerToken: a.ownerToken, run: makeRun() }),
    ).rejects.toBeInstanceOf(NotOwnerError)
    expect((await h.records.listRuns(b.id)).runs).toHaveLength(0)
  })

  it('無い id・形の違う id → TripNotFoundError', async () => {
    const { ownerToken } = await h.newTrip()
    for (const tripId of ['Zz99Zz99', 'bad id']) {
      await expect(
        h.saveRun.execute({ tripId, ownerToken, run: makeRun() }),
      ).rejects.toBeInstanceOf(TripNotFoundError)
    }
  })
})

describe('GetTripRecordUseCase', () => {
  it('UC-4a: 見せる欄だけ（RecordTrip）と集計。ハッシュ・runId・予算・seed が無い', async () => {
    const { id, ownerToken } = await h.newTrip()
    const run = makeRun({ day: 1 })
    await h.saveRun.execute({ tripId: id, ownerToken, run })
    const out = await h.getRecord.execute({ id })
    expect(RecordTripSchema.safeParse(out.trip).success).toBe(true)
    expect(TripRecordSchema.safeParse(out.record).success).toBe(true)
    const json = JSON.stringify({ trip: out.trip, record: out.record })
    for (const secret of ['ownerTokenHash', run.runId, ownerToken, 'budgetPerPersonJPY', 'seed']) {
      expect(json).not.toContain(secret)
    }
    expect(out.version).toEqual({ runs: 1, lastSeq: 1 })
  })

  it('UC-4b: 無い id・形の違う id → TripNotFoundError', async () => {
    await expect(h.getRecord.execute({ id: 'Zz99Zz99' })).rejects.toBeInstanceOf(TripNotFoundError)
    await expect(h.getRecord.execute({ id: '../x' })).rejects.toBeInstanceOf(TripNotFoundError)
  })

  it('FAIL-1: 保存した run の 1 件が壊れている → 飛ばして集計し、warn', async () => {
    const { id, ownerToken } = await h.newTrip()
    await h.saveRun.execute({ tripId: id, ownerToken, run: makeRun({ day: 1 }) })
    await h.conn.client.execute({
      sql: "INSERT INTO trip_runs (trip_id, run_id, day, payload, created_at, seq) VALUES (?, 'broken', 2, '{\"day\":2}', 0, 2)",
      args: [id],
    })
    const { record } = await h.getRecord.execute({ id })
    expect(record.days.map((d) => d.result).slice(0, 2)).toEqual(['completed', 'not-driven'])
    expect(h.log.has('record.run.invalid')).toBe(true)
  })
})

describe('DeleteTripUseCase', () => {
  it('UC-5a: trip_id を持つすべての表でその旅の行が 0、ほかの旅は残る', async () => {
    const a = await h.newTrip(KEY_A)
    const b = await h.newTrip(KEY_B)
    for (const t of [a, b]) {
      await h.saveRun.execute({ tripId: t.id, ownerToken: t.ownerToken, run: makeRun() })
      // A-6 の喪失文（loss の trip_losses）も旅の行として持つ
      await h.conn.client.execute({
        sql: "INSERT INTO trip_losses (key_hash, trip_id, collision, story, created_at) VALUES (?, ?, '{}', '{}', 0)",
        args: [`loss-${t.id}`, t.id],
      })
      // stop-events の束とイベントの行（docs/specs/stop-events/functional.md R10。旅の削除で一緒に消す）
      await h.conn.client.execute({
        sql: "INSERT INTO stop_decks (trip_id, day, status, created_at, updated_at) VALUES (?, 1, 'failed', 0, 0)",
        args: [t.id],
      })
      await h.conn.client.execute({
        sql: "INSERT INTO trip_events (trip_id, run_id, seq, day, kind, at, alert_enabled, data, received_at) VALUES (?, 'r', 0, 1, 'collision', '2027-02-14T12:00+09:00', 1, '{}', 0)",
        args: [t.id],
      })
    }
    await h.deleteTrip.execute({ tripId: a.id, ownerToken: a.ownerToken })
    const rowsA = await h.rowsOfTrip(a.id)
    // 旅の id を持つ表が増えたら、ここと DrizzleRecordRepository.deleteTrip の両方を直す（足し忘れを止める）
    expect(Object.keys(rowsA).sort()).toEqual([
      'stop_decks',
      'trip_events',
      'trip_losses',
      'trip_requests',
      'trip_runs',
      'trips',
    ])
    expect(Object.values(rowsA).every((n) => n === 0)).toBe(true)
    const rowsB = await h.rowsOfTrip(b.id)
    expect(rowsB).toMatchObject({
      trips: 1,
      trip_runs: 1,
      trip_requests: 1,
      stop_decks: 1,
      trip_events: 1,
      trip_losses: 1,
    })
  })

  it('UC-5b: 削除のあと、同じ冪等キーで旅を作り直しても失敗しない（新しい旅）', async () => {
    const a = await h.newTrip(KEY_A)
    await h.deleteTrip.execute({ tripId: a.id, ownerToken: a.ownerToken })
    const again = await h.newTrip(KEY_A)
    expect(again.id).not.toBe(a.id)
    expect(again.ownerToken).toBe(a.ownerToken)
  })

  it('AUTH-3: トークンなし → OwnerTokenRequiredError、違うトークン → NotOwnerError、何も消えない', async () => {
    const a = await h.newTrip(KEY_A)
    await expect(h.deleteTrip.execute({ tripId: a.id, ownerToken: '' })).rejects.toBeInstanceOf(
      OwnerTokenRequiredError,
    )
    await expect(
      h.deleteTrip.execute({ tripId: a.id, ownerToken: 'ab'.repeat(32) }),
    ).rejects.toBeInstanceOf(NotOwnerError)
    expect((await h.rowsOfTrip(a.id))['trips']).toBe(1)
  })

  it('IDOR-1: 旅 A のトークンで旅 B → NotOwnerError、旅 B は残る', async () => {
    const a = await h.newTrip(KEY_A)
    const b = await h.newTrip(KEY_B)
    await expect(
      h.deleteTrip.execute({ tripId: b.id, ownerToken: a.ownerToken }),
    ).rejects.toBeInstanceOf(NotOwnerError)
    expect((await h.rowsOfTrip(b.id))['trips']).toBe(1)
  })

  it('AUTH-4 / CONC-1: 削除のあと、同じトークンで削除・保存 → TripNotFoundError、run は残らない', async () => {
    const a = await h.newTrip(KEY_A)
    await h.deleteTrip.execute({ tripId: a.id, ownerToken: a.ownerToken })
    await expect(
      h.deleteTrip.execute({ tripId: a.id, ownerToken: a.ownerToken }),
    ).rejects.toBeInstanceOf(TripNotFoundError)
    await expect(
      h.saveRun.execute({ tripId: a.id, ownerToken: a.ownerToken, run: makeRun() }),
    ).rejects.toBeInstanceOf(TripNotFoundError)
    expect((await h.rowsOfTrip(a.id))['trip_runs']).toBe(0)
  })

  it('FAIL-2: 削除の途中の失敗でトランザクションが戻る（旅も run も残る）', async () => {
    const a = await h.newTrip(KEY_A)
    await h.saveRun.execute({ tripId: a.id, ownerToken: a.ownerToken, run: makeRun() })
    const failing = new DeleteTripUseCase({
      uow: {
        transaction: (fn) =>
          h.uow.transaction((repos) =>
            fn({
              ...repos,
              records: Object.assign(Object.create(repos.records) as typeof repos.records, {
                deleteTrip: async (tripId: string) => {
                  await repos.records.deleteTrip(tripId)
                  throw new Error('disk I/O error')
                },
              }),
            }),
          ),
      },
      hasher: h.hasher,
      log: h.log,
    })
    await expect(failing.execute({ tripId: a.id, ownerToken: a.ownerToken })).rejects.toThrow(
      'disk I/O error',
    )
    expect(await h.rowsOfTrip(a.id)).toMatchObject({ trips: 1, trip_runs: 1, trip_requests: 1 })
  })
})
