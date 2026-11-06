import { describe, expect, it } from 'vitest'
import type { Deer } from '../types'
import { deerEyeshine, eyeshineStrength, gazeHeading } from './eyeshine'

function deer(over: Partial<Deer>): Deer {
  return {
    id: 'x-0',
    candidateId: 'x',
    pattern: 'eyeshine',
    motion: 'eyeshine',
    seed: 1,
    phase: 'wait',
    index: 0,
    s: 1060,
    d: -1.75,
    heading: Math.PI,
    pose: 'idle',
    occluded: false,
    startedAt: null,
    gone: false,
    ...over,
  }
}

describe('eyeshine（R5、ch9 ②）', () => {
  it('UC-5f: ヘッドライトが鹿を向くほど強い（内積）', () => {
    const light = { pos: [0, 0] as const, dir: [1, 0] as const }
    // 鹿は 60 m 先で、いつもライトの方を向いている。ライトの向きだけを回す
    const eyePos = [60, 0] as const
    const eye = { pos: eyePos, dir: [-1, 0] as const }
    const at = (deg: number) => {
      const r = (deg * Math.PI) / 180
      return eyeshineStrength({ ...light, dir: [Math.cos(r), Math.sin(r)] }, eye)
    }
    expect(at(0)).toBeGreaterThan(0.95)
    expect(at(0)).toBeGreaterThan(at(8))
    expect(at(8)).toBeGreaterThan(at(16))
    expect(at(16)).toBeGreaterThan(at(24))
    // 照らす範囲（光の円錐）の外は 0
    expect(at(45)).toBe(0)
    expect(at(180)).toBe(0)
  })

  it('UC-5f: 鹿が背を向けると 0。横を向くと弱い', () => {
    const light = { pos: [0, 0] as const, dir: [1, 0] as const }
    const facing = eyeshineStrength(light, { pos: [60, 0], dir: [-1, 0] })
    const side = eyeshineStrength(light, { pos: [60, 0], dir: [-0.5, Math.sqrt(3) / 2] })
    const away = eyeshineStrength(light, { pos: [60, 0], dir: [1, 0] })
    expect(facing).toBeGreaterThan(side)
    expect(side).toBeGreaterThan(0)
    expect(away).toBe(0)
    expect(eyeshineStrength(light, { pos: [60, 0], dir: [0, 1] })).toBe(0)
  })

  it('UC-5f: 強さは 0〜1 で、遠すぎると 0', () => {
    const light = { pos: [0, 0] as const, dir: [1, 0] as const }
    for (const x of [5, 20, 60, 120, 150]) {
      const v = eyeshineStrength(light, { pos: [x, 0.5], dir: [-1, 0] })
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(eyeshineStrength(light, { pos: [400, 0], dir: [-1, 0] })).toBe(0)
  })

  it('UC-5f: 道の座標で: 車の前で車の方を向く鹿は光り、背を向けた鹿は光らない', () => {
    expect(deerEyeshine(deer({ heading: Math.PI }), 1000, -1.75)).toBeGreaterThan(0.8)
    expect(deerEyeshine(deer({ heading: 0 }), 1000, -1.75)).toBe(0)
    // 車の後ろの鹿は照らされない
    expect(deerEyeshine(deer({ s: 990 }), 1000, -1.75)).toBe(0)
  })

  it('UC-5f: 顔を上げた（look）鹿は首を車の方へ回すので、横を向いていても光る', () => {
    const sideways = deer({ heading: Math.PI / 2, d: -11 })
    const idle = deerEyeshine({ ...sideways, pose: 'idle' }, 1000, -1.75)
    const look = deerEyeshine({ ...sideways, pose: 'look' }, 1000, -1.75)
    expect(look).toBeGreaterThan(idle)
    // 首は体の向きから 100° までしか回らない
    const back = deer({ heading: 0, pose: 'look' })
    expect(Math.abs(gazeHeading(back, 1000, -1.75))).toBeLessThanOrEqual(
      (100 * Math.PI) / 180 + 1e-9,
    )
  })
})
