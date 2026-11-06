import { describe, expect, it } from 'vitest'
import { DriveRunInputSchema, type DriveRunInput } from './run'
import { summarizeRecord, TripRecordSchema, type RecordPlan } from './summary'
import { buildRecordView } from './view'
import type { RecordTrip } from './trip-view'

// drive-crash-spot UC-4i（docs/specs/drive-crash-spot/functional.md R4）: run の spotting は省略でき、
// 記録の集計はその日の結果にした run の合計（欄の無い run が混ざれば出さない）。A-7 に 1 行。

const PLAN: RecordPlan = {
  days: [
    { day: 1, stops: [] },
    { day: 2, stops: [] },
  ],
}

let n = 0
function run(patch: Partial<DriveRunInput>): DriveRunInput {
  n += 1
  return {
    runId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    day: 1,
    alertEnabled: true,
    outcome: 'completed',
    zonePasses: 1,
    encounters: [],
    frames: null,
    ...patch,
  }
}

const TRIP: RecordTrip = {
  id: 'K7m2abcd',
  lang: 'ja',
  title: '道東の旅',
  partySize: 2,
  depart: { at: '2027-02-14T09:00:00+09:00', place: 'cts' },
  return: { at: '2027-02-16T18:00:00+09:00', place: 'cts' },
  days: [
    { day: 1, from: 'cts', to: 'kushiro', stops: [], stay: 'kushiro' },
    { day: 2, from: 'kushiro', to: 'akan', stops: [], stay: 'akan' },
  ],
}

describe('鹿の発見の記録（drive-crash-spot UC-4i）', () => {
  it('run の spotting は省略でき、あれば early ≤ found ≤ appeared の整数', () => {
    expect(DriveRunInputSchema.safeParse(run({})).success).toBe(true)
    const ok = run({ spotting: { appeared: 4, found: 3, early: 1 } })
    expect(DriveRunInputSchema.safeParse(ok).success).toBe(true)
    for (const spotting of [
      { appeared: 2, found: 3, early: 0 },
      { appeared: 3, found: 1, early: 2 },
      { appeared: -1, found: 0, early: 0 },
      { appeared: 1.5, found: 0, early: 0 },
    ])
      expect(DriveRunInputSchema.safeParse(run({ spotting })).success).toBe(false)
    // 知らない欄は 400（strict のまま）
    expect(
      DriveRunInputSchema.safeParse({
        ...ok,
        spotting: { appeared: 1, found: 1, early: 0, extra: 1 },
      }).success,
    ).toBe(false)
  })

  it('集計はその日の結果にした run の合計。欄の無い run が混ざれば出さない。A-7 に 1 行', () => {
    const both = summarizeRecord(PLAN, [
      run({ day: 1, spotting: { appeared: 5, found: 1, early: 0 } }),
      // 同じ日の後の run（その日の結果）が合計に入る
      run({ day: 1, spotting: { appeared: 4, found: 3, early: 2 } }),
      run({ day: 2, spotting: { appeared: 2, found: 1, early: 1 } }),
    ])
    expect(both.totals.spotting).toEqual({ appeared: 6, found: 4, early: 3 })
    expect(TripRecordSchema.safeParse(both).success).toBe(true)
    expect(buildRecordView(TRIP, both).spotting).toBe(
      '自分で見つけた鹿 4 / 6 頭（60 m より前で 3 頭）',
    )

    const mixed = summarizeRecord(PLAN, [
      run({ day: 1, spotting: { appeared: 4, found: 3, early: 2 } }),
      run({ day: 2 }),
    ])
    expect(mixed.totals.spotting).toBeUndefined()
    expect(buildRecordView(TRIP, mixed).spotting).toBeNull()

    // 足す前の応答（欄なし）も読める
    const { spotting: _drop, ...old } = both.totals
    expect(TripRecordSchema.safeParse({ ...both, totals: old }).success).toBe(true)

    const none = summarizeRecord(PLAN, [
      run({ day: 1, spotting: { appeared: 0, found: 0, early: 0 } }),
    ])
    expect(buildRecordView(TRIP, none).spotting).toBeNull()
  })
})
