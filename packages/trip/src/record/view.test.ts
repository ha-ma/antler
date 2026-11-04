import { describe, expect, it } from 'vitest'
import type { DriveRunInput } from './run'
import { summarizeRecord } from './summary'
import type { RecordTrip } from './trip-view'
import { buildRecordView } from './view'

// docs/specs/record/functional.md UC-8b〜UC-8d（表示の形。sim・SSR・OG が同じものを描く）

const TRIP: RecordTrip = {
  id: 'K7m2abcd',
  lang: 'ja',
  title: '流氷とタンチョウ',
  depart: { at: '2027-02-14T10:00+09:00', place: 'CTS' },
  return: { at: '2027-02-18T17:00+09:00', place: 'CTS' },
  partySize: 4,
  days: [
    { day: 1, from: 'cts', to: 'kushiro', stops: ['washo-market'], stay: 'kushiro' },
    { day: 2, from: 'kushiro', to: 'akan', stops: ['red-crowned-crane'], stay: null },
  ],
}

function run(patch: Partial<DriveRunInput>): DriveRunInput {
  return {
    runId: '00000000-0000-4000-8000-000000000001',
    day: 1,
    alertEnabled: true,
    outcome: 'completed',
    zonePasses: 2,
    encounters: [],
    frames: null,
    ...patch,
  }
}

describe('buildRecordView', () => {
  it('UC-8b: 完走・途中・未走行の見出しと、平均が無ければ「—」', () => {
    const none = buildRecordView(TRIP, summarizeRecord(TRIP, []))
    expect(none.heading).toBe('まだ走っていません。')
    expect(none.stats.map((s) => s.value)).toEqual(['0 / 2', '0', '0 / 0', '—'])
    expect(none.eyebrow).toBe('TRIP RECORD ・ 2027.02.14 – 02.18')

    const partial = buildRecordView(TRIP, summarizeRecord(TRIP, [run({ day: 1 })]))
    expect(partial.heading).toBe('D1 まで走った。')

    const done = buildRecordView(
      TRIP,
      summarizeRecord(TRIP, [
        run({ day: 1 }),
        run({
          day: 2,
          encounters: [
            {
              pattern: 'roadside',
              at: '2027-02-15T16:31:00+09:00',
              alertToBrakeMs: 1200,
              closestM: 3,
              outcome: 'avoided',
            },
          ],
        }),
      ]),
    )
    expect(done.heading).toBe('守りきった。')
    expect(done.stats.find((s) => s.key === 'brake')).toMatchObject({ value: '1.2', unit: 's' })
    expect(done.summary).toContain('4人・2日間')
  })

  it('UC-8c: 守れたものは completed の日だけ。ログの間一髪・衝突・OFF の表記', () => {
    const view = buildRecordView(
      TRIP,
      summarizeRecord(TRIP, [
        run({ day: 1, outcome: 'collided', encounters: [] }),
        run({
          day: 2,
          alertEnabled: false,
          encounters: [
            {
              pattern: 'herd',
              at: null,
              alertToBrakeMs: null,
              closestM: 2.4,
              outcome: 'avoided',
            },
          ],
        }),
      ]),
    )
    expect(view.kept.map((k) => k.id)).toEqual(['red-crowned-crane'])
    expect(view.log[0]).toMatchObject({
      when: 'D2',
      what: '群れ ・ 最接近 2 m',
      brake: 'アラート OFF',
      tone: 'closeCall',
      outcomeLabel: '間一髪',
    })
    expect(view.logHeading).toBe('鹿ゾーンでの1回')
  })

  it('UC-8d: しおりの各日に結果と OFF の印、OFF の挑戦の結果', () => {
    const view = buildRecordView(
      TRIP,
      summarizeRecord(TRIP, [
        run({ day: 1 }),
        run({ day: 1, alertEnabled: false, outcome: 'collided' }),
      ]),
    )
    expect(view.shiori.rows[0]).toMatchObject({
      result: 'completed',
      resultLabel: '完走',
      alertOff: false,
      offChallenge: 'OFF 衝突',
    })
    expect(view.shiori.rows[1]).toMatchObject({ result: 'not-driven', offChallenge: null })
    expect(view.shiori.rows[0]?.title).toMatch(/^D1 .+ → .+/)
    expect(view.shiori.completed).toBe(false)
  })

  it('UC-8f: en の旅は en で書く', () => {
    const view = buildRecordView({ ...TRIP, lang: 'en' }, summarizeRecord(TRIP, []))
    expect(view.heading).toBe('Not driven yet.')
    expect(view.stats[0]?.label).toBe('Pleasures kept')
  })
})
