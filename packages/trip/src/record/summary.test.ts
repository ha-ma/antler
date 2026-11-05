import { describe, expect, it } from 'vitest'
import type { DriveEncounter, DriveRunInput } from './run'
import { CLOSE_CALL_M, summarizeRecord, TripRecordSchema, type RecordPlan } from './summary'

// docs/specs/record/functional.md UC-2（R3 集計）

const PLAN: RecordPlan = {
  days: [
    { day: 1, stops: ['washo-market'] },
    { day: 2, stops: ['red-crowned-crane', 'akan-onsen'] },
    { day: 3, stops: [] },
  ],
}

function enc(patch: Partial<DriveEncounter> = {}): DriveEncounter {
  return {
    pattern: 'roadside',
    at: '2027-02-15T16:31:00+09:00',
    alertToBrakeMs: 1000,
    closestM: 20,
    outcome: 'avoided',
    ...patch,
  }
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

describe('summarizeRecord', () => {
  it('UC-2a: run が無い → not-started、全日 not-driven、0 / N、平均 null、最後に走った日 1', () => {
    const record = summarizeRecord(PLAN, [])
    expect(record.status).toBe('not-started')
    expect(record.days.map((d) => d.result)).toEqual(['not-driven', 'not-driven', 'not-driven'])
    expect(record.totals).toMatchObject({
      pleasuresProtected: 0,
      pleasuresTotal: 3,
      zonePasses: 0,
      encounters: 0,
      avoided: 0,
      alertToBrakeAvgMs: null,
    })
    expect(record.lastDay).toBe(1)
    expect(record.furthestDay).toBe(0)
    expect(TripRecordSchema.safeParse(record).success).toBe(true)
  })

  it('UC-2b: 同じ日の run が 2 件（衝突 → 完走）→ 最新の completed。数は最新の run だけ', () => {
    const record = summarizeRecord(PLAN, [
      run({
        day: 2,
        outcome: 'collided',
        zonePasses: 1,
        encounters: [enc({ outcome: 'collided' })],
      }),
      run({ day: 2, outcome: 'completed', zonePasses: 3, encounters: [enc(), enc()] }),
    ])
    expect(record.days[1]?.result).toBe('completed')
    expect(record.totals.zonePasses).toBe(3)
    expect(record.totals.encounters).toBe(2)
    expect(record.totals.avoided).toBe(2)
    expect(record.totals.collided).toBe(0)
  })

  it('UC-2c: 全日 completed → completed。1 日でも collided か not-driven → partial', () => {
    const all = [1, 2, 3].map((day) => run({ day }))
    expect(summarizeRecord(PLAN, all).status).toBe('completed')
    expect(summarizeRecord(PLAN, all.slice(0, 2)).status).toBe('partial')
    expect(summarizeRecord(PLAN, [...all, run({ day: 3, outcome: 'collided' })]).status).toBe(
      'partial',
    )
  })

  it('UC-2d: 守れた楽しみは completed の日の stops、分母は全日の stops の数', () => {
    const record = summarizeRecord(PLAN, [
      run({ day: 1, outcome: 'collided' }),
      run({ day: 2, outcome: 'completed' }),
    ])
    expect(record.totals).toMatchObject({ pleasuresProtected: 2, pleasuresTotal: 3 })
    expect(record.pleasures).toEqual([
      { id: 'washo-market', day: 1, protected: false },
      { id: 'red-crowned-crane', day: 2, protected: true },
      { id: 'akan-onsen', day: 2, protected: true },
    ])
  })

  it('UC-2e: 平均は alertToBrakeMs がある遭遇だけ。ログは日 → 時刻（null は後ろ）、間一髪は 5 m 以下', () => {
    const record = summarizeRecord(PLAN, [
      run({
        day: 2,
        encounters: [
          enc({ at: null, alertToBrakeMs: null, closestM: 30 }),
          enc({ at: '2027-02-15T16:44:00+09:00', alertToBrakeMs: 1100, closestM: CLOSE_CALL_M }),
          enc({ at: '2027-02-15T16:31:00+09:00', alertToBrakeMs: 1900, closestM: 6 }),
        ],
      }),
      run({ day: 1, encounters: [enc({ at: '2027-02-14T17:00:00+09:00', alertToBrakeMs: 1200 })] }),
    ])
    expect(record.totals.alertToBrakeAvgMs).toBe(1400)
    expect(record.log.map((l) => [l.day, l.at])).toEqual([
      [1, '2027-02-14T17:00:00+09:00'],
      [2, '2027-02-15T16:31:00+09:00'],
      [2, '2027-02-15T16:44:00+09:00'],
      [2, null],
    ])
    expect(record.log.map((l) => l.closeCall)).toEqual([false, false, true, false])
  })

  it('UC-2e: 衝突は間一髪にしない', () => {
    const record = summarizeRecord(PLAN, [
      run({ day: 1, outcome: 'collided', encounters: [enc({ outcome: 'collided', closestM: 0 })] }),
    ])
    expect(record.log[0]).toMatchObject({ outcome: 'collided', closeCall: false })
  })

  it('UC-2f: 日ごとの alertEnabled と、最後に走った日は保存順で最後の run の日', () => {
    const record = summarizeRecord(PLAN, [
      run({ day: 2, alertEnabled: false }),
      run({ day: 1, alertEnabled: true }),
    ])
    expect(record.days.map((d) => d.alertEnabled)).toEqual([true, false, null])
    expect(record.days.map((d) => d.offResult)).toEqual([null, 'completed', null])
    expect(record.lastDay).toBe(1)
    expect(record.log.every((l) => typeof l.alertEnabled === 'boolean')).toBe(true)
  })

  it('UC-2g: ON で完走した日のあとに OFF で衝突 → completed のまま、offResult が collided', () => {
    const record = summarizeRecord(PLAN, [
      run({ day: 2, alertEnabled: true, outcome: 'completed', zonePasses: 2 }),
      run({ day: 2, alertEnabled: false, outcome: 'collided', zonePasses: 1 }),
    ])
    expect(record.days[1]).toEqual({
      day: 2,
      result: 'completed',
      alertEnabled: true,
      offResult: 'collided',
    })
    expect(record.totals.zonePasses).toBe(2)
  })

  it('UC-2g: OFF の run しか無い日は OFF の最新が結果', () => {
    const record = summarizeRecord(PLAN, [
      run({ day: 1, alertEnabled: false, outcome: 'collided' }),
      run({ day: 1, alertEnabled: false, outcome: 'completed' }),
    ])
    expect(record.days[0]).toEqual({
      day: 1,
      result: 'completed',
      alertEnabled: false,
      offResult: 'completed',
    })
  })

  it('UC-2h: furthestDay は走った日の最大。同じ楽しみが 2 日にあっても 1 つ', () => {
    const record = summarizeRecord(PLAN, [
      run({ day: 1 }),
      run({ day: 2 }),
      run({ day: 3, outcome: 'collided' }),
      run({ day: 1 }),
    ])
    expect(record.furthestDay).toBe(3)
    expect(record.lastDay).toBe(1)
    const dup = summarizeRecord(
      {
        days: [
          { day: 1, stops: ['a'] },
          { day: 2, stops: ['a', 'b'] },
        ],
      },
      [run({ day: 2 })],
    )
    expect(dup.pleasures).toEqual([
      { id: 'a', day: 1, protected: false },
      { id: 'b', day: 2, protected: true },
    ])
    expect(dup.totals).toMatchObject({ pleasuresProtected: 1, pleasuresTotal: 2 })
  })

  it('日数を超える run は数えない', () => {
    const record = summarizeRecord(PLAN, [run({ day: 9 })])
    expect(record.status).toBe('not-started')
    expect(record.lastDay).toBe(1)
  })
})
