import { personaRecord, run } from '../test-fixtures'
import { arrivalOf, celebrationOf, RECORD_AFTER_COLLISION } from './celebration'

// 祝いを出すかの判定（docs/specs/result-screens/functional.md R4、UC-3・UC-4・S-1）

describe('celebrationOf', () => {
  it('CLEAR-1 最後の run の日が完走で、合図なし → その日', () => {
    const { record } = personaRecord([run({ day: 1 }), run({ day: 2 })])
    expect(celebrationOf(record, null)).toEqual({ day: 2 })
  })

  it('CLEAR-1 OFF の完走も「クリア」', () => {
    const { record } = personaRecord([run({ day: 1, alertEnabled: false })])
    expect(celebrationOf(record, null)).toEqual({ day: 1 })
  })

  it('CLEAR-2 合図「衝突のあと」→ null（最後の日が完走のままでも）', () => {
    // ON で完走した日に OFF で挑戦して衝突した。その日の結果は ON の完走のまま（record R3）
    const { record } = personaRecord([
      run({ day: 2 }),
      run({ day: 2, alertEnabled: false, outcome: 'collided' }),
    ])
    expect(record.days.find((d) => d.day === 2)?.result).toBe('completed')
    expect(celebrationOf(record, arrivalOf(RECORD_AFTER_COLLISION))).toBeNull()
  })

  it('CLEAR-3 最後の run の日が衝突 → null', () => {
    const { record } = personaRecord([run({ day: 1 }), run({ day: 2, outcome: 'collided' })])
    expect(celebrationOf(record, null)).toBeNull()
  })

  it('CLEAR-3 記録が無い（not-started）→ null', () => {
    const { record } = personaRecord([])
    expect(record.status).toBe('not-started')
    expect(celebrationOf(record, null)).toBeNull()
  })

  it('CLEAR-3 最後の日が走っていない（形の上で起きうる）→ null', () => {
    const { record } = personaRecord([run({ day: 1 })])
    expect(celebrationOf({ ...record, lastDay: 3 }, null)).toBeNull()
  })
})

describe('arrivalOf（location state の読み取り）', () => {
  it('合図だけを「衝突のあと」と読む。それ以外の形は null', () => {
    expect(arrivalOf(RECORD_AFTER_COLLISION)).toBe('after-collision')
    expect(arrivalOf({ arrival: 'after-collision' })).toBe('after-collision')
    expect(arrivalOf(null)).toBeNull()
    expect(arrivalOf(undefined)).toBeNull()
    expect(arrivalOf('after-collision')).toBeNull()
    expect(arrivalOf({ arrival: 'cleared' })).toBeNull()
  })
})
