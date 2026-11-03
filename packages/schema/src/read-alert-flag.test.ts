import { describe, expect, it } from 'vitest'
import { readAlertFlag } from './alert-flag'
import { loadFixture } from './test-fixtures'

const example = () => loadFixture('alert-flag', 'valid', 'ch7-example') as Record<string, unknown>

describe('UC-11 ゆるい受信（readAlertFlag）', () => {
  it('UC-11a: 正しいフラグ → そのまま読み、strict=true', () => {
    const { flag, problem } = readAlertFlag(JSON.stringify(example()))
    expect(problem).toBeUndefined()
    expect(flag).toEqual({
      deer: true,
      strict: true,
      conf: 0.94,
      distanceM: 58,
      side: 'L',
      zone: 'inside',
      zoneRemainingKm: 14.2,
    })
  })

  it('UC-11b: deer:true で distanceM が文字列・side が "X" → deer は読み、距離と side は無し', () => {
    const { flag, problem } = readAlertFlag({ ...example(), distanceM: '58', side: 'X' })
    expect(problem).toBe('partial')
    expect(flag?.deer).toBe(true)
    expect(flag?.strict).toBe(false)
    expect(flag).not.toHaveProperty('distanceM')
    expect(flag).not.toHaveProperty('side')
  })

  it('UC-11c: JSON でない・type が ack・deer が無い → null', () => {
    expect(readAlertFlag('{not json').flag).toBeNull()
    expect(readAlertFlag({ type: 'ack', t_shown: '2027-02-15T16:31:08.360+09:00' }).flag).toBeNull()
    expect(readAlertFlag({ type: 'flag', v: 1 }).flag).toBeNull()
    expect(readAlertFlag(null).flag).toBeNull()
    expect(readAlertFlag(42).problem).toBe('not_flag')
  })

  it('UC-11d: deer:true, conf 0.3 → deer:true のまま（間引かない）', () => {
    expect(readAlertFlag({ ...example(), conf: 0.3 }).flag).toMatchObject({ deer: true, conf: 0.3 })
  })

  it('負・NaN・Infinity の距離は無いものとして扱う', () => {
    const { flag } = readAlertFlag({ ...example(), distanceM: -1, zoneRemainingKm: Number.NaN })
    expect(flag).not.toHaveProperty('distanceM')
    expect(flag).not.toHaveProperty('zoneRemainingKm')
  })
})

describe('resilience', () => {
  it('FAIL-1: JSON でない文字列を受けても flag は null で、problem に受け取った本文が入らない', () => {
    const secret = '{"type":"flag","frameJpegB64":"AAAA-secret'
    const result = readAlertFlag(secret)
    expect(result.flag).toBeNull()
    expect(result.problem).toBe('invalid_json')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('FAIL-2: v:2 で deer:true のフラグ → deer:true として読む（danger になる）', () => {
    const { flag, problem } = readAlertFlag({ ...example(), v: 2 })
    expect(problem).toBe('partial')
    expect(flag).toMatchObject({ deer: true, strict: false, distanceM: 58, side: 'L' })
  })
})
